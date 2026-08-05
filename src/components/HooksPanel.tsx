import { useStore } from "../lib/store";
import type { Settings } from "../lib/types";
import type { HookEvent, Webhook } from "../lib/hooks";
import { IconX } from "./icons";

/** Sensitive built-in tools worth gating, with friendly labels. */
const GUARDED: { id: string; label: string }[] = [
  { id: "run_terminal", label: "Run terminal commands" },
  { id: "write_file", label: "Write files" },
  { id: "edit_file", label: "Edit files" },
  { id: "delete_file", label: "Delete files" },
  { id: "http_request", label: "Make HTTP requests" },
];

const EVENTS: { id: HookEvent; label: string }[] = [
  { id: "turn-complete", label: "A turn finishes" },
  { id: "tool-call", label: "A tool is called" },
  { id: "error", label: "An error occurs" },
  { id: "schedule-complete", label: "A scheduled run finishes" },
];

type Policy = "allow" | "ask" | "deny";

/**
 * Settings › Hooks & guardrails.
 *  - Guardrails: allow / ask / deny each sensitive tool.
 *  - Webhooks: POST to a URL on lifecycle events (logging, alerts, Slack).
 */
export function HooksPanel() {
  const { settings, saveSettings } = useStore();
  const save = (patch: Partial<Settings>) => void saveSettings({ ...settings, ...patch });

  const policyOf = (id: string): Policy =>
    (settings.blockTools ?? []).includes(id) ? "deny" : (settings.confirmTools ?? []).includes(id) ? "ask" : "allow";

  const setPolicy = (id: string, p: Policy) => {
    const confirmTools = new Set(settings.confirmTools ?? []);
    const blockTools = new Set(settings.blockTools ?? []);
    confirmTools.delete(id);
    blockTools.delete(id);
    if (p === "ask") confirmTools.add(id);
    if (p === "deny") blockTools.add(id);
    save({ confirmTools: [...confirmTools], blockTools: [...blockTools] });
  };

  const webhooks = settings.webhooks ?? [];
  const setWebhook = (id: string, patch: Partial<Webhook>) =>
    save({ webhooks: webhooks.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const addWebhook = () =>
    save({ webhooks: [...webhooks, { id: `hook-${Date.now()}`, event: "turn-complete", url: "", kind: "json" }] });
  const removeWebhook = (id: string) => save({ webhooks: webhooks.filter((w) => w.id !== id) });

  return (
    <>
      <h2>Guardrails</h2>
      <p className="hint">
        Decide what the agent may do on its own. <b>Ask</b> pops a confirmation before the tool runs;
        <b> Deny</b> blocks it entirely. Applies to every chat, agent and schedule.
      </p>
      <div className="provider-card">
        {GUARDED.map((t) => {
          const cur = policyOf(t.id);
          return (
            <div key={t.id} className="provider-row" style={{ alignItems: "center" }}>
              <span className="grow">{t.label} <code className="hint">{t.id}</code></span>
              <div className="seg">
                {(["allow", "ask", "deny"] as Policy[]).map((p) => (
                  <button
                    key={p}
                    className={`seg-btn ${cur === p ? "active" : ""}`}
                    onClick={() => setPolicy(t.id, p)}
                  >
                    {p === "allow" ? "Allow" : p === "ask" ? "Ask" : "Deny"}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <h2 style={{ marginTop: 28 }}>
        Webhooks{" "}
        <button className="btn small" onClick={addWebhook}>
          + Add
        </button>
      </h2>
      <p className="hint">
        Fire a <code>POST</code> to a URL when something happens — for logging, alerts, or piping to
        Slack. Best-effort: a slow or dead webhook never holds up the app, and no prompts or keys are
        included in the payload.
      </p>
      {webhooks.length === 0 && <p className="hint">No webhooks yet.</p>}
      {webhooks.map((w) => (
        <div key={w.id} className="provider-card">
          <div className="provider-row">
            <label className="field">
              <span>On</span>
              <select value={w.event} onChange={(e) => setWebhook(w.id, { event: e.target.value as HookEvent })}>
                {EVENTS.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Format</span>
              <select value={w.kind} onChange={(e) => setWebhook(w.id, { kind: e.target.value as "json" | "slack" })}>
                <option value="json">JSON</option>
                <option value="slack">Slack message</option>
              </select>
            </label>
            <button className="icon-btn" title="Remove" aria-label="Remove webhook" onClick={() => removeWebhook(w.id)}>
              <IconX size={14} />
            </button>
          </div>
          <input
            className="grow"
            type="url"
            value={w.url}
            placeholder="https://hooks.slack.com/services/…  or any endpoint"
            onChange={(e) => setWebhook(w.id, { url: e.target.value })}
          />
        </div>
      ))}
    </>
  );
}
