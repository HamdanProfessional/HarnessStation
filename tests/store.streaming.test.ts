import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, Provider } from "../src/lib/types";

/**
 * Regression cover for the streaming write path.
 *
 * Every write used to target `get().currentId` rather than the chat that was
 * actually being streamed, so switching chats mid-reply appended the remaining
 * tokens (and the tool messages) to whichever conversation was on screen.
 */

const streamChat = vi.fn();
const chatOnce = vi.fn(async () => "A Generated Title");

vi.mock("../src/lib/providers", () => ({
  streamChat: (...a: unknown[]) => streamChat(...a),
  chatOnce: (...a: unknown[]) => chatOnce(...(a as [])),
  listModels: vi.fn(async () => []),
}));

vi.mock("../src/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/storage")>()),
  saveChat: vi.fn(async () => {}),
  saveSettings: vi.fn(async () => {}),
  deleteChat: vi.fn(async () => {}),
}));

vi.mock("../src/lib/budget", () => ({
  capExceeded: () => null,
  recordUsage: vi.fn(),
  syncTray: vi.fn(async () => {}),
  totals: () => ({ todayUsd: 0, monthUsd: 0, allUsd: 0, todayTokens: 0, unpricedCalls: 0, byModel: [] }),
  onSpendChange: () => () => {},
}));

vi.mock("../src/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { useStore } = await import("../src/lib/store");

const provider: Provider = {
  id: "p1",
  name: "P",
  kind: "openai-compatible",
  baseUrl: "http://x/v1",
  apiKey: "",
  models: ["m1"],
};

const chat = (id: string, title: string): Chat => ({
  id,
  title,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  providerId: "p1",
  model: "m1",
  systemPrompt: "",
  styleId: "normal",
  temperature: 0.7,
  maxTokens: 0,
  messages: [],
});

const find = (id: string) => useStore.getState().chats.find((c) => c.id === id)!;

beforeEach(() => {
  streamChat.mockReset();
  chatOnce.mockClear();
  useStore.setState({
    ready: true,
    settings: {
      ...useStore.getState().settings,
      providers: [provider],
      passiveMemory: false,
      autoCompact: false,
      autoTitle: false,
    },
    chats: [chat("A", "Chat A"), chat("B", "Chat B")],
    currentId: "A",
    streaming: false,
    error: null,
  });
});

describe("streaming writes stay on the originating chat", () => {
  it("keeps appending to chat A after the user switches to chat B", async () => {
    streamChat.mockImplementation(async (p: { onDelta: (t: string) => void }) => {
      p.onDelta("first ");
      useStore.getState().selectChat("B"); // user clicks another chat mid-reply
      p.onDelta("second ");
      p.onDelta("third");
      return { toolCalls: null };
    });

    await useStore.getState().sendMessage("hello");

    expect(find("A").messages.map((m) => m.content)).toEqual(["hello", "first second third"]);
    expect(find("B").messages).toEqual([]);
  });

  it("routes reasoning deltas to the originating chat too", async () => {
    streamChat.mockImplementation(async (p: { onDelta: (t: string) => void; onReasoning?: (t: string) => void }) => {
      useStore.getState().selectChat("B");
      p.onReasoning?.("thinking...");
      p.onDelta("answer");
      return { toolCalls: null };
    });

    await useStore.getState().sendMessage("hi");

    const last = find("A").messages[1];
    expect(last.content).toBe("answer");
    expect(last.reasoning).toBe("thinking...");
    expect(find("B").messages).toEqual([]);
  });

  it("records token usage on the originating chat's message", async () => {
    streamChat.mockImplementation(async (p: { onDelta: (t: string) => void }) => {
      p.onDelta("ok");
      useStore.getState().selectChat("B");
      return { toolCalls: null, usage: { promptTokens: 11, completionTokens: 22 } };
    });

    await useStore.getState().sendMessage("hi");

    expect(find("A").messages[1]).toMatchObject({ promptTokens: 11, completionTokens: 22 });
  });

  it("drops the empty placeholder on the originating chat when the request fails", async () => {
    streamChat.mockImplementation(async () => {
      useStore.getState().selectChat("B");
      throw new Error("HTTP 401: bad key");
    });

    await useStore.getState().sendMessage("hi");

    expect(find("A").messages.map((m) => m.role)).toEqual(["user"]);
    expect(find("B").messages).toEqual([]);
    expect(useStore.getState().error).toContain("401");
  });

  it("survives the chat being deleted mid-stream", async () => {
    streamChat.mockImplementation(async (p: { onDelta: (t: string) => void }) => {
      p.onDelta("partial");
      await useStore.getState().deleteChat("A");
      p.onDelta(" more");
      return { toolCalls: null };
    });

    await expect(useStore.getState().sendMessage("hi")).resolves.toBeUndefined();
    expect(useStore.getState().chats.some((c) => c.id === "A")).toBe(false);
    expect(find("B").messages).toEqual([]);
  });

  it("refuses to start a second send while one is streaming", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    streamChat.mockImplementation(async (p: { onDelta: (t: string) => void }) => {
      p.onDelta("one");
      await gate;
      return { toolCalls: null };
    });

    const first = useStore.getState().sendMessage("first");
    await Promise.resolve();
    await useStore.getState().sendMessage("second"); // must be ignored
    release();
    await first;

    expect(find("A").messages.map((m) => m.content)).toEqual(["first", "one"]);
  });
});

describe("auto-title", () => {
  const settle = () => new Promise((r) => setTimeout(r, 0));

  const reply = (text: string) =>
    streamChat.mockImplementation(async (p: { onDelta: (t: string) => void }) => {
      p.onDelta(text);
      return { toolCalls: null };
    });

  it("names the chat from the first exchange", async () => {
    useStore.setState({ settings: { ...useStore.getState().settings, autoTitle: true } });
    reply("hello there");

    await useStore.getState().sendMessage("what is a harness?");
    await settle();

    expect(chatOnce).toHaveBeenCalledTimes(1);
    expect(find("A").title).toBe("A Generated Title");
  });

  it("titles the originating chat even after the user switches away", async () => {
    useStore.setState({ settings: { ...useStore.getState().settings, autoTitle: true } });
    streamChat.mockImplementation(async (p: { onDelta: (t: string) => void }) => {
      p.onDelta("hi");
      useStore.getState().selectChat("B");
      return { toolCalls: null };
    });

    await useStore.getState().sendMessage("question");
    await settle();

    expect(find("A").title).toBe("A Generated Title");
    expect(find("B").title).toBe("Chat B");
  });

  it("does nothing when the setting is off", async () => {
    useStore.setState({ settings: { ...useStore.getState().settings, autoTitle: false } });
    reply("hello");

    await useStore.getState().sendMessage("hi");
    await settle();

    expect(chatOnce).not.toHaveBeenCalled();
  });

  it("only runs on the first exchange, not on later turns", async () => {
    useStore.setState({ settings: { ...useStore.getState().settings, autoTitle: true } });
    reply("first reply");
    await useStore.getState().sendMessage("one");
    await settle();
    expect(chatOnce).toHaveBeenCalledTimes(1);

    reply("second reply");
    await useStore.getState().sendMessage("two");
    await settle();
    expect(chatOnce).toHaveBeenCalledTimes(1);
  });

  it("keeps the fallback title when the title call fails", async () => {
    useStore.setState({ settings: { ...useStore.getState().settings, autoTitle: true } });
    chatOnce.mockRejectedValueOnce(new Error("offline"));
    reply("hello");

    await useStore.getState().sendMessage("a question about harnesses");
    await settle();

    expect(find("A").title).toBe("a question about harnesses");
  });
});
