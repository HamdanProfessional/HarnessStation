import { beforeEach, describe, expect, it } from "vitest";
import {
  capOutput,
  MAX_ENTRIES,
  MAX_INLINE,
  PREVIEW,
  readStash,
  resetStashes,
  stash,
  stashCount,
} from "../src/lib/toolOutputStore";

beforeEach(() => resetStashes());

describe("capping a tool result", () => {
  it("leaves output that fits completely alone", () => {
    // The overwhelming majority of tool calls are small; they must not pay for
    // this, and nothing should be stored for them.
    const small = "x".repeat(MAX_INLINE);
    expect(capOutput(small, "run_terminal")).toBe(small);
    expect(stashCount()).toBe(0);
  });

  it("returns a preview and a handle when output is too long", () => {
    const out = capOutput("y".repeat(50_000), "run_terminal");
    expect(out.startsWith("y".repeat(PREVIEW))).toBe(true);
    expect(out).toMatch(/read_tool_output\(\{ id: "out_1", offset: 8000 \}\)/);
    expect(out).toContain("of 50000");
  });

  it("keeps the whole output, not just the preview", () => {
    // The entire point: before this, everything past the cut was destroyed.
    const text = "z".repeat(50_000);
    capOutput(text, "run_terminal");
    const page = readStash("out_1", 0, 50_000)!;
    expect(page.text).toBe(text);
    expect(page.length).toBe(50_000);
  });
});

describe("reading a stash back", () => {
  it("pages from an offset and reports the next one", () => {
    stash("abcdefghij", "t");
    const first = readStash("out_1", 0, 4)!;
    expect(first.text).toBe("abcd");
    expect(first.next).toBe(4);
    const second = readStash("out_1", first.next!, 4)!;
    expect(second.text).toBe("efgh");
    expect(second.next).toBe(8);
  });

  it("reports null for next once the end is reached", () => {
    stash("abcdefghij", "t");
    expect(readStash("out_1", 8, 100)!.next).toBeNull();
  });

  it("reassembles the original across successive reads", () => {
    const text = Array.from({ length: 5000 }, (_, i) => String(i % 10)).join("");
    stash(text, "t");
    let out = "";
    let at: number | null = 0;
    while (at !== null) {
      const page = readStash("out_1", at, 512)!;
      out += page.text;
      at = page.next;
    }
    expect(out).toBe(text);
  });

  it("returns null for an unknown id rather than throwing", () => {
    // The model will get this wrong sometimes; it needs an answer it can act
    // on, not an exception that ends the turn.
    expect(readStash("out_99")).toBeNull();
    expect(readStash("")).toBeNull();
  });

  it("clamps a negative offset and a zero limit instead of returning nothing", () => {
    stash("abcdef", "t");
    expect(readStash("out_1", -10, 3)!.text).toBe("abc");
    expect(readStash("out_1", 0, 0)!.text).toHaveLength(1);
  });

  it("handles an offset past the end", () => {
    stash("abc", "t");
    const page = readStash("out_1", 100)!;
    expect(page.text).toBe("");
    expect(page.next).toBeNull();
  });
});

describe("not growing without limit", () => {
  it("drops the oldest stash once the cap is reached", () => {
    // This lives in memory for the process lifetime, so it needs a ceiling.
    for (let i = 0; i < MAX_ENTRIES + 5; i++) stash(`entry ${i}`, "t");
    expect(stashCount()).toBe(MAX_ENTRIES);
    expect(readStash("out_1")).toBeNull(); // evicted
    expect(readStash(`out_${MAX_ENTRIES + 5}`)).not.toBeNull(); // newest kept
  });

  it("evicts by total size as well as by count", () => {
    // A handful of very large outputs can breach the memory budget long before
    // the entry count does.
    stash("a".repeat(3_000_000), "t");
    stash("b".repeat(3_000_000), "t");
    expect(stashCount()).toBe(1);
    expect(readStash("out_2")).not.toBeNull();
  });

  it("gives every stash a distinct id", () => {
    const ids = new Set(Array.from({ length: 10 }, () => stash("x", "t")));
    expect(ids.size).toBe(10);
  });
});
