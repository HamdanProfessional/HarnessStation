import { useRef, useState } from "react";
import { confirmDialog } from "../lib/dialog";
import { useStore } from "../lib/store";
import { runWorkflow } from "../lib/workflow";
import { mediaConfigFromSettings } from "../lib/media";
import type { CondOp, Condition, ParallelLane, Workflow, WorkflowStep } from "../lib/types";
import { WORKFLOW_PRESETS } from "../lib/workflowPresets";
import { toast } from "../lib/toast";
import { EmptyState } from "./EmptyState";
import { IconFlow } from "./icons";

const OPS: { value: CondOp; label: string; noRight?: boolean }[] = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "eq", label: "equals" },
  { value: "neq", label: "does not equal" },
  { value: "gt", label: "> greater than" },
  { value: "lt", label: "< less than" },
  { value: "gte", label: ">= at least" },
  { value: "lte", label: "<= at most" },
  { value: "starts", label: "starts with" },
  { value: "ends", label: "ends with" },
  { value: "regex", label: "matches regex" },
  { value: "empty", label: "is empty", noRight: true },
  { value: "not_empty", label: "is not empty", noRight: true },
];

type NodeStatus = "idle" | "running" | "done" | "error";

interface RunState {
  status: Record<string, NodeStatus>;
  output: Record<string, string>;
  timing: Record<string, number>;
  error?: string;
}

const TYPE_LABEL: Record<WorkflowStep["type"], string> = {
  prompt: "AI Prompt",
  function: "Function",
  switch: "Switch",
  agent: "Agent",
  parallel: "Parallel",
};

function newStep(type: WorkflowStep["type"], existing: WorkflowStep[]): WorkflowStep {
  let n = existing.length + 1;
  while (existing.some((s) => s.name === `step${n}`)) n++;
  const name = `step${n}`;
  if (type === "prompt")
    return { type, name, instructions: "", prompt: "{{prev}}", useTools: false };
  if (type === "function") return { type, name, toolId: "", args: "{}" };
  if (type === "agent") return { type, name, agentId: "", input: "{{prev}}" };
  if (type === "parallel")
    return {
      type,
      name,
      lanes: [{ label: "A", kind: "prompt", prompt: "{{prev}}", instructions: "", useTools: false }],
    };
  return {
    type,
    name,
    cases: [{ left: "{{prev}}", op: "contains", right: "", goto: "end" }],
    defaultGoto: "end",
  };
}

function newCondition(): Condition {
  return { left: "{{prev}}", op: "contains", right: "", goto: "end" };
}

function describeCond(c: Condition): string {
  const op = OPS.find((o) => o.value === (c.op ?? "contains"))?.label ?? "contains";
  const left = c.left || "{{prev}}";
  return OPS.find((o) => o.value === c.op)?.noRight ? `${left} ${op}` : `${left} ${op} "${c.right}"`;
}

function gotoOptions(steps: WorkflowStep[]): { value: string; label: string }[] {
  return [
    ...steps.map((s) => ({ value: s.name, label: `Step: ${s.name}` })),
    { value: "end", label: "End (finish workflow)" },
  ];
}

function stepSummary(s: WorkflowStep, tools: { id: string; name: string }[]): string {
  if (s.type === "prompt") return s.prompt.slice(0, 60) || "(empty prompt)";
  if (s.type === "function")
    return tools.find((t) => t.id === s.toolId)?.name ?? "(no tool selected)";
  if (s.type === "agent") return s.agentId ? `runs agent → ${s.input || "{{prev}}"}` : "(no agent selected)";
  if (s.type === "parallel")
    return `${s.lanes.length} lane(s): ${s.lanes.map((l) => l.label || l.kind).join(", ")}`;
  const parts = s.cases.map((c) => `if ${describeCond(c)} → ${c.goto}`);
  parts.push(`else → ${s.defaultGoto}`);
  return parts.join(", ");
}

export function WorkflowsView() {
  const { workflows, saveWorkflow, deleteWorkflow, settings, allTools, runAgentTask, agents } = useStore();
  const [wf, setWf] = useState<Workflow | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<RunState>({ status: {}, output: {}, timing: {} });
  const [dirty, setDirty] = useState(false);
  const [runProviderId, setRunProviderId] = useState(settings.providers[0]?.id ?? "");
  const [runModel, setRunModel] = useState(settings.providers[0]?.models[0] ?? "");
  const controllerRef = useRef<AbortController | null>(null);

  const tools = allTools();

  const patch = (w: Workflow) => {
    setWf(w);
    setDirty(true);
  };

  const patchStep = (i: number, p: Partial<WorkflowStep>) => {
    if (!wf) return;
    patch({ ...wf, steps: wf.steps.map((s, j) => (j === i ? ({ ...s, ...p } as WorkflowStep) : s)) });
  };

  const insertStep = (at: number, type: WorkflowStep["type"]) => {
    if (!wf) return;
    const steps = [...wf.steps];
    steps.splice(at, 0, newStep(type, wf.steps));
    patch({ ...wf, steps });
    setSelected(at);
    setInsertAt(null);
  };

  const removeStep = (i: number) => {
    if (!wf) return;
    patch({ ...wf, steps: wf.steps.filter((_, j) => j !== i) });
    setSelected(null);
  };

  const moveStep = (i: number, dir: -1 | 1) => {
    if (!wf) return;
    const j = i + dir;
    if (j < 0 || j >= wf.steps.length) return;
    const steps = [...wf.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    patch({ ...wf, steps });
    setSelected(j);
  };

  const doRun = async () => {
    if (!wf) return;
    const provider = settings.providers.find((p) => p.id === runProviderId);
    if (!provider || !runModel) {
      setRun({ status: {}, output: {}, timing: {}, error: "Pick a provider and model first." });
      return;
    }
    setRunning(true);
    const status: Record<string, NodeStatus> = {};
    const output: Record<string, string> = {};
    const timing: Record<string, number> = {};
    setRun({ status, output, timing });
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await runWorkflow(wf, {
        provider,
        model: runModel,
        tools,
        input,
        signal: controller.signal,
        runAgent: (agentId, agentInput) => runAgentTask(agentId, agentInput, () => {}),
        media: mediaConfigFromSettings(settings),
        onStepStart: (name) => {
          status[name] = "running";
          setRun({ status: { ...status }, output: { ...output }, timing: { ...timing } });
        },
        onLog: (log) => {
          if (status[log.step]) status[log.step] = "done";
          output[log.step] = (output[log.step] ? output[log.step] + "\n" : "") + log.output;
          if (log.ms != null) timing[log.step] = log.ms;
          setRun({ status: { ...status }, output: { ...output }, timing: { ...timing } });
        },
      });
      for (const k of Object.keys(status)) if (status[k] === "running") status[k] = "done";
      setRun({ status: { ...status }, output: { ...output }, timing: { ...timing } });
    } catch (e) {
      for (const k of Object.keys(status)) if (status[k] === "running") status[k] = "error";
      setRun({
        status: { ...status },
        output: { ...output },
        timing: { ...timing },
        error: (e as Error).message || String(e),
      });
    } finally {
      setRunning(false);
    }
  };

  // ---------- list view ----------
  const newWorkflow = () => {
    setWf({ id: `wf-${Date.now()}`, name: "New workflow", description: "", steps: [] });
    setDirty(true);
    setSelected(null);
    setRun({ status: {}, output: {}, timing: {} });
  };

  const addStarterWorkflows = () => {
    const existing = new Set(workflows.map((w) => w.name.toLowerCase()));
    const missing = WORKFLOW_PRESETS.filter((p) => !existing.has(p.name.toLowerCase()));
    if (missing.length === 0) {
      toast.info("All starter workflows are already added.");
      return;
    }
    missing.forEach((preset, idx) => {
      void saveWorkflow({ ...preset, id: `wf-${Date.now()}-${idx}` });
    });
    toast.success(`Added ${missing.length} starter workflow(s).`);
  };

  if (!wf) {
    return (
      <main className="settings-main">
        <div className="settings-header">
          <h1>Workflows</h1>
          <div>
            <button className="btn" onClick={addStarterWorkflows}>
              + Starter workflows
            </button>{" "}
            <button className="btn primary" onClick={newWorkflow}>
              New workflow
            </button>
          </div>
        </div>
        {workflows.length === 0 && (
          <EmptyState
            icon={<IconFlow size={22} />}
            title="No workflows yet"
            hint="Chain AI prompts, functions, and conditions visually — like n8n or Zapier."
            action={{ label: "New workflow", onClick: newWorkflow }}
          />
        )}
        {workflows.map((w) => (
          <div key={w.id} className="provider-card">
            <div className="provider-row">
              <div className="grow" style={{ cursor: "pointer" }} onClick={() => { setWf(structuredClone(w)); setDirty(false); setSelected(null); setRun({ status: {}, output: {}, timing: {} }); }}>
                <b>{w.name}</b>
                <div className="hint">{w.description || `${w.steps.length} step(s)`}</div>
              </div>
              <button className="btn small" onClick={() => { setWf(structuredClone(w)); setDirty(false); setSelected(null); setRun({ status: {}, output: {}, timing: {} }); }}>
                Open
              </button>
              <button
                className="btn small"
                onClick={() =>
                  void saveWorkflow({ ...structuredClone(w), id: `wf-${Date.now()}`, name: `${w.name} (copy)` })
                }
              >
                Duplicate
              </button>
              <button
                className="icon-btn"
                onClick={async () => {
                  if (await confirmDialog(`Delete workflow ${w.name}?`, { danger: true }))
                    void deleteWorkflow(w.id);
                }}
              >
                x
              </button>
            </div>
          </div>
        ))}
      </main>
    );
  }

  // ---------- canvas view ----------
  const connector = (at: number) => (
    <div className="wf-connector">
      <div className="wf-line" />
      <button className="wf-plus" title="Insert step here" onClick={() => setInsertAt(insertAt === at ? null : at)}>
        +
      </button>
      {insertAt === at && (
        <div className="wf-insert-menu">
          {(["prompt", "function", "switch", "agent", "parallel"] as const).map((t) => (
            <button key={t} onClick={() => insertStep(at, t)}>
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      )}
      <div className="wf-line" />
    </div>
  );

  return (
    <main className="settings-main wf-main">
      <div className="settings-header">
        <input
          className="provider-name wf-title"
          value={wf.name}
          onChange={(e) => patch({ ...wf, name: e.target.value })}
        />
        <div>
          <button className="btn primary" disabled={running} onClick={() => void doRun()}>
            {running ? "Running..." : "Run"}
          </button>{" "}
          {running && (
            <>
              <button className="btn" onClick={() => controllerRef.current?.abort()}>
                Stop
              </button>{" "}
            </>
          )}
          <button
            className="btn"
            disabled={!dirty}
            onClick={() => {
              void saveWorkflow(wf);
              setDirty(false);
            }}
          >
            {dirty ? "Save" : "Saved"}
          </button>{" "}
          <button
            className="btn"
            onClick={async () => {
              if (!dirty || (await confirmDialog("Discard unsaved changes?", { danger: true })))
                setWf(null);
            }}
          >
            Close
          </button>
        </div>
      </div>
      {run.error && <div className="error-banner">{run.error}</div>}

      <div className="wf-canvas">
        {/* trigger node */}
        <div className="wf-node wf-trigger">
          <div className="wf-node-head">
            <span className="wf-badge">Input</span>
            <span className="wf-node-title">Workflow input</span>
          </div>
          <textarea
            rows={2}
            value={input}
            placeholder="Text passed to the workflow as {{input}}"
            onChange={(e) => setInput(e.target.value)}
          />
          <div className="provider-row">
            <select
              value={runProviderId}
              onChange={(e) => {
                setRunProviderId(e.target.value);
                const p = settings.providers.find((x) => x.id === e.target.value);
                setRunModel(p?.models[0] ?? "");
              }}
            >
              {settings.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              className="grow"
              value={runModel}
              onChange={(e) => setRunModel(e.target.value)}
              placeholder="model"
            />
          </div>
        </div>

        {wf.steps.map((s, i) => {
          const st: NodeStatus = run.status[s.name] ?? "idle";
          const sel = selected === i;
          return (
            <div key={i} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
              {connector(i)}
              <div
                className={`wf-node wf-${st} ${sel ? "wf-selected" : ""}`}
                onClick={() => setSelected(sel ? null : i)}
              >
                <div className="wf-node-head">
                  <span className={`wf-badge wf-badge-${s.type}`}>{TYPE_LABEL[s.type]}</span>
                  <span className="wf-node-title">
                    {i + 1}. {s.name}
                  </span>
                  {run.timing[s.name] != null && (
                    <span className="wf-time">{(run.timing[s.name] / 1000).toFixed(1)}s</span>
                  )}
                  <span className={`wf-status wf-status-${st}`}>
                    {st === "running" ? "running" : st === "done" ? "done" : st === "error" ? "error" : ""}
                  </span>
                  <span className="wf-node-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="icon-btn" title="Move up" onClick={() => moveStep(i, -1)}>
                      ^
                    </button>
                    <button className="icon-btn" title="Move down" onClick={() => moveStep(i, 1)}>
                      v
                    </button>
                    <button className="icon-btn" title="Delete step" onClick={() => removeStep(i)}>
                      x
                    </button>
                  </span>
                </div>
                {!sel && <div className="wf-summary">{stepSummary(s, tools)}</div>}

                {sel && (
                  <div className="wf-edit" onClick={(e) => e.stopPropagation()}>
                    <label className="field">
                      <span>Step name (used by switch goto and {"{{steps.NAME}}"})</span>
                      <input value={s.name} onChange={(e) => patchStep(i, { name: e.target.value })} />
                    </label>
                    {s.type === "prompt" && (
                      <>
                        <label className="field">
                          <span>Custom instructions (system prompt)</span>
                          <textarea
                            rows={2}
                            value={s.instructions}
                            onChange={(e) => patchStep(i, { instructions: e.target.value })}
                          />
                        </label>
                        <label className="field">
                          <span>Prompt — {"{{input}}"}, {"{{prev}}"}, {"{{steps.NAME}}"}</span>
                          <textarea
                            rows={3}
                            value={s.prompt}
                            onChange={(e) => patchStep(i, { prompt: e.target.value })}
                          />
                        </label>
                        <label className="hint">
                          <input
                            type="checkbox"
                            checked={s.useTools}
                            onChange={(e) => patchStep(i, { useTools: e.target.checked })}
                          />{" "}
                          Allow tool calling
                        </label>
                      </>
                    )}
                    {s.type === "function" && (
                      <>
                        <label className="field">
                          <span>Tool</span>
                          <select value={s.toolId} onChange={(e) => patchStep(i, { toolId: e.target.value })}>
                            <option value="">Pick a tool...</option>
                            {tools
                              .filter((t) => !t.id.startsWith("agent:") && !t.id.startsWith("workflow:"))
                              .map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Args (JSON, templated)</span>
                          <input value={s.args} onChange={(e) => patchStep(i, { args: e.target.value })} />
                        </label>
                      </>
                    )}
                    {s.type === "switch" && (
                      <>
                        <p className="hint wf-help">
                          Each rule is an <b>IF condition</b>: it compares a value (default the previous step's
                          output, <code>{"{{prev}}"}</code>) against another using an operator. The first rule that's
                          true wins and the workflow jumps to that step; if none match, it takes the default. Use
                          <code> {"{{input}}"}</code>, <code>{"{{prev}}"}</code>, <code>{"{{steps.NAME}}"}</code> as values.
                        </p>
                        {s.cases.map((c, k) => {
                          const noRight = OPS.find((o) => o.value === c.op)?.noRight;
                          const upd = (patch: Partial<Condition>) =>
                            patchStep(i, {
                              cases: s.cases.map((x, m) => (m === k ? { ...x, ...patch } : x)),
                            });
                          return (
                            <div key={k} className="wf-case">
                              <span className="wf-if">IF</span>
                              <input
                                className="wf-cond-val"
                                placeholder="{{prev}}"
                                value={c.left}
                                onChange={(e) => upd({ left: e.target.value })}
                              />
                              <select value={c.op} onChange={(e) => upd({ op: e.target.value as CondOp })}>
                                {OPS.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                              {!noRight && (
                                <input
                                  className="wf-cond-val"
                                  placeholder="value"
                                  value={c.right}
                                  onChange={(e) => upd({ right: e.target.value })}
                                />
                              )}
                              <span className="hint">jump to</span>
                              <select value={c.goto} onChange={(e) => upd({ goto: e.target.value })}>
                                {gotoOptions(wf.steps).map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="icon-btn"
                                title="Remove rule"
                                onClick={() => patchStep(i, { cases: s.cases.filter((_, m) => m !== k) })}
                              >
                                x
                              </button>
                            </div>
                          );
                        })}
                        <div className="wf-case">
                          <button
                            className="btn small"
                            onClick={() => patchStep(i, { cases: [...s.cases, newCondition()] })}
                          >
                            + Add rule
                          </button>
                          <span className="grow" />
                          <span className="hint">otherwise jump to</span>
                          <select value={s.defaultGoto} onChange={(e) => patchStep(i, { defaultGoto: e.target.value })}>
                            {gotoOptions(wf.steps).map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                    {s.type === "agent" && (
                      <>
                        <label className="field">
                          <span>Agent</span>
                          <select value={s.agentId} onChange={(e) => patchStep(i, { agentId: e.target.value })}>
                            <option value="">Pick an agent...</option>
                            {agents.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Input — {"{{input}}"}, {"{{prev}}"}, {"{{steps.NAME}}"}</span>
                          <textarea
                            rows={2}
                            placeholder="{{prev}}"
                            value={s.input}
                            onChange={(e) => patchStep(i, { input: e.target.value })}
                          />
                        </label>
                      </>
                    )}
                    {s.type === "parallel" && (
                      <>
                        <p className="hint wf-help">
                          Lanes run concurrently; their outputs are merged into this step's result under a{" "}
                          <code>## &lt;label&gt;</code> heading each.
                        </p>
                        {s.lanes.map((lane, k) => {
                          const updLane = (p: Partial<ParallelLane>) =>
                            patchStep(i, {
                              lanes: s.lanes.map((x, m) => (m === k ? { ...x, ...p } : x)),
                            });
                          return (
                            <div key={k} className="wf-lane">
                              <div className="wf-lane-head">
                                <span className="wf-lane-tag">Lane</span>
                                <input
                                  className="wf-lane-label"
                                  placeholder="Label"
                                  value={lane.label}
                                  onChange={(e) => updLane({ label: e.target.value })}
                                />
                                <select
                                  value={lane.kind}
                                  onChange={(e) => updLane({ kind: e.target.value as ParallelLane["kind"] })}
                                >
                                  <option value="prompt">Prompt</option>
                                  <option value="agent">Agent</option>
                                </select>
                                <span className="grow" />
                                <button
                                  className="icon-btn"
                                  title="Remove lane"
                                  onClick={() => patchStep(i, { lanes: s.lanes.filter((_, m) => m !== k) })}
                                >
                                  ×
                                </button>
                              </div>
                              {lane.kind === "prompt" ? (
                                <>
                                  <textarea
                                    rows={2}
                                    placeholder="Instructions (system prompt)"
                                    value={lane.instructions ?? ""}
                                    onChange={(e) => updLane({ instructions: e.target.value })}
                                  />
                                  <textarea
                                    rows={2}
                                    placeholder="Prompt — {{input}}, {{prev}}, {{steps.NAME}}"
                                    value={lane.prompt ?? ""}
                                    onChange={(e) => updLane({ prompt: e.target.value })}
                                  />
                                  <label className="hint">
                                    <input
                                      type="checkbox"
                                      checked={!!lane.useTools}
                                      onChange={(e) => updLane({ useTools: e.target.checked })}
                                    />{" "}
                                    Allow tool calling
                                  </label>
                                </>
                              ) : (
                                <>
                                  <select
                                    value={lane.agentId ?? ""}
                                    onChange={(e) => updLane({ agentId: e.target.value })}
                                  >
                                    <option value="">Pick an agent...</option>
                                    {agents.map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.name}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    placeholder="Input to the agent — {{prev}}"
                                    value={lane.agentInput ?? ""}
                                    onChange={(e) => updLane({ agentInput: e.target.value })}
                                  />
                                </>
                              )}
                            </div>
                          );
                        })}
                        <button
                          className="btn small"
                          onClick={() =>
                            patchStep(i, {
                              lanes: s.lanes.concat([
                                {
                                  label: String.fromCharCode(65 + s.lanes.length),
                                  kind: "prompt",
                                  prompt: "{{prev}}",
                                  instructions: "",
                                  useTools: false,
                                },
                              ]),
                            })
                          }
                        >
                          + Add lane
                        </button>
                      </>
                    )}
                  </div>
                )}

                {run.output[s.name] && (
                  <pre className="code-view wf-output">{run.output[s.name].slice(0, 1500)}</pre>
                )}
              </div>
            </div>
          );
        })}

        {connector(wf.steps.length)}
        <div className="wf-node wf-end">
          <div className="wf-node-head">
            <span className="wf-badge">End</span>
            <span className="wf-node-title">Output = last step's result</span>
          </div>
        </div>
      </div>
    </main>
  );
}
