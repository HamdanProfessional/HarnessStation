import { describe, expect, it, vi } from "vitest";
import type { Message } from "../src/lib/types";

// voice.ts pulls in the whole runtime at import time; none of it is exercised by
// the pure helpers under test here.
vi.mock("../src/lib/audio", () => ({ startRecording: vi.fn() }));
vi.mock("../src/lib/whisper", () => ({
  ensureWhisper: vi.fn(),
  transcribeFast: vi.fn(),
  startSttServer: vi.fn(),
  stopSttServer: vi.fn(),
  DEFAULT_STT: "base",
  DEFAULT_STT_LANG: "auto",
  sttLanguageName: () => "",
}));
vi.mock("../src/lib/providers", () => ({ streamChat: vi.fn() }));
vi.mock("../src/lib/tts", () => ({
  speakQueued: vi.fn(),
  stopSpeaking: vi.fn(),
  whenSpoken: vi.fn(),
  speakableText: (s: string) => s,
}));
vi.mock("../src/lib/memory", () => ({
  recall: vi.fn(),
  recallBlock: vi.fn(),
  shouldExtract: vi.fn(),
  markExtracted: vi.fn(),
  extractAndStore: vi.fn(),
  GLOBAL_MEMORY: "__global__",
}));
vi.mock("../src/lib/rag", () => ({ retrieveMultiContext: vi.fn() }));
vi.mock("../src/lib/skills", () => ({ skillIndexPrompt: () => "", listSkills: vi.fn() }));
vi.mock("../src/lib/budget", () => ({
  capExceeded: () => null,
  recordUsage: vi.fn(),
  syncTray: vi.fn(),
}));

const { conversationWindow, looksComplete } = await import("../src/lib/voice");

const m = (role: Message["role"], content: string, extra: Partial<Message> = {}): Message => ({
  role,
  content,
  ...extra,
});

describe("looksComplete", () => {
  it("treats questions and exclamations as finished", () => {
    expect(looksComplete("what time is it?")).toBe(true);
    expect(looksComplete("stop that!")).toBe(true);
  });

  it("treats a trailing comma or dash as trailing off", () => {
    expect(looksComplete("I want you to,")).toBe(false);
    expect(looksComplete("the thing is —")).toBe(false);
  });

  it("spots a sentence ending on a dangling word", () => {
    expect(looksComplete("hi, I want you to")).toBe(false);
    expect(looksComplete("open the")).toBe(false);
    expect(looksComplete("send it and")).toBe(false);
    expect(looksComplete("um")).toBe(false);
  });

  it("accepts a complete sentence", () => {
    expect(looksComplete("open the settings page")).toBe(true);
    expect(looksComplete("that is all for now")).toBe(true);
  });

  it("errs towards waiting on verbs that often continue", () => {
    // Deliberate bias: a wrong "incomplete" costs a short pause that resolves
    // itself, a wrong "complete" cuts the speaker off mid-sentence. So endings
    // like "needed" and "done" are held even though they can finish a sentence.
    expect(looksComplete("that's everything I needed")).toBe(false);
    expect(looksComplete("I think we're done")).toBe(false);
  });

  it("accepts standalone one-word replies but not arbitrary single words", () => {
    expect(looksComplete("yes")).toBe(true);
    expect(looksComplete("stop")).toBe(true);
    expect(looksComplete("banana")).toBe(false);
  });

  it("treats empty input as nothing to wait for", () => {
    expect(looksComplete("")).toBe(true);
    expect(looksComplete("   ")).toBe(true);
  });

  it("ignores punctuation when finding the last word", () => {
    expect(looksComplete("I need you to...")).toBe(false);
  });
});

describe("conversationWindow", () => {
  it("returns everything when the history is short", () => {
    const h = [m("user", "a"), m("assistant", "b")];
    expect(conversationWindow(h, 16)).toEqual(h);
  });

  it("never starts on a tool result orphaned from its tool_calls", () => {
    // Regression: a plain slice(-n) could cut between the assistant message
    // carrying tool_calls and the tool messages answering it, which strict
    // OpenAI-compatible endpoints reject outright.
    const h = [
      m("user", "old"),
      m("assistant", "", { toolCalls: [{ id: "c1", name: "t", arguments: "{}" }] }),
      m("tool", "result", { toolCallId: "c1" }),
      m("assistant", "done"),
      m("user", "next"),
      m("assistant", "reply"),
    ];

    const out = conversationWindow(h, 4);

    expect(out[0].role).toBe("user");
    expect(out.map((x) => x.content)).toEqual(["next", "reply"]);
  });

  it("keeps a tool sequence intact when the window starts before it", () => {
    const h = [
      m("user", "go"),
      m("assistant", "", { toolCalls: [{ id: "c1", name: "t", arguments: "{}" }] }),
      m("tool", "result", { toolCallId: "c1" }),
      m("assistant", "done"),
    ];

    const out = conversationWindow(h, 4);

    expect(out).toHaveLength(4);
    expect(out[1].toolCalls).toBeTruthy();
    expect(out[2].role).toBe("tool");
  });

  it("falls back to the last user turn when the tail is all tool traffic", () => {
    const h = [
      m("user", "go"),
      m("assistant", "", { toolCalls: [{ id: "c1", name: "t", arguments: "{}" }] }),
      m("tool", "r1", { toolCallId: "c1" }),
      m("tool", "r2", { toolCallId: "c1" }),
      m("tool", "r3", { toolCallId: "c1" }),
    ];

    const out = conversationWindow(h, 2);

    expect(out[0].role).toBe("user");
    expect(out).toHaveLength(5);
  });

  it("returns nothing rather than an invalid window when there is no user turn", () => {
    const h = [m("assistant", "a"), m("tool", "b", { toolCallId: "c" }), m("assistant", "c")];
    expect(conversationWindow(h, 2)).toEqual([]);
  });

  it("does not mutate the history it is given", () => {
    const h = [m("user", "a"), m("assistant", "b"), m("user", "c")];
    const copy = JSON.parse(JSON.stringify(h));
    conversationWindow(h, 2);
    expect(h).toEqual(copy);
  });
});
