import { describe, expect, it } from "vitest";
import { describeHang, parseHangReport } from "../src/lib/watchdog";

/**
 * The marker file is written by a process that is on its way out, from a thread
 * running alongside a wedged one. It can plausibly be truncated, empty, or from
 * an older version — and the code that reads it runs during startup, where
 * throwing would turn a recovered hang into a failure to boot.
 */

describe("reading the marker", () => {
  it("parses what the watchdog writes", () => {
    const r = parseHangReport('{"at":1700000000000,"silentMs":31000,"version":"0.3.0"}');
    expect(r).toEqual({ at: 1700000000000, silentMs: 31000, version: "0.3.0" });
  });

  it("returns null when there is no marker", () => {
    // The normal case — every launch that did not follow a hang.
    expect(parseHangReport(null)).toBeNull();
    expect(parseHangReport(undefined)).toBeNull();
    expect(parseHangReport("")).toBeNull();
  });

  it("survives a truncated write", () => {
    // The process was being torn down as it wrote.
    expect(parseHangReport('{"at":1700000000000,"sile')).toBeNull();
  });

  it("rejects a well-formed object missing the fields it needs", () => {
    expect(parseHangReport('{"hello":"world"}')).toBeNull();
    expect(parseHangReport('{"at":"nope","silentMs":1}')).toBeNull();
  });

  it("accepts a marker with no version", () => {
    // Forward compatibility runs both ways; an older marker should still be
    // reportable rather than silently dropped.
    expect(parseHangReport('{"at":1,"silentMs":2}')?.version).toBeUndefined();
  });

  it("does not throw on JSON that is not an object", () => {
    expect(parseHangReport("42")).toBeNull();
    expect(parseHangReport("null")).toBeNull();
    expect(parseHangReport('"a string"')).toBeNull();
  });
});

describe("what the user is told", () => {
  it("says how long it was stuck, in seconds", () => {
    expect(describeHang({ at: 0, silentMs: 31000 })).toContain("31 seconds");
  });

  it("gets the singular right", () => {
    expect(describeHang({ at: 0, silentMs: 1000 })).toContain("1 second");
    expect(describeHang({ at: 0, silentMs: 1000 })).not.toContain("1 seconds");
  });

  it("never reports zero seconds", () => {
    // Rounding a sub-second value to "0 seconds" describes something that did
    // not happen and makes the whole notice look broken.
    expect(describeHang({ at: 0, silentMs: 200 })).toContain("1 second");
  });

  it("does not call it a crash", () => {
    // Nothing crashed and no data was lost; saying so reads worse than what
    // actually happened.
    const msg = describeHang({ at: 0, silentMs: 31000 });
    expect(msg.toLowerCase()).not.toContain("crash");
    expect(msg).toContain("saved");
  });
});
