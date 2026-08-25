import type { Badge } from "./providerStatus";

/**
 * Measured provider exhaustion, from the one signal that cannot lie: the
 * provider's own 429s.
 *
 * Subscription plans don't publish their quota windows (X messages / 5h, and
 * they move), so we don't model them. Instead we record what actually happened
 * — every 429, with its Retry-After when the provider sent one — and derive a
 * conservative "limited until" from it. A successful call means the wall is
 * down and clears the record. That is enough to make combos honest (a step
 * that just got rate-limited is tried last, not first) and to say why on the
 * provider card.
 *
 * Observations live in localStorage (same tier as the spend ledger), pruned to
 * a day; this is telemetry, not settings.
 */

const KEY = "hs-provider-quota";
const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 20;
/** A 429 with no Retry-After still means something: assume a short wall. */
const DEFAULT_WALL_MS = 60_000;

interface RateLimitEvent {
  ts: number;
  retryAfterMs?: number;
}

type Store = Record<string, RateLimitEvent[]>;

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function save(s: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* telemetry — a failed write costs nothing */
  }
}

function prune(events: RateLimitEvent[], now: number): RateLimitEvent[] {
  return events.filter((e) => now - e.ts < KEEP_MS).slice(-MAX_EVENTS);
}

/** The provider said no (429). `retryAfterMs` when it said for how long. */
export function recordRateLimit(providerId: string, retryAfterMs?: number, now = Date.now()): void {
  const s = load();
  const events = prune(s[providerId] ?? [], now);
  events.push({ ts: now, ...(retryAfterMs ? { retryAfterMs } : {}) });
  s[providerId] = events.slice(-MAX_EVENTS);
  save(s);
}

/** A call went through — the wall is down, however recently it went up. */
export function recordSuccess(providerId: string): void {
  const s = load();
  if (!s[providerId]?.length) return;
  delete s[providerId];
  save(s);
}

/**
 * When the provider stops saying no, or null.
 *
 * The wall lasts as long as the longest unexpired Retry-After we were given;
 * bare 429s (no header) each claim the default wall from their own timestamp,
 * so a burst of them without guidance reads as "recently limited".
 */
export function limitedUntil(providerId: string, now = Date.now()): number | null {
  const s = load();
  const events = prune(s[providerId] ?? [], now);
  if (!events.length) return null;
  let until = 0;
  for (const e of events) {
    const wall = e.ts + (e.retryAfterMs ?? DEFAULT_WALL_MS);
    if (wall > until) until = wall;
  }
  return until > now ? until : null;
}

/** True when the step should be tried after the ones that are clearly up. */
export function isLimited(providerId: string, now = Date.now()): boolean {
  return limitedUntil(providerId, now) !== null;
}

/** Human "in 3m" for the countdown on a badge or tooltip. */
export function untilLabel(until: number, now = Date.now()): string {
  const sec = Math.max(0, Math.round((until - now) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** The My Models badge for a limited provider, or null when it isn't. */
export function rateLimitBadge(providerId: string, now = Date.now()): Badge | null {
  const until = limitedUntil(providerId, now);
  if (!until) return null;
  return {
    label: `Limited · ${untilLabel(until, now)}`,
    tone: "warn",
    title:
      "The provider returned 429 recently" +
      (until - now > 60_000 ? ` — retries back off until about ${new Date(until).toLocaleTimeString()}` : "") +
      ". Combos try this step last.",
  };
}

/** Test seam. */
export function resetQuota(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}
