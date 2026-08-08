/**
 * Hooks & guardrails.
 *
 *  - **Guardrails** — control what tools the agent may run. A quick per-tool
 *    policy (allow / ask / deny), plus **rules** that can match on the tool's
 *    *arguments* (e.g. deny `run_terminal` when the command matches `rm -rf`).
 *  - **Webhooks** — POST to a URL on lifecycle events (a turn finishing, a tool
 *    call, an error, a scheduled run completing), as raw JSON or a Slack message,
 *    with optional custom headers. Fire-and-forget: a slow endpoint never blocks
 *    the app.
 *
 * Scheduled runs can also *deliver* their output to a webhook or Slack — the
 * outbound half of "trigger and deliver".
 */
import { fetch } from "@tauri-apps/plugin-http";
import { confirmDialog } from "./dialog";
import { useStore } from "./store";

export type HookEvent = "turn-complete" | "tool-call" | "error" | "schedule-complete";

export interface Webhook {
  id: string;
  label?: string;
  event: HookEvent;
  url: string;
  kind: "json" | "slack";
  /** Extra request headers, e.g. an Authorization token for a private endpoint. */
  headers?: { key: string; value: string }[];
}

/**
 * A guardrail rule. Matches when the tool id matches (`*` = any) and, if a
 * `pattern` is set, the tool's arguments match that regex. First matching rule
 * wins. `allow` lets a specific case through even if a later rule would deny it.
 */
export interface GuardrailRule {
  id: string;
  tool: string; // a tool id, or "*"
  pattern?: string; // regex tested (case-insensitive) against the JSON arguments
  action: "allow" | "ask" | "deny";
  message?: string; // shown on ask/deny
}

export interface HookPayload {
  event: HookEvent;
  at: string;
  chatId?: string;
  chatTitle?: string;
  tool?: string;
  scheduleName?: string;
  error?: string;
  summary?: string;
}

function headerRecord(headers?: { key: string; value: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers ?? []) if (h.key.trim()) out[h.key.trim()] = h.value;
  return out;
}

/** POST to one destination. Returns true on a 2xx, false on any failure. */
async function post(url: string, kind: "json" | "slack", payload: HookPayload, headers?: Record<string, string>): Promise<boolean> {
  try {
    const body =
      kind === "slack"
        ? JSON.stringify({ text: payload.summary || `${payload.event}${payload.error ? `: ${payload.error}` : ""}` })
        : JSON.stringify(payload);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(headers ?? {}) }, body });
    return res.ok;
  } catch {
    return false;
  }
}

/** Fire every configured webhook for an event, without blocking the caller. */
export function fireHook(event: HookEvent, payload: Omit<HookPayload, "event" | "at">): void {
  const hooks = useStore.getState().settings.webhooks ?? [];
  const targets = hooks.filter((h) => h.event === event && h.url.trim());
  if (!targets.length) return;
  const full: HookPayload = { event, at: new Date().toISOString(), ...payload };
  for (const h of targets) void post(h.url.trim(), h.kind, full, headerRecord(h.headers));
}

/** Fire a sample payload at one webhook, so it can be tested from Settings. */
export async function testWebhook(w: Webhook): Promise<boolean> {
  return post(
    w.url.trim(),
    w.kind,
    { event: w.event, at: new Date().toISOString(), summary: `Test webhook from HarnessStation${w.label ? ` (${w.label})` : ""}` },
    headerRecord(w.headers),
  );
}

function argJson(args: unknown): string {
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return "";
  }
}

/**
 * Guardrail check before a tool runs. Returns "allow" to proceed, or a message
 * to return in place of running it. Rules are evaluated first (with argument
 * matching), then the simple per-tool allow/ask/deny lists.
 */
/** Coarse category used by the sandbox/approval presets. */
const EXEC_TOOLS = new Set(["run_terminal"]);
const WRITE_TOOLS = new Set(["write_file", "edit_file", "delete_path", "make_dir", "make_folder"]);
export function toolClass(id: string): "read" | "write" | "exec" {
  if (EXEC_TOOLS.has(id) || /terminal|shell|exec|bash|powershell|process|spawn/i.test(id)) return "exec";
  if (
    WRITE_TOOLS.has(id) ||
    /write|edit|delete|remove|create|update|modify|save|mkdir|move|rename|append|patch|commit|push|upload/i.test(id)
  )
    return "write";
  return "read";
}

export async function guardTool(toolId: string, args?: unknown): Promise<"allow" | string> {
  const s = useStore.getState().settings;
  const argsStr = argJson(args);

  // Sandbox / approval presets (Settings › Agent permissions). Explicit guardrails
  // and per-tool lists below still layer on top of these.
  const sandbox = s.toolSandbox ?? "full-access";
  const approval = s.toolApproval ?? "full-auto";
  if (sandbox !== "full-access" || approval !== "full-auto") {
    const cls = toolClass(toolId);
    const mutating = cls !== "read";
    const dangerous = cls === "exec" || /delete|remove|\brm\b|drop|destroy/i.test(toolId);
    if (sandbox === "read-only" && mutating) {
      return `Blocked by the read-only sandbox: "${toolId}" would change files or run a command. Switch to workspace-write in Settings › Agent permissions to allow it.`;
    }
    if (approval === "suggest" && mutating) {
      const ok = await confirmDialog(`Allow the agent to run "${toolId}"?`, {
        message: "Approval mode is “suggest” — confirm before any change.",
      });
      if (!ok) return `Cancelled: you declined the "${toolId}" tool.`;
    } else if (approval === "auto-edit" && dangerous) {
      const ok = await confirmDialog(`Allow the agent to run "${toolId}"?`, {
        message: "Approval mode is “auto-edit” — confirm before terminal or delete actions.",
      });
      if (!ok) return `Cancelled: you declined the "${toolId}" tool.`;
    }
  }

  for (const r of s.guardrails ?? []) {
    if (r.tool !== "*" && r.tool !== toolId) continue;
    if (r.pattern) {
      try {
        if (!new RegExp(r.pattern, "i").test(argsStr)) continue;
      } catch {
        continue; // a bad regex never blocks anything
      }
    }
    if (r.action === "allow") return "allow";
    if (r.action === "deny") return `Blocked by a guardrail${r.message ? `: ${r.message}` : `: the "${toolId}" tool.`}`;
    const ok = await confirmDialog(`Allow the agent to run "${toolId}"?`, {
      message: r.message || "A guardrail requires confirmation before this runs.",
    });
    if (!ok) return `Cancelled: you declined the "${toolId}" tool.`;
    return "allow";
  }

  if ((s.blockTools ?? []).includes(toolId)) {
    return `Blocked by a guardrail: the "${toolId}" tool is disabled in Settings › Hooks & guardrails.`;
  }
  if ((s.confirmTools ?? []).includes(toolId)) {
    const ok = await confirmDialog(`Allow the agent to run "${toolId}"?`, {
      message: "This tool is set to require confirmation (Settings › Hooks & guardrails).",
    });
    if (!ok) return `Cancelled: you declined the "${toolId}" tool.`;
  }
  return "allow";
}

/** Deliver a scheduled run's output to its configured destination. Best-effort. */
export async function deliverScheduleResult(
  target: { deliverUrl?: string; deliverKind?: "json" | "slack"; name: string },
  result: string,
): Promise<void> {
  if (!target.deliverUrl?.trim()) return;
  await post(target.deliverUrl.trim(), target.deliverKind ?? "json", {
    event: "schedule-complete",
    at: new Date().toISOString(),
    scheduleName: target.name,
    summary: `*${target.name}*\n${result.slice(0, 3500)}`,
  });
}
