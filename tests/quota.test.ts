import { beforeEach, describe, expect, it } from "vitest";
import {
  isLimited,
  limitedUntil,
  rateLimitBadge,
  recordRateLimit,
  recordSuccess,
  resetQuota,
  untilLabel,
} from "../src/lib/quota";

beforeEach(() => {
  resetQuota();
});

describe("recordRateLimit / limitedUntil", () => {
  it("a bare 429 claims a short default wall", () => {
    recordRateLimit("p", undefined, 1_000_000);
    expect(limitedUntil("p", 1_000_000)).toBe(1_000_000 + 60_000);
    expect(limitedUntil("p", 1_000_000 + 61_000)).toBeNull();
  });

  it("Retry-After extends the wall from the moment of the 429", () => {
    recordRateLimit("p", 10 * 60_000, 1_000_000);
    expect(limitedUntil("p", 1_000_000 + 60_000)).toBe(1_000_000 + 10 * 60_000);
  });

  it("the longest outstanding Retry-After wins, across bursts", () => {
    recordRateLimit("p", 30_000, 1_000_000);
    recordRateLimit("p", 5 * 60_000, 1_100_000);
    recordRateLimit("p", undefined, 1_200_000);
    expect(limitedUntil("p", 1_200_000)).toBe(1_100_000 + 5 * 60_000);
  });

  it("old observations age out and stop holding the wall up", () => {
    recordRateLimit("p", 10 * 60_000, 1_000);
    // 24h keep-window has passed by now; the event is gone even though its
    // Retry-After would nominally still be running.
    expect(limitedUntil("p", 25 * 60 * 60 * 1000)).toBeNull();
  });

  it("isLimited mirrors limitedUntil", () => {
    expect(isLimited("p")).toBe(false);
    recordRateLimit("p", 60_000, Date.now());
    expect(isLimited("p")).toBe(true);
  });
});

describe("recordSuccess", () => {
  it("clears the record — a success means the wall came down", () => {
    recordRateLimit("p", 10 * 60_000, Date.now());
    expect(isLimited("p")).toBe(true);
    recordSuccess("p");
    expect(isLimited("p")).toBe(false);
  });

  it("is a no-op for a provider that was never limited", () => {
    recordSuccess("p");
    expect(localStorage.getItem("hs-provider-quota")).toBeNull();
  });
});

describe("rateLimitBadge", () => {
  it("is null while the provider is up", () => {
    expect(rateLimitBadge("p")).toBeNull();
  });

  it("shows a countdown while the wall stands", () => {
    const now = Date.now();
    recordRateLimit("p", 3 * 60_000, now);
    const b = rateLimitBadge("p", now + 1000)!;
    expect(b.tone).toBe("warn");
    expect(b.label).toMatch(/^Limited · [0-9]+m$/);
    expect(b.title).toContain("Combos try this step last");
  });

  it("stops showing once the wall expires", () => {
    const now = Date.now();
    recordRateLimit("p", 60_000, now);
    expect(rateLimitBadge("p", now + 61_000)).toBeNull();
  });
});

describe("untilLabel", () => {
  it("renders seconds, minutes and hours", () => {
    expect(untilLabel(100_000, 99_000)).toBe("1s");
    expect(untilLabel(100_000 + 3 * 60_000, 100_000)).toBe("3m");
    expect(untilLabel(100_000 + 90 * 60_000, 100_000)).toBe("1h 30m");
  });
});
