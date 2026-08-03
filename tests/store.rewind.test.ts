import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, Message } from "../src/lib/types";

/**
 * Rewind: delete a message and everything after it, in place. The guarantees
 * that matter are that it snapshots first (so it's reversible), that it persists
 * the truncated state — including an empty transcript when you rewind to the very
 * start, which the coalescing save queue deliberately refuses — and that it
 * never runs mid-stream.
 */

const snapshotChat = vi.fn(async () => {});
const saveChat = vi.fn(async () => {});
const cancelChatSave = vi.fn();
const queueSaveChat = vi.fn();

vi.mock("../src/lib/providers", () => ({
  streamChat: vi.fn(async () => ({ toolCalls: null })),
  chatOnce: vi.fn(async () => "Title"),
  listModels: vi.fn(async () => []),
}));

vi.mock("../src/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/storage")>()),
  loadChatBody: vi.fn(async () => null),
  saveChat: (...a: unknown[]) => saveChat(...(a as [])),
  snapshotChat: (...a: unknown[]) => snapshotChat(...(a as [])),
  cancelChatSave: (...a: unknown[]) => cancelChatSave(...(a as [])),
  queueSaveChat: (...a: unknown[]) => queueSaveChat(...(a as [])),
  flushChatSaves: vi.fn(async () => {}),
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

const transcript: Message[] = [
  { role: "user", content: "q1" },
  { role: "assistant", content: "a1" },
  { role: "user", content: "q2" },
  { role: "assistant", content: "a2 (bad)" },
];

function chatWith(messages: Message[]): Chat {
  return {
    id: "c1",
    title: "Chat",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    providerId: "p1",
    model: "m1",
    systemPrompt: "",
    styleId: "normal",
    temperature: 0.7,
    maxTokens: 0,
    messages,
  };
}

const messages = () => useStore.getState().chats[0].messages;

beforeEach(() => {
  snapshotChat.mockClear();
  saveChat.mockClear();
  cancelChatSave.mockClear();
  useStore.setState({
    chats: [chatWith(structuredClone(transcript))],
    currentId: "c1",
    hydratedIds: { c1: true },
    streaming: false,
  });
});

describe("rewindTo", () => {
  it("deletes the chosen message and everything after it", async () => {
    // Rewind at the last assistant message → keep q1, a1, q2.
    await useStore.getState().rewindTo(3);
    expect(messages().map((m) => m.content)).toEqual(["q1", "a1", "q2"]);
  });

  it("snapshots before deleting, so the rewind can be undone", async () => {
    await useStore.getState().rewindTo(2);
    expect(snapshotChat).toHaveBeenCalledTimes(1);
    // The snapshot must capture the FULL transcript, taken before truncation.
    const snapped = snapshotChat.mock.calls[0][0] as Chat;
    expect(snapped.messages).toHaveLength(4);
  });

  it("persists the truncated state directly", async () => {
    await useStore.getState().rewindTo(2);
    const saved = saveChat.mock.calls.at(-1)![0] as Chat;
    expect(saved.messages.map((m) => m.content)).toEqual(["q1", "a1"]);
  });

  it("rewinding to the start empties the chat and still persists it", async () => {
    // The save queue refuses empty transcripts; rewind must force the write so a
    // reload doesn't resurrect the deleted messages.
    await useStore.getState().rewindTo(0);
    expect(messages()).toEqual([]);
    expect(saveChat).toHaveBeenCalled();
    const saved = saveChat.mock.calls.at(-1)![0] as Chat;
    expect(saved.messages).toEqual([]);
  });

  it("does nothing when the index is at or past the end", async () => {
    await useStore.getState().rewindTo(4);
    expect(messages()).toHaveLength(4);
    expect(snapshotChat).not.toHaveBeenCalled();
    expect(saveChat).not.toHaveBeenCalled();
  });

  it("refuses to run while a reply is streaming", async () => {
    useStore.setState({ streaming: true });
    await useStore.getState().rewindTo(2);
    expect(messages()).toHaveLength(4);
    expect(snapshotChat).not.toHaveBeenCalled();
  });
});
