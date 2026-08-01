import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { VoiceSession, type VoiceCallbacks, type VoiceContext, type VoiceState } from "../lib/voice";
import { usingMediaVoice } from "../lib/tts";
import { executeTool } from "../lib/tools";
import { mediaConfigFromSettings } from "../lib/media";
import { runWorkflow } from "../lib/workflow";
import { prettyName } from "../lib/format";
import { STT_LANGUAGES } from "../lib/whisper";
import * as storage from "../lib/storage";
import type { Tool, VoiceMode } from "../lib/types";

// three.js + three-vrm are large; keep them out of the initial bundle.
const VrmAvatar = lazy(() => import("./VrmAvatar").then((m) => ({ default: m.VrmAvatar })));
const MmdAvatar = lazy(() => import("./MmdAvatar").then((m) => ({ default: m.MmdAvatar })));

/** Useful, low-risk defaults when no agent is selected. */
const DEFAULT_VOICE_TOOLS = [
  "web_search",
  "fetch_page",
  "wikipedia",
  "calculate",
  "get_current_time",
  "http_request",
];

const STATE_LABEL: Record<VoiceState, string> = {
  idle: "Ready",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

interface Turn {
  role: "user" | "assistant" | "action";
  text: string;
}

/**
 * Outlives the component so the avatar can keep listening in the background.
 * React.StrictMode double-mounts in dev, which is exactly why this is a singleton
 * rather than one session per mount.
 */
let liveSession: VoiceSession | null = null;

export function VoiceView() {
  const {
    settings,
    saveSettings,
    setView,
    agents,
    allTools,
    chats,
    selectChat,
    pendingVoiceChat,
    clearPendingVoiceChat,
    setActiveVoiceChat,
  } = useStore();
  const voiceCfg = settings.voice ?? {};
  const realTools = allTools().filter(
    (t) => !t.id.startsWith("agent:") && !t.id.startsWith("workflow:"),
  );
  const selectedToolIds = voiceCfg.toolIds ?? DEFAULT_VOICE_TOOLS;

  const [state, setState] = useState<VoiceState>("idle");
  const [level, setLevel] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [partial, setPartial] = useState("");
  const [running, setRunning] = useState(false);
  const [holding, setHolding] = useState(false);

  const mode: VoiceMode = voiceCfg.mode ?? "ptt";
  const smooth = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<VoiceSession | null>(null);
  const ctxRef = useRef({ settings, mode });
  ctxRef.current = { settings, mode };

  // Resolve which model answers: the configured one, else the first usable provider.
  const resolved = useMemo(() => {
    const byId = settings.providers.find((p) => p.id === voiceCfg.providerId);
    const usable =
      byId ??
      settings.providers.find(
        (p) =>
          p.models.length > 0 &&
          (p.apiKey.trim() !== "" || /localhost|127\.0\.0\.1/.test(p.baseUrl)),
      ) ??
      settings.providers.find((p) => p.models.length > 0);
    const model = (byId && voiceCfg.model) || usable?.models[0] || "";
    return { provider: usable, model };
  }, [settings.providers, voiceCfg.providerId, voiceCfg.model]);

  // The session is a module singleton, not per-view: in background mode it keeps
  // listening after you navigate away or close the window, so it must outlive the
  // component. On remount we rebind the callbacks (the old setStates are stale).
  if (!sessionRef.current) {
    const callbacks: VoiceCallbacks = {
        onState: setState,
        onLevel: (l) => {
          smooth.current = smooth.current * 0.6 + l * 0.4;
          setLevel(smooth.current);
        },
        onStatus: setStatus,
        onUser: (text) => {
          setPartial("");
          setTurns((t) => [...t, { role: "user", text }]);
        },
        onDelta: (d) => setPartial((p) => p + d),
        onAssistant: (text) => {
          setPartial("");
          setTurns((t) => [...t, { role: "assistant", text }]);
        },
        onAction: (label) => setTurns((t) => [...t, { role: "action", text: label }]),
        onError: (msg) => {
          setError(msg);
          if (!liveSession?.isRunning()) {
            setRunning(false);
            useStore.getState().setActiveVoiceChat(null);
          }
        },
      };
    const makeCtx = (): VoiceContext => {
        const st = useStore.getState();
        const s = st.settings;
        const byId = s.providers.find((p) => p.id === (s.voice?.providerId ?? ""));
        const usable =
          byId ??
          s.providers.find(
            (p) =>
              p.models.length > 0 &&
              (p.apiKey.trim() !== "" || /localhost|127\.0\.0\.1/.test(p.baseUrl)),
          ) ??
          s.providers.find((p) => p.models.length > 0);
        const model = (byId && s.voice?.model) || usable?.models[0] || "";
        const agent = st.agents.find((a) => a.id === (s.voice?.agentId ?? ""));
        const all = st.allTools();
        const ids = agent
          ? [
              ...agent.toolIds,
              ...agent.subAgentIds.map((x) => `agent:${x}`),
              ...agent.workflowIds.map((x) => `workflow:${x}`),
            ]
          : (s.voice?.toolIds ?? DEFAULT_VOICE_TOOLS);
        const tools = all.filter((t) => ids.includes(t.id));
        const cwd = s.voice?.workingDir ?? "";
        return {
          settings: s,
          provider: usable,
          model,
          agent,
          knowledgeBases: st.knowledgeBases,
          tools,
          execTool: async (tool: Tool, args: Record<string, unknown>) => {
            if (tool.id.startsWith("agent:")) {
              return st.runAgentTask(tool.id.slice(6), String(args.query ?? ""), () => {});
            }
            if (tool.id.startsWith("workflow:")) {
              const wf = st.workflows.find((w) => w.id === tool.id.slice(9));
              if (!wf) return "Error: workflow not found";
              return runWorkflow(wf, {
                provider: usable!,
                model,
                tools: all,
                input: String(args.input ?? ""),
                signal: new AbortController().signal,
                onLog: () => {},
                runAgent: (id, input) => st.runAgentTask(id, input, () => {}),
                media: mediaConfigFromSettings(s),
              });
            }
            return executeTool(
              tool,
              args,
              cwd,
              mediaConfigFromSettings(s),
              agent ? { kind: "agent", id: agent.id } : { kind: "voice" },
            );
          },
        };
      };
    if (liveSession) {
      liveSession.rebind(callbacks, makeCtx);
      sessionRef.current = liveSession;
    } else {
      liveSession = new VoiceSession(callbacks, makeCtx);
      sessionRef.current = liveSession;
    }
  }

  // Rehydrate the UI from a session that kept running while we were away. Without
  // this the view reads "Off" while the avatar is still listening in the background.
  useEffect(() => {
    const s = sessionRef.current;
    if (!s?.isRunning()) {
      setActiveVoiceChat(null);
      return;
    }
    setRunning(true);
    setActiveVoiceChat(s.getChatId());
    setState(s.getState());
    setTurns(
      s
        .getHistory()
        .filter((m) => m.role === "user" || m.role === "assistant")
        .filter((m) => m.content.trim())
        .map((m) => ({ role: m.role as "user" | "assistant", text: m.content })),
    );
  }, []);

  // The sidebar starts calls by putting a request in the store: "new" for a fresh
  // one, or a chat id to reopen. Doing it this way keeps the session out of the
  // sidebar and survives this view being unmounted.
  useEffect(() => {
    if (!pendingVoiceChat) return;
    const id = pendingVoiceChat;
    clearPendingVoiceChat();
    const s = sessionRef.current;
    if (!s) return;
    // Already on that call? Just show it rather than restarting.
    if (id !== "new" && s.isRunning() && s.getChatId() === id) return;
    void (id === "new" ? startFresh() : resume(id));
  }, [pendingVoiceChat, clearPendingVoiceChat]);

  // Global push-to-talk (Ctrl+Shift+V held) — works even when the window isn't focused.
  useEffect(() => {
    let un: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<boolean>("voice-ptt", (e) => {
        const s = sessionRef.current;
        if (!s) return;
        if (e.payload) {
          setHolding(true);
          void s.pttDown();
        } else {
          setHolding(false);
          void s.pttUp();
        }
      }).then((f) => (un = f)),
    );
    return () => un?.();
  }, []);

  // Leaving the view only stops the avatar when background mode is off — otherwise
  // the whole point is that it keeps listening while you work elsewhere.
  useEffect(
    () => () => {
      if (!(useStore.getState().settings.backgroundMode ?? true)) {
        void sessionRef.current?.stop();
      }
    },
    [],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, partial]);

  const patchVoice = (p: Partial<typeof voiceCfg>) =>
    void saveSettings({ ...settings, voice: { ...voiceCfg, ...p } });

  /** Turn the spoken conversation into a normal chat so it persists and can be continued. */
  /** Open this spoken conversation in the normal chat view (it's a real chat). */
  const openInChat = () => {
    const id = sessionRef.current?.getChatId();
    if (id) selectChat(id);
  };

  const [compacting, setCompacting] = useState(false);
  const compactNow = async () => {
    setCompacting(true);
    try {
      await sessionRef.current?.compactNow();
    } finally {
      setCompacting(false);
    }
  };

  // Saved spoken conversations, newest first — the resume list.
  const pastVoiceChats = useMemo(
    () =>
      chats
        .filter((c) => c.kind === "voice" && c.id !== sessionRef.current?.getChatId())
        .slice(0, 8),
    [chats],
  );

  /** Resume a saved spoken conversation from where it left off. */
  const resume = async (id: string) => {
    const s = sessionRef.current!;
    setError(null);
    setPartial("");
    if (s.isRunning()) await s.stop();
    if (!resolved.provider || !resolved.model) {
      setError("Add a provider with a model first, then start the avatar.");
      return;
    }
    setRunning(true);
    await s.start(mode, id);
    setActiveVoiceChat(s.getChatId());
    setTurns(
      s
        .getHistory()
        .filter((m) => m.role !== "tool")
        .map((m) => ({ role: m.role as "user" | "assistant", text: m.content })),
    );
  };

  /** Begin a brand-new call. The previous one stays saved. */
  const startFresh = async () => {
    const s = sessionRef.current!;
    setError(null);
    setPartial("");
    setTurns([]);
    if (s.isRunning()) await s.stop();
    if (!resolved.provider || !resolved.model) {
      setError("Add a provider with a model first, then start the avatar.");
      return;
    }
    setRunning(true);
    await s.start(mode);
    setActiveVoiceChat(s.getChatId());
  };

  const toggleSession = async () => {
    const s = sessionRef.current!;
    setError(null);
    if (running) {
      await s.stop();
      setRunning(false);
      setActiveVoiceChat(null);
    } else {
      await startFresh();
    }
  };

  const changeMode = async (m: VoiceMode) => {
    patchVoice({ mode: m });
    const s = sessionRef.current!;
    s.setMode(m);
    if (running) {
      // Restart on the same call — switching push-to-talk to hands-free shouldn't
      // abandon the conversation and open a new one.
      const id = s.getChatId();
      await s.stop();
      setRunning(true);
      await s.start(m, id ?? undefined);
      setActiveVoiceChat(s.getChatId());
    }
  };

  // Load the chosen model once; the avatar component animates it from state + level.
  // A VRM is a single file; an MMD model is a folder of a .pmx plus its textures.
  const avatarFile = voiceCfg.avatarFile ?? "";
  const avatarKind = avatarFile ? storage.avatarKind(avatarFile) : null;
  const [avatarData, setAvatarData] = useState<Uint8Array | null>(null);
  const [avatarBundle, setAvatarBundle] = useState<Map<string, Uint8Array> | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  useEffect(() => {
    setAvatarData(null);
    setAvatarBundle(null);
    setAvatarError(null);
    if (!avatarFile) return;

    let live = true;
    const fail = (e: unknown) => {
      if (live) setAvatarError(`Couldn't read the avatar: ${(e as Error).message || String(e)}`);
    };

    if (storage.avatarKind(avatarFile) === "mmd") {
      void storage
        .readAvatarBundle(avatarFile)
        .then((b) => live && setAvatarBundle(b))
        .catch(fail);
    } else {
      void storage
        .readAvatar(avatarFile)
        .then((bytes) => live && setAvatarData(bytes))
        .catch(fail);
    }
    return () => {
      live = false;
    };
  }, [avatarFile]);

  /** Path of the .pmx inside its folder, which is how the bundle is keyed. */
  const mmdModelPath = avatarFile.split("/").slice(1).join("/");

  // Orb reacts to mic level while listening, and gently pulses while speaking.
  const amp = state === "listening" ? Math.min(1, level * 9) : 0;
  const scale = 1 + amp * 0.28;
  const speaking = state === "speaking";

  return (
    <main className="voice-main">
      <div className="voice-stage">
        {avatarData || avatarBundle ? (
          <Suspense fallback={<div className="vrm-stage vrm-loading">Loading avatar…</div>}>
            {avatarKind === "mmd" && avatarBundle ? (
              <MmdAvatar
                bundle={avatarBundle}
                modelPath={mmdModelPath}
                state={state}
                level={level}
                onError={(m) => setAvatarError(m)}
              />
            ) : (
              avatarData && (
                <VrmAvatar
                  data={avatarData}
                  state={state}
                  level={level}
                  onError={(m) => setAvatarError(m)}
                />
              )
            )}
          </Suspense>
        ) : (
          <div className={`orb-wrap orb-${state}`}>
            <div className="orb-ring" style={{ transform: `scale(${1 + amp * 0.5})`, opacity: 0.25 + amp * 0.5 }} />
            <div className={`orb ${speaking ? "orb-speaking" : ""}`} style={{ transform: `scale(${scale})` }}>
              <div className="orb-core" />
            </div>
          </div>
        )}
        {avatarError && (
          <div className="error-banner voice-error" role="alert">
            <span>{avatarError}</span>
            <button className="error-dismiss" aria-label="Dismiss" onClick={() => setAvatarError(null)}>
              ×
            </button>
          </div>
        )}

        <div className="voice-state-label">{running ? STATE_LABEL[state] : "Off"}</div>
        {status && <div className="voice-substatus">{status}</div>}
        {error && (
          <div className="error-banner voice-error" onClick={() => setError(null)}>
            {error}
          </div>
        )}

        <div className="voice-controls">
          <button className={`btn ${running ? "danger" : "primary"}`} onClick={() => void toggleSession()}>
            {running ? "Stop" : "Start avatar"}
          </button>
          {mode === "ptt" && running && (
            <button
              className={`btn voice-ptt ${holding ? "active" : ""}`}
              onMouseDown={() => {
                setHolding(true);
                void sessionRef.current?.pttDown();
              }}
              onMouseUp={() => {
                setHolding(false);
                void sessionRef.current?.pttUp();
              }}
              onMouseLeave={() => {
                if (holding) {
                  setHolding(false);
                  void sessionRef.current?.pttUp();
                }
              }}
            >
              {holding ? "Listening — release to send" : "Hold to talk"}
            </button>
          )}
          {(state === "speaking" || state === "thinking") && (
            <button className="btn" onClick={() => void sessionRef.current?.interrupt()}>
              Interrupt
            </button>
          )}
        </div>

        <div className="voice-modes">
          <button
            className={`seg-btn ${mode === "ptt" ? "active" : ""}`}
            onClick={() => void changeMode("ptt")}
          >
            Push to talk
          </button>
          <button
            className={`seg-btn ${mode === "auto" ? "active" : ""}`}
            onClick={() => void changeMode("auto")}
          >
            Always listening
          </button>
        </div>

        <p className="hint voice-hint">
          {mode === "ptt" ? (
            <>
              Hold <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> anywhere — even when this window
              isn't focused — talk, then release to send.
            </>
          ) : (
            <>
              Just talk. It listens continuously and replies when you stop speaking. Mic stays off
              while it's answering, so it won't hear itself.
            </>
          )}
          {" · "}
          {resolved.provider && resolved.model
            ? `${resolved.provider.name} · ${resolved.model}`
            : "no model selected"}
          {" · voice: "}
          {usingMediaVoice(settings) ? "media TTS model" : "Windows built-in"}
        </p>
      </div>

      <div className="voice-side">
        <div className="voice-side-head">
          <b>Conversation</b>
          <span>
            <button className="link-btn" disabled={!turns.length} onClick={openInChat}>
              Open in chat
            </button>{" "}
            <button
              className="link-btn"
              disabled={compacting || turns.length < 6}
              title="Summarize older turns so a long session keeps its context"
              onClick={() => void compactNow()}
            >
              {compacting ? "Compacting…" : "Compact"}
            </button>{" "}
            <button
              className="link-btn"
              title="Start a new call — this one stays saved"
              onClick={() => void startFresh()}
            >
              New
            </button>
          </span>
        </div>
        <div className="voice-transcript" ref={scrollRef}>
          {turns.length === 0 && !partial && (
            <>
              <p className="hint">Start the avatar and say something — the conversation appears here.</p>
              {pastVoiceChats.length > 0 && (
                <div className="voice-resume">
                  <p className="hint">Or pick up where you left off:</p>
                  {pastVoiceChats.map((c) => (
                    <button
                      key={c.id}
                      className="voice-resume-item"
                      onClick={() => void resume(c.id)}
                      title={`Resume "${c.title}"`}
                    >
                      <span className="grow">{c.title}</span>
                      <span className="hint">{new Date(c.updatedAt).toLocaleDateString()}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {turns.map((t, i) =>
            t.role === "action" ? (
              <div key={i} className="voice-action">
                <span className="voice-action-dot" /> {t.text}
              </div>
            ) : (
              <div key={i} className={`voice-turn voice-turn-${t.role}`}>
                <span className="voice-turn-who">{t.role === "user" ? "You" : "Avatar"}</span>
                <div>{t.text}</div>
              </div>
            ),
          )}
          {partial && (
            <div className="voice-turn voice-turn-assistant">
              <span className="voice-turn-who">Avatar</span>
              <div>{partial}</div>
            </div>
          )}
        </div>

        <div className="voice-side-settings">
          <label className="field">
            <span>Model</span>
            <select
              value={voiceCfg.providerId ?? ""}
              onChange={(e) => {
                const p = settings.providers.find((x) => x.id === e.target.value);
                patchVoice({ providerId: e.target.value, model: p?.models[0] ?? "" });
              }}
            >
              <option value="">Auto (first available)</option>
              {settings.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {voiceCfg.providerId && (
            <label className="field">
              <span>&nbsp;</span>
              <select value={voiceCfg.model ?? ""} onChange={(e) => patchVoice({ model: e.target.value })}>
                {(settings.providers.find((p) => p.id === voiceCfg.providerId)?.models ?? []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Agent (gives it tools, knowledge &amp; memory)</span>
            <select
              value={voiceCfg.agentId ?? ""}
              onChange={(e) => patchVoice({ agentId: e.target.value })}
            >
              <option value="">No agent — use the tools below</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          {!voiceCfg.agentId && (
            <details className="voice-tools">
              <summary>Tools it can use ({selectedToolIds.length})</summary>
              <div className="agent-check-grid">
                {realTools.map((t) => (
                  <label key={t.id} className="agent-check">
                    <input
                      type="checkbox"
                      checked={selectedToolIds.includes(t.id)}
                      onChange={() =>
                        patchVoice({
                          toolIds: selectedToolIds.includes(t.id)
                            ? selectedToolIds.filter((x) => x !== t.id)
                            : [...selectedToolIds, t.id],
                        })
                      }
                    />
                    {prettyName(t.name)}
                  </label>
                ))}
              </div>
            </details>
          )}

          <label className="field">
            <span>Working folder (for file &amp; terminal tools)</span>
            <input
              placeholder="e.g. Desktop  — blank = home folder"
              value={voiceCfg.workingDir ?? ""}
              onChange={(e) => patchVoice({ workingDir: e.target.value })}
            />
          </label>

          <label className="field">
            <span>Persona (optional)</span>
            <textarea
              rows={2}
              placeholder="e.g. You are Nova, warm and witty. Keep answers punchy."
              value={voiceCfg.instructions ?? ""}
              onChange={(e) => patchVoice({ instructions: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Wake word (always-listening only)</span>
            <input
              placeholder='e.g. "hey nova" — blank = respond to everything'
              value={voiceCfg.wakeWord ?? ""}
              onChange={(e) => patchVoice({ wakeWord: e.target.value })}
            />
          </label>
          <label className="agent-check">
            <input
              type="checkbox"
              checked={voiceCfg.speakReplies ?? true}
              onChange={(e) => patchVoice({ speakReplies: e.target.checked })}
            />
            Speak replies aloud
          </label>
          <label className="agent-check">
            <input
              type="checkbox"
              checked={voiceCfg.bargeIn ?? false}
              onChange={(e) => patchVoice({ bargeIn: e.target.checked })}
            />
            Let me interrupt by talking (use headphones)
          </label>
          <label className="field">
            <span>Language I speak</span>
            <select
              value={voiceCfg.language ?? "auto"}
              onChange={(e) => patchVoice({ language: e.target.value })}
            >
              {STT_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <p className="hint" style={{ marginTop: 2 }}>
            Picking your language instead of auto-detect makes transcription noticeably faster and
            more accurate — auto has to guess on every utterance.
          </p>
          <label className="field">
            <span>Reply in</span>
            <select
              value={voiceCfg.replyLanguage ?? "match"}
              onChange={(e) => patchVoice({ replyLanguage: e.target.value })}
            >
              <option value="match">Whatever language I spoke</option>
              {STT_LANGUAGES.filter((l) => l.id !== "auto").map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="agent-check">
            <input
              type="checkbox"
              checked={voiceCfg.translateToEnglish ?? false}
              onChange={(e) => patchVoice({ translateToEnglish: e.target.checked })}
            />
            Transcribe my speech into English
          </label>
          <label className="agent-check">
            <input
              type="checkbox"
              checked={voiceCfg.noThinking ?? true}
              onChange={(e) => patchVoice({ noThinking: e.target.checked })}
            />
            Disable thinking on all models (faster replies)
          </label>
          <label className="agent-check">
            <input
              type="checkbox"
              checked={voiceCfg.humanDelivery ?? true}
              onChange={(e) => patchVoice({ humanDelivery: e.target.checked })}
            />
            Sound human (contractions, pauses, natural rhythm)
          </label>
          <label className="field">
            <span>Personality</span>
            <select
              value={voiceCfg.persona ?? "friendly"}
              onChange={(e) => patchVoice({ persona: e.target.value as typeof voiceCfg.persona })}
            >
              <option value="friendly">Friendly — warm, easy-going</option>
              <option value="calm">Calm — steady, unhurried</option>
              <option value="upbeat">Upbeat — bright, energetic</option>
              <option value="professional">Professional — crisp colleague</option>
              <option value="none">None — plain assistant</option>
            </select>
          </label>
          <label className="field">
            <span>Expressiveness — {(voiceCfg.expressiveness ?? 1).toFixed(1)}×</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={voiceCfg.expressiveness ?? 1}
              onChange={(e) => patchVoice({ expressiveness: Number(e.target.value) })}
            />
          </label>
          <label className="agent-check">
            <input
              type="checkbox"
              checked={voiceCfg.smartEndpoint ?? true}
              onChange={(e) => patchVoice({ smartEndpoint: e.target.checked })}
            />
            Wait for me to finish my sentence
          </label>
          <p className="hint" style={{ marginTop: 2 }}>
            Pause mid-thought ("hi, I want you to…") and it keeps listening instead of answering,
            stitching what you say next onto the same request.
          </p>
          <button className="link-btn" onClick={() => setView("settings")}>
            Voice &amp; TTS settings →
          </button>
        </div>
      </div>
    </main>
  );
}
