import { useStore } from "../lib/store";
import type { Settings } from "../lib/types";
import type { HookEvent, Webhook, GuardrailRule } from "../lib/hooks";
import { testWebhook } from "../lib/hooks";
import { toast } from "../lib/toast";
import { IconX } from "./icons";

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

const PRESETS: { label: string; rule: Omit<GuardrailRule, "id"> }[] = [
  {
    label: "Block destructive shell",
    rule: {
      tool: "run_terminal",
      pattern: "\\brm\\s+-rf\\b|\\bmkfs\\b|\\bdd\\s+if=|>\\s*/dev/sd|:\\(\\)\\s*\\{\\s*:\\|",
      action: "deny",
      message: "That command looks destructive.",
    },
  },
  { label: "Confirm every HTTP request", rule: { tool: "http_request", action: "ask" } },
  { label: "Confirm writes to .env / secrets", rule: { tool: "write_file", pattern: "\\.env|secret|credential|\\.pem", action: "ask", message: "This writes to a sensitive-looking path." } },
];

type Policy = "allow" | "ask" | "deny";

/** Settings › Hooks & guardrails — tool policies, argument rules, and webhooks. */
export function HooksPanel() {
  const { settings, saveSettings, allTools } = useStore();
  const save = (patch: Partial<Settings>) => void saveSettings({ ...settings, ...patch });
  const toolIds = ["*", ...allTools().map((t) => t.id)];

  // ---- quick per-tool policy ----
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

  // ---- rules ----
  const rules = settings.guardrails ?? [];
  const setRule = (id: string, patch: Partial<GuardrailRule>) =>
    save({ guardrails: rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const addRule = (rule?: Omit<GuardrailRule, "id">) =>
    save({ guardrails: [...rules, { id: `rule-${Date.now()}`, tool: "run_terminal", action: "ask", ...rule }] });
  const removeRule = (id: string) => save({ guardrails: rules.filter((r) => r.id !== id) });

  // ---- webhooks ----
  const webhooks = settings.webhooks ?? [];
  const setHook = (id: string, patch: Partial<Webhook>) =>
    save({ webhooks: webhooks.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const addHook = () =>
    save({ webhooks: [...webhooks, { id: `hook-${Date.now()}`, event: "turn-complete", url: "", kind: "json" }] });
  const removeHook = (id: string) => save({ webhooks: webhooks.filter((w) => w.id !== id) });
  const setHeader = (w: Webhook, i: number, patch: Partial<{ key: string; value: string }>) => {
    const headers = [...(w.headers ?? [])];
    headers[i] = { ...headers[i], ...patch };
    setHook(w.id, { headers });
  };
  const test = async (w: Webhook) => {
    if (!w.url.trim()) return;
    toast.info("Sending test…");
    (await testWebhook(w)) ? toast.success("Webhook responded OK.") : toast.error("Webhook failed (no 2xx).");
  };

  return (
    <>
      <datalist id="hook-tools">
        {toolIds.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>

      <h2>Guardrails</h2>
      <p className="hint">
        Decide what the agent may do on its own. <b>Ask</b> confirms before the tool runs; <b>Deny</b>{" "}
        blocks it. Applies to every chat, agent and schedule.
      </p>
      <div className="provider-card">
        {GUARDED.map((t) => {
          const cur = policyOf(t.id);
          return (
            <div key={t.id} className="provider-row" style={{ alignItems: "center" }}>
              <span className="grow">
                {t.label} <code className="hint">{t.id}</code>
              </span>
              <div className="seg">
                {(["allow", "ask", "deny"] as Policy[]).map((p) => (
                  <button key={p} className={`seg-btn ${cur === p ? "active" : ""}`} onClick={() => setPolicy(t.id, p)}>
                    {p === "allow" ? "Allow" : p === "ask" ? "Ask" : "Deny"}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <h3 style={{ marginTop: 20 }}>
        Rules{" "}
        <button className="btn small" onClick={() => addRule()}>
          + Add rule
        </button>
      </h3>
      <p className="hint">
        Finer control: match a tool <b>and</b> its arguments. A rule fires when the tool matches
        (<code>*</code> = any) and, if given, its arguments match the regex. First matching rule wins;
        <b> Allow</b> can whitelist a case a broader rule would block.
      </p>
      <div className="provider-row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        {PRESETS.map((p) => (
          <button key={p.label} className="btn small" onClick={() => addRule(p.rule)} title="Add this rule">
            + {p.label}
          </button>
        ))}
      </div>
      {rules.map((r) => (
        <div key={r.id} className="provider-card">
          <div className="provider-row">
            <label className="field">
              <span>Tool</span>
              <input list="hook-tools" value={r.tool} onChange={(e) => setRule(r.id, { tool: e.target.value })} style={{ width: 170 }} />
            </label>
            <label className="field grow">
              <span>Arguments match (regex, optional)</span>
              <input
                spellCheck={false}
                value={r.pattern ?? ""}
                placeholder="e.g. rm\s+-rf"
                onChange={(e) => setRule(r.id, { pattern: e.target.value || undefined })}
              />
            </label>
            <label className="field">
              <span>Then</span>
              <select value={r.action} onChange={(e) => setRule(r.id, { action: e.target.value as GuardrailRule["action"] })}>
                <option value="allow">Allow</option>
                <option value="ask">Ask</option>
                <option value="deny">Deny</option>
              </select>
            </label>
            <button className="icon-btn" title="Remove rule" aria-label="Remove rule" onClick={() => removeRule(r.id)}>
              <IconX size={14} />
            </button>
          </div>
          <input
            className="grow"
            value={r.message ?? ""}
            placeholder="Message shown on ask/deny (optional)"
            onChange={(e) => setRule(r.id, { message: e.target.value || undefined })}
          />
        </div>
      ))}

      <h2 style={{ marginTop: 28 }}>
        Webhooks{" "}
        <button className="btn small" onClick={addHook}>
          + Add
        </button>
      </h2>
      <p className="hint">
        Fire a <code>POST</code> on an event — logging, alerts, or Slack. Best-effort; the payload
        carries no prompts or keys. Add headers for a private endpoint, and Test to check it.
      </p>
      {webhooks.length === 0 && <p className="hint">No webhooks yet.</p>}
      {webhooks.map((w) => (
        <div key={w.id} className="provider-card">
          <div className="provider-row">
            <input
              className="grow"
              value={w.label ?? ""}
              placeholder="Label (optional)"
              onChange={(e) => setHook(w.id, { label: e.target.value || undefined })}
            />
            <label className="field">
              <span>On</span>
              <select value={w.event} onChange={(e) => setHook(w.id, { event: e.target.value as HookEvent })}>
                {EVENTS.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Format</span>
              <select value={w.kind} onChange={(e) => setHook(w.id, { kind: e.target.value as "json" | "slack" })}>
                <option value="json">JSON</option>
                <option value="slack">Slack</option>
              </select>
            </label>
            <button className="icon-btn" title="Remove" aria-label="Remove webhook" onClick={() => removeHook(w.id)}>
              <IconX size={14} />
            </button>
          </div>
          <div className="provider-row">
            <input
              className="grow"
              type="url"
              value={w.url}
              placeholder="https://hooks.slack.com/services/…  or any endpoint"
              onChange={(e) => setHook(w.id, { url: e.target.value })}
            />
            <button className="btn small" disabled={!w.url.trim()} onClick={() => void test(w)}>
              Test
            </button>
          </div>
          <details className="voice-tools">
            <summary>Custom headers</summary>
            {(w.headers ?? []).map((h, i) => (
              <div key={i} className="provider-row">
                <input value={h.key} placeholder="Header" onChange={(e) => setHeader(w, i, { key: e.target.value })} />
                <input className="grow" value={h.value} placeholder="Value" onChange={(e) => setHeader(w, i, { value: e.target.value })} />
                <button
                  className="icon-btn"
                  aria-label="Remove header"
                  onClick={() => setHook(w.id, { headers: (w.headers ?? []).filter((_, j) => j !== i) })}
                >
                  <IconX size={14} />
                </button>
              </div>
            ))}
            <button className="btn small" onClick={() => setHook(w.id, { headers: [...(w.headers ?? []), { key: "", value: "" }] })}>
              + Add header
            </button>
          </details>
        </div>
      ))}
    </>
  );
}
