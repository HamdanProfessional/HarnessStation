import { invoke } from "@tauri-apps/api/core";
import { generateMedia, mediaConfigFromSettings } from "./media";
import { humanSsml, spokenForm } from "./humanize";
import { rewriteForSpeech, speechModel } from "./speechRewrite";
import { sttLanguageName } from "./whisper";
import {
  detectLang,
  missingVoiceHelp,
  voiceForLang,
  winrtSpeakToDataUrl,
} from "./sysvoice";
import { toast } from "./toast";
import { bandLevel } from "./loudness";

/** Only warn once per language, not once per sentence. */
let lastMissingLang: string | null = null;

/** The language the user configured, if they pinned one. */
function preferredLang(settings: Settings): string {
  const reply = settings.voice?.replyLanguage;
  if (reply && reply !== "match") return reply;
  const spoken = settings.voice?.language;
  return spoken && spoken !== "auto" ? spoken : "";
}
import type { Settings } from "./types";

/**
 * Speech output for the talking avatar.
 *
 * Uses the built-in Windows voice (offline, zero setup) by default, and automatically
 * upgrades to the configured media TTS model (OpenAI-compatible / local) when one exists.
 * Utterances are queued so streamed sentences play back in order without overlapping.
 */

/**
 * Queued utterances. Each entry is a promise so an optional small-model rewrite
 * (see speechRewrite.ts) can run *while the previous sentence is still playing* —
 * by the time we get to it, it's usually already resolved.
 */
let queue: Promise<string>[] = [];
let draining = false;
let cancelled = false;
let currentAudio: HTMLAudioElement | null = null;

// ---------- real-time speech loudness (avatar lip-sync) ----------
//
// While a data-URL utterance plays, its <audio> element is routed through an
// AnalyserNode so the avatar can drive the mouth from what is actually being
// heard. The native SAPI engine plays inside Rust with no element to analyse —
// currentSpeechLevel() returns null there and the caller falls back to the
// synthetic envelope.

let audioCtx: AudioContext | null = null;
let activeAnalyser: AnalyserNode | null = null;
let levelBuf: Uint8Array | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctor!();
  }
  return audioCtx;
}

/**
 * Route `audio` through the analyser and to the speakers.
 *
 * The context only runs after the user has interacted with the page (sticky
 * activation), so this can refuse: before the first click, wiring would both
 * mute playback (a suspended graph swallows the element's output) and give no
 * levels. Refusing keeps speech working; lip-sync just waits a sentence.
 */
async function routeThroughAnalyser(
  audio: HTMLAudioElement,
): Promise<{ analyser: AnalyserNode; source: MediaElementAudioSourceNode } | null> {
  try {
    const ctx = getCtx();
    if (ctx.state !== "running") {
      // Re-read via a widened local: TS keeps the pre-await narrowing on
      // ctx.state, but resuming is exactly what may have changed it.
      await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
      if ((ctx.state as string) !== "running") return null;
    }
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6; // steadier mouth, less strobing
    source.connect(analyser);
    analyser.connect(ctx.destination);
    return { analyser, source };
  } catch {
    return null;
  }
}

/**
 * Loudness of the currently playing utterance, 0..1 — or null when nothing is
 * playing or the current engine cannot be analysed. Polled once per animation
 * frame by the avatar loop; deliberately cheap.
 */
export function currentSpeechLevel(): number | null {
  const audio = currentAudio;
  const analyser = activeAnalyser;
  if (!audio || !analyser || audio.paused || audio.ended) return null;
  try {
    const bins = analyser.frequencyBinCount;
    if (!levelBuf || levelBuf.length !== bins) levelBuf = new Uint8Array(bins);
    analyser.getByteFrequencyData(levelBuf as Uint8Array<ArrayBuffer>);
    return bandLevel(levelBuf, analyser.context.sampleRate);
  } catch {
    return null;
  }
}

/**
 * Everyone waiting for the queue to drain. A single callback slot used to be
 * enough until two callers overlapped — the second overwrote the first, and the
 * first promise never settled, hanging whatever awaited it.
 */
let waiters: (() => void)[] = [];

function releaseWaiters(): void {
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) resolve();
}

function pickTtsModel(settings: Settings) {
  const cfg = mediaConfigFromSettings(settings);
  const id = cfg.defaults.audio;
  return (
    cfg.models.find((m) => m.id === id && m.kind === "audio") ??
    cfg.models.find((m) => m.kind === "audio")
  );
}

/** True when a media TTS model will be used instead of the Windows voice. */
export function usingMediaVoice(settings: Settings): boolean {
  return !!pickTtsModel(settings);
}

function playDataUrl(url: string): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    currentAudio = audio;
    let wired: { analyser: AnalyserNode; source: MediaElementAudioSourceNode } | null = null;
    const finish = () => {
      if (currentAudio === audio) {
        currentAudio = null;
        activeAnalyser = null;
      }
      // A long call plays hundreds of sentences; without this each one leaves
      // a connected source node on the shared context forever.
      try {
        wired?.source.disconnect();
        wired?.analyser.disconnect();
      } catch {
        /* already gone */
      }
      resolve();
    };
    // Lip-sync when the graph can run; plain playback when it can't. Wiring
    // happens before play() so no audio escapes un-analysed mid-utterance.
    void routeThroughAnalyser(audio).then((w) => {
      wired = w;
      activeAnalyser = w?.analyser ?? null;
      audio.onended = finish;
      audio.onerror = finish;
      void audio.play().catch(finish);
    });
  });
}

/**
 * Whether the neural voice is already downloaded. Cached because "auto" consults
 * it before every utterance and the answer only changes on a fresh install.
 */
let piperInstalled: { voice: string; ready: boolean } | null = null;

async function neuralReady(voiceId: string): Promise<boolean> {
  if (piperInstalled?.voice === voiceId) return piperInstalled.ready;
  try {
    const { piperReady } = await import("./piper");
    const ready = await piperReady(voiceId);
    piperInstalled = { voice: voiceId, ready };
    return ready;
  } catch {
    return false;
  }
}

/** Call after installing a voice so "auto" starts using it without a restart. */
export function invalidateNeuralVoice(): void {
  piperInstalled = null;
}

/** Synthesize through Piper to an audio URL. Returns null so the caller can fall back. */
async function synthPiper(text: string, voiceId: string, human: boolean): Promise<string | null> {
  try {
    const { ensurePiper, piperSynthesize } = await import("./piper");
    await ensurePiper(() => {}, voiceId);
    piperInstalled = { voice: voiceId, ready: true };
    return await piperSynthesize(text, voiceId, human);
  } catch {
    return null; // caller falls back so speech never goes silent
  }
}

/**
 * Speak through a cloud service. Returns false so the caller can fall back —
 * a network blip or an expired key should degrade to a local voice, not silence.
 */
async function synthCloud(text: string, settings: Settings): Promise<string | null> {
  const cfg = settings.voice?.cloud;
  try {
    const { cloudSynthesize, speechConfigured } = await import("./speechProviders");
    if (!speechConfigured(cfg)) return null;
    return await cloudSynthesize(cfg, text, personaInstruction(settings));
  } catch (e) {
    // Say why once — a silently-ignored billing failure is baffling.
    const message = (e as Error).message || "";
    if (message && lastCloudError !== message) {
      lastCloudError = message;
      toast.error(message);
    }
    return null;
  }
}

let lastCloudError: string | null = null;

/** Synthesize through Kokoro to an audio URL. Returns null so the caller can fall back. */
async function synthKokoro(text: string, settings: Settings): Promise<string | null> {
  try {
    const { kokoroSynthesize } = await import("./kokoro");
    return await kokoroSynthesize(text, settings.voice?.kokoroVoice || undefined);
  } catch {
    return null;
  }
}

/** The persona, phrased as a delivery note for engines that accept one. */
function personaInstruction(settings: Settings): string {
  const persona = settings.voice?.persona;
  const extra = settings.voice?.instructions?.trim();
  const base =
    persona === "calm"
      ? "Speak calmly and unhurriedly."
      : persona === "upbeat"
        ? "Speak brightly and with energy."
        : persona === "professional"
          ? "Speak clearly and precisely, like a briefing."
          : persona === "friendly"
            ? "Speak warmly, like a friend talking."
            : "";
  return [base, extra].filter(Boolean).join(" ");
}

/**
 * A synthesized utterance ready to play. Splitting synthesis (the expensive part —
 * a network call or neural inference producing an audio URL) from playback lets the
 * queue synthesize the *next* sentence while the current one is still playing, so
 * there's no dead air between sentences. `play()` is always run serially, so only
 * one utterance is ever audible at a time.
 */
interface Prepared {
  play: () => Promise<void>;
}

/** A prepared utterance backed by an already-synthesized audio URL. */
function fromUrl(url: string, revoke: boolean): Prepared {
  return {
    play: async () => {
      if (cancelled) return;
      await playDataUrl(url);
      // Blob URLs are held until the document unloads; a long call would otherwise
      // accumulate one per sentence. (data: URLs don't need it, but it's harmless.)
      if (revoke) URL.revokeObjectURL(url);
    },
  };
}

/**
 * Run the engine cascade and synthesize `raw` to a ready-to-play utterance. Does
 * NOT play — that's `Prepared.play()`. Same engine order and fallbacks as before.
 */
async function prepareUtterance(raw: string, settings: Settings): Promise<Prepared> {
  const engine = settings.voice?.ttsEngine ?? "auto";
  const human = settings.voice?.humanDelivery ?? true;
  const text = human ? spokenForm(raw) : raw;
  // Left blank when unset — the piper module resolves that to its default voice,
  // so the engine is only loaded on the paths that actually use it.
  const piperVoiceId = settings.voice?.piperVoice || "";
  // Piper's bundled voices are English-only; anything else needs a system voice.
  const english = detectLang(text, preferredLang(settings) || "en") === "en";
  let url: string | null;

  // Explicitly chosen engines get first refusal, in quality order. Each returns
  // null rather than throwing, so a failure moves down the list instead of
  // leaving the avatar mute.
  if (engine === "cloud") {
    url = await synthCloud(text, settings);
    if (url) return fromUrl(url, true);
  }

  // Kokoro is English-only in this build; handed another script it produces
  // confident nonsense rather than failing, so the check has to happen here.
  if (engine === "kokoro" && english) {
    url = await synthKokoro(text, settings);
    if (url) return fromUrl(url, true);
  }

  // Offline neural voice, chosen explicitly — download it if this is the first use.
  if (engine === "piper" && english) {
    url = await synthPiper(text, piperVoiceId, human);
    if (url) return fromUrl(url, false);
  }

  const model = engine === "windows" ? undefined : pickTtsModel(settings);
  if (model) {
    try {
      const { dataUrl } = await generateMedia(model, text);
      return fromUrl(dataUrl, false);
    } catch {
      // fall through to the built-in voice if the cloud/local TTS fails
    }
  }

  // "Auto" means the best voice already available, in quality order — and only
  // ever something already present. Nothing here may trigger a model download or
  // spend the user's money from a setting they didn't explicitly choose.
  if (engine === "auto" && english) {
    const { kokoroCached } = await import("./kokoro");
    if (await kokoroCached()) {
      url = await synthKokoro(text, settings);
      if (url) return fromUrl(url, true);
    }
    if (await neuralReady(piperVoiceId)) {
      url = await synthPiper(text, piperVoiceId, human);
      if (url) return fromUrl(url, false);
    }
  }
  // Route to a voice that can actually read this script. An English SAPI voice
  // handed Urdu or Arabic just produces silence, so we detect the language and
  // pick a matching voice — including the Settings-installed OneCore ones, which
  // are only reachable through the WinRT synthesizer.
  const lang = detectLang(text, preferredLang(settings) || "en");
  const voice = await voiceForLang(lang, settings.voice?.winVoice || undefined);

  if (!voice) {
    const help = missingVoiceHelp(lang, sttLanguageName(lang));
    if (lastMissingLang !== lang) {
      lastMissingLang = lang;
      toast.error(help);
    }
    throw new Error(help);
  }
  lastMissingLang = null;

  if (voice.engine === "winrt") {
    const wurl = await winrtSpeakToDataUrl(text, voice.name);
    return fromUrl(wurl, false);
  }

  // SAPI synthesizes and plays in one native call, so it can't be pre-synthesized —
  // the whole thing runs at play time. That's fine: it's the local, instant engine.
  return {
    play: async () => {
      if (cancelled) return;
      await invoke("speak", {
        text: human
          ? humanSsml(text, {
              expressiveness: settings.voice?.expressiveness ?? 1,
              lang: voice.lang || lang,
            })
          : text,
        voice: voice.name,
        rate: settings.voice?.rate ?? 1,
      });
    },
  };
}

/** Synthesize + play a single utterance (used for one-off previews). */
async function speakOnce(raw: string, settings: Settings): Promise<void> {
  await (await prepareUtterance(raw, settings)).play();
}

/** Resolve a queued (possibly rewritten) text to a synthesized, ready-to-play
 *  utterance. A synth failure drops just that one sentence instead of the queue. */
async function prepareFrom(item: Promise<string>, settings: Settings): Promise<Prepared | null> {
  try {
    const text = await item;
    if (!text || cancelled) return null;
    return await prepareUtterance(text, settings);
  } catch {
    return null; // e.g. no matching voice — skip this sentence, keep the queue alive
  }
}

async function drain(settings: Settings) {
  if (draining) return;
  draining = true;
  try {
    // One-sentence look-ahead: synthesize the next utterance while the current one
    // plays. Playback (`play()`) is still strictly serial, so only one is audible.
    let nextPrep: Promise<Prepared | null> | null = null;
    while ((queue.length || nextPrep) && !cancelled) {
      const prepared = await (nextPrep ?? prepareFrom(queue.shift()!, settings));
      nextPrep = null;
      if (cancelled) break;
      // Kick off synthesis of the following sentence before playing this one.
      if (queue.length && !cancelled) nextPrep = prepareFrom(queue.shift()!, settings);
      if (prepared) await prepared.play();
    }
  } finally {
    draining = false;
    // Also release when the queue was abandoned mid-drain (cancelled), or a
    // barge-in would leave the caller awaiting a queue nobody will finish.
    if (!queue.length || cancelled) releaseWaiters();
  }
}

/**
 * Load the TTS engine ahead of the first reply, so the first sentence isn't
 * delayed by a cold start (Kokoro loads ~90 MB of weights into memory; Piper
 * spins up its process). Speaks nothing, and — like "auto" itself — never
 * triggers a download or spend the user didn't ask for: engines that aren't
 * already present are skipped. Safe to call repeatedly; failures are ignored.
 */
export async function warmSpeech(settings: Settings): Promise<void> {
  const engine = settings.voice?.ttsEngine ?? "auto";
  const piperVoiceId = settings.voice?.piperVoice || "";
  try {
    if (engine === "kokoro" || engine === "auto") {
      const { kokoroCached, kokoroLoaded, loadKokoro } = await import("./kokoro");
      if (!kokoroLoaded() && (await kokoroCached())) await loadKokoro();
      if (engine === "kokoro") return;
    }
    if (engine === "piper" || engine === "auto") {
      if (await neuralReady(piperVoiceId)) {
        const { ensurePiper } = await import("./piper");
        await ensurePiper(() => {}, piperVoiceId);
      }
    }
  } catch {
    /* warming is best-effort — the real call will surface any problem */
  }
}

/** Speak one utterance immediately and await it (used for voice previews). */
export async function speakNow(text: string, settings: Settings): Promise<void> {
  cancelled = false;
  await speakOnce(text, settings);
}

/** Queue a sentence/utterance for speaking. Returns immediately. */
export function speakQueued(text: string, settings: Settings): void {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return;
  cancelled = false;
  const choice = speechModel(settings);
  // Kick the rewrite off now, not when its turn comes — it overlaps with playback.
  queue.push(choice ? rewriteForSpeech(clean, choice, languageHint(settings)) : Promise.resolve(clean));
  void drain(settings);
}

/**
 * Stage 2: decide whether to speak the just-completed reply out loud.
 *
 * Stage 2 behaviour: voice mode is a property of the chat, not a separate
 * chat. The `speakReplies` setting is the smarter default — text-mode
 * chats get TTS for replies when the user has it on, hands-free voice
 * mode gets TTS for the same reason. No mode flag to keep in sync.
 *
 * Silence rules: empty content, error markers, and the user being already
 * in voice mode (the voice session has its own queue) all skip. The voice
 * session is bypassed entirely here — the chat only speaks in text mode.
 */
export function maybeSpeakReply(content: string, settings: Settings, opts: { voiceMode?: boolean } = {}): void {
  if (opts.voiceMode) return;
  if (settings.voice?.speakReplies === false) return;
  const text = speakableText(content);
  if (!text) return;
  speakQueued(text, settings);
}

/** Keep the rewriter in the same language as the reply. */
function languageHint(settings: Settings): string {
  const code = settings.voice?.replyLanguage;
  const named = code && code !== "match" ? sttLanguageName(code) : sttLanguageName(settings.voice?.language ?? "");
  return named ? `The text is in ${named}. Write your rewrite in ${named}.` : "";
}

/** Resolves once the queue has fully drained (or was stopped). */
export function whenSpoken(): Promise<void> {
  if (!draining && !queue.length) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

/** Stop speaking immediately and drop anything queued (barge-in). */
export async function stopSpeaking(): Promise<void> {
  cancelled = true;
  queue = [];
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  try {
    await invoke("speak_stop");
  } catch {
    /* nothing speaking */
  }
  releaseWaiters();
}

/** Installed Windows voice names (for the picker in Settings). */
export async function listWindowsVoices(): Promise<string[]> {
  try {
    return await invoke<string[]>("speak_voices");
  } catch {
    return [];
  }
}

/** Strip markdown/emoji noise so the voice reads naturally. */
export function speakableText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
