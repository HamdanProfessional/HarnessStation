import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import { Markdown } from "./Markdown";
import { Canvas } from "./Canvas";
import { prettyName } from "../lib/format";
import { formatCost, messageCost } from "../lib/cost";
import { fileToAttachment, extractArtifact } from "../lib/attach";
import { startRecording, type Recorder } from "../lib/audio";
import type { Attachment, Chat } from "../lib/types";
import { useStore } from "../lib/store";
import { ensureWhisper, transcribePath } from "../lib/whisper";
import { IconX, IconSpeaker, LogoMark } from "./icons";
import { useMicAvailable, type MicStatus } from "../lib/micDetect";
import { FirstRunKey } from "./FirstRunKey";
import { InlineBrowser } from "./InlineBrowser";
import { AskUserPrompt } from "./AskUserPrompt";
import { MultiAgentBar } from "./MultiAgentBar";
import { TrajectoryView } from "./TrajectoryView";
import { planScroll, prefersReducedMotion } from "../lib/autoscroll";

const STARTER_PROMPTS = [
  "Summarize the latest news on a topic I choose, with sources.",
  "Write a Python script that renames files in a folder by date.",
  "Explain this error message and how to fix it.",
  "Draft a friendly but firm email declining a meeting.",
];

/** If the whole message is a JSON object/array, return it pretty-printed; else null. */
function prettyJson(content: string): string | null {
  const t = content.trim();
  if (!(t.startsWith("{") && t.endsWith("}")) && !(t.startsWith("[") && t.endsWith("]"))) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
}

let speaking = false;
function speak(text: string) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  // Cancel anything in flight, then speak the new text. It used to return here,
  // so clicking Speak on a second message only stopped the first — you had to
  // click twice, and it looked like the button had failed.
  if (speaking) synth.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, " code block ").slice(0, 4000));
  // speechSynthesis fires `error` rather than `end` on interruption or a
  // missing voice. Handling only `end` left `speaking` stuck true, and the
  // Speak button became a silent no-op for the rest of the session.
  u.onend = u.onerror = () => (speaking = false);
  speaking = true;
  synth.speak(u);
}

function prettyArgs(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function Reasoning({ text, onDelete }: { text: string; onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="reasoning">
      <button className="toolcall-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="reasoning-dot" />
        <span className="toolcall-label">Thinking</span>
        <span className="toolcall-toggle">{open ? "hide" : "show"}</span>
        {onDelete && <DeleteItemBtn label="Delete this thinking from context" onDelete={onDelete} />}
      </button>
      {open && <div className="reasoning-body">{text}</div>}
    </div>
  );
}

/** A small ✕ that removes one item from the conversation to trim context. */
function DeleteItemBtn({ label, onDelete }: { label: string; onDelete: () => void }) {
  return (
    <span
      className="item-del"
      role="button"
      tabIndex={0}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
      onKeyDown={(e) => e.key === "Enter" && onDelete()}
    >
      <IconX size={11} />
    </span>
  );
}

function MsgMeta({ model, m }: { model: string; m: { promptTokens?: number; completionTokens?: number } }) {
  if (!m.completionTokens && !m.promptTokens) return null;
  const cost = messageCost(model, m.promptTokens, m.completionTokens);
  const tok = (m.promptTokens ?? 0) + (m.completionTokens ?? 0);
  return (
    <div className="msg-meta">
      {tok} tok
      {m.promptTokens != null && ` (${m.promptTokens}→${m.completionTokens ?? 0})`}
      {cost !== null && ` · ${formatCost(cost)}`}
    </div>
  );
}

function ToolCall({ name, args, onDelete }: { name: string; args: string; onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  const hasArgs = args && args.trim() !== "{}" && args.trim() !== "";
  return (
    <div className="toolcall">
      <button className="toolcall-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="toolcall-dot" />
        <span className="toolcall-label">
          Called <b>{prettyName(name)}</b>
        </span>
        {hasArgs && <span className="toolcall-toggle">{open ? "hide args" : "args"}</span>}
        {onDelete && <DeleteItemBtn label="Delete this tool call from context" onDelete={onDelete} />}
      </button>
      {open && hasArgs && <pre className="toolcall-args">{prettyArgs(args)}</pre>}
    </div>
  );
}

function MediaAttachment({ a }: { a: Attachment }) {
  if (a.kind === "image") return <img className="msg-image" src={a.data} alt={a.name} />;
  if (a.kind === "audio") return <audio className="msg-audio" controls src={a.data} />;
  if (a.kind === "video") return <video className="msg-video" controls src={a.data} />;
  return (
    <span className="att-chip att-chip-msg">
      {a.name}
    </span>
  );
}

function ToolResult({
  name,
  content,
  attachments,
  onDelete,
}: {
  name?: string;
  content: string;
  attachments?: Attachment[];
  onDelete?: () => void;
}) {
  // Show tool responses by default; only long dumps start collapsed to reduce noise.
  const [open, setOpen] = useState((content?.length ?? 0) <= 1500);
  // A tool result can arrive empty and grow. Decided only at mount, the
  // collapse choice was made against the first content this component ever saw,
  // so a 40 kB dump stayed expanded because it started at zero characters.
  // Re-decide when the content changes — unless the user has clicked since,
  // which `touched` records, because overriding a deliberate click is worse
  // than a bad default.
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setOpen((content?.length ?? 0) <= 1500);
  }, [content]);
  const media = (attachments ?? []).filter((a) => a.kind !== "text");
  return (
    <div className="toolresult">
      {media.length > 0 && (
        <div className="toolresult-media">
          {media.map((a, k) => (
            <MediaAttachment key={k} a={a} />
          ))}
        </div>
      )}
      <button
        className="toolcall-head"
        onClick={() => {
          touched.current = true;
          setOpen(!open);
        }}
        aria-expanded={open}
      >
        <span className="toolcall-arrow" aria-hidden="true">
          &#8627;
        </span>
        <span className="toolcall-label">
          Result{name ? <> from <b>{prettyName(name)}</b></> : ""}
        </span>
        <span className="toolcall-toggle">{open ? "hide" : "show"}</span>
        {onDelete && <DeleteItemBtn label="Delete this tool response from context" onDelete={onDelete} />}
      </button>
      {open && <pre className="toolcall-args">{content.slice(0, 4000)}</pre>}
    </div>
  );
}

/**
 * The "it is working" indicator, shown under the thread for as long as a turn
 * is in flight.
 *
 * The chat had no live signal of its own. Waiting for the first token rendered
 * a literal "..." — three static full stops, indistinguishable from a model
 * that had actually replied with an ellipsis — and once a tool call started,
 * the assistant bubble was hidden entirely and nothing replaced it. The only
 * real indicator lived in ConfigPanel, which is closed by default.
 *
 * `activity` is already maintained by the store for every phase of a turn
 * ("Running read file...", "Conversation too long — summarising and
 * retrying..."), so this is a second reader of it rather than new state.
 */
function Working({ activity }: { activity: string | null }) {
  return (
    <div className="working" role="status" aria-live="polite">
      <span className="working-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="working-text">{activity ?? "Working…"}</span>
    </div>
  );
}

export function ChatWindow() {
  const { chats, currentId, streaming, activity, error, clearError, branchAt, editUserMessage, rewindTo, deleteItem, agents, settings, browserDock, setView, updateChatById } =
    useStore();
  const [editIdx, setEditIdx] = useState<number | null>(null);
  /**
   * The id of the message being edited, held alongside its index.
   *
   * editUserMessage takes an index, so the index has to be kept. But if a
   * message is deleted while the edit box is open, that index now points at a
   * different message and "Save & regenerate" would rewrite the wrong one.
   * Checking the id too means the edit is abandoned instead.
   */
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [showTrace, setShowTrace] = useState(false);
  const chat = chats.find((c) => c.id === currentId);
  /** Voice-first is the default empty state. The "Type instead" link toggles
   *  to the text-mode starter prompts. Persisted per-chat so a user who
   *  prefers text doesn't have to flip it every chat. The persisted choice
   *  wins, but if the user hasn't chosen, smart detection picks the default:
   *  voice-first when a mic is available or unknown, text-first when one
   *  isn't. Toggling always updates the persisted preference. */
  const micStatus = useMicAvailable();
  const [textMode, setTextMode] = useState<boolean | null>(() => {
    const saved = localStorage.getItem("hs-chat-textmode");
    if (saved === "1") return true;
    if (saved === "0") return false;
    return null; // not yet chosen — smart detection will decide
  });
  /** Resolved text-mode for this render. Pending until the mic status resolves
   *  (so we don't flash voice-first on a mic-less device). */
  const resolvedTextMode =
    textMode !== null ? textMode : micStatus === "unavailable";
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);

  // Which chat this scroller last painted. Switching chats has to jump rather
  // than glide — see planScroll.
  const paintedChat = useRef<string | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstPaint = paintedChat.current !== (chat?.id ?? null);
    paintedChat.current = chat?.id ?? null;

    const { scroll, behavior } = planScroll({
      viewport: el,
      streaming,
      firstPaint,
      reducedMotion: prefersReducedMotion(),
    });
    if (scroll) el.scrollTo({ top: el.scrollHeight, behavior });
  }, [chat?.messages, chat?.id, streaming]);

  if (!chat) return <main className="chat-main" />;

  const agentName = chat.agentId ? agents.find((a) => a.id === chat.agentId)?.name : undefined;

  return (
    <main className="chat-main">
      <MultiAgentBar />
      {chat.messages.length > 0 && (
        <button
          className="traj-open-btn"
          title="Trajectory — trace every step of this run"
          aria-label="Open trajectory view"
          onClick={() => setShowTrace(true)}
        >
          ⤳ Trace
        </button>
      )}
      {showTrace && <TrajectoryView chat={chat} onClose={() => setShowTrace(false)} />}
      <div className={`messages ${chat.mode === "battle" ? "battle" : ""}`} ref={scrollRef}>
        {chat.messages.length === 0 && (() => {
          const provider = settings.providers.find((p) => p.id === chat.providerId);
          const isLocal = provider ? /localhost|127\.0\.0\.1/.test(provider.baseUrl) : false;
          const currentReady = !!provider && !!chat.model && (isLocal || provider.apiKey.trim() !== "");
          // The user has ANY key on file — they're set up, just not necessarily
          // on this chat's provider. Show the starter prompts and let them pick
          // a model in the right rail rather than nagging them to add a key
          // they already have.
          const anyKey = settings.providers.some((p) => /localhost|127\.0\.0\.1/.test(p.baseUrl) || p.apiKey.trim() !== "");
          const ready = currentReady || anyKey;
          // Voice-first is THE default. The brand promise is hands-free, and the
          // top of the empty state is the strongest piece of real estate in the
          // app. Text mode is still here, but one click away rather than equal.
          const toggleTextMode = () => {
            const next = !resolvedTextMode;
            setTextMode(next);
            localStorage.setItem("hs-chat-textmode", next ? "1" : "0");
          };
          // Voice mode is a property of the chat, not a navigation. Toggling
          // it on persists across loads, so the chat reopens in voice mode
          // when the user comes back. The VoiceView is still a fullscreen
          // focus-mode — voice mode is the persistent flag, the view is the
          // spot to use it.
          const openVoice = () => {
            updateChatById(chat.id, { voiceMode: true });
            setView("voice");
          };
          return (
            <div className="empty-state">
              {!ready ? (
                <>
                  <LogoMark size={46} />
                  <h2>Your AI chat. Your machine. Your keys.</h2>
                  <p>
                    Give any model real tools — your files, a terminal, the web and a browser —
                    without an account and without your conversations leaving this computer.
                  </p>
                  <FirstRunKey />
                </>
              ) : resolvedTextMode ? (
                <>
                  <LogoMark size={46} />
                  <h2>Your AI chat. Your machine. Your keys.</h2>
                  <p>
                    Give any model real tools — your files, a terminal, the web and a browser —
                    without an account and without your conversations leaving this computer.
                  </p>
                  <p className="empty-hint">Try one of these to get started:</p>
                  <div className="prompt-chips">
                    {STARTER_PROMPTS.map((p) => (
                      <button key={p} className="prompt-chip" onClick={() => composerRef.current?.setDraft(p)}>
                        {p}
                      </button>
                    ))}
                  </div>
                  {!currentReady && (
                    <p className="hint">
                      <b>Pick a model in the right panel</b> — your key is set, just on a
                      different provider than this chat's default.
                    </p>
                  )}
                  <button className="link-btn empty-voice-link" onClick={toggleTextMode}>
                    🎙 Try voice instead
                  </button>
                </>
              ) : (
                <>
                  {/* The orb is the only button the user needs to press. It
                      opens the full Voice view, which handles its own setup
                      (mic permission, TTS engine, etc.). */}
                  <button
                    className="voice-orb-cta"
                    onClick={openVoice}
                    aria-label="Start a voice conversation"
                    title="Start a voice conversation"
                  >
                    <span className="orb-core" />
                  </button>
                  <h2>Press to talk</h2>
                  <p className="empty-hint">
                    Speak naturally — your AI chat listens and replies out loud. Your mic and
                    the conversation stay on your machine.
                  </p>
                  <MicStatusHint status={micStatus} />
                  <button className="link-btn empty-voice-link" onClick={toggleTextMode}>
                    Type instead →
                  </button>
                </>
              )}
            </div>
          );
        })()}
        {chat.summary && (chat.summaryUpto ?? 0) > 0 && (
          <details className="compact-banner">
            <summary>{chat.summaryUpto} earlier message(s) summarized — click to view</summary>
            <div className="compact-summary">{chat.summary}</div>
          </details>
        )}
        {(() => {
          // map each toolCallId to the name the assistant used, for result cards
          const callName: Record<string, string> = {};
          for (const m of chat.messages)
            for (const c of m.toolCalls ?? []) callName[c.id] = c.name;
          return chat.messages.map((m, i) => {
            // Key by identity, not position. Keyed by index, deleting a message
            // made React reuse each component for whatever slid into its slot,
            // so expanded tool cards collapsed and collapsed ones opened. Ids
            // are assigned on append and backfilled on load; the index fallback
            // only covers a message that somehow has neither.
            const key = m.id ?? `idx-${i}`;
            if (m.role === "tool") {
              return (
                <ToolResult
                  key={key}
                  name={callName[m.toolCallId ?? ""]}
                  content={m.content}
                  attachments={m.attachments}
                  onDelete={streaming ? undefined : () => void deleteItem(i, "message")}
                />
              );
            }
            const hasText = m.content.trim().length > 0;
            const artifact = m.role === "assistant" ? extractArtifact(m.content) : null;
            if (editIdx === i && editId === key) {
              return (
                <div key={key} className="msg user">
                  <div className="msg-role">Edit message</div>
                  <textarea
                    className="chat-input"
                    rows={3}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <div className="msg-actions">
                    <button
                      className="btn primary small"
                      onClick={() => {
                        setEditIdx(null);
                        setEditId(null);
                        void editUserMessage(i, editText);
                      }}
                    >
                      Save &amp; regenerate
                    </button>
                    <button
                      className="btn small"
                      onClick={() => {
                        setEditIdx(null);
                        setEditId(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div
                key={key}
                className={`msg ${m.role} ${m.author && chat.mode === "battle" ? "battle-col" : ""} ${
                  // Only the newest message animates in. Marking it here rather
                  // than with :last-child because the transcript's last node is
                  // often a tool result or the Working indicator, not a .msg.
                  i === chat.messages.length - 1 ? "msg-new" : ""
                }`}
              >
                <div className="msg-role">
                  {m.role === "user" ? "You" : m.author ?? agentName ?? "Assistant"}
                  {!streaming && (
                    <span className="msg-hover-actions">
                      {m.role === "user" && (
                        <button
                          className="msg-act"
                          onClick={() => {
                            setEditIdx(i);
                            setEditId(key);
                            setEditText(m.content);
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {m.role === "assistant" && m.content.trim() && (
                        <button className="msg-act" title="Read aloud" onClick={() => speak(m.content)}>
                          Speak
                        </button>
                      )}
                      <button className="msg-act" title="Fork the chat here" onClick={() => branchAt(i)}>
                        Branch
                      </button>
                      <button
                        className="msg-act msg-act-danger"
                        title="Delete this message and everything after it (a snapshot is saved first, so it's reversible)"
                        onClick={() => void rewindTo(i)}
                      >
                        Rewind
                      </button>
                      <button
                        className="msg-act msg-act-danger"
                        title="Delete just this message from context"
                        onClick={() =>
                          void deleteItem(
                            i,
                            m.role === "assistant" && (m.toolCalls?.length || m.reasoning)
                              ? "content"
                              : "message",
                          )
                        }
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </div>
                {m.attachments?.map((a, k) =>
                  a.kind === "text" ? (
                    <span key={k} className="att-chip att-chip-msg">
                      {a.name}
                    </span>
                  ) : (
                    <MediaAttachment key={k} a={a} />
                  ),
                )}
                {m.reasoning && m.role === "assistant" && (
                  <Reasoning
                    text={m.reasoning}
                    onDelete={streaming ? undefined : () => void deleteItem(i, "reasoning")}
                  />
                )}
                {m.toolCalls?.map((c) => (
                  <ToolCall
                    key={c.id}
                    name={c.name}
                    args={c.arguments}
                    onDelete={streaming ? undefined : () => void deleteItem(i, { toolCallId: c.id })}
                  />
                ))}
                {(hasText || m.role === "user" || (!m.toolCalls?.length && streaming)) && (
                  <div className="msg-content">
                    {m.role === "assistant" ? (
                      prettyJson(m.content) ? (
                        <pre className="code-view">{prettyJson(m.content)}</pre>
                      ) : (
                        <Markdown>{m.content}</Markdown>
                      )
                    ) : (
                      m.content
                    )}
                  </div>
                )}
                {artifact && <Canvas artifact={artifact} />}
                {m.role === "assistant" && !streaming && <MsgMeta model={chat.model} m={m} />}
              </div>
            );
          });
        })()}
        {streaming && <Working activity={activity} />}
        {error && (
          // role="alert" so the failure is announced, and a real button so it can
          // be dismissed without a mouse.
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="error-dismiss" onClick={clearError} aria-label="Dismiss error">
              <IconX size={12} />
            </button>
          </div>
        )}
      </div>
      {/* Below the thread and above the composer — inside the conversation, but
          deliberately *not* inside the scrolling list. See InlineBrowser. */}
      {browserDock && <InlineBrowser />}
      {/* A paused turn waiting on an answer. Above the composer and outside the
          scrolling list, so it cannot scroll away while it is blocking. */}
      <AskUserPrompt chatId={chat.id} />
      <Composer chat={chat} composerRef={composerRef} />
     </main>
   );
 }

export type ComposerHandle = {
  /** Replace the draft from outside — used by the empty-state starter chips. */
  setDraft: (text: string) => void;
};

/**
 * The message box, and every piece of state that only it cares about: the
 * draft text, staged attachments, the dictation recorder, and the compaction
 * flag.
 *
 * This is a child rather than part of ChatWindow for one reason. `draft` used
 * to live in ChatWindow, so every keystroke re-rendered the whole component —
 * including the transcript, where each message runs ReactMarkdown with syntax
 * highlighting. On a long conversation that is a lot of work per character
 * typed. Moving the state down here means a keystroke re-renders the composer
 * and nothing else; the transcript above is untouched.
 *
 * The starter chips in the empty state still need to write into the draft, so
 * the one way in is `composerRef.setDraft` rather than a prop — a `draft` prop
 * would put the state back in the parent and undo the whole point.
 */
function Composer({ chat, composerRef }: { chat: Chat; composerRef: RefObject<ComposerHandle | null> }) {
  const { streaming, sendMessage, regenerate, stop, compactChat, setView, updateChatById } = useStore();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recorder, setRecorder] = useState<Recorder | null>(null);
  const [voiceState, setVoiceState] = useState<string | null>(null);
  const [compacting, setCompacting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(composerRef, () => ({ setDraft }), []);

  const submit = () => {
    const text = draft.trim();
    if ((!text && !attachments.length) || streaming) return;
    const atts = attachments;
    setDraft("");
    setAttachments([]);
    void sendMessage(text, atts.length ? atts : undefined);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      try {
        const att = await fileToAttachment(f);
        setAttachments((prev) => [...prev, att]);
      } catch (e) {
        useStore.setState({ error: `Could not read ${f.name}: ${(e as Error).message}` });
      }
    }
  };

  const toggleDictation = async () => {
    if (recorder) {
      // stop and transcribe
      const rec = recorder;
      setRecorder(null);
      try {
        setVoiceState("Processing audio...");
        const wavPath = await rec.stopPath();
        await ensureWhisper((s) => setVoiceState(s));
        setVoiceState("Transcribing...");
        const text = await transcribePath(wavPath);
        if (text) setDraft((d) => (d ? `${d} ${text}` : text));
        setVoiceState(null);
      } catch (e) {
        setVoiceState(null);
        useStore.setState({ error: `Dictation failed: ${(e as Error).message || String(e)}` });
      }
      return;
    }
    try {
      setVoiceState(null);
      const rec = await startRecording(useStore.getState().settings.voice?.micDevice);
      setRecorder(rec);
    } catch (e) {
      useStore.setState({ error: `Microphone unavailable: ${(e as Error).message || String(e)}` });
    }
  };

  return (
    <>
      {voiceState && <div className="voice-state">{voiceState}</div>}
      {attachments.length > 0 && (
        <div className="att-tray">
          {attachments.map((a, i) => (
            <span key={i} className="att-chip">
              {a.kind === "image" ? (
                <img className="att-thumb" src={a.data} alt={a.name} />
              ) : (
                <span className="att-file-ic">TXT</span>
              )}
              <span className="att-name">{a.name}</span>
              <button
                className="att-x"
                aria-label={`Remove attachment ${a.name}`}
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="input-row">
        <div
          className="composer"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,.txt,.md,.csv,.json,.js,.ts,.py,.html,.css,.pdf,.log,.xml,.yaml,.yml"
            style={{ display: "none" }}
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <textarea
            className="composer-input"
            placeholder="Type a message...  (Enter to send, Shift+Enter for newline, drop files to attach)"
            value={draft}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
              if (imgs.length) {
                e.preventDefault();
                void addFiles(e.clipboardData.files);
              }
            }}
          />
          <div className="composer-actions">
            <div className="composer-left">
              <button className="btn ghost" onClick={() => fileRef.current?.click()} title="Attach files or images">
                Attach
              </button>
              <button
                className={`btn ghost ${recorder ? "danger" : ""}`}
                onClick={() => void toggleDictation()}
                disabled={!!voiceState}
                title="Voice dictation (local whisper model)"
              >
                {recorder ? "Stop rec" : "Dictate"}
              </button>
              {/* Persistent voice-mode entry point. Distinct from "Dictate" —
                  this opens the full hands-free voice session, not a one-shot
                  dictation. The mic button is always visible so the brand
                  promise of voice-first is reinforced every time the user
                  looks at the composer. */}
              <button
                className={`btn ghost composer-mic${chat.voiceMode ? " active" : ""}`}
                onClick={() => {
                  // Toggle voice mode on the chat, then open the VoiceView
                  // for the actual session. voiceMode persists so the chat
                  // is in voice mode next time the user opens it — the
                  // fullscreen view is just where you use it.
                  updateChatById(chat.id, { voiceMode: !chat.voiceMode });
                  setView("voice");
                }}
                title={chat.voiceMode ? "Voice mode is on — open session" : "Open voice mode (hands-free)"}
                aria-label="Open voice mode"
                aria-pressed={!!chat.voiceMode}
              >
                <IconSpeaker size={14} /> Voice
              </button>
            </div>
            <div className="composer-right">
              {streaming ? (
                <button className="btn danger" onClick={stop}>
                  Stop
                </button>
              ) : (
                <>
                  {chat.messages.length > 8 && (
                    <button
                      className="btn ghost"
                      disabled={compacting}
                      onClick={async () => {
                        setCompacting(true);
                        try {
                          await compactChat(chat.id);
                        } finally {
                          setCompacting(false);
                        }
                      }}
                      title="Summarize older messages to save context"
                    >
                      {compacting ? "Compacting…" : "Compact"}
                    </button>
                  )}
                  <button
                    className="btn ghost"
                    onClick={() => void regenerate()}
                    disabled={!chat.messages.length}
                    title="Regenerate last response"
                  >
                    Regen
                  </button>
                  <button className="btn primary" onClick={submit} disabled={!draft.trim() && !attachments.length}>
                    Send
                  </button>
                </>
              )}
             </div>
           </div>
         </div>
       </div>
    </>
  );
}

/**
 * One-line trust signal under the voice-first empty state. Three states:
 *
 *   - "available"   a small green dot says "Mic ready" — quiet reassurance
 *   - "unavailable" a warning says voice needs a mic, and a hint to type
 *   - "unknown"     nothing rendered — we don't want to claim what's
 *                   unverified. The orb CTA still works on click.
 *
 * The "unavailable" hint is the only one that surfaces a problem a user
 * might otherwise hit on click. The other two are quiet by design.
 */
function MicStatusHint({ status }: { status: MicStatus }) {
  if (status === "available") {
    return <p className="mic-hint mic-hint-ok"><span className="mic-dot" />Mic ready</p>;
  }
  if (status === "unavailable") {
    return (
      <p className="mic-hint mic-hint-warn">
        No microphone detected — voice mode won't work on this device.
      </p>
    );
  }
  return null;
}
