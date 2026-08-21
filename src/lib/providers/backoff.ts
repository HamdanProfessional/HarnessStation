/**
 * How long to wait before trying a rate-limited provider again.
 *
 * Failover used to move to the next key the instant a request failed. Against a
 * 429 that is close to the worst possible behaviour: the provider has just said
 * "wait N seconds", and instead we spend every remaining key in the pool within
 * milliseconds and rate-limit all of them. Round-robin makes this sharper,
 * because now there is a pool to burn.
 *
 * Two rules, in order:
 *   1. If the provider said how long to wait, wait that long. It knows.
 *   2. Otherwise back off exponentially with jitter, so a burst of parallel
 *      requests does not retry in lockstep and re-create the spike.
 */

export const BASE_DELAY_MS = 500;
export const MAX_DELAY_MS = 20_000;

/**
 * Parse a `Retry-After` in any of the three forms servers actually send.
 *
 * Returns null when there is no usable value — the caller falls back to
 * exponential backoff rather than treating "no header" as "retry immediately".
 */
export function retryAfterMs(headers: Headers | null | undefined, now = Date.now()): number | null {
  if (!headers) return null;

  // Non-standard but common, and more precise when present. Note the explicit
  // null check: `Number(null)` is 0, which is finite and non-negative, so
  // testing the parse alone would report a zero wait for every response that
  // does not carry this header — an immediate retry, which is the exact
  // behaviour this module exists to prevent.
  const rawMs = headers.get("retry-after-ms");
  if (rawMs !== null) {
    const ms = Number(rawMs);
    if (Number.isFinite(ms) && ms >= 0) return ms;
  }

  const raw = headers.get("retry-after");
  if (raw === null || raw.trim() === "") return null;

  // Delta-seconds form: "Retry-After: 30". A numeric value that is negative is
  // malformed rather than a date, so stop here rather than falling through to
  // Date.parse, which would interpret "-5" as a year.
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null;

  // HTTP-date form: "Retry-After: Wed, 21 Oct 2026 07:28:00 GMT". A date in the
  // past means the wait is already over, hence the clamp at zero.
  const at = Date.parse(raw);
  if (!Number.isNaN(at)) return Math.max(0, at - now);

  return null;
}

/**
 * Delay before attempt number `attempt` (0-based), given an optional
 * server-supplied wait. Jitter is +/-20%, so parallel callers spread out.
 */
export function backoffMs(attempt: number, serverMs: number | null, random = Math.random): number {
  if (serverMs !== null) return Math.min(serverMs, MAX_DELAY_MS);
  const target = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jittered = target * (0.8 + random() * 0.4);
  return Math.round(Math.min(jittered, MAX_DELAY_MS));
}

/**
 * Whether a status is worth waiting for rather than moving on immediately.
 *
 * A 429 or an overloaded 5xx is temporary and the same key will work shortly.
 * A 401 is not — waiting on a bad key wastes the user's time, so those fail
 * over at once, which is what the old behaviour did for everything.
 */
export function shouldWait(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status === 429 || status === 503 || status === 504 || status === 529;
}
