import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { Canvas } from "./Canvas";
import { prettyName } from "../lib/format";
import { formatCost, messageCost } from "../lib/cost";
import { fileToAttachment, extractArtifact } from "../lib/attach";
import { startRecording, type Recorder } from "../lib/audio";
import type { Attachment } from "../lib/types";
import { useStore } from "../lib/store";
import { ensureWhisper, transcribePath } from "../lib/whisper";
import { LogoMark } from "./icons";
import { InlineBrowser } from "./InlineBrowser";
import { MultiAgentBar } from "./MultiAgentBar";

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
  if (speaking) {
    synth.cancel();
    speaking = false;
    return;
  }
  const u = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, " code block ").slice(0, 4000));
  u.onend = () => (speaking = false);
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
      ×
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
      <button className="toolcall-head" onClick={() => setOpen(!open)} aria-expanded={open}>
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

export function ChatWindow() {
  const { chats, currentId, streaming, error, sendMessage, regenerate, stop, clearError, branchAt, editUserMessage, rewindTo, deleteItem, agents, compactChat, setView, settings, browserDock } =
    useStore();
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [compacting, setCompacting] = useState(false);
  const chat = chats.find((c) => c.id === currentId);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recorder, setRecorder] = useState<Recorder | null>(null);
  const [voiceState, setVoiceState] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat?.messages, streaming]);

  if (!chat) return <main className="chat-main" />;

  const agentName = chat.agentId ? agents.find((a) => a.id === chat.agentId)?.name : undefined;

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
    <main className="chat-main">
      <MultiAgentBar />
      <div className={`messages ${chat.mode === "battle" ? "battle" : ""}`} ref={scrollRef}>
        {chat.messages.length === 0 && (() => {
          const provider = settings.providers.find((p) => p.id === chat.providerId);
          const isLocal = provider ? /localhost|127\.0\.0\.1/.test(provider.baseUrl) : false;
          const ready = !!provider && !!chat.model && (isLocal || provider.apiKey.trim() !== "");
          return (
            <div className="empty-state">
              <LogoMark size={46} />
              <h2>Run any model as an agent</h2>
              <p>
                Local, free-cloud, or a flat-rate coding plan — with tools, files, and knowledge, in
                one place.
              </p>
              {ready ? (
                <>
                  <p className="empty-hint">Try one of these to get started:</p>
                  <div className="prompt-chips">
                    {STARTER_PROMPTS.map((p) => (
                      <button key={p} className="prompt-chip" onClick={() => setDraft(p)}>
                        {p}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="empty-hint">
                    No model connected yet. Add a free local, free-cloud, or coding-plan model to
                    begin.
                  </p>
                  <button className="btn primary" onClick={() => setView("discover")}>
                    Connect a model →
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
            if (m.role === "tool") {
              return (
                <ToolResult
                  key={i}
                  name={callName[m.toolCallId ?? ""]}
                  content={m.content}
                  attachments={m.attachments}
                  onDelete={streaming ? undefined : () => void deleteItem(i, "message")}
                />
              );
            }
            const hasText = m.content.trim().length > 0;
            const artifact = m.role === "assistant" ? extractArtifact(m.content) : null;
            if (editIdx === i) {
              return (
                <div key={i} className="msg user">
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
                        void editUserMessage(i, editText);
                      }}
                    >
                      Save &amp; regenerate
                    </button>
                    <button className="btn small" onClick={() => setEditIdx(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div
                key={i}
                className={`msg ${m.role} ${m.author && chat.mode === "battle" ? "battle-col" : ""}`}
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
                        <Markdown>{m.content || (streaming ? "..." : "")}</Markdown>
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
        {error && (
          // role="alert" so the failure is announced, and a real button so it can
          // be dismissed without a mouse.
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="error-dismiss" onClick={clearError} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
      </div>
      {/* Below the thread and above the composer — inside the conversation, but
          deliberately *not* inside the scrolling list. See InlineBrowser. */}
      {browserDock && <InlineBrowser />}
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
    </main>
  );
}
