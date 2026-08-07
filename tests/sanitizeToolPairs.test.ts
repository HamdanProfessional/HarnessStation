import { describe, expect, it } from "vitest";
import { sanitizeToolPairs } from "../src/lib/providers/index";
import { estimateContextTokens } from "../src/lib/tokens";
import type { Message } from "../src/lib/types";

/**
 * Deleting individual items can leave a tool call without its response, or a
 * response without its call. The OpenAI API rejects either. sanitizeToolPairs
 * repairs that at send time so a user can delete freely; the invariant is that
 * whatever it returns, every tool_call has a matching tool message and vice
 * versa.
 */

const asst = (content: string, calls?: { id: string; name: string }[]): Message => ({
  role: "assistant",
  content,
  toolCalls: calls?.map((c) => ({ id: c.id, name: c.name, arguments: "{}" })),
});
const toolMsg = (id: string, content = "result"): Message => ({ role: "tool", content, toolCallId: id });
const user = (content: string): Message => ({ role: "user", content });

/** Every tool message references a live call, and every call has a response. */
function isValid(msgs: Message[]): boolean {
  const calls = new Set<string>();
  const responses = new Set<string>();
  for (const m of msgs) {
    if (m.role === "assistant") for (const c of m.toolCalls ?? []) calls.add(c.id);
    if (m.role === "tool" && m.toolCallId) responses.add(m.toolCallId);
  }
  for (const id of responses) if (!calls.has(id)) return false;
  for (const id of calls) if (!responses.has(id)) return false;
  return true;
}

describe("sanitizeToolPairs", () => {
  it("leaves a complete conversation untouched", () => {
    const msgs = [user("q"), asst("", [{ id: "t1", name: "read" }]), toolMsg("t1"), asst("done")];
    expect(sanitizeToolPairs(msgs)).toEqual(msgs);
    expect(isValid(sanitizeToolPairs(msgs))).toBe(true);
  });

  it("drops a tool response whose call was deleted", () => {
    // user deleted the tool call, leaving an orphan response
    const msgs = [user("q"), toolMsg("t1"), asst("done")];
    const out = sanitizeToolPairs(msgs);
    expect(out.some((m) => m.role === "tool")).toBe(false);
    expect(isValid(out)).toBe(true);
  });

  it("drops a tool call whose response was deleted, keeping surrounding text", () => {
    const msgs = [user("q"), asst("thinking", [{ id: "t1", name: "read" }]), asst("done")];
    const out = sanitizeToolPairs(msgs);
    const a = out.find((m) => m.content === "thinking")!;
    expect(a.toolCalls).toBeUndefined(); // the orphan call is gone
    expect(a.content).toBe("thinking"); // but its text stays
    expect(isValid(out)).toBe(true);
  });

  it("keeps only the paired calls when a message has several", () => {
    const msgs = [
      user("q"),
      asst("", [
        { id: "t1", name: "read" },
        { id: "t2", name: "write" },
      ]),
      toolMsg("t1"), // t2's response was deleted
      asst("done"),
    ];
    const out = sanitizeToolPairs(msgs);
    const a = out.find((m) => m.role === "assistant" && m.toolCalls)!;
    expect(a.toolCalls!.map((c) => c.id)).toEqual(["t1"]);
    expect(isValid(out)).toBe(true);
  });

  it("drops an assistant turn that was only orphaned calls", () => {
    // an assistant message with no text and all calls orphaned carries nothing
    const msgs = [user("q"), asst("", [{ id: "t1", name: "read" }]), asst("answer")];
    const out = sanitizeToolPairs(msgs);
    expect(out.map((m) => m.content)).toEqual(["q", "answer"]);
  });

  it("never invents pairing — output is always valid for any deletion combo", () => {
    // A messy transcript with orphans of both kinds.
    const msgs = [
      user("a"),
      asst("", [{ id: "x" }].map((c) => ({ ...c, name: "n" }))),
      toolMsg("y"), // orphan response
      asst("", [{ id: "z", name: "n" }]), // orphan call
      toolMsg("z"),
      asst("z paired"),
    ];
    expect(isValid(sanitizeToolPairs(msgs))).toBe(true);
  });
});

describe("estimateContextTokens", () => {
  it("counts what's sent (content) but not reasoning, which is display-only", () => {
    const full: Message[] = [
      { role: "user", content: "x".repeat(40) },
      { role: "assistant", content: "y".repeat(40), reasoning: "z".repeat(40) },
    ];
    // Reasoning is never sent to the model, so removing it frees nothing.
    const noReasoning: Message[] = [full[0], { ...full[1], reasoning: undefined }];
    expect(estimateContextTokens(noReasoning)).toBe(estimateContextTokens(full));

    // Content IS sent, so removing it reduces the estimate (~4 chars/token: 40 ≈ 10).
    const noContent: Message[] = [full[0], { ...full[1], content: "" }];
    expect(estimateContextTokens(full) - estimateContextTokens(noContent)).toBe(10);
  });
});
