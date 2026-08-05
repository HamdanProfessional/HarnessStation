/**
 * Hooks & guardrails.
 *
 * Two related things, both configured in Settings:
 *
 *  - **Guardrails** — a policy per tool: block it outright, or require a
 *    confirmation before it runs. A safety net for the tools that touch your
 *    machine (terminal, file writes, HTTP).
 *  - **Webhooks (hooks)** — fire a POST to a URL on lifecycle events (a turn
 *    finishing, a tool being called, an error, a scheduled run completing). Use
 *    them for logging, alerts, or piping results to Slack. Fire-and-forget: a
 *    slow or dead webhook never blocks the app.
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
  event: HookEvent;
  url: string;
  /** How to shape the body: raw JSON, or a Slack-style { text } message. */
  kind: "json" | "slack";
}

export interface HookPayload {
  event: HookEvent;
  at: string; // ISO timestamp
  chatId?: string;
  chatTitle?: string;
  tool?: string;
  scheduleName?: string;
  error?: string;
  summary?: string; // short human line for Slack
}

/** POST to one destination, shaping the body for its kind. Never throws. */
async function post(url: string, kind: "json" | "slack", payload: HookPayload): Promise<void> {
  try {
    const body =
      kind === "slack"
        ? JSON.stringify({ text: payload.summary || `${payload.event}${payload.error ? `: ${payload.error}` : ""}` })
        : JSON.stringify(payload);
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  } catch {
    /* a webhook is best-effort — its failure is not the user's problem */
  }
}

/** Fire every configured webhook for an event. Does not block the caller. */
export function fireHook(event: HookEvent, payload: Omit<HookPayload, "event" | "at">): void {
  const hooks = useStore.getState().settings.webhooks ?? [];
  const targets = hooks.filter((h) => h.event === event && h.url.trim());
  if (!targets.length) return;
  const full: HookPayload = { event, at: new Date().toISOString(), ...payload };
  // Detach: we don't await, so the turn/schedule isn't held up by the network.
  for (const h of targets) void post(h.url.trim(), h.kind, full);
}

/**
 * Guardrail check before a tool runs. Returns "allow" to proceed, or a message
 * to return in place of running the tool ("blocked" / "cancelled").
 */
export async function guardTool(toolId: string): Promise<"allow" | string> {
  const s = useStore.getState().settings;
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

/** Deliver a scheduled run's output to its configured destination. Never throws. */
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
    error: undefined,
  });
}
