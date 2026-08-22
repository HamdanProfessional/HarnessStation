import { beforeEach, describe, expect, it } from "vitest";
import { describe as describeErr, resetErrorReporting, shouldReport } from "../src/lib/errorReporting";

/**
 * Async failures used to be completely silent — the button did nothing and the
 * app looked fine. Reporting them is the fix; reporting them without limit is
 * how a retry loop against a dead endpoint buries the UI under its own error
 * messages.
 */

beforeEach(() => resetErrorReporting());

describe("throttling", () => {
  it("reports the first occurrence", () => {
    expect(shouldReport("boom", 0)).toBe(true);
  });

  it("suppresses the same message repeated immediately", () => {
    expect(shouldReport("boom", 0)).toBe(true);
    expect(shouldReport("boom", 100)).toBe(false);
    expect(shouldReport("boom", 3999)).toBe(false);
  });

  it("lets the same message through once it has gone quiet", () => {
    expect(shouldReport("boom", 0)).toBe(true);
    expect(shouldReport("boom", 4001)).toBe(true);
  });

  it("still reports a different message", () => {
    expect(shouldReport("boom", 0)).toBe(true);
    expect(shouldReport("other", 10)).toBe(true);
  });

  it("goes quiet after a burst rather than flooding the screen", () => {
    expect(shouldReport("a", 0)).toBe(true);
    expect(shouldReport("b", 1)).toBe(true);
    expect(shouldReport("c", 2)).toBe(true);
    expect(shouldReport("d", 3)).toBe(false);
  });

  it("opens up again in the next window", () => {
    for (const m of ["a", "b", "c"]) shouldReport(m, 0);
    expect(shouldReport("d", 4)).toBe(false);
    expect(shouldReport("d", 10_001)).toBe(true);
  });
});

describe("describing what was thrown", () => {
  it("uses an Error's message", () => {
    expect(describeErr(new Error("nope"))).toBe("nope");
  });

  it("falls back to the name for an Error with no message", () => {
    expect(describeErr(new TypeError())).toBe("TypeError");
  });

  it("passes a thrown string through", () => {
    expect(describeErr("plain")).toBe("plain");
  });

  it("reads a message off a plain object", () => {
    expect(describeErr({ message: "from object" })).toBe("from object");
  });

  it("builds one from an HTTP-shaped rejection", () => {
    // fetch rejections and Response objects are a common shape here.
    expect(describeErr({ status: 429, statusText: "Too Many Requests" })).toBe("429 Too Many Requests");
  });

  it("never returns [object Object]", () => {
    // Which is what a toast showed before, and is worse than saying nothing.
    expect(describeErr({ some: "data" })).not.toContain("[object Object]");
    expect(describeErr({ some: "data" })).toContain("some");
  });

  it("survives a circular object", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => describeErr(a)).not.toThrow();
    expect(describeErr(a)).toMatch(/threw no message/);
  });

  it("says something for a bare throw", () => {
    expect(describeErr(undefined)).toMatch(/threw no message/);
    expect(describeErr(null)).toMatch(/threw no message/);
  });
});
