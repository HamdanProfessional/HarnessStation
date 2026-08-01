import { invoke } from "@tauri-apps/api/core";
import { startRecording, type Recorder } from "./audio";
import {
  ensureWhisper,
  transcribeFast,
  startSttServer,
  stopSttServer,
  DEFAULT_STT,
  type SttModelId,
} from "./whisper";
import { streamChat } from "./providers";
import { speakQueued, stopSpeaking, whenSpoken, speakableText } from "./tts";
import {
  recall,
  recallBlock,
  shouldExtract,
  markExtracted,
  extractAndStore,
  GLOBAL_MEMORY,
} from "./memory";
import { retrieveMultiContext } from "./rag";
import { prettyName } from "./format";
import { skillIndexPrompt, listSkills } from "./skills";
import { pickFiller } from "./humanize";
import { DEFAULT_STT_LANG, sttLanguageName } from "./whisper";
import { capExceeded, recordUsage, syncTray } from "./budget";
import type {
  Agent,
  KnowledgeBase,
  Message,
  Provider,
  Settings,
  Tool,
  VoiceMode,
} from "./types";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

export interface VoiceCallbacks {
  onState: (s: VoiceState) => void;
  onLevel: (level: number) => void;
  onStatus: (s: string | null) => void;
  onUser: (text: string) => void;
  /**
   * Rolling transcript of what you're saying right now, before the turn ends.
   * Lets you see what it actually heard as you speak, rather than after.
   */
  onPartial?: (text: string) => void;
  onDelta: (text: string) => void;
  onAssistant: (text: string) => void;
  onAction: (label: string) => void;
  onError: (msg: string) => void;
}

export interface VoiceContext {
  settings: Settings;
  provider?: Provider;
  model: string;
  /** Tools the avatar may call this turn (already resolved from the agent or picker). */
  tools: Tool[];
  /** Runs a tool — injected so agent:/workflow:/MCP routing stays in one place. */
  execTool: (tool: Tool, args: Record<string, unknown>) => Promise<string>;
  /** Agent driving the avatar, if one is selected. */
  agent?: Agent;
  knowledgeBases?: KnowledgeBase[];
}

const DEFAULT_THRESHOLD = 0.02;
const DEFAULT_SILENCE_MS = 900;
const MAX_UTTERANCE_MS = 25_000;
const IDLE_RESTART_MS = 30_000; // recycle a silent recording so the WAV stays small
const MIN_UTTERANCE_MS = 350;

const DEFAULT_HOLD_MS = 2200; // extra grace when the sentence sounds unfinished
const MAX_HOLDS = 4; // never wait forever for a sentence to land

/**
 * Words that almost never end a spoken sentence. If the transcript stops on one,
 * the speaker paused mid-thought ("hi, I want you to…") rather than finished.
 */
const DANGLING = new Set(
  `and but or so then because since although while if unless until whether
   to the a an this that these those my our your their its his her
   with for from about into onto over under between of in on at as by like
   i we you he she it they there here
   is are am was were be been being do does did doing done
   can could would should will shall may might must have has had
   want wants wanted need needs needed going gonna wanna trying try let lets
   make made get got put take give tell show find send create write add
   um uh erm hmm mm er ah oh well just really very quite kind sort`.split(/\s+/),
);

/** One-word replies that are genuinely complete on their own. */
const STANDALONE = new Set(
  `yes yeah yep no nope nah hi hello hey stop cancel thanks ok okay sure done
   continue next back repeat quiet louder help what why how who when where`.split(/\s+/),
);

/**
 * Rough "did they finish the sentence?" check on a transcript. Cheap and local —
 * it only has to be right often enough to stop the avatar interrupting a pause.
 */
export function looksComplete(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/[?!]$/.test(t)) return true; // a question is a finished thought
  if (/[,:;–—-]$/.test(t)) return false; // Whisper heard the sentence trail off
  const words = t
    .toLowerCase()
    .replace(/[^\w\s']+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return true;
  const last = words[words.length - 1];
  if (DANGLING.has(last)) return false;
  if (words.length === 1) return STANDALONE.has(last);
  return true;
}

/** Whisper emits these for silence/noise — treat as "nothing said". */
const NOISE = /^[\s.,!?-]*$|^\[?\(?(blank[_ ]?audio|inaudible|silence|music|sounds?)\)?\]?[\s.]*$/i;

const BASE_PROMPT = `You are a voice assistant. Your replies are spoken aloud, so:
- Answer directly and immediately. Never narrate your reasoning or think out loud.
- Keep it to 1–3 short sentences unless the user explicitly asks for more.
- Plain conversational language. No markdown, no bullet points, no code blocks, no emoji.
- If you don't know, say so briefly. If the request is ambiguous, ask one short question.
Sound natural, like a person talking — not like a document being read.`;

/**
 * Layered on top of BASE_PROMPT when "sound human" is on. Written speech and spoken
 * speech are different registers — this asks for the spoken one.
 */
const HUMAN_PROMPT = `Talk the way a real person talks, not the way writing reads:
- Use contractions always — "I'll", "that's", "don't", "you're". Never the long forms.
- Vary your rhythm. Mix a short punchy sentence with a longer one. Never two sentences of the same shape in a row.
- React before you answer, in two or three words: "Ah, got it." / "Yeah —" / "Hmm, okay." Then answer.
- Use everyday words. "Set it up", not "configure it". "Fix", not "remediate".
- It's fine to start a sentence with And, But, or So. It's fine to trail off with "…" when you're thinking.
- Never list things out loud with numbers. Say "a couple of things — first… and then…".
- Don't repeat the user's question back. Don't say "Certainly", "Of course", "I'd be happy to", "Great question".
- If something's annoying or funny, you can say so. A little warmth and opinion is what makes you sound real.`;

const PERSONAS: Record<string, string> = {
  friendly: "Your manner is warm and easy-going, like a friend who knows their stuff. Light humour is welcome.",
  calm: "Your manner is calm, steady and unhurried. Short sentences. You never sound rushed or excitable.",
  upbeat: "Your manner is bright and energetic. You sound genuinely pleased to help, without being saccharine.",
  professional: "Your manner is crisp and competent — friendly but efficient, like a good colleague at work.",
};

const TOOL_PROMPT = `You have tools and you are expected to USE them to actually do things —
search, read and write files, run commands, generate media, call other agents — not just talk about them.
Act first, then report the result in one or two spoken sentences. Never read raw output, file paths,
JSON or code aloud: summarize what happened ("Done — I saved it to your desktop"). If a tool fails,
say what failed in plain words and what you'll try next.`;

const MAX_TOOL_ROUNDS = 8;

/**
 * If `text` is addressed to the avatar, return it with the wake phrase removed;
 * otherwise null. Tolerates Whisper's punctuation ("Hey, Nova — ...").
 */
function stripWake(text: string, wake: string): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const t = norm(text);
  const w = norm(wake);
  if (!w) return text;
  if (t === w) return "";
  if (t.startsWith(`${w} `)) {
    // map back to the original string, minus the leading wake words
    const words = text.split(/\s+/);
    const wakeWords = w.split(" ").length;
    return words.slice(wakeWords).join(" ").replace(/^[\s,.:;—-]+/, "");
  }
  return t.includes(w) ? text : null;
}

/**
 * The last `max` messages, trimmed forward to start on a user turn.
 *
 * A plain `slice(-n)` can cut between an assistant message carrying `tool_calls`
 * and the `tool` results answering it. Strict OpenAI-compatible endpoints reject
 * that outright ("tool message must follow a message with tool_calls"), so a long
 * spoken conversation that used tools would start failing mid-session.
 */
export function conversationWindow(history: Message[], max = 16): Message[] {
  if (history.length <= max) return history.slice();
  let start = history.length - max;
  while (start < history.length && history[start].role !== "user") start++;
  if (start >= history.length) {
    // The whole tail is tool traffic — fall back to the last complete user turn.
    const lastUser = history.map((m) => m.role).lastIndexOf("user");
    if (lastUser === -1) return [];
    start = lastUser;
  }
  return history.slice(start);
}

/** Split off any complete sentences so they can be spoken while the rest streams in. */
function takeSentences(buf: string): { ready: string; rest: string } {
  const m = [...buf.matchAll(/[.!?…]["')\]]*\s|\n+/g)];
  if (!m.length) return { ready: "", rest: buf };
  const last = m[m.length - 1];
  const cut = (last.index ?? 0) + last[0].length;
  return { ready: buf.slice(0, cut), rest: buf.slice(cut) };
}

export class VoiceSession {
  private state: VoiceState = "idle";
  private mode: VoiceMode = "ptt";
  private running = false;
  private recorder: Recorder | null = null;
  private timer: number | null = null;
  private aborter: AbortController | null = null;
  private history: Message[] = [];

  // VAD bookkeeping
  private listenStart = 0;
  private lastLoud = 0;
  private heardSpeech = false;
  private busy = false;
  /** Wake-word mode: follow-ups are accepted without the wake phrase until this time. */
  private awakeUntil = 0;
  private loudSince = 0;
  /** Live transcript of the segment being spoken, for on-screen feedback. */
  private partial = "";
  /** Guards the rolling transcription so passes can't pile up on a slow machine. */
  private partialBusy = false;
  private lastPartialAt = 0;
  /** Transcript of a sentence that sounded unfinished — waiting for the rest. */
  private pending = "";
  private holds = 0;
  /** The saved Chat backing this session, so it survives a restart and can resume. */
  private chatId: string | null = null;
  /**
   * Store handle, resolved when the chat is opened. Held so `persist` can write
   * synchronously — going through a dynamic import each time made saving
   * fire-and-forget, so a turn could be lost if the app closed right after it.
   */
  private store: typeof import("./store").useStore | null = null;

  constructor(
    private cb: VoiceCallbacks,
    private getCtx: () => VoiceContext,
  ) {}

  /**
   * Point the session at a fresh set of callbacks. Needed for background mode: the
   * session outlives the view, so when the view remounts its old setState closures
   * are stale and must be swapped out.
   */
  rebind(cb: VoiceCallbacks, getCtx: () => VoiceContext): void {
    this.cb = cb;
    this.getCtx = getCtx;
  }

  /** Conversation so far, so a remounted view can redraw the transcript. */
  getHistory(): Message[] {
    return this.history.slice();
  }

  /** The saved chat this session is writing to, if any. */
  getChatId(): string | null {
    return this.chatId;
  }

  /**
   * Attach to a saved voice chat (resuming its transcript) or start a fresh one.
   * Spoken sessions are ordinary Chat records, so they get history, search,
   * export, snapshots and compaction on exactly the same terms as typed chats.
   */
  private async openChat(chatId?: string): Promise<void> {
    const { useStore } = await import("./store");
    this.store = useStore;
    if (chatId) {
      await useStore.getState().hydrateChat(chatId);
      const chat = useStore.getState().chats.find((c) => c.id === chatId);
      this.chatId = chatId;
      this.history = chat ? chat.messages.slice() : [];
      return;
    }
    // Deliberately no chat yet. Creating one here meant every start/stop left an
    // empty "Voice chat — …" in the sidebar even if you never said anything.
    // The chat is created on the first turn instead — see ensureChat().
    this.chatId = null;
    this.history = [];
  }

  /** The chat to write to, created on demand so silent calls leave no trace. */
  private ensureChat(): string | null {
    if (this.chatId) return this.chatId;
    if (!this.store) return null;
    const st = this.store.getState();
    this.chatId = st.newVoiceChat();
    // Now that the call has something in it, let the sidebar mark it live.
    st.setActiveVoiceChat(this.chatId);
    return this.chatId;
  }

  /** Write the transcript back to its chat. Coalesced by the store, so cheap. */
  private persist(): void {
    if (!this.history.length) return; // nothing said yet — don't create a chat
    const id = this.ensureChat();
    if (!id || !this.store) return;
    const st = this.store.getState();
    const chat = st.chats.find((c) => c.id === id);
    if (!chat) return;
    const patch: Partial<import("./types").Chat> = { messages: this.history.slice() };
    // Name it from the first thing actually said, like a typed chat does.
    const firstUser = this.history.find((m) => m.role === "user")?.content.trim();
    if (firstUser && chat.title.startsWith("Voice chat — ")) {
      patch.title = firstUser.length > 42 ? `${firstUser.slice(0, 42)}...` : firstUser;
    }
    st.updateChatById(id, patch);
  }

  /**
   * Fold older turns into a summary once the transcript grows past the threshold,
   * so a long spoken session doesn't run out of context. Same mechanism, settings
   * and storage as the typed chat.
   */
  private async maybeCompact(settings: Settings): Promise<void> {
    if (!this.chatId || !settings.autoCompact) return;
    const est = this.history.reduce((n, m) => n + m.content.length, 0) / 4;
    if (est <= (settings.compactThreshold ?? 8000)) return;
    const useStore = this.store ?? (await import("./store")).useStore;
    try {
      await useStore.getState().compactChat(this.chatId);
    } catch {
      /* compaction is an optimisation — never block the reply */
    }
  }

  /** Compact this session's transcript now (manual trigger from the UI). */
  async compactNow(): Promise<void> {
    if (!this.chatId) return;
    const useStore = this.store ?? (await import("./store")).useStore;
    await useStore.getState().compactChat(this.chatId);
  }

  /** Summary + the turns it doesn't already cover, for the request. */
  private async requestMessages(): Promise<{ messages: Message[]; summaryNote: string }> {
    if (!this.chatId || !this.store) {
      return { messages: conversationWindow(this.history), summaryNote: "" };
    }
    const chat = this.store.getState().chats.find((c) => c.id === this.chatId);
    if (!chat?.summary) return { messages: conversationWindow(this.history), summaryNote: "" };
    const rest = this.history.slice(chat.summaryUpto ?? 0);
    return {
      messages: conversationWindow(rest),
      summaryNote: `\n\nSummary of earlier conversation:\n${chat.summary}`,
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  getMode(): VoiceMode {
    return this.mode;
  }

  getState(): VoiceState {
    return this.state;
  }

  private setState(s: VoiceState) {
    this.state = s;
    this.cb.onState(s);
    // Surface the state on the tray tooltip — in background mode that's the only
    // indication the avatar is live.
    void syncTray(s === "idle" ? "" : s === "listening" ? "listening" : s === "thinking" ? "working" : "speaking");
  }

  private cfg() {
    const v = this.getCtx().settings.voice ?? {};
    return {
      threshold: v.threshold ?? DEFAULT_THRESHOLD,
      silenceMs: v.silenceMs ?? DEFAULT_SILENCE_MS,
      speak: v.speakReplies ?? true,
      instructions: v.instructions ?? "",
      narrate: v.narrateActions ?? true,
      wake: (v.wakeWord ?? "").trim().toLowerCase(),
      followUpMs: (v.followUpSeconds ?? 20) * 1000,
      bargeIn: v.bargeIn ?? false,
      smartEndpoint: v.smartEndpoint ?? true,
      holdMs: v.holdMs ?? DEFAULT_HOLD_MS,
      human: v.humanDelivery ?? true,
      persona: v.persona ?? "friendly",
      noThink: v.noThinking ?? true,
      language: v.language ?? DEFAULT_STT_LANG,
      translate: v.translateToEnglish ?? false,
      replyLanguage: v.replyLanguage ?? "match",
      liveTranscript: v.liveTranscript ?? true,
    };
  }

  /** Speech-to-text options for this session (spoken language / translation). */
  private sttOpts() {
    const { language, translate } = this.cfg();
    return { language, translate };
  }

  /**
   * Begin a session. In "auto" mode it listens continuously with silence detection.
   * Pass a chat id to pick up a previous spoken conversation where it left off.
   */
  async start(mode: VoiceMode, chatId?: string) {
    this.mode = mode;
    this.running = true;
    this.awakeUntil = 0;
    await this.openChat(chatId);
    if (!this.timer) {
      this.timer = window.setInterval(() => void this.tick(), 80);
    }
    // Warm the speech-to-text server so the model is already loaded for the first utterance.
    const stt = (this.getCtx().settings.voice?.sttModel as SttModelId) || DEFAULT_STT;
    void ensureWhisper((s) => this.cb.onStatus(s), stt).then(() => {
      this.cb.onStatus(null);
      void startSttServer(stt);
    });
    if (mode === "auto") await this.beginListening();
  }

  /** Stop everything: recording, generation, and speech. */
  async stop() {
    this.running = false;
    this.pending = "";
    this.partial = "";
    this.cb.onPartial?.("");
    this.holds = 0;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.aborter?.abort();
    this.aborter = null;
    await this.discardRecording();
    await stopSpeaking();
    void stopSttServer(); // free the loaded model when the avatar is off
    this.cb.onLevel(0);
    this.cb.onStatus(null);
    this.setState("idle");
  }

  setMode(mode: VoiceMode) {
    this.mode = mode;
  }

  /** Push-to-talk key went down. */
  async pttDown() {
    if (!this.running || this.busy) return;
    await stopSpeaking(); // barge-in: talking over the avatar interrupts it
    await this.beginListening();
  }

  /** Push-to-talk key released — process what was said. */
  async pttUp() {
    if (this.state !== "listening") return;
    await this.finishUtterance();
  }

  /** Open the mic without changing state (used for barge-in monitoring). */
  private async openMic(): Promise<boolean> {
    if (this.recorder) return true;
    try {
      this.recorder = await startRecording(this.getCtx().settings.voice?.micDevice);
      this.listenStart = Date.now();
      this.lastLoud = 0;
      this.heardSpeech = false;
      this.loudSince = 0;
      return true;
    } catch {
      return false;
    }
  }

  private async beginListening() {
    if (this.recorder || this.busy) return;
    try {
      this.recorder = await startRecording(this.getCtx().settings.voice?.micDevice);
      this.listenStart = Date.now();
      this.lastLoud = 0;
      this.heardSpeech = false;
      this.loudSince = 0;
      this.setState("listening");
    } catch (e) {
      this.cb.onError(`Microphone unavailable: ${(e as Error).message || String(e)}`);
      this.running = false;
      this.setState("idle");
    }
  }

  private async discardRecording() {
    if (!this.recorder) return;
    const rec = this.recorder;
    this.recorder = null;
    try {
      await rec.stopPath();
    } catch {
      /* already stopped */
    }
  }

  /** Poll the mic level: drives the orb, and the silence detection in auto mode. */
  private async tick() {
    if (!this.running) return;
    let level = 0;
    try {
      level = await invoke<number>("mic_level");
    } catch {
      /* not recording */
    }
    const { threshold, silenceMs, bargeIn, holdMs } = this.cfg();

    // Barge-in: while the avatar is speaking we keep a recorder open and watch for
    // sustained, clearly-louder-than-threshold input, then cut it off and listen.
    if (bargeIn && this.state === "speaking" && this.recorder) {
      const now = Date.now();
      if (level > threshold * 2.5) {
        if (!this.loudSince) this.loudSince = now;
        if (now - this.loudSince > 250) {
          this.loudSince = 0;
          await stopSpeaking();
          this.setState("listening");
          this.listenStart = now;
          this.lastLoud = now;
          this.heardSpeech = true;
        }
      } else {
        this.loudSince = 0;
      }
      this.cb.onLevel(level);
      return;
    }

    this.cb.onLevel(this.state === "listening" ? level : 0);
    if (this.state !== "listening" || !this.recorder) return;
    void this.updatePartial();
    const now = Date.now();
    if (level > threshold) {
      this.lastLoud = now;
      this.heardSpeech = true;
    }
    if (this.mode !== "auto") return;

    const elapsed = now - this.listenStart;
    // While we're holding a half-finished sentence, give the speaker the longer
    // grace window — they're mid-thought, not done.
    const wait = this.pending ? Math.max(silenceMs, holdMs) : silenceMs;
    if (this.heardSpeech && this.lastLoud && now - this.lastLoud > wait) {
      await this.finishUtterance();
    } else if (elapsed > MAX_UTTERANCE_MS && this.heardSpeech) {
      await this.finishUtterance();
    } else if (this.pending && !this.heardSpeech && elapsed > holdMs) {
      // they never carried on — commit what we already have
      await this.finishUtterance();
    } else if (!this.heardSpeech && elapsed > IDLE_RESTART_MS) {
      await this.discardRecording();
      await this.beginListening();
    }
  }

  /**
   * Rolling transcription of the segment in progress.
   *
   * Whisper has no streaming mode here, so this re-transcribes the audio captured
   * so far every second or so and shows the result. It's throttled and skipped
   * while a pass is already running, so on a slow machine it degrades to fewer
   * updates rather than queueing work — and it never blocks the real transcript,
   * which is still produced once from the final segment.
   */
  private async updatePartial(): Promise<void> {
    if (!this.cfg().liveTranscript || !this.cb.onPartial) return;
    if (this.partialBusy || !this.recorder || !this.heardSpeech) return;
    const now = Date.now();
    if (now - this.lastPartialAt < 900) return;
    this.lastPartialAt = now;
    this.partialBusy = true;
    try {
      const wav = await this.recorder.snapshotPath();
      const stt = (this.getCtx().settings.voice?.sttModel as SttModelId) || DEFAULT_STT;
      const text = (await transcribeFast(wav, stt, this.sttOpts())).trim();
      // Still listening to the same segment? (A turn may have ended meanwhile.)
      if (!this.recorder || this.state !== "listening") return;
      if (text && !NOISE.test(text)) {
        this.partial = text;
        this.cb.onPartial?.([this.pending, text].filter(Boolean).join(" "));
      }
    } catch {
      /* no audio yet, or the model is busy — try again next tick */
    } finally {
      this.partialBusy = false;
      this.lastPartialAt = Date.now();
    }
  }

  /** Stop recording, transcribe, and respond. */
  private async finishUtterance() {
    if (!this.recorder || this.busy) return;
    const rec = this.recorder;
    const spokeFor = Date.now() - this.listenStart;
    this.busy = true;
    // In hands-free mode the mic stays open across transcription and the reply,
    // so anything said in that window is captured instead of falling into a
    // deaf gap. Push-to-talk still stops, because the key press defines the turn.
    const continuous = this.mode === "auto";
    if (!continuous) this.recorder = null;
    const livePartial = this.partial;
    // Read the VAD result for the segment being handed over BEFORE resetting it
    // for the next one — this is what decides whether to transcribe at all.
    const spoke = this.heardSpeech;
    try {
      const wav = continuous ? await rec.takePath() : await rec.stopPath();
      if (continuous) {
        // The segment just taken is consumed; the next one starts from now.
        this.listenStart = Date.now();
        this.lastLoud = 0;
        this.heardSpeech = false;
        this.partial = "";
      }
      const nothing = spokeFor < MIN_UTTERANCE_MS || (this.mode === "auto" && !spoke);
      let chunk = "";
      if (!nothing) {
        this.setState("thinking");
        this.cb.onStatus("Transcribing…");
        const stt = (this.getCtx().settings.voice?.sttModel as SttModelId) || DEFAULT_STT;
        await ensureWhisper((s) => this.cb.onStatus(s), stt);
        chunk = (await transcribeFast(wav, stt, this.sttOpts())).trim();
        this.cb.onStatus(null);
        if (NOISE.test(chunk)) chunk = "";
        // The live pass already transcribed this audio once. If the final pass
        // comes back empty but the rolling one heard words, trust those rather
        // than dropping the turn entirely.
        if (!chunk && livePartial && !NOISE.test(livePartial)) chunk = livePartial;
      }
      // Nothing new in this slice: if we were holding a half-sentence, send it now.
      if (!chunk && !this.pending) return;

      const { wake, followUpMs, smartEndpoint, holdMs } = this.cfg();
      const text = [this.pending, chunk].filter(Boolean).join(" ").trim();

      // Smart endpointing: a pause after "…I want you to" isn't the end of a turn.
      // Keep the transcript, listen for the rest, and stitch it together.
      if (
        this.mode === "auto" &&
        smartEndpoint &&
        chunk &&
        this.holds < MAX_HOLDS &&
        !looksComplete(text)
      ) {
        this.pending = text;
        this.holds++;
        this.cb.onStatus(`Go on… (${Math.round(holdMs / 100) / 10}s)`);
        return; // finally-block reopens the mic
      }
      this.pending = "";
      this.holds = 0;
      if (!text) return;

      // Wake word (auto mode): ignore anything that isn't addressed to the avatar,
      // but stay awake briefly afterwards so follow-ups don't need the phrase again.
      let spoken = text;
      if (wake && this.mode === "auto") {
        const stripped = stripWake(text, wake);
        if (stripped !== null) {
          spoken = stripped || "Yes?";
        } else if (Date.now() > this.awakeUntil) {
          this.cb.onStatus(null);
          return; // not addressed to us
        }
      }
      this.awakeUntil = Date.now() + followUpMs;
      this.partial = "";
      this.cb.onPartial?.("");
      this.cb.onUser(spoken);
      await this.respond(spoken);
      this.awakeUntil = Date.now() + followUpMs;
      void this.harvestMemory(spoken);
    } catch (e) {
      this.cb.onStatus(null);
      this.cb.onError((e as Error).message || String(e));
    } finally {
      this.busy = false;
      if (this.running && this.mode === "auto") {
        if (this.recorder) {
          // Already open — either continuous listening or the barge-in mic.
          // Keep whatever was said during the reply rather than resetting it.
          if (!this.heardSpeech) this.listenStart = Date.now();
          this.loudSince = 0;
          this.setState("listening");
        } else {
          await this.beginListening();
        }
      } else if (this.running) {
        this.setState("idle");
      }
    }
  }

  /** Passive memory write path — background, never blocks the next utterance. */
  private async harvestMemory(userText: string): Promise<void> {
    const ctx = this.getCtx();
    if (!ctx.settings.passiveMemory || !ctx.provider || !ctx.model) return;
    try {
      if (!(await shouldExtract(GLOBAL_MEMORY, userText))) return;
      const transcript = this.history
        .filter((m) => m.role !== "tool")
        .slice(-14)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");
      await extractAndStore(GLOBAL_MEMORY, transcript, ctx.provider, ctx.model);
      markExtracted(GLOBAL_MEMORY);
    } catch {
      /* best-effort */
    }
  }

  /** Build the system prompt: voice style + agent instructions + persona + memory + knowledge. */
  private async buildSystem(userText: string, ctx: VoiceContext): Promise<string> {
    const { instructions, human, persona, language, replyLanguage, noThink } = this.cfg();
    const parts = [BASE_PROMPT];
    // Prompt-level backstop for models that ignore the API switches. "/no_think" is
    // the Qwen3 convention and is harmless text to everything else.
    if (noThink) {
      parts.push(
        "/no_think\nDo not think step by step and do not emit any reasoning or <think> blocks. Answer immediately in your first tokens.",
      );
    }
    if (human) parts.push(HUMAN_PROMPT);
    if (persona && PERSONAS[persona]) parts.push(PERSONAS[persona]);
    // Which language to answer in. "match" tracks whatever the user just spoke.
    if (replyLanguage === "match") {
      const named = sttLanguageName(language);
      parts.push(
        named
          ? `The user speaks ${named}. Reply in ${named} unless they switch language, in which case follow them.`
          : `Always reply in the same language the user just spoke.`,
      );
    } else if (replyLanguage && replyLanguage !== "auto") {
      const named = sttLanguageName(replyLanguage) || replyLanguage;
      parts.push(`Always reply in ${named}, whatever language the user speaks.`);
    }
    if (ctx.tools.length) parts.push(TOOL_PROMPT);
    if (ctx.tools.some((t) => t.id === "use_skill")) {
      const idx = skillIndexPrompt(await listSkills());
      if (idx) parts.push(idx);
    }
    if (ctx.agent?.instructions?.trim()) parts.push(ctx.agent.instructions.trim());
    if (instructions.trim()) parts.push(instructions.trim());

    // Passive memory: the avatar recalls what the app already knows about you,
    // agent or not, without spending a tool call on it.
    if (ctx.settings.passiveMemory) {
      try {
        const block = await recallBlock(GLOBAL_MEMORY, userText, ctx.settings.memoryK ?? 6);
        if (block) parts.push(block);
      } catch {
        /* best-effort */
      }
    }

    if (ctx.agent) {
      try {
        const mem = await recall(ctx.agent.id, userText, 6);
        if (mem.length) parts.push(`Relevant long-term memory:\n${mem.map((m) => `- ${m}`).join("\n")}`);
      } catch {
        /* memory is best-effort */
      }
      const kbIds = ctx.agent.knowledgeBaseIds ?? [];
      if (kbIds.length && ctx.knowledgeBases?.length) {
        const kbs = ctx.knowledgeBases.filter((k) => kbIds.includes(k.id));
        if (kbs.length) {
          try {
            const rag = await retrieveMultiContext(kbs, userText, (kb) =>
              ctx.settings.providers.find((p) => p.id === kb.embedProviderId),
            );
            if (rag) parts.push(rag);
          } catch {
            /* knowledge is best-effort */
          }
        }
      }
    }
    return parts.join("\n\n");
  }

  /**
   * Stream a spoken reply, running tools as the model asks for them.
   * Sentences are spoken as soon as they're complete so the reply starts fast.
   */
  private async respond(userText: string) {
    const ctx = this.getCtx();
    const { settings, provider, model } = ctx;
    // re-read per round so a tool enabled mid-turn (enable_tool) is usable at once
    let tools = ctx.tools;
    if (!provider || !model) {
      this.cb.onError("Pick a provider and model for the voice assistant first.");
      return;
    }
    const { speak, narrate } = this.cfg();
    this.setState("thinking");
    this.history.push({ role: "user", content: userText });
    this.persist();

    // Spend cap applies to the avatar too — it's the surface most likely to be
    // left running unattended.
    const capped = capExceeded(settings.dailyCapUsd, settings.monthlyCapUsd);
    if (capped) {
      this.cb.onError(capped);
      this.setState("idle");
      return;
    }

    // Fold old turns away before they push the request over the context limit.
    await this.maybeCompact(settings);

    const aborter = new AbortController();
    this.aborter = aborter;
    const { summaryNote } = await this.requestMessages();
    const system = (await this.buildSystem(userText, ctx)) + summaryNote;
    let spokeAny = false;
    let saidFiller = false;
    let finalText = "";

    // Speak in reasonably sized chunks: a short reply ("Hi there. How can I help?")
    // goes out as ONE utterance instead of two, which sounds far more natural.
    const MIN_SPEAK_CHARS = 90;
    const flush = (chunk: string, force = false) => {
      if (!speak) return chunk;
      const { ready, rest } = force ? { ready: chunk, rest: "" } : takeSentences(chunk);
      if (!force && ready.trim().length < MIN_SPEAK_CHARS) return chunk; // keep accumulating
      if (ready.trim()) {
        const line = speakableText(ready);
        if (line) {
          if (!spokeAny) {
            spokeAny = true;
            this.setState("speaking");
          }
          speakQueued(line, settings);
        }
      }
      return rest;
    };

    // Same stuck-loop guard as the chat and agent loops.
    let lastSig = "";
    let repeats = 0;

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (round > 0) tools = this.getCtx().tools;
        let text = "";
        let buf = "";
        const result = await streamChat({
          provider,
          model,
          system,
          messages: (await this.requestMessages()).messages,
          temperature: 0.6,
          maxTokens: 0,
          noThinking: this.cfg().noThink,
          tools: tools.length ? tools : undefined,
          signal: aborter.signal,
          onDelta: (d) => {
            text += d;
            this.cb.onDelta(d);
            buf = flush(buf + d);
          },
        });
        buf = flush(buf, true);
        if (result.usage) {
          recordUsage(provider.id, model, result.usage.promptTokens, result.usage.completionTokens);
        }

        if (!result.toolCalls?.length) {
          finalText = text;
          this.history.push({ role: "assistant", content: text });
          break;
        }

        const sig = result.toolCalls.map((c) => `${c.name}:${c.arguments}`).join("|");
        repeats = sig === lastSig ? repeats + 1 : 0;
        lastSig = sig;
        if (repeats >= 2) {
          finalText = text || "That didn't work — I kept trying the same thing. Want me to try another way?";
          this.history.push({ role: "assistant", content: finalText });
          if (speak) speakQueued(finalText, settings);
          break;
        }

        // Cover tool latency with a short spoken filler, once per turn.
        if (speak && narrate && !spokeAny && !saidFiller) {
          saidFiller = true;
          spokeAny = true;
          this.setState("speaking");
          speakQueued(pickFiller(), settings);
        }
        this.history.push({ role: "assistant", content: text, toolCalls: result.toolCalls });
        this.setState("thinking");

        for (const call of result.toolCalls) {
          const tool = tools.find((t) => t.name === call.name);
          this.cb.onStatus(`${prettyName(call.name)}…`);
          this.cb.onAction(prettyName(call.name));
          let output: string;
          try {
            const args = JSON.parse(call.arguments || "{}");
            output = tool ? await ctx.execTool(tool, args) : `Error: unknown tool ${call.name}`;
          } catch (e) {
            output = `Error: ${(e as Error).message || String(e)}`;
          }
          if (output.startsWith("data:")) output = `[${call.name} produced media for the user]`;
          this.history.push({ role: "tool", content: output.slice(0, 6000), toolCallId: call.id });
        }
        this.cb.onStatus(null);
      }

      if (!finalText) {
        finalText = "I ran out of steps on that one — want me to keep going?";
        if (speak) speakQueued(finalText, settings);
      }
      this.persist(); // the turn is complete — save the transcript
      this.cb.onAssistant(finalText);
      if (speak && spokeAny) {
        this.setState("speaking");
        // Keep the mic open so the user can talk over the reply.
        if (this.cfg().bargeIn && this.mode === "auto") await this.openMic();
        await whenSpoken();
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        this.cb.onError((e as Error).message || String(e));
      }
    } finally {
      this.cb.onStatus(null);
      this.aborter = null;
    }
  }

  /** Interrupt the current reply (stop generating and speaking). */
  async interrupt() {
    this.aborter?.abort();
    await stopSpeaking();
    if (this.running && this.mode === "auto" && !this.busy) await this.beginListening();
    else if (this.running) this.setState("idle");
  }

  /** Start a new spoken conversation, leaving the previous one saved. */
  async clearHistory(): Promise<void> {
    this.history = [];
    if (this.running) await this.openChat();
    else this.chatId = null;
  }
}
