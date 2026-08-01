import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, Message } from "../src/lib/types";

/**
 * Lazy transcripts: startup reads only the metadata index, so a chat's messages
 * are empty until it's opened. The invariant that matters is that an unhydrated
 * chat is never written back — that would replace its file with an empty one.
 */

const bodies = new Map<string, Message[]>();
const loadChatBody = vi.fn(async (id: string) => {
  const messages = bodies.get(id);
  return messages ? ({ ...stub(id), messages } as Chat) : null;
});
const saveChat = vi.fn(async () => {});
const queueSaveChat = vi.fn();

vi.mock("../src/lib/providers", () => ({
  streamChat: vi.fn(async (p: { onDelta: (t: string) => void }) => {
    p.onDelta("reply");
    return { toolCalls: null };
  }),
  chatOnce: vi.fn(async () => "Title"),
  listModels: vi.fn(async () => []),
}));

vi.mock("../src/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/storage")>()),
  loadChatBody: (id: string) => loadChatBody(id),
  saveChat: (...a: unknown[]) => saveChat(...(a as [])),
  queueSaveChat: (...a: unknown[]) => queueSaveChat(...(a as [])),
  flushChatSaves: vi.fn(async () => {}),
  deleteChat: vi.fn(async () => {}),
  snapshotChat: vi.fn(async () => {}),
  exportChat: vi.fn(async () => "exported"),
}));

vi.mock("../src/lib/budget", () => ({
  capExceeded: () => null,
  recordUsage: vi.fn(),
  syncTray: vi.fn(async () => {}),
  totals: () => ({ todayUsd: 0, monthUsd: 0, allUsd: 0, todayTokens: 0, unpricedCalls: 0, byModel: [] }),
  onSpendChange: () => () => {},
}));

vi.mock("../src/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { useStore } = await import("../src/lib/store");

const isHydrated = (id: string) => !!useStore.getState().hydratedIds[id];

function stub(id: string): Chat {
  return {
    id,
    title: `Chat ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    providerId: "p1",
    model: "m1",
    systemPrompt: "",
    styleId: "normal",
    temperature: 0.7,
    maxTokens: 0,
    messages: [],
  };
}

const find = (id: string) => useStore.getState().chats.find((c) => c.id === id)!;

beforeEach(() => {
  loadChatBody.mockClear();
  saveChat.mockClear();
  queueSaveChat.mockClear();
  bodies.clear();
  bodies.set("A", [
    { role: "user", content: "old question" },
    { role: "assistant", content: "old answer" },
  ]);
  bodies.set("B", [{ role: "user", content: "beta transcript" }]);

  useStore.setState({
    ready: true,
    settings: {
      ...useStore.getState().settings,
      providers: [
        { id: "p1", name: "P", kind: "openai-compatible", baseUrl: "http://x/v1", apiKey: "", models: ["m1"] },
      ],
      passiveMemory: false,
      autoCompact: false,
      autoTitle: false,
    },
    chats: [stub("A"), stub("B")],
    messageCounts: { A: 2, B: 1 },
    hydratedIds: {},
    currentId: null,
    streaming: false,
    error: null,
    view: "chat",
    pendingVoiceChat: null,
    activeVoiceChat: null,
  });
});

describe("hydrateChat", () => {
  it("loads a transcript on demand and only once", async () => {
    expect(find("A").messages).toEqual([]);
    expect(isHydrated("A")).toBe(false);

    await useStore.getState().hydrateChat("A");

    expect(find("A").messages.map((m) => m.content)).toEqual(["old question", "old answer"]);
    expect(isHydrated("A")).toBe(true);

    await useStore.getState().hydrateChat("A");
    expect(loadChatBody).toHaveBeenCalledTimes(1);
  });

  it("keeps in-memory metadata edits over what's on disk", async () => {
    useStore.setState({ chats: [{ ...stub("A"), title: "Renamed in memory" }, stub("B")] });

    await useStore.getState().hydrateChat("A");

    expect(find("A").title).toBe("Renamed in memory");
    expect(find("A").messages).toHaveLength(2);
  });

  it("does not retry a chat whose file is missing", async () => {
    bodies.delete("A");

    await useStore.getState().hydrateChat("A");
    await useStore.getState().hydrateChat("A");

    expect(loadChatBody).toHaveBeenCalledTimes(1);
    expect(find("A").messages).toEqual([]);
  });

  it("selectChat pulls the transcript in", async () => {
    useStore.getState().selectChat("A");
    await vi.waitFor(() => expect(find("A").messages).toHaveLength(2));
  });
});

describe("never writes an unhydrated chat", () => {
  it("refuses to queue a save for a chat whose transcript is not loaded", () => {
    // Simulate a stray patch arriving before hydration.
    useStore.getState().updateChatById("A", { messages: [{ role: "user", content: "stray" }] });
    expect(queueSaveChat).not.toHaveBeenCalled();
  });

  it("queues saves normally once hydrated", async () => {
    await useStore.getState().hydrateChat("A");
    useStore.getState().updateChatById("A", { title: "New title" });
    expect(queueSaveChat).toHaveBeenCalledTimes(1);
  });

  it("renaming an unopened chat loads it first, so the file keeps its messages", async () => {
    await useStore.getState().renameChat("A", "Renamed");

    expect(loadChatBody).toHaveBeenCalledWith("A");
    expect(saveChat).toHaveBeenCalledTimes(1);
    const written = saveChat.mock.calls[0][0] as unknown as Chat;
    expect(written.title).toBe("Renamed");
    expect(written.messages).toHaveLength(2); // not truncated
  });

  it("pinning an unopened chat also preserves its messages", async () => {
    await useStore.getState().togglePin("A");
    const written = saveChat.mock.calls[0][0] as unknown as Chat;
    expect(written.pinned).toBe(true);
    expect(written.messages).toHaveLength(2);
  });

  it("duplicating an unopened chat copies the whole transcript", async () => {
    await useStore.getState().duplicateChat("A");
    const copy = useStore.getState().chats[0];
    expect(copy.title).toBe("Chat A (copy)");
    expect(copy.messages).toHaveLength(2);
  });

  it("exporting an unopened chat loads it first", async () => {
    await useStore.getState().exportChat("A", "md");
    expect(loadChatBody).toHaveBeenCalledWith("A");
  });
});

describe("sending into a chat that has not finished loading", () => {
  it("appends to the existing transcript rather than replacing it", async () => {
    useStore.getState().selectChat("A"); // hydration starts, not awaited
    await useStore.getState().sendMessage("new question");

    expect(find("A").messages.map((m) => m.content)).toEqual([
      "old question",
      "old answer",
      "new question",
      "reply",
    ]);
  });
});

describe("hydrateAllChats", () => {
  it("loads every outstanding transcript in one pass", async () => {
    await useStore.getState().hydrateAllChats();

    expect(find("A").messages).toHaveLength(2);
    expect(find("B").messages).toHaveLength(1);
    expect(loadChatBody).toHaveBeenCalledTimes(2);

    await useStore.getState().hydrateAllChats();
    expect(loadChatBody).toHaveBeenCalledTimes(2); // nothing left to do
  });
});

describe("voice calls route to the Voice view", () => {
  it("opens a spoken conversation as a call, not as a transcript", async () => {
    // Regression: clicking a saved voice chat opened it in the chat view, so you
    // could type into a conversation you had been having out loud.
    useStore.setState({ chats: [{ ...stub("V"), kind: "voice" }], hydratedIds: {} });

    useStore.getState().selectChat("V");

    const st = useStore.getState();
    expect(st.view).toBe("voice");
    expect(st.pendingVoiceChat).toBe("V");
    expect(st.currentId).toBe("V");
  });

  it("still opens a typed chat in the chat view", () => {
    useStore.getState().selectChat("A");
    const st = useStore.getState();
    expect(st.view).toBe("chat");
    expect(st.pendingVoiceChat).toBeNull();
  });

  it("newVoiceCall asks the Voice view for a fresh call", () => {
    useStore.getState().newVoiceCall();
    const st = useStore.getState();
    expect(st.view).toBe("voice");
    expect(st.pendingVoiceChat).toBe("new");
  });

  it("the request is one-shot, so remounting doesn't restart the call", () => {
    useStore.getState().newVoiceCall();
    useStore.getState().clearPendingVoiceChat();
    expect(useStore.getState().pendingVoiceChat).toBeNull();
  });

  it("tracks which call is on air so the sidebar can show it", () => {
    useStore.getState().setActiveVoiceChat("V");
    expect(useStore.getState().activeVoiceChat).toBe("V");
    useStore.getState().setActiveVoiceChat(null);
    expect(useStore.getState().activeVoiceChat).toBeNull();
  });

  it("newVoiceChat creates a chat marked as voice and ready to write to", () => {
    const id = useStore.getState().newVoiceChat();
    const chat = useStore.getState().chats.find((c) => c.id === id)!;
    expect(chat.kind).toBe("voice");
    expect(useStore.getState().hydratedIds[id]).toBe(true);
  });
});
