/**
 * Errors that never reach a React error boundary.
 *
 * A boundary only catches throws during render, commit or lifecycle. Anything
 * asynchronous — a rejected fetch in an event handler, a failed Tauri command, a
 * `void somePromise()` whose rejection nobody awaited — bypasses it entirely and
 * lands in the console, which no user is looking at. The failure is then
 * completely silent: the button did nothing and the app looks fine.
 *
 * These are surfaced as toasts rather than the full crash screen. The app is
 * still working; blanking it over one failed request would be a worse bug than
 * the one being reported.
 */

import { toast } from "./toast";

/** Identical messages inside this window are counted, not repeated. */
const DEDUPE_MS = 4000;

/**
 * A rejection loop — a retry timer hitting a dead endpoint, say — can fire
 * hundreds of times a second. Past this many in a window we go quiet rather
 * than burying the UI under its own error reports.
 */
const MAX_PER_WINDOW = 3;
const WINDOW_MS = 10_000;

let recent = new Map<string, number>();
let windowStart = 0;
let inWindow = 0;

/** Exported for tests: forget everything this module has seen. */
export function resetErrorReporting(): void {
  recent = new Map();
  windowStart = 0;
  inWindow = 0;
}

/**
 * Should this error be shown, given what has already been shown recently?
 *
 * Pure apart from the module-level counters, so the throttling rules can be
 * tested without a DOM or a toast host.
 */
export function shouldReport(message: string, now: number): boolean {
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    inWindow = 0;
  }
  const last = recent.get(message);
  if (last !== undefined && now - last < DEDUPE_MS) return false;
  if (inWindow >= MAX_PER_WINDOW) return false;

  recent.set(message, now);
  inWindow++;
  // Bound the map so a long session with many distinct errors cannot grow it
  // without limit.
  if (recent.size > 50) {
    for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);
  }
  return true;
}

/**
 * Turn whatever was thrown into one line a person can read.
 *
 * Rejections carry anything at all — a string, a Response, undefined from a
 * bare `throw`. "[object Object]" in a toast is worse than saying nothing.
 */
export function describe(reason: unknown): string {
  if (reason instanceof Error) return reason.message || reason.name || "Unknown error";
  if (typeof reason === "string") return reason;
  if (reason && typeof reason === "object") {
    const r = reason as { message?: unknown; error?: unknown; statusText?: unknown; status?: unknown };
    if (typeof r.message === "string" && r.message) return r.message;
    if (typeof r.error === "string" && r.error) return r.error;
    if (typeof r.statusText === "string" && r.statusText) {
      return r.status ? `${r.status} ${r.statusText}` : r.statusText;
    }
    try {
      const j = JSON.stringify(reason);
      if (j && j !== "{}") return j.slice(0, 200);
    } catch {
      /* circular — fall through */
    }
  }
  return "Something failed, but threw no message.";
}

/**
 * Noise that is expected and not actionable.
 *
 * An aborted request is the normal result of the user pressing Stop or
 * navigating away; reporting it would train people to ignore the toasts.
 */
function isIgnorable(message: string): boolean {
  return /abort|cancel|the operation was aborted|ResizeObserver loop/i.test(message);
}

let installed = false;

/** Install the window-level handlers. Safe to call more than once. */
export function installErrorReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("unhandledrejection", (e) => {
    const msg = describe((e as PromiseRejectionEvent).reason);
    if (isIgnorable(msg)) return;
    console.error("[HarnessStation] unhandled rejection", (e as PromiseRejectionEvent).reason);
    if (shouldReport(msg, Date.now())) toast.error(msg);
  });

  window.addEventListener("error", (e) => {
    // Failed <img>/<script> loads also raise `error` but carry no `error`
    // property, and reporting a missing avatar as an app failure is noise.
    const ev = e as ErrorEvent;
    if (!ev.error && !ev.message) return;
    const msg = describe(ev.error ?? ev.message);
    if (isIgnorable(msg)) return;
    console.error("[HarnessStation] uncaught error", ev.error ?? ev.message);
    if (shouldReport(msg, Date.now())) toast.error(msg);
  });
}
