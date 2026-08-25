import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { toast } from "../lib/toast";
import { isWeb } from "../lib/web";
import { acpConnect, type AcpSession, type AcpUpdate } from "../lib/acp";
import { ask } from "../lib/askUser";
import { EmptyState } from "./EmptyState";

/**
 * ACP agents (plan WP4, docs/research/acp-b-plan.md): run agents from the ACP
 * registry inside the conversation. Config lives in Settings → ACP agents;
 * this view connects, carries the transcript, and surfaces the agent's
 * permission requests as questions the user answers inline.
 *
 * Deliberately plainer than the chat surface: an ACP agent owns its own tool
 * loop, so this is a terminal-with-guardrails, not a full conversation.
 */

interface Entry {
  kind: "user" | "agent" | "status" | "error";
  text: string;
}

interface Running {
  session: AcpSession;
  entries: Entry[];
  busy: boolean;
}

function updateToEntry(u: AcpUpdate): Entry | null {
  if (u.sessionUpdate === "agent_message_chunk") return { kind: "agent", text: u.content?.text ?? "" };
  if (u.sessionUpdate === "user_message_chunk") return null; // our own words, echoed
  if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
    const title = u.title ?? u.toolCallId ?? "tool";
    return { kind: "status", text: `${u.sessionUpdate === "tool_call" ? "→" : "·"} ${title}${u.status ? ` (${u.status})` : ""}` };
  }
  if (u.sessionUpdate === "plan") {
    const entries = (u as { entries?: { content: string; status: string }[] }).entries ?? [];
    return { kind: "status", text: `plan: ${entries.map((e) => e.content).join(" · ")}` };
  }
  return { kind: "status", text: u.sessionUpdate };
}

export function AcpView() {
  const { settings, setView } = useStore();
  const agents = settings.acpAgents ?? [];
  const [running, setRunning] = useState<Record<string, Running>>({});
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const sessionRefs = useRef<Record<string, AcpSession | null>>({});
  // Connect is async; a double-click must not spawn two processes for one id.
  const connectingRef = useRef<Set<string>>(new Set());
  // Async callbacks must not setState after the view is gone.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => () => {
    // Leaving the view keeps agents running (they own their loop); the panel
    // just stops watching. Dispose happens via Disconnect.
  }, []);

  const patch = (id: string, fn: (r: Running) => Running) => {
    if (!mountedRef.current) return;
    setRunning((prev) => {
      const cur = prev[id];
      return cur ? { ...prev, [id]: fn(cur) } : prev;
    });
  };

  const connect = async (id: string) => {
    const cfg = agents.find((a) => a.id === id);
    if (!cfg || running[id] || connectingRef.current.has(id)) return;
    connectingRef.current.add(id);
    try {
      const session = await acpConnect(cfg, {
        onUpdate: (u) => {
          const entry = updateToEntry(u);
          if (entry) {
            patch(id, (r) => {
              const last = r.entries[r.entries.length - 1];
              // Consecutive agent chunks are one message — append, don't stack.
              if (entry.kind === "agent" && last?.kind === "agent") {
                const merged = { ...last, text: last.text + entry.text };
                return { ...r, entries: [...r.entries.slice(0, -1), merged] };
              }
              return { ...r, entries: [...r.entries, entry] };
            });
          }
        },
        onRequestPermission: async (req) => {
          const labels = req.options.map((o) => o.name);
          try {
            const answer = await ask({
              question: `${cfg.name} asks: ${req.toolCall?.title ?? "permission requested"}`,
              options: labels,
              chatId: req.sessionId,
            });
            return req.options.find((o) => o.name === answer)?.optionId ?? null;
          } catch {
            return null; // dismissed — the cancelled outcome
          }
        },
        onExit: (error) => {
          sessionRefs.current[id] = null;
          if (!mountedRef.current) return;
          setRunning((prev) => {
            const r = prev[id];
            if (!r) return prev;
            const next: Running = {
              ...r,
              busy: false,
              entries: [...r.entries, { kind: "error", text: error ?? "the agent exited" }],
            };
            return { ...prev, [id]: next };
          });
        },
      });
      sessionRefs.current[id] = session;
      setRunning((prev) => ({ ...prev, [id]: { session, entries: [], busy: false } as Running }));
      toast.success(`${cfg.name} running.`);
    } catch (e) {
      toast.error((e as Error).message || String(e));
    } finally {
      connectingRef.current.delete(id);
    }
  };

  const disconnect = async (id: string) => {
    await sessionRefs.current[id]?.dispose().catch(() => {});
    sessionRefs.current[id] = null;
    setRunning((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const send = async (id: string) => {
    const r = running[id];
    const text = draft.trim();
    if (!r || !text || busyId) return;
    setDraft("");
    setBusyId(id);
    patch(id, (cur) => ({ ...cur, busy: true, entries: [...cur.entries, { kind: "user", text }] }));
    try {
      const res = await r.session.prompt(text);
      patch(id, (cur) => ({
        ...cur,
        busy: false,
        entries: [...cur.entries, { kind: "status", text: `— ${res.stopReason} —` }],
      }));
    } catch (e) {
      patch(id, (cur) => ({
        ...cur,
        busy: false,
        entries: [...cur.entries, { kind: "error", text: (e as Error).message }],
      }));
    } finally {
      setBusyId(null);
    }
  };

  if (isWeb()) {
    return (
      <main className="view">
        <EmptyState
          title="ACP agents"
          hint="ACP agents run as subprocesses of the desktop app, which the browser build can't do."
        />
      </main>
    );
  }

  return (
    <main className="view">
      <h2>ACP agents</h2>
      <p className="hint">
        Agents from the ACP registry, running as subprocesses and talking to you here. Configure
        them in <button className="link-btn" onClick={() => {
          localStorage.setItem("hs-settings-tab", "acp");
          setView("settings");
        }}>Settings → ACP agents</button>.
      </p>

      {agents.length === 0 && (
        <EmptyState
          title="No ACP agents configured"
          hint="Add one in Settings → ACP agents — the command is what an ACP editor would launch."
          action={{ label: "Open Settings", onClick: () => {
            localStorage.setItem("hs-settings-tab", "acp");
            setView("settings");
          } }}
        />
      )}

      {agents.map((a) => {
        const r = running[a.id];
        return (
          <div key={a.id} className="provider-card" style={{ marginBottom: 14 }}>
            <div className="provider-row" style={{ alignItems: "center" }}>
              <span className="grow" style={{ fontWeight: 600 }}>
                {a.name} <span className="hint">({a.command})</span>
              </span>
              {r ? (
                <>
                  <span className="pill ok">Running</span>
                  <button className="btn danger small" disabled={busyId === a.id} onClick={() => void disconnect(a.id)}>
                    Disconnect
                  </button>
                </>
              ) : (
                <button className="btn small" onClick={() => void connect(a.id)}>
                  Run
                </button>
              )}
            </div>

            {r && (
              <>
                <div
                  className="code-view"
                  style={{ maxHeight: 340, overflowY: "auto", whiteSpace: "pre-wrap", padding: 10 }}
                >
                  {r.entries.length === 0 && <span className="hint">No turns yet — say something.</span>}
                  {r.entries.map((e, i) => (
                    <div
                      key={i}
                      style={{
                        marginBottom: 6,
                        color: e.kind === "error" ? "var(--danger)" : e.kind === "status" ? "var(--text-dim)" : undefined,
                        fontWeight: e.kind === "user" ? 600 : undefined,
                      }}
                    >
                      {e.kind === "user" ? "you: " : ""}
                      {e.text}
                    </div>
                  ))}
                  {r.busy && <span className="hint">working…</span>}
                </div>
                <div className="provider-row" style={{ marginTop: 8 }}>
                  <textarea
                    className="grow"
                    rows={2}
                    value={draft}
                    placeholder={r.busy ? "Working…" : "Prompt the agent (Enter to send)"}
                    disabled={r.busy || busyId !== null}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send(a.id);
                      }
                    }}
                  />
                  <button
                    className="btn danger small"
                    title="Cancel the running turn"
                    onClick={() => r.session.cancel()}
                    disabled={!r.busy}
                  >
                    Stop
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </main>
  );
}
