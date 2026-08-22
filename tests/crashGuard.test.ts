import { beforeEach, describe, expect, it } from "vitest";
import {
  LOOP_WINDOW_MS,
  clearCrashRecord,
  describeCrash,
  readRecord,
  shouldAutoRecover,
} from "../src/lib/crashGuard";

/**
 * The guard decides whether the app is allowed to restart itself.
 *
 * Getting this wrong in the permissive direction is the worst outcome in the
 * whole feature: a fault that reproduces during boot turns an app that
 * auto-recovers into an unkillable flicker with no way to read the error.
 */

// The module reads sessionStorage, which the node test environment lacks.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}

beforeEach(() => {
  (globalThis as { sessionStorage?: unknown }).sessionStorage = new MemStorage();
});

describe("automatic recovery", () => {
  it("recovers the first time", () => {
    expect(shouldAutoRecover(1000)).toBe(true);
  });

  it("refuses the second time inside the window, so a boot fault cannot loop", () => {
    expect(shouldAutoRecover(1000)).toBe(true);
    expect(shouldAutoRecover(2000)).toBe(false);
    expect(shouldAutoRecover(3000)).toBe(false);
  });

  it("allows another once the window has passed", () => {
    // Two crashes an hour apart are two incidents, not a loop.
    expect(shouldAutoRecover(1000)).toBe(true);
    expect(shouldAutoRecover(1000 + LOOP_WINDOW_MS + 1)).toBe(true);
  });

  it("starts fresh after the app has been marked healthy", () => {
    expect(shouldAutoRecover(1000)).toBe(true);
    clearCrashRecord();
    expect(shouldAutoRecover(1500)).toBe(true);
  });

  it("forgets attempts that have aged out of the window", () => {
    shouldAutoRecover(1000);
    expect(readRecord(1000 + LOOP_WINDOW_MS + 1).at).toEqual([]);
  });
});

describe("when storage is unavailable", () => {
  it("degrades to never auto-recovering rather than throwing", () => {
    // Storage can be disabled by policy, and a crash screen that crashes while
    // reading its own bookkeeping leaves the user with nothing at all.
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
      removeItem() { throw new Error("denied"); },
    };
    expect(() => shouldAutoRecover(1000)).not.toThrow();
    expect(() => clearCrashRecord()).not.toThrow();
  });

  it("survives a corrupt record", () => {
    (globalThis as { sessionStorage: MemStorage }).sessionStorage.setItem("hs-crash-guard", "{{{");
    expect(readRecord(1000).at).toEqual([]);
    expect(shouldAutoRecover(1000)).toBe(true);
  });

  it("ignores non-numeric timestamps someone else wrote", () => {
    (globalThis as { sessionStorage: MemStorage }).sessionStorage.setItem(
      "hs-crash-guard",
      JSON.stringify({ at: ["nope", null, 900] }),
    );
    expect(readRecord(1000).at).toEqual([900]);
  });
});

describe("describing a crash", () => {
  it("keeps the readable message separate from the stack", () => {
    // A stack trace as the headline tells a non-developer their app is broken
    // in a way they cannot act on.
    const e = new Error("Cannot read properties of undefined");
    const r = describeCrash(e);
    expect(r.message).toBe("Cannot read properties of undefined");
    expect(r.detail).toContain("Error: Cannot read properties of undefined");
  });

  it("includes the component stack when React gives one", () => {
    const r = describeCrash(new Error("boom"), "\n    at ChatWindow");
    expect(r.detail).toContain("Component stack:");
    expect(r.detail).toContain("ChatWindow");
  });

  it("handles a throw that was never an Error", () => {
    expect(describeCrash("just a string").message).toBe("just a string");
    // `throw null` and `throw undefined` are both legal and both used to
    // produce a headline reading literally "null", which tells the user
    // nothing and looks like a second bug.
    expect(describeCrash(null).message).toBe("Unknown error");
    expect(describeCrash(undefined).message).toBe("Unknown error");
  });

  it("caps the headline so one enormous message cannot fill the screen", () => {
    expect(describeCrash(new Error("x".repeat(5000))).message.length).toBeLessThanOrEqual(400);
  });
});
