import { useEffect, useState } from "react";
import { confirmDialog } from "../lib/dialog";
import { EmptyState } from "./EmptyState";
import { PublishButton } from "./PublishButton";
import { IconAgent } from "./icons";
import { prettyName } from "../lib/format";
import { toast } from "../lib/toast";
import { BUILTIN_TOOLS } from "../lib/tools";
import { AGENT_PRESETS } from "../lib/agentPresets";
import { useStore } from "../lib/store";
import { ModelOptions } from "./ModelOptions";
import type { Agent } from "../lib/types";

function emptyAgent(): Agent {
  return {
    id: "",
    name: "New agent",
    description: "",
    instructions: "You are a helpful assistant.",
    providerId: "",
    model: "",
    temperature: 0.7,
    maxTokens: 0,
    toolIds: [],
    workflowIds: [],
    subAgentIds: [],
    knowledgeBaseIds: [],
    autoMemory: false,
  };
}

export function AgentsView() {
  const {
    agents,
    saveAgent,
    deleteAgent,
    applyAgentToChat,
    runAgentTask,
    customTools,
    mcpTools,
    workflows,
    knowledgeBases,
    ensureKnowledgeBases,
    settings,
  } = useStore();

  // Knowledge bases load on demand — this picker is one of the triggers.
  useEffect(() => {
    void ensureKnowledgeBases();
  }, [ensureKnowledgeBases]);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [runFor, setRunFor] = useState<Agent | null>(null);
  const [runInput, setRunInput] = useState("");
  const [runLog, setRunLog] = useState<string[]>([]);
  const [runOut, setRunOut] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const realTools = [...BUILTIN_TOOLS, ...customTools, ...mcpTools];

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const addStarters = async () => {
    const existing = new Set(agents.map((a) => a.name.toLowerCase()));
    const toAdd = AGENT_PRESETS.filter((p) => !existing.has(p.name.toLowerCase()));
    if (!toAdd.length) {
      toast.info("All starter agents are already added.");
      return;
    }
    for (let i = 0; i < toAdd.length; i++) {
      await saveAgent({ ...toAdd[i], id: `agent-${Date.now()}-${i}` });
    }
    toast.success(`Added ${toAdd.length} starter agent${toAdd.length > 1 ? "s" : ""}.`);
  };

  const doRun = async (a: Agent) => {
    setRunning(true);
    setRunLog([]);
    setRunOut(null);
    try {
      const out = await runAgentTask(a.id, runInput, (l) => setRunLog((prev) => [...prev, l]));
      setRunOut(out);
    } catch (e) {
      setRunOut(`Error: ${(e as Error).message || String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  // ---------- editor ----------
  if (editing) {
    const a = editing;
    const set = (p: Partial<Agent>) => setEditing({ ...a, ...p });
    const provider = settings.providers.find((x) => x.id === a.providerId);
    return (
      <main className="settings-main">
        <div className="settings-header">
          <h1>{a.id ? "Edit agent" : "New agent"}</h1>
          <div>
            <button
              className="btn primary"
              onClick={() => {
                void saveAgent({ ...a, id: a.id || `agent-${Date.now()}` });
                setEditing(null);
              }}
            >
              Save
            </button>{" "}
            <button className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>

        <label className="field">
          <span>Name</span>
          <input value={a.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>Description</span>
          <input value={a.description} onChange={(e) => set({ description: e.target.value })} placeholder="Short summary of what this agent does" />
        </label>
        <label className="field">
          <span>Instructions (system prompt)</span>
          <textarea rows={6} value={a.instructions} onChange={(e) => set({ instructions: e.target.value })} />
        </label>

        <div className="provider-row">
          <label className="field grow">
            <span>Model provider (optional — else uses the chat's)</span>
            <select
              value={a.providerId}
              onChange={(e) => {
                const p = settings.providers.find((x) => x.id === e.target.value);
                set({ providerId: e.target.value, model: p?.models[0] ?? "" });
              }}
            >
              <option value="">Use current chat provider</option>
              {settings.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span>Model</span>
            {provider && provider.models.length ? (
              <select value={a.model} onChange={(e) => set({ model: e.target.value })}>
                <option value="">(default)</option>
                <ModelOptions models={provider.models} />
              </select>
            ) : (
              <input value={a.model} placeholder="model name" onChange={(e) => set({ model: e.target.value })} />
            )}
          </label>
        </div>

        <div className="provider-row">
          <label className="field">
            <span>Temperature: {a.temperature.toFixed(1)}</span>
            <input type="range" min={0} max={2} step={0.1} value={a.temperature} onChange={(e) => set({ temperature: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>Max tokens (0 = default)</span>
            <input type="number" min={0} value={a.maxTokens} onChange={(e) => set({ maxTokens: Number(e.target.value) || 0 })} />
          </label>
        </div>

        <section>
          <h2>Tools</h2>
          <div className="agent-check-grid">
            {realTools.map((t) => (
              <label key={t.id} className="agent-check">
                <input type="checkbox" checked={a.toolIds.includes(t.id)} onChange={() => set({ toolIds: toggle(a.toolIds, t.id) })} />
                {prettyName(t.name)}
              </label>
            ))}
          </div>
        </section>

        <section>
          <h2>Workflows it can run</h2>
          {workflows.length === 0 && <p className="hint">No workflows yet.</p>}
          <div className="agent-check-grid">
            {workflows.map((w) => (
              <label key={w.id} className="agent-check">
                <input type="checkbox" checked={a.workflowIds.includes(w.id)} onChange={() => set({ workflowIds: toggle(a.workflowIds, w.id) })} />
                {w.name}
              </label>
            ))}
          </div>
        </section>

        {knowledgeBases.length > 0 && (
          <section>
            <h2>Knowledge sources</h2>
            <p className="hint">
              Attached knowledge bases are searched for each task and the most relevant chunks are
              injected into the agent's context.
            </p>
            <div className="agent-check-grid">
              {knowledgeBases.map((k) => (
                <label key={k.id} className="agent-check">
                  <input
                    type="checkbox"
                    checked={(a.knowledgeBaseIds ?? []).includes(k.id)}
                    onChange={() => set({ knowledgeBaseIds: toggle(a.knowledgeBaseIds ?? [], k.id) })}
                  />
                  {k.name} ({k.chunks.length})
                </label>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2>Memory</h2>
          <label className="agent-check">
            <input type="checkbox" checked={a.autoMemory ?? false} onChange={(e) => set({ autoMemory: e.target.checked })} />
            Automatically remember durable facts after each run
          </label>
          <p className="hint">
            The agent recalls only the most relevant memories per task (not the whole pile), and new
            facts reconcile with old ones. Semantic recall needs an embedding model set in Settings;
            otherwise it uses keyword matching.
          </p>
        </section>

        <section>
          <h2>Sub-agents it can call</h2>
          {agents.filter((x) => x.id !== a.id).length === 0 && <p className="hint">No other agents yet.</p>}
          <div className="agent-check-grid">
            {agents
              .filter((x) => x.id !== a.id)
              .map((x) => (
                <label key={x.id} className="agent-check">
                  <input type="checkbox" checked={a.subAgentIds.includes(x.id)} onChange={() => set({ subAgentIds: toggle(a.subAgentIds, x.id) })} />
                  {x.name}
                </label>
              ))}
          </div>
        </section>
      </main>
    );
  }

  // ---------- run panel ----------
  if (runFor) {
    return (
      <main className="settings-main">
        <div className="settings-header">
          <h1>Run: {runFor.name}</h1>
          <button className="btn" onClick={() => setRunFor(null)}>
            Back
          </button>
        </div>
        <textarea rows={3} value={runInput} onChange={(e) => setRunInput(e.target.value)} placeholder="Task or question for this agent" />
        <div className="provider-row" style={{ marginTop: 8 }}>
          <button className="btn primary" disabled={running || !runInput.trim()} onClick={() => void doRun(runFor)}>
            {running ? "Running..." : "Run agent"}
          </button>
        </div>
        {runLog.length > 0 && (
          <pre className="code-view" style={{ marginTop: 12 }}>{runLog.join("\n")}</pre>
        )}
        {runOut !== null && (
          <div className="provider-card" style={{ marginTop: 12 }}>
            <b>Result</b>
            <div className="md" style={{ whiteSpace: "pre-wrap" }}>{runOut}</div>
          </div>
        )}
      </main>
    );
  }

  // ---------- list ----------
  return (
    <main className="settings-main">
      <div className="settings-header">
        <h1>Agents</h1>
        <div>
          <button className="btn" onClick={() => void addStarters()}>
            + Starter agents
          </button>{" "}
          <button className="btn primary" onClick={() => setEditing(emptyAgent())}>
            New agent
          </button>
        </div>
      </div>
      <p className="hint">
        An agent bundles custom instructions, a set of tools, workflows it can run, and other agents
        it can delegate to. Apply one to a chat, or run it standalone.
      </p>
      <div className="card-grid">
        {agents.map((a) => (
          <div key={a.id} className="cloud-card">
            <div className="cloud-card-head">
              <span className="cloud-logo">{a.name.slice(0, 1).toUpperCase()}</span>
              <div className="grow">
                <div className="cloud-name">{a.name}</div>
                <div className="cloud-by">
                  {a.toolIds.length} tools · {a.workflowIds.length} workflows · {a.subAgentIds.length} sub-agents
                </div>
              </div>
            </div>
            <div className="cloud-blurb">{a.description || a.instructions.slice(0, 90)}</div>
            <div className="cloud-foot">
              <button className="link-btn" onClick={() => applyAgentToChat(a.id)}>
                Use in chat
              </button>
              <button className="link-btn" onClick={() => { setRunFor(a); setRunInput(""); setRunLog([]); setRunOut(null); }}>
                Run
              </button>
              <button className="link-btn" onClick={() => setEditing(structuredClone(a))}>
                Edit
              </button>
              <PublishButton
                kind="agent"
                defaultName={a.name}
                defaultDescription={a.description}
                getEntity={() => a}
              />
              <button
                className="link-btn danger-link"
                onClick={async () => {
                  if (await confirmDialog(`Delete agent ${a.name}?`, { danger: true })) void deleteAgent(a.id);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      {agents.length === 0 && (
        <EmptyState
          icon={<IconAgent size={22} />}
          title="No agents yet"
          hint="An agent bundles instructions, tools, and knowledge into a reusable assistant."
          action={{ label: "New agent", onClick: () => setEditing(emptyAgent()) }}
          secondary={{ label: "Add starter agents", onClick: () => void addStarters() }}
        />
      )}
    </main>
  );
}
