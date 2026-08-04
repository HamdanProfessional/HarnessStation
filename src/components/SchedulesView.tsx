import { useState } from "react";
import { confirmDialog } from "../lib/dialog";
import { computeNextRun, describeCadence, formatWhen } from "../lib/schedule";
import { useStore } from "../lib/store";
import type { Cadence, Schedule } from "../lib/types";
import { EmptyState } from "./EmptyState";
import { PublishButton } from "./PublishButton";
import { IconClock } from "./icons";

function emptySchedule(providerId: string, model: string): Schedule {
  return {
    id: "",
    name: "New schedule",
    enabled: true,
    targetType: "agent",
    targetId: "",
    input: "",
    providerId,
    model,
    cadence: { type: "daily", time: "09:00" },
    saveToChat: true,
    nextRun: computeNextRun({ type: "daily", time: "09:00" }, Date.now()) ?? Date.now(),
  };
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function SchedulesView() {
  const { schedules, agents, workflows, settings, saveSchedule, deleteSchedule, runScheduleNow } =
    useStore();
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const runNow = async (id: string) => {
    setBusy(id);
    try {
      await runScheduleNow(id);
    } finally {
      setBusy(null);
    }
  };

  if (editing) {
    const s = editing;
    const set = (p: Partial<Schedule>) => setEditing({ ...s, ...p });
    const setCadence = (c: Cadence) => setEditing({ ...s, cadence: c, nextRun: computeNextRun(c, Date.now()) ?? Date.now() });
    const targets = s.targetType === "agent" ? agents : workflows;

    return (
      <main className="settings-main">
        <div className="settings-header">
          <h1>{s.id ? "Edit schedule" : "New schedule"}</h1>
          <div>
            <button
              className="btn primary"
              disabled={!s.targetId}
              onClick={() => {
                void saveSchedule({ ...s, id: s.id || `sch-${Date.now()}` });
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
          <input value={s.name} onChange={(e) => set({ name: e.target.value })} />
        </label>

        <div className="provider-row">
          <label className="field grow">
            <span>Run a</span>
            <select
              value={s.targetType}
              onChange={(e) => set({ targetType: e.target.value as "agent" | "workflow", targetId: "" })}
            >
              <option value="agent">Agent</option>
              <option value="workflow">Workflow</option>
            </select>
          </label>
          <label className="field grow">
            <span>{s.targetType === "agent" ? "Agent" : "Workflow"}</span>
            <select value={s.targetId} onChange={(e) => set({ targetId: e.target.value })}>
              <option value="">Pick one...</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {s.targetType === "workflow" && (
          <div className="provider-row">
            <label className="field grow">
              <span>Provider</span>
              <select
                value={s.providerId}
                onChange={(e) => {
                  const p = settings.providers.find((x) => x.id === e.target.value);
                  set({ providerId: e.target.value, model: p?.models[0] ?? "" });
                }}
              >
                {settings.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field grow">
              <span>Model</span>
              <input value={s.model} onChange={(e) => set({ model: e.target.value })} placeholder="model" />
            </label>
          </div>
        )}

        <label className="field">
          <span>Input / task</span>
          <textarea rows={3} value={s.input} onChange={(e) => set({ input: e.target.value })} placeholder="What to send to the agent/workflow each run" />
        </label>

        <section>
          <h2>Schedule</h2>
          <div className="provider-row sched-cadence">
            <label className="field">
              <span>Frequency</span>
              <select
                value={s.cadence.type}
                onChange={(e) => {
                  const type = e.target.value as Cadence["type"];
                  if (type === "interval") setCadence({ type, minutes: 60 });
                  else if (type === "hourly") setCadence({ type, minute: 0 });
                  else if (type === "daily") setCadence({ type, time: "09:00" });
                  else if (type === "weekly") setCadence({ type, day: 1, time: "09:00" });
                  else setCadence({ type: "once", at: new Date(Date.now() + 3600_000).toISOString().slice(0, 16) });
                }}
              >
                <option value="interval">Every N minutes</option>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="once">Once</option>
              </select>
            </label>

            {s.cadence.type === "interval" && (
              <label className="field">
                <span>Minutes</span>
                <input type="number" min={1} value={s.cadence.minutes} onChange={(e) => setCadence({ type: "interval", minutes: Number(e.target.value) || 60 })} />
              </label>
            )}
            {s.cadence.type === "hourly" && (
              <label className="field">
                <span>At minute</span>
                <input type="number" min={0} max={59} value={s.cadence.minute} onChange={(e) => setCadence({ type: "hourly", minute: Number(e.target.value) || 0 })} />
              </label>
            )}
            {s.cadence.type === "daily" && (
              <label className="field">
                <span>At time</span>
                <input type="time" value={s.cadence.time} onChange={(e) => setCadence({ type: "daily", time: e.target.value })} />
              </label>
            )}
            {s.cadence.type === "weekly" && (
              <>
                <label className="field">
                  <span>Day</span>
                  <select value={s.cadence.day} onChange={(e) => setCadence({ type: "weekly", day: Number(e.target.value), time: (s.cadence as { time: string }).time })}>
                    {DAYS.map((d, i) => (
                      <option key={i} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>At time</span>
                  <input type="time" value={s.cadence.time} onChange={(e) => setCadence({ type: "weekly", day: (s.cadence as { day: number }).day, time: e.target.value })} />
                </label>
              </>
            )}
            {s.cadence.type === "once" && (
              <label className="field">
                <span>At</span>
                <input type="datetime-local" value={s.cadence.at.slice(0, 16)} onChange={(e) => setCadence({ type: "once", at: new Date(e.target.value).toISOString() })} />
              </label>
            )}
          </div>
          <p className="hint">Next run: {formatWhen(s.nextRun)}</p>
        </section>

        <label className="agent-check">
          <input type="checkbox" checked={s.saveToChat} onChange={(e) => set({ saveToChat: e.target.checked })} />
          Save each run's output as a new chat
        </label>
      </main>
    );
  }

  return (
    <main className="settings-main">
      <div className="settings-header">
        <h1>Schedules</h1>
        <button
          className="btn primary"
          onClick={() => setEditing(emptySchedule(settings.providers[0]?.id ?? "", settings.providers[0]?.models[0] ?? ""))}
        >
          New schedule
        </button>
      </div>
      <p className="hint">
        Run an agent or workflow automatically on a repeating schedule. Schedules run while
        HarnessStation is open — the app checks every minute and runs anything due.
      </p>

      {schedules.map((s) => {
        const target = (s.targetType === "agent" ? agents : workflows).find((t) => t.id === s.targetId);
        return (
          <div key={s.id} className="provider-card">
            <div className="provider-row">
              <div className="grow">
                <b>{s.name}</b>{" "}
                <span className={`tool-tag ${s.enabled ? "tag-JS" : ""}`}>{s.enabled ? "on" : "off"}</span>
                <div className="hint">
                  {describeCadence(s.cadence)} · {s.targetType} “{target?.name ?? "missing"}”
                </div>
                <div className="hint">
                  Next: {s.enabled ? formatWhen(s.nextRun) : "paused"}
                  {s.lastRun ? ` · Last: ${formatWhen(s.lastRun)}` : ""}
                  {s.lastError ? ` · error: ${s.lastError}` : ""}
                </div>
              </div>
              <label className="switch-wrap" title="Enable/disable">
                <span className={`switch ${s.enabled ? "on" : ""}`} onClick={() => void saveSchedule({ ...s, enabled: !s.enabled, nextRun: computeNextRun(s.cadence, Date.now()) ?? s.nextRun })}>
                  <span className="knob" />
                </span>
              </label>
              <button className="btn small" disabled={busy === s.id} onClick={() => void runNow(s.id)}>
                {busy === s.id ? "Running..." : "Run now"}
              </button>
              <button className="btn small" onClick={() => setEditing(structuredClone(s))}>
                Edit
              </button>
              <PublishButton
                kind="schedule"
                defaultName={s.name}
                defaultDescription={`Runs a ${s.targetType} — ${describeCadence(s.cadence)}`}
                getEntity={() => s}
                className="btn small"
              />
              <button
                className="icon-btn"
                onClick={async () => {
                  if (await confirmDialog(`Delete schedule ${s.name}?`, { danger: true })) void deleteSchedule(s.id);
                }}
              >
                x
              </button>
            </div>
            {s.lastResult && (
              <details className="tool-msg">
                <summary>Last output</summary>
                <pre className="code-view">{s.lastResult.slice(0, 3000)}</pre>
              </details>
            )}
          </div>
        );
      })}
      {schedules.length === 0 && (
        <EmptyState
          icon={<IconClock size={22} />}
          title="No schedules yet"
          hint="Run an agent or workflow automatically on a recurring schedule."
          action={{
            label: "New schedule",
            onClick: () =>
              setEditing(emptySchedule(settings.providers[0]?.id ?? "", settings.providers[0]?.models[0] ?? "")),
          }}
        />
      )}
    </main>
  );
}
