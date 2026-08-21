import { describe, expect, it } from "vitest";
import {
  backoffMs,
  BASE_DELAY_MS,
  MAX_DELAY_MS,
  retryAfterMs,
  shouldWait,
} from "../src/lib/providers/backoff";

const h = (obj: Record<string, string>) => new Headers(obj);
const NOW = Date.parse("2026-08-21T12:00:00Z");

describe("reading Retry-After", () => {
  it("takes the delta-seconds form", () => {
    expect(retryAfterMs(h({ "retry-after": "30" }), NOW)).toBe(30_000);
  });

  it("takes the HTTP-date form", () => {
    expect(retryAfterMs(h({ "retry-after": "Fri, 21 Aug 2026 12:00:45 GMT" }), NOW)).toBe(45_000);
  });

  it("prefers retry-after-ms when both are present, being more precise", () => {
    expect(retryAfterMs(h({ "retry-after-ms": "1500", "retry-after": "60" }), NOW)).toBe(1500);
  });

  it("clamps a date already in the past to zero rather than going negative", () => {
    // A negative delay would become an immediate retry via setTimeout, which is
    // the behaviour this whole module exists to stop.
    expect(retryAfterMs(h({ "retry-after": "Fri, 21 Aug 2026 11:59:00 GMT" }), NOW)).toBe(0);
  });

  it("returns null when there is nothing usable, rather than zero", () => {
    // null means "fall back to exponential backoff". Zero would mean "the
    // server told us to retry immediately", which it did not.
    expect(retryAfterMs(h({}), NOW)).toBeNull();
    expect(retryAfterMs(h({ "retry-after": "soon" }), NOW)).toBeNull();
    expect(retryAfterMs(null, NOW)).toBeNull();
    expect(retryAfterMs(undefined, NOW)).toBeNull();
  });

  it("ignores a negative delta rather than treating it as a wait", () => {
    expect(retryAfterMs(h({ "retry-after": "-5" }), NOW)).toBeNull();
  });

  it("accepts a zero-second wait as a real instruction", () => {
    expect(retryAfterMs(h({ "retry-after": "0" }), NOW)).toBe(0);
  });
});

describe("choosing the delay", () => {
  it("does what the server said, when the server said anything", () => {
    expect(backoffMs(0, 7_000)).toBe(7_000);
    expect(backoffMs(5, 250)).toBe(250);
  });

  it("caps even a server-supplied wait, so one bad header cannot hang a turn", () => {
    expect(backoffMs(0, 10 * 60 * 1000)).toBe(MAX_DELAY_MS);
  });

  it("doubles each attempt when the server said nothing", () => {
    const mid = () => 0.5; // no jitter, for a readable assertion
    expect(backoffMs(0, null, mid)).toBe(BASE_DELAY_MS);
    expect(backoffMs(1, null, mid)).toBe(BASE_DELAY_MS * 2);
    expect(backoffMs(2, null, mid)).toBe(BASE_DELAY_MS * 4);
  });

  it("caps the exponential curve instead of growing without bound", () => {
    expect(backoffMs(50, null, () => 0.5)).toBe(MAX_DELAY_MS);
    expect(backoffMs(50, null, () => 1)).toBeLessThanOrEqual(MAX_DELAY_MS);
  });

  it("jitters within +/-20%, so parallel callers do not retry in lockstep", () => {
    // Without jitter a burst that all got 429ed retries at the same instant and
    // recreates the spike that caused the 429.
    const low = backoffMs(2, null, () => 0);
    const high = backoffMs(2, null, () => 0.999);
    expect(low).toBe(Math.round(BASE_DELAY_MS * 4 * 0.8));
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(Math.round(BASE_DELAY_MS * 4 * 1.2));
  });
});

describe("which failures are worth waiting for", () => {
  it("waits on rate limits and overload", () => {
    for (const s of [429, 503, 504, 529]) expect(shouldWait(s), String(s)).toBe(true);
  });

  it("does not wait on an auth failure — the key is wrong, not busy", () => {
    // These still fail over immediately, which is what the old code did for
    // everything. Waiting on a bad key just makes the user wait.
    for (const s of [400, 401, 403, 404, 408, 409, 500]) expect(shouldWait(s), String(s)).toBe(false);
  });

  it("does not wait when there is no status at all", () => {
    // A network-level throw has no status; retrying another endpoint at once is
    // the right move there.
    expect(shouldWait(undefined)).toBe(false);
  });
});
