import { useCallback, useEffect, useRef, useState } from "react";
import {
  ISOLATED,
  assistantText,
  claudeEndInput,
  claudeProbe,
  claudeSend,
  claudeStart,
  claudeStop,
  isInit,
  isResult,
  isSubagent,
  nextRunId,
  onClaudeEvent,
  toolUses,
  type ClaudeResult,
  type SystemInit,
} from "../lib/claudeCode";
import { agentsArg, writeKit } from "../lib/claudeKit";
import { listSkills, loadSkillBody } from "../lib/skills";
import { useStore } from "../lib/store";
import { EmptyState } from "./EmptyState";
import { IconBolt } from "./icons";

interface Line {
  id: number;
  kind: "you" | "claude" | "tool" | "notice" | "subagent";
  text: string;
}

/**
 * Run Claude Code inside HarnessStation, with this app's agents and skills
 * injected into the session.
 *
 * Claude Code is not reimplemented here — the installed `claude` binary runs it.
 * What this view adds is the two injections it accepts per session: agents as a
 * `--agents` JSON object, and skills as a generated plugin directory. Both are
 * read back out of the `system/init` event and shown, so "injected" is something
 * observed rather than claimed.
 */
export function ClaudeCodeView() {
  const { agents, chats, currentId } = useStore();
  const [version, setVersion] = useState<string | null | "checking">("checking");
  // Seeded from the open chat's working directory: the folder the user is
  // already pointing the app's own tools at is the one they mean here too.
  const [cwd, setCwd] = useState(chats.find((c) => c.id === currentId)?.workingDir ?? "");
  const [model, setModel] = useState("");
  const [isolate, setIsolate] = useState(true);
  const [injectAgents, setInjectAgents] = useState(true);
  const [injectSkills, setInjectSkills] = useState(true);
  const [running, setRunning] = useState(false);
  const [init, setInit] = useState<SystemInit | null>(null);
  const [result, setResult] = useState<ClaudeResult | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const unlisten = useRef<(() => void) | null>(null);
  const runId = useRef(0);
  const lineId = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  const push = useCallback((kind: Line["kind"], text: string) => {
    if (!text.trim()) return;
    setLines((prev) => [...prev, { id: ++lineId.current, kind, text }]);
  }, []);

  useEffect(() => {
    void claudeProbe().then(setVersion);
    // The listener outlives a render but not the view; without this a closed
    // view keeps receiving events and setting state on an unmounted tree.
    return () => {
      unlisten.current?.();
      void claudeStop();
    };
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lines]);

  const start = async () => {
    setError(null);
    setInit(null);
    setResult(null);
    setLines([]);
    try {
      // Rewritten every launch: skills are edited between runs, and a stale kit
      // would inject the previous set with nothing to show it had.
      let pluginDirs: string[] = [];
      if (injectSkills) {
        const enabled = (await listSkills()).filter((s) => s.enabled);
        const sources = await Promise.all(
          enabled.map(async (s) => ({
            name: s.name,
            description: s.description,
            body: await loadSkillBody(s.slug).catch(() => ""),
          })),
        );
        if (sources.some((s) => s.body.trim())) pluginDirs = [await writeKit(sources)];
      }

      const id = nextRunId();
      runId.current = id;
      unlisten.current?.();
      unlisten.current = await onClaudeEvent(id, {
        onEvent: (e) => {
          if (isInit(e)) {
            setInit(e);
            return;
          }
          if (isResult(e)) {
            setResult(e);
            return;
          }
          if (e.type === "assistant") {
            const text = assistantText(e);
            if (text) push(isSubagent(e) ? "subagent" : "claude", text);
            for (const t of toolUses(e)) push("tool", t.name);
          }
        },
        onNotice: (text) => push("notice", text),
        onDone: () => setRunning(false),
      });

      await claudeStart(
        {
          ...(isolate ? ISOLATED : {}),
          cwd,
          model,
          agentsJson: injectAgents ? agentsArg(agents) : "",
          pluginDirs,
          forwardSubagentText: true,
        },
        id,
      );
      setRunning(true);
    } catch (e) {
      setError((e as Error).message || String(e));
      setRunning(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !running) return;
    setDraft("");
    push("you", text);
    setResult(null);
    try {
      await claudeSend(text);
    } catch (e) {
      setError((e as Error).message || String(e));
    }
  };

  const stop = async () => {
    await claudeStop();
    setRunning(false);
  };

  if (version === "checking") return <main className="view"><p className="hint">Looking for Claude Code…</p></main>;

  if (version === null) {
    return (
      <main className="view">
        <h1>Claude Code</h1>
        <EmptyState
          icon={<IconBolt size={22} />}
          title="Claude Code isn't installed"
          hint="This runs the `claude` CLI on your machine — it isn't bundled. Install it, make sure `claude` is on your PATH, then reopen this view."
          action={{ label: "Re-check", onClick: () => void claudeProbe().then(setVersion) }}
        />
      </main>
    );
  }

  return (
    <main className="view">
      <h1>Claude Code</h1>
      <p className="hint">
        Runs the <code>claude</code> CLI ({version}) as a session here, with this app's agents and
        skills injected into it.
      </p>

      <section>
        <div className="load-opts">
          <label>
            Folder{" "}
            <input
              className="grow"
              placeholder="working directory for the session"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              disabled={running}
            />
          </label>
          <label>
            Model{" "}
            <input
              placeholder="default"
              style={{ width: 120 }}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={running}
            />
          </label>
        </div>

        <div className="load-opts-advanced">
          <label className="check">
            <input
              type="checkbox"
              checked={injectAgents}
              onChange={(e) => setInjectAgents(e.target.checked)}
              disabled={running}
            />
            Inject this app's agents ({agents.length})
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={injectSkills}
              onChange={(e) => setInjectSkills(e.target.checked)}
              disabled={running}
            />
            Inject this app's enabled skills
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={isolate}
              onChange={(e) => setIsolate(e.target.checked)}
              disabled={running}
            />
            Ignore my own Claude Code config
          </label>
          {/* Not a detail. Left on, a session inherits whatever skills, agents,
              output style and MCP servers the machine happens to have — so the
              same run behaves differently per machine, invisibly from in here. */}
          <p className="hint">
            On, the session ignores your settings files — your own agents, output style and MCP
            servers stay out of it. Claude Code's own built-in agents and bundled skills still load
            either way.
          </p>
        </div>

        <div className="provider-row">
          {running ? (
            <>
              <button className="btn danger" onClick={() => void stop()}>
                Stop session
              </button>
              <button className="btn ghost" onClick={() => void claudeEndInput()} title="Close stdin and let the run finish on its own">
                Finish
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={() => void start()}>
              Start session
            </button>
          )}
        </div>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
          </div>
        )}
      </section>

      {init && (
        <section>
          <h2>What loaded</h2>
          {/* Read back from system/init rather than assumed: a --plugin-dir that
              doesn't resolve is ignored silently, so the only honest way to say
              a skill was injected is that the session reported it. */}
          <p className="hint">
            Reported by the session itself — model <code>{init.model}</code>, session{" "}
            <code>{init.session_id.slice(0, 8)}</code>.
          </p>
          <div className="att-tray">
            {init.agents.map((a) => (
              <span key={a} className="chip-tag">
                agent: {a}
              </span>
            ))}
            {init.skills.map((s) => (
              <span key={s} className="chip-tag">
                skill: {s}
              </span>
            ))}
          </div>
          {injectSkills && !init.skills.some((s) => s.startsWith("harnessstation:")) && (
            <p className="hint">No injected skills loaded — check that some skills are enabled.</p>
          )}
        </section>
      )}

      <section>
        <div className="messages" ref={scroller} style={{ maxHeight: 420, overflowY: "auto" }}>
          {lines.length === 0 && !running && <p className="hint">Start a session, then send it a task.</p>}
          {lines.map((l) => (
            <div key={l.id} className={`cc-line cc-${l.kind}`}>
              <span className="cc-tag">{l.kind}</span>
              <span className="cc-text">{l.text}</span>
            </div>
          ))}
        </div>

        {result && (
          <p className="hint">
            {result.is_error ? "Failed" : "Done"} — {result.num_turns} turn(s),{" "}
            ${result.total_cost_usd.toFixed(4)}, {(result.duration_ms / 1000).toFixed(1)}s.
          </p>
        )}

        <div className="provider-row">
          <input
            className="grow"
            placeholder={running ? "Ask Claude Code to do something…" : "Start a session first"}
            value={draft}
            disabled={!running}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void send();
            }}
          />
          <button className="btn primary" onClick={() => void send()} disabled={!running || !draft.trim()}>
            Send
          </button>
        </div>
      </section>
    </main>
  );
}
