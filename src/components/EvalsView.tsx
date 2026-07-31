import { useState } from "react";
import { confirmDialog } from "../lib/dialog";
import { runEval, modelKey, type CellResult } from "../lib/evals";
import { useStore } from "../lib/store";
import type { Eval, EvalCase, EvalModel, EvalScoring } from "../lib/types";
import { EmptyState } from "./EmptyState";
import { IconChart } from "./icons";

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function emptyEval(providerId: string, model: string): Eval {
  return {
    id: "",
    name: "New eval",
    system: "",
    cases: [{ id: uid(), prompt: "", expected: "" }],
    models: [{ providerId, model }],
    scoring: "judge",
  };
}

const SCORING: { v: EvalScoring; label: string }[] = [
  { v: "judge", label: "LLM judge (1-5)" },
  { v: "contains", label: "Output contains expected" },
  { v: "equals", label: "Output equals expected" },
  { v: "regex", label: "Output matches regex" },
  { v: "none", label: "No scoring (compare only)" },
];

export function EvalsView() {
  const { evals, saveEval, deleteEval, settings } = useStore();
  const [ev, setEv] = useState<Eval | null>(null);
  const [running, setRunning] = useState(false);
  const [cells, setCells] = useState<Record<string, CellResult>>({});
  const [openCell, setOpenCell] = useState<string | null>(null);

  const cellId = (caseId: string, mk: string) => `${caseId}|${mk}`;

  const run = async () => {
    if (!ev) return;
    setRunning(true);
    setCells({});
    try {
      await runEval(ev, {
        providers: settings.providers,
        signal: new AbortController().signal,
        onCell: (r) => setCells((c) => ({ ...c, [cellId(r.caseId, r.modelKey)]: r })),
      });
    } finally {
      setRunning(false);
    }
  };

  // ---------- editor ----------
  if (ev) {
    const patch = (p: Partial<Eval>) => setEv({ ...ev, ...p });
    const patchCase = (i: number, p: Partial<EvalCase>) =>
      patch({ cases: ev.cases.map((c, j) => (j === i ? { ...c, ...p } : c)) });
    const patchModel = (i: number, p: Partial<EvalModel>) =>
      patch({ models: ev.models.map((m, j) => (j === i ? { ...m, ...p } : m)) });

    const cols = ev.models;
    // leaderboard: average score + avg latency per model
    const summary = cols.map((m) => {
      const mk = modelKey(m.providerId, m.model);
      const rs = ev.cases.map((c) => cells[cellId(c.id, mk)]).filter(Boolean);
      const scored = rs.filter((r) => r.score !== null);
      const avg = scored.length ? scored.reduce((n, r) => n + (r.score ?? 0), 0) / scored.length : null;
      const ms = rs.length ? rs.reduce((n, r) => n + r.ms, 0) / rs.length : 0;
      return { mk, model: m.model, avg, ms };
    });

    return (
      <main className="settings-main">
        <div className="settings-header">
          <input className="provider-name wf-title" value={ev.name} onChange={(e) => patch({ name: e.target.value })} />
          <div>
            <button className="btn primary" disabled={running} onClick={() => void run()}>
              {running ? "Running..." : "Run eval"}
            </button>{" "}
            <button className="btn" onClick={() => { void saveEval({ ...ev, id: ev.id || `eval-${Date.now()}` }); }}>
              Save
            </button>{" "}
            <button className="btn" onClick={() => setEv(null)}>
              Close
            </button>
          </div>
        </div>

        <label className="field">
          <span>Shared system prompt (optional)</span>
          <textarea rows={2} value={ev.system} onChange={(e) => patch({ system: e.target.value })} />
        </label>

        <section>
          <h2>Models</h2>
          {ev.models.map((m, i) => {
            const provider = settings.providers.find((p) => p.id === m.providerId);
            return (
              <div key={i} className="provider-row">
                <select
                  value={m.providerId}
                  onChange={(e) => {
                    const p = settings.providers.find((x) => x.id === e.target.value);
                    patchModel(i, { providerId: e.target.value, model: p?.models[0] ?? "" });
                  }}
                >
                  {settings.providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {provider && provider.models.length ? (
                  <select className="grow" value={m.model} onChange={(e) => patchModel(i, { model: e.target.value })}>
                    {provider.models.map((mm) => <option key={mm} value={mm}>{mm}</option>)}
                  </select>
                ) : (
                  <input className="grow" value={m.model} placeholder="model" onChange={(e) => patchModel(i, { model: e.target.value })} />
                )}
                <button
                  className="icon-btn"
                  aria-label="Remove model"
                  onClick={() => patch({ models: ev.models.filter((_, j) => j !== i) })}
                >
                  x
                </button>
              </div>
            );
          })}
          <button className="btn small" onClick={() => { const p = settings.providers[0]; patch({ models: [...ev.models, { providerId: p?.id ?? "", model: p?.models[0] ?? "" }] }); }}>
            + Add model
          </button>
        </section>

        <section>
          <h2>Scoring</h2>
          <div className="provider-row">
            <select value={ev.scoring} onChange={(e) => patch({ scoring: e.target.value as EvalScoring })}>
              {SCORING.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
            {ev.scoring === "judge" && (
              <>
                <span className="hint">judge:</span>
                <select
                  value={ev.judgeProviderId ?? ""}
                  onChange={(e) => {
                    const p = settings.providers.find((x) => x.id === e.target.value);
                    patch({ judgeProviderId: e.target.value, judgeModel: p?.models[0] ?? "" });
                  }}
                >
                  <option value="">Pick...</option>
                  {settings.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input className="grow" value={ev.judgeModel ?? ""} placeholder="judge model" onChange={(e) => patch({ judgeModel: e.target.value })} />
              </>
            )}
          </div>
          <p className="hint">
            {ev.scoring === "judge"
              ? "The 'expected' field is the grading criteria/rubric for each case."
              : ev.scoring === "none"
                ? "Outputs are shown side by side without a score."
                : "The 'expected' field is compared against each model's output."}
          </p>
        </section>

        <section>
          <h2>Test cases</h2>
          {ev.cases.map((c, i) => (
            <div key={c.id} className="provider-card">
              <div className="provider-row">
                <b className="grow">Case {i + 1}</b>
                <button
                  className="icon-btn"
                  aria-label="Remove test case"
                  onClick={() => patch({ cases: ev.cases.filter((_, j) => j !== i) })}
                >
                  x
                </button>
              </div>
              <textarea rows={2} value={c.prompt} placeholder="Prompt" onChange={(e) => patchCase(i, { prompt: e.target.value })} />
              {ev.scoring !== "none" && (
                <textarea
                  rows={2}
                  value={c.expected}
                  placeholder={ev.scoring === "judge" ? "Grading criteria / rubric" : "Expected (text / regex)"}
                  onChange={(e) => patchCase(i, { expected: e.target.value })}
                />
              )}
              {/* results row for this case */}
              <div className="eval-cells">
                {cols.map((m) => {
                  const mk = modelKey(m.providerId, m.model);
                  const r = cells[cellId(c.id, mk)];
                  const id = cellId(c.id, mk);
                  return (
                    <div
                      key={mk}
                      className={`eval-cell ${r?.score != null ? (r.score >= 0.75 ? "good" : r.score >= 0.4 ? "mid" : "bad") : ""}`}
                      onClick={() => setOpenCell(openCell === id ? null : id)}
                    >
                      <div className="eval-cell-head">
                        <span className="eval-cell-model">{m.model || "—"}</span>
                        {r?.score != null && <span className="eval-score">{Math.round(r.score * 100)}%</span>}
                        {r && <span className="hint">{(r.ms / 1000).toFixed(1)}s</span>}
                      </div>
                      {r?.error && <div className="hint" style={{ color: "var(--danger)" }}>{r.error}</div>}
                      {openCell === id && r && <pre className="code-view">{r.output.slice(0, 3000)}</pre>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <button className="btn small" onClick={() => patch({ cases: [...ev.cases, { id: uid(), prompt: "", expected: "" }] })}>
            + Add case
          </button>
        </section>

        {summary.some((s) => s.avg !== null) && (
          <section>
            <h2>Leaderboard</h2>
            <table className="bench-table">
              <thead>
                <tr><th>Model</th><th>Avg score</th><th>Avg latency</th></tr>
              </thead>
              <tbody>
                {summary.slice().sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1)).map((s) => (
                  <tr key={s.mk}>
                    <td>{s.model}</td>
                    <td>
                      {s.avg !== null ? (
                        <div className="bench-bar-wrap">
                          <div className="bench-bar" style={{ width: `${s.avg * 100}%` }} />
                          <span>{Math.round(s.avg * 100)}%</span>
                        </div>
                      ) : "—"}
                    </td>
                    <td>{(s.ms / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    );
  }

  // ---------- list ----------
  return (
    <main className="settings-main">
      <div className="settings-header">
        <h1>Evals</h1>
        <button className="btn primary" onClick={() => setEv(emptyEval(settings.providers[0]?.id ?? "", settings.providers[0]?.models[0] ?? ""))}>
          New eval
        </button>
      </div>
      <p className="hint">
        Run a suite of test prompts across multiple models and score them — by keyword, regex, or an
        LLM judge — to see which model wins on your tasks.
      </p>
      {evals.map((e) => (
        <div key={e.id} className="provider-card">
          <div className="provider-row">
            <div className="grow" style={{ cursor: "pointer" }} onClick={() => { setEv(structuredClone(e)); setCells({}); }}>
              <b>{e.name}</b>
              <div className="hint">{e.cases.length} cases · {e.models.length} models · {e.scoring}</div>
            </div>
            <button className="btn small" onClick={() => { setEv(structuredClone(e)); setCells({}); }}>Open</button>
            <button
              className="icon-btn"
              aria-label={`Delete eval ${e.name}`}
              onClick={async () => {
                if (await confirmDialog(`Delete eval ${e.name}?`, { danger: true })) void deleteEval(e.id);
              }}
            >
              x
            </button>
          </div>
        </div>
      ))}
      {evals.length === 0 && (
        <EmptyState
          icon={<IconChart size={22} />}
          title="No evals yet"
          hint="Test prompts against models and compare quality, cost, and speed."
          action={{
            label: "New eval",
            onClick: () => setEv(emptyEval(settings.providers[0]?.id ?? "", settings.providers[0]?.models[0] ?? "")),
          }}
        />
      )}
    </main>
  );
}
