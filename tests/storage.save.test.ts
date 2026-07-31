import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat } from "../src/lib/types";

const writeTextFile = vi.fn(async () => {});
const remove = vi.fn(async () => {});

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { Home: 1 },
  exists: vi.fn(async () => true),
  mkdir: vi.fn(async () => {}),
  readDir: vi.fn(async () => []),
  readTextFile: vi.fn(async () => "{}"),
  remove: (...a: unknown[]) => remove(...(a as [])),
  stat: vi.fn(async () => ({})),
  writeTextFile: (...a: unknown[]) => writeTextFile(...(a as [])),
}));

const { cancelChatSave, chatMeta, deleteChat, flushChatSaves, loadChatIndex, loadChats, queueSaveChat, saveChat } =
  await import("../src/lib/storage");
const fs = await import("@tauri-apps/plugin-fs");
const readDir = fs.readDir as unknown as ReturnType<typeof vi.fn>;
const readTextFile = fs.readTextFile as unknown as ReturnType<typeof vi.fn>;

const chat = (id: string, content: string): Chat => ({
  id,
  title: "t",
  createdAt: "",
  updatedAt: "",
  providerId: "p",
  model: "m",
  systemPrompt: "",
  styleId: "normal",
  temperature: 0.7,
  maxTokens: 0,
  messages: [{ role: "assistant", content }],
});

/** Writes to conversation files, ignoring the metadata index maintained alongside them. */
const chatWrites = () =>
  writeTextFile.mock.calls.filter((c) => !String(c[0]).endsWith("/index.json"));
const written = () => chatWrites().map((c) => JSON.parse(c[1] as unknown as string) as Chat);

beforeEach(() => {
  vi.useFakeTimers();
  writeTextFile.mockClear();
  remove.mockClear();
});

afterEach(async () => {
  vi.useRealTimers();
});

describe("queueSaveChat", () => {
  it("collapses a burst of token-by-token saves into one write", async () => {
    for (const t of ["a", "ab", "abc", "abcd"]) queueSaveChat(chat("c1", t));
    expect(writeTextFile).not.toHaveBeenCalled(); // nothing written synchronously

    await vi.advanceTimersByTimeAsync(500);

    expect(chatWrites()).toHaveLength(1);
    expect(written()[0].messages[0].content).toBe("abcd"); // newest state wins
  });

  it("keeps separate chats on separate files", async () => {
    queueSaveChat(chat("c1", "one"));
    queueSaveChat(chat("c2", "two"));
    await vi.advanceTimersByTimeAsync(500);

    const paths = chatWrites().map((c) => c[0]);
    expect(paths).toContain(".harnessx/conversations/c1.json");
    expect(paths).toContain(".harnessx/conversations/c2.json");
  });

  it("schedules again after a flush, so later edits still persist", async () => {
    queueSaveChat(chat("c1", "first"));
    await vi.advanceTimersByTimeAsync(500);
    queueSaveChat(chat("c1", "second"));
    await vi.advanceTimersByTimeAsync(500);

    expect(chatWrites()).toHaveLength(2);
    expect(written()[1].messages[0].content).toBe("second");
  });
});

describe("flushChatSaves", () => {
  it("writes pending state immediately without waiting for the timer", async () => {
    queueSaveChat(chat("c1", "urgent"));
    await flushChatSaves();

    expect(chatWrites()).toHaveLength(1);
    expect(written()[0].messages[0].content).toBe("urgent");

    // the cancelled timer must not produce a second write
    await vi.advanceTimersByTimeAsync(1000);
    expect(chatWrites()).toHaveLength(1);
  });

  it("is a no-op when nothing is queued", async () => {
    await flushChatSaves();
    expect(chatWrites()).toHaveLength(0);
  });

  it("does not reject when a write fails", async () => {
    writeTextFile.mockRejectedValueOnce(new Error("disk full"));
    queueSaveChat(chat("c1", "x"));
    await expect(flushChatSaves()).resolves.toBeUndefined();
  });
});

describe("deleteChat", () => {
  it("drops a queued write so it cannot resurrect the file", async () => {
    queueSaveChat(chat("c1", "doomed"));
    await deleteChat("c1");
    await vi.advanceTimersByTimeAsync(1000);

    expect(remove).toHaveBeenCalledWith(".harnessx/conversations/c1.json", expect.anything());
    expect(chatWrites()).toHaveLength(0);
  });

  it("leaves other chats' queued writes alone", async () => {
    queueSaveChat(chat("c1", "keep"));
    await deleteChat("c2");
    await vi.advanceTimersByTimeAsync(500);

    expect(chatWrites()).toHaveLength(1);
    expect(written()[0].id).toBe("c1");
  });
});

describe("loadChats", () => {
  it("skips non-JSON entries and corrupt files instead of failing the load", async () => {
    readDir.mockResolvedValueOnce([
      { name: "good.json" },
      { name: "notes.txt" },
      { name: "broken.json" },
    ]);
    readTextFile.mockImplementation(async (path: string) =>
      path.includes("broken") ? "{{{ not json" : JSON.stringify(chat("good", "hi")),
    );

    const out = await loadChats();

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("good");
  });

  it("reads the files concurrently and returns newest first", async () => {
    readDir.mockResolvedValueOnce([{ name: "a.json" }, { name: "b.json" }]);
    let open = 0;
    let peak = 0;
    readTextFile.mockImplementation(async (path: string) => {
      open++;
      peak = Math.max(peak, open);
      await Promise.resolve();
      open--;
      const id = path.includes("a.json") ? "a" : "b";
      return JSON.stringify({ ...chat(id, "x"), updatedAt: id === "a" ? "2026-01-01" : "2026-06-01" });
    });

    const out = await loadChats();

    expect(peak).toBe(2); // both reads in flight at once, not one after the other
    expect(out.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("cancelChatSave", () => {
  it("forgets the pending write", async () => {
    queueSaveChat(chat("c1", "x"));
    cancelChatSave("c1");
    await vi.advanceTimersByTimeAsync(1000);
    expect(chatWrites()).toHaveLength(0);
  });
});

describe("chat index", () => {
  const indexWrites = () =>
    writeTextFile.mock.calls.filter((c) => String(c[0]).endsWith("/index.json"));

  it("carries every field except the transcript", () => {
    const meta = chatMeta(chat("c1", "hello"));
    expect(meta).toMatchObject({ id: "c1", title: "t", messageCount: 1 });
    expect("messages" in meta).toBe(false);
  });

  it("is updated whenever a chat is written", async () => {
    readTextFile.mockResolvedValue("[]");
    await saveChat(chat("c1", "hi"));

    const entries = JSON.parse(indexWrites().at(-1)![1] as unknown as string);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "c1", messageCount: 1 });
  });

  it("replaces rather than duplicates an existing entry", async () => {
    readTextFile.mockResolvedValue(JSON.stringify([chatMeta(chat("c1", "old"))]));
    await saveChat({ ...chat("c1", "new"), title: "renamed" });

    const entries = JSON.parse(indexWrites().at(-1)![1] as unknown as string);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("renamed");
  });

  it("drops the entry when the chat is deleted", async () => {
    readTextFile.mockResolvedValue(
      JSON.stringify([chatMeta(chat("c1", "a")), chatMeta(chat("c2", "b"))]),
    );
    await deleteChat("c1");

    const entries = JSON.parse(indexWrites().at(-1)![1] as unknown as string);
    expect(entries.map((e: { id: string }) => e.id)).toEqual(["c2"]);
  });

  it("rebuilds from the conversation files when the index is missing", async () => {
    readDir.mockResolvedValue([{ name: "c1.json" }]);
    readTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith("index.json")) throw new Error("ENOENT");
      return JSON.stringify(chat("c1", "recovered"));
    });

    const metas = await loadChatIndex();

    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({ id: "c1", messageCount: 1 });
    expect(indexWrites()).toHaveLength(1); // the rebuild is written back
  });

  it("rebuilds when the index disagrees with what is on disk", async () => {
    readDir.mockResolvedValue([{ name: "c1.json" }, { name: "c2.json" }]);
    readTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith("index.json")) return JSON.stringify([chatMeta(chat("c1", "a"))]);
      return JSON.stringify(chat(path.includes("c1") ? "c1" : "c2", "x"));
    });

    const metas = await loadChatIndex();

    expect(metas.map((m) => m.id).sort()).toEqual(["c1", "c2"]);
  });

  it("uses a valid index as-is, newest first", async () => {
    readDir.mockResolvedValue([{ name: "c1.json" }, { name: "c2.json" }]);
    readTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith("index.json")) {
        return JSON.stringify([
          { ...chatMeta(chat("c1", "a")), updatedAt: "2026-01-01" },
          { ...chatMeta(chat("c2", "b")), updatedAt: "2026-06-01" },
        ]);
      }
      throw new Error("should not read conversation files");
    });

    const metas = await loadChatIndex();

    expect(metas.map((m) => m.id)).toEqual(["c2", "c1"]);
    expect(indexWrites()).toHaveLength(0); // no rebuild needed
  });

  it("never treats the index file itself as a conversation", async () => {
    readDir.mockResolvedValue([{ name: "index.json" }, { name: "c1.json" }]);
    readTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith("index.json")) throw new Error("ENOENT");
      return JSON.stringify(chat("c1", "only real chat"));
    });

    expect((await loadChatIndex()).map((m) => m.id)).toEqual(["c1"]);
  });
});
