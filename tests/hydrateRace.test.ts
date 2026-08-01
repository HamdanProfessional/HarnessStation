import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Hydration must never overwrite live messages with the last-saved copy.
 *
 * Chat saves are coalesced at 400 ms, so during a turn the on-disk body always
 * lags the in-memory one. Anything that hydrated the chat mid-turn — enabling a
 * tool, the sidebar search, moving a chat out of a project — replaced the live
 * array with that stale copy, and the tool result the user had just watched
 * arrive disappeared a second later.
 */

const savedBody = {
  id: "c1",
  title: "Chat",
  messages: [
    { role: "user", content: "open a tab" },
    // The assistant turn as it looked when it was last written to disk: the call
    // is recorded, its result hadn't happened yet.
    { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "open_new_tab" }] },
  ],
};

vi.mock("../src/lib/storage", () => ({
  DEFAULT_SETTINGS: { providers: [], globalInstructions: "", theme: "dark" },
  loadChatBody: vi.fn(async () => structuredClone(savedBody)),
  loadChatIndex: vi.fn(async () => []),
  loadSettings: vi.fn(async () => ({ providers: [], globalInstructions: "", theme: "dark" })),
  listProjects: vi.fn(async () => []),
  listEvals: vi.fn(async () => []),
  listKnowledgeBases: vi.fn(async () => []),
  queueSaveChat: vi.fn(),
  flushChatSaves: vi.fn(async () => {}),
  cancelChatSave: vi.fn(),
  saveChat: vi.fn(async () => {}),
  saveSettings: vi.fn(async () => {}),
}));

const { useStore } = await import("../src/lib/store");

/** The same chat a moment later: the tool has run and its result is on screen. */
const liveMessages = [
  ...savedBody.messages,
  { role: "tool", content: "Opened tab 3", toolCallId: "t1" },
];

beforeEach(() => {
  useStore.setState({
    chats: [{ ...savedBody, messages: structuredClone(liveMessages) } as never],
    currentId: "c1",
    hydratedIds: {},
  });
});

const messages = () => useStore.getState().chats[0].messages;

describe("hydrating a chat that already has messages", () => {
  it("keeps the tool result that hasn't reached disk yet", async () => {
    await useStore.getState().hydrateChat("c1");

    expect(messages()).toHaveLength(3);
    expect(messages()[2]).toMatchObject({ role: "tool", content: "Opened tab 3" });
  });

  it("doesn't even read the body — there's nothing on disk worth having", async () => {
    const storage = await import("../src/lib/storage");
    await useStore.getState().hydrateChat("c1");
    expect(storage.loadChatBody).not.toHaveBeenCalled();
  });

  it("marks it hydrated, so nothing tries again later in the turn", async () => {
    await useStore.getState().hydrateChat("c1");
    expect(useStore.getState().hydratedIds.c1).toBe(true);
  });

  it("still loads a chat that really is just an index stub", async () => {
    useStore.setState({
      chats: [{ id: "c1", title: "Chat", messages: [] } as never],
      hydratedIds: {},
    });
    await useStore.getState().hydrateChat("c1");
    expect(messages()).toHaveLength(2);
  });
});
