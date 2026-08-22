/**
 * Deciding whether it is safe to restart after a crash.
 *
 * Automatically reloading on error is right exactly once. If the fault is in
 * something that runs during boot — a corrupt settings file, a bad migration, a
 * component that throws on mount — then reloading reproduces it, and an app that
 * restarts itself every time becomes an unkillable flicker with no way to read
 * the error. That is strictly worse than a stopped app showing a message.
 *
 * So: recover silently the first time, and after that stop and show the user
 * what happened. The counter is time-boxed, because two crashes an hour apart
 * are two incidents, not a loop.
 */

/** Crashes within this window of each other count as the same incident. */
export const LOOP_WINDOW_MS = 60_000;

/** How many automatic recoveries to allow inside that window. */
export const MAX_AUTO_RELOADS = 1;

export interface CrashRecord {
  /** Timestamps of recent automatic reloads, newest last. */
  at: number[];
}

const KEY = "hs-crash-guard";

/**
 * Session storage, not local: the record should die with the window.
 *
 * A crash from three days ago must not make today's first crash refuse to
 * recover, and there is no value in the history surviving a deliberate restart.
 */
function store(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    // Storage can throw outright when disabled by policy. A crash screen that
    // crashes reading its own bookkeeping is the worst possible outcome here.
    return null;
  }
}

export function readRecord(now: number): CrashRecord {
  const s = store();
  if (!s) return { at: [] };
  try {
    const raw = JSON.parse(s.getItem(KEY) ?? "");
    const at = Array.isArray(raw?.at) ? raw.at.filter((n: unknown) => typeof n === "number") : [];
    return { at: at.filter((t: number) => now - t < LOOP_WINDOW_MS) };
  } catch {
    return { at: [] };
  }
}

function writeRecord(rec: CrashRecord): void {
  try {
    store()?.setItem(KEY, JSON.stringify(rec));
  } catch {
    /* nothing to do — the guard degrades to "never auto-reload" */
  }
}

/**
 * Should this crash be recovered automatically?
 *
 * Records the attempt when it says yes, so the next crash inside the window
 * sees it and stops.
 */
export function shouldAutoRecover(now: number): boolean {
  const rec = readRecord(now);
  if (rec.at.length >= MAX_AUTO_RELOADS) return false;
  writeRecord({ at: [...rec.at, now] });
  return true;
}

/** Called once the app has run long enough to be considered healthy. */
export function clearCrashRecord(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    /* see writeRecord */
  }
}

/**
 * A crash turned into something a person can act on.
 *
 * `message` is what the user reads, `detail` is what they send us. Keeping them
 * separate matters: a stack trace as the headline tells a non-developer their
 * app is broken in a way they cannot do anything about.
 */
export interface CrashReport {
  message: string;
  detail: string;
}

export function describeCrash(err: unknown, componentStack?: string): CrashReport {
  const e = err as { message?: string; stack?: string; name?: string } | null;
  const message = (e?.message || String(err ?? "Unknown error")).slice(0, 400);
  const detail = [
    e?.name ? `${e.name}: ${e.message ?? ""}` : message,
    e?.stack ?? "",
    componentStack ? `\nComponent stack:${componentStack}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
  return { message, detail };
}
