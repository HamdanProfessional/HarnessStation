import { useState } from "react";
import { Markdown } from "./Markdown";
import { streamChat } from "../lib/providers";
import { useStore } from "../lib/store";

interface Slot {
  providerId: string;
  model: string;
}

interface RunResult {
  text: string;
  ms: number;
  running: boolean;
  error?: string;
}

function estTokens(s: string): number {
  return Math.round(s.length / 4);
}

export function CompareView() {
  const { settings } = useStore();
  const [prompt, setPrompt] = useState("");
  const [system, setSystem] = useState("");
  const [slots, setSlots] = useState<Slot[]>(() => {
    const p = settings.providers[0];
    const base: Slot = { providerId: p?.id ?? "", model: p?.models[0] ?? "" };
    return [base, { ...base }];
  });
  const [results, setResults] = useState<Record<number, RunResult>>({});
  const [running, setRunning] = useState(false);

  const setSlot = (i: number, patch: Partial<Slot>) =>
    setSlots((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const addSlot = () => {
    if (slots.length >= 4) return;
    const p = settings.providers[0];
    setSlots((s) => [...s, { providerId: p?.id ?? "", model: p?.models[0] ?? "" }]);
  };

  const removeSlot = (i: number) => setSlots((s) => s.filter((_, j) => j !== i));

  const run = async () => {
    if (!prompt.trim() || running) return;
    setRunning(true);
    const init: Record<number, RunResult> = {};
    slots.forEach((_, i) => (init[i] = { text: "", ms: 0, running: true }));
    setResults(init);
    const start = Date.now();

    await Promise.all(
      slots.map(async (slot, i) => {
        const provider = settings.providers.find((p) => p.id === slot.providerId);
        if (!provider || !slot.model) {
          setResults((r) => ({ ...r, [i]: { text: "", ms: 0, running: false, error: "No provider/model" } }));
          return;
        }
        try {
          await streamChat({
            provider,
            model: slot.model,
            system,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            maxTokens: 0,
            signal: new AbortController().signal,
            onDelta: (d) =>
              setResults((r) => ({
                ...r,
                [i]: { ...r[i], text: (r[i]?.text ?? "") + d, ms: Date.now() - start },
              })),
          });
          setResults((r) => ({ ...r, [i]: { ...r[i], running: false, ms: Date.now() - start } }));
        } catch (e) {
          setResults((r) => ({
            ...r,
            [i]: { ...r[i], running: false, error: (e as Error).message || String(e) },
          }));
        }
      }),
    );
    setRunning(false);
  };

  return (
    <main className="chat-main">
      <div className="compare-input">
        <input
          className="compare-system"
          value={system}
          placeholder="System prompt (optional, shared by all models)"
          onChange={(e) => setSystem(e.target.value)}
        />
        <div className="compare-prompt-row">
          <textarea
            className="chat-input"
            rows={2}
            value={prompt}
            placeholder="One prompt, sent to every model below..."
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
            }}
          />
          <button className="btn primary" disabled={running || !prompt.trim()} onClick={() => void run()}>
            {running ? "Running..." : "Compare"}
          </button>
        </div>
      </div>

      <div className="compare-grid">
        {slots.map((slot, i) => {
          const provider = settings.providers.find((p) => p.id === slot.providerId);
          const res = results[i];
          return (
            <div key={i} className="compare-col">
              <div className="compare-col-head">
                <select
                  value={slot.providerId}
                  onChange={(e) => {
                    const p = settings.providers.find((x) => x.id === e.target.value);
                    setSlot(i, { providerId: e.target.value, model: p?.models[0] ?? "" });
                  }}
                >
                  {settings.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {provider && provider.models.length ? (
                  <select value={slot.model} onChange={(e) => setSlot(i, { model: e.target.value })}>
                    {provider.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={slot.model} placeholder="model" onChange={(e) => setSlot(i, { model: e.target.value })} />
                )}
                {slots.length > 1 && (
                  <button className="icon-btn" title="Remove column" onClick={() => removeSlot(i)}>
                    x
                  </button>
                )}
              </div>
              <div className="compare-col-body">
                {res ? (
                  res.error ? (
                    <div className="error-banner">{res.error}</div>
                  ) : (
                    <Markdown>{res.text || (res.running ? "..." : "")}</Markdown>
                  )
                ) : (
                  <div className="hint">Ready.</div>
                )}
              </div>
              {res && !res.error && (
                <div className="compare-col-foot">
                  <span>{(res.ms / 1000).toFixed(1)}s</span>
                  <span>~{estTokens(res.text)} tok</span>
                  {res.running && <span className="wf-status-running">streaming</span>}
                </div>
              )}
            </div>
          );
        })}
        {slots.length < 4 && (
          <button className="compare-add" onClick={addSlot}>
            + Add model
          </button>
        )}
      </div>
    </main>
  );
}
