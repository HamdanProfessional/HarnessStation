import { describe, expect, it } from "vitest";
import { withCacheBreakpoint, type AnthropicMessage } from "../src/lib/providers/cache";

const u = (content: AnthropicMessage["content"]): AnthropicMessage => ({ role: "user", content });
const a = (content: AnthropicMessage["content"]): AnthropicMessage => ({ role: "assistant", content });

/** The cache_control marker on a message, or undefined. */
const markerOn = (m: AnthropicMessage) =>
  typeof m.content === "string"
    ? undefined
    : m.content.find((part) => "cache_control" in part)?.cache_control;

describe("where the breakpoint goes", () => {
  it("marks the last user message", () => {
    const out = withCacheBreakpoint([u("first"), a("reply"), u("second")]);
    expect(markerOn(out[2])).toEqual({ type: "ephemeral" });
  });

  it("marks only one message, not every user turn", () => {
    // Anthropic allows four breakpoints in total; spending them on every turn
    // of a long chat would exhaust them and cache the wrong prefixes.
    const out = withCacheBreakpoint([u("a"), a("b"), u("c"), a("d"), u("e")]);
    expect(out.filter((m) => markerOn(m)).length).toBe(1);
    expect(markerOn(out[4])).toBeTruthy();
  });

  it("ignores a trailing assistant message and marks the user turn before it", () => {
    const out = withCacheBreakpoint([u("q"), a("partial")]);
    expect(markerOn(out[0])).toBeTruthy();
    expect(markerOn(out[1])).toBeUndefined();
  });

  it("puts the marker on the last content part, not the first", () => {
    // It means "cache everything up to and including this part". On an earlier
    // part, the rest of the message falls outside the cached prefix.
    const out = withCacheBreakpoint([
      u([
        { type: "text", text: "look at this" },
        { type: "image", source: { type: "base64" } },
      ]),
    ]);
    const parts = out[0].content as Record<string, unknown>[];
    expect(parts[0]).not.toHaveProperty("cache_control");
    expect(parts[1]).toHaveProperty("cache_control");
  });
});

describe("shapes it has to survive", () => {
  it("promotes string content to a text part so the marker has somewhere to go", () => {
    const out = withCacheBreakpoint([u("plain text")]);
    expect(out[0].content).toEqual([
      { type: "text", text: "plain text", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("returns the list untouched when there is no user message at all", () => {
    const input = [a("system-initiated")];
    expect(withCacheBreakpoint(input)).toBe(input);
  });

  it("handles an empty list", () => {
    expect(withCacheBreakpoint([])).toEqual([]);
  });

  it("leaves a user message with no content parts alone rather than inventing one", () => {
    const out = withCacheBreakpoint([u([])]);
    expect(out[0].content).toEqual([]);
  });

  it("does not mutate the caller's messages", () => {
    // The same array is reused across failover attempts; mutating it would
    // stack a second marker on every retry.
    const original = u([{ type: "text", text: "hi" }]);
    const before = JSON.stringify(original);
    withCacheBreakpoint([original]);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("is idempotent — running twice does not double the marker", () => {
    const once = withCacheBreakpoint([u("hello")]);
    const twice = withCacheBreakpoint(once);
    const parts = twice[0].content as Record<string, unknown>[];
    expect(parts).toHaveLength(1);
    expect(parts[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("preserves the content of every other message exactly", () => {
    const input = [u("one"), a("two"), u("three")];
    const out = withCacheBreakpoint(input);
    expect(out[0].content).toBe("one");
    expect(out[1].content).toBe("two");
  });
});
