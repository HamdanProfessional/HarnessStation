import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryEntry } from "../src/lib/types";

let store: MemoryEntry[] = [];
const loadAgentMemory = vi.fn(async () => store.map((m) => ({ ...m })));
const saveAgentMemory = vi.fn(async (_id: string, mem: MemoryEntry[]) => {
  store = mem;
});
const chatOnce = vi.fn(async () => "[]");

vi.mock("../src/lib/storage", () => ({
  loadAgentMemory: (id: string) => loadAgentMemory(id),
  saveAgentMemory: (id: string, mem: MemoryEntry[]) => saveAgentMemory(id, mem),
}));

vi.mock("../src/lib/providers", () => ({ chatOnce: (...a: unknown[]) => chatOnce(...(a as [])) }));

// No embedding provider configured -> the keyword fallback path.
vi.mock("../src/lib/store", () => ({
  useStore: { getState: () => ({ settings: { providers: [], embedProviderId: "", embedModel: "" } }) },
}));

vi.mock("../src/lib/rag", () => ({ embed: vi.fn(async () => []) }));

const { consolidate, forget, listMemories, recall, remember } = await import("../src/lib/memory");

const entry = (text: string, ts: number): MemoryEntry => ({ text, ts });

/** Facts with no shared vocabulary, so the local dedupe leaves them all alone. */
const DISTINCT = [
  "deployments happen on thursday",
  "the user drinks strong coffee",
  "penguins are the office mascot",
  "billing renews each january",
  "staging mirrors production hardware",
  "release notes go in the wiki",
  "meetings start at quarter past",
  "backups rotate every fortnight",
  "the logo uses two greens",
  "support rota changes monthly",
];

beforeEach(() => {
  store = [];
  loadAgentMemory.mockClear();
  saveAgentMemory.mockClear();
  chatOnce.mockReset();
  chatOnce.mockResolvedValue("[]");
  localStorage.clear();
});

describe("remember", () => {
  it("stores a fact and refuses an empty one", async () => {
    expect(await remember("a1", "  ")).toBe("Nothing to remember.");
    expect(await remember("a1", "The user prefers dark mode")).toMatch(/^Remembered:/);
    expect(store).toHaveLength(1);
  });

  it("supersedes a near-duplicate rather than piling up", async () => {
    await remember("a1", "The user prefers dark mode always");
    const msg = await remember("a1", "The user prefers dark mode always");
    expect(msg).toMatch(/^Updated memory:/);
    expect(store).toHaveLength(1);
  });

  it("keeps genuinely different facts apart", async () => {
    await remember("a1", "The user prefers dark mode");
    await remember("a1", "Deployments happen on Thursday afternoons");
    expect(store).toHaveLength(2);
  });
});

describe("recall", () => {
  it("returns everything when the store is smaller than k", async () => {
    store = [entry("one", 1), entry("two", 2)];
    expect(await recall("a1", "anything", 8)).toEqual(["one", "two"]);
  });

  it("ranks by keyword overlap when there are no embeddings", async () => {
    store = [
      entry("the deployment pipeline runs on thursday", 1),
      entry("the user likes strong coffee", 2),
      entry("unrelated trivia about penguins", 3),
    ];
    const hits = await recall("a1", "when does deployment run", 1);
    expect(hits[0]).toBe("the deployment pipeline runs on thursday");
  });
});

describe("forget", () => {
  it("drops one entry by exact text", async () => {
    store = [entry("keep me", 1), entry("drop me", 2)];
    await forget("a1", "drop me");
    expect(store.map((m) => m.text)).toEqual(["keep me"]);
  });
});

describe("listMemories", () => {
  it("returns newest first", async () => {
    store = [entry("old", 1), entry("new", 9)];
    expect((await listMemories("a1")).map((m) => m.text)).toEqual(["new", "old"]);
  });
});

describe("consolidate", () => {
  const provider = {
    id: "p",
    name: "P",
    kind: "openai-compatible" as const,
    baseUrl: "",
    apiKey: "",
    models: [],
  };
  const run = (force = true) => consolidate("scope", provider, "m", force);

  it("does not run on a small store unless forced", async () => {
    store = [entry("a", 1)];
    expect(await consolidate("scope", provider, "m")).toBeNull();
    expect(saveAgentMemory).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    localStorage.setItem("hs-consolidated-at:scope", String(Date.now()));
    store = DISTINCT.map((text, i) => entry(text, i));
    expect(await consolidate("scope", provider, "m")).toBeNull();
  });

  it("drops local duplicates without needing the model", async () => {
    store = [entry("the user prefers dark mode", 1), entry("the user prefers dark mode", 2)];
    chatOnce.mockRejectedValueOnce(new Error("offline"));

    const removed = await run();

    expect(removed).toBe(1);
    expect(store).toHaveLength(1);
  });

  it("keeps the newest facts when trimming, not the oldest", async () => {
    // Regression: dedupeLocal returned newest-first while the caller trims with
    // slice(-MAX), so the newest facts were the ones thrown away.
    store = [
      entry("deployments happen on thursday", 0),
      entry("the user drinks strong coffee", 1),
      entry("penguins are the office mascot", 2),
    ];
    chatOnce.mockRejectedValueOnce(new Error("offline"));

    await run();

    expect(store.map((m) => m.ts)).toEqual([0, 1, 2]); // chronological, oldest first
  });

  it("saves a merge that keeps the same number of facts", async () => {
    // Regression: the write was gated on the count shrinking, so a pass that
    // reworded or merged without changing the length was silently discarded.
    store = [entry("a", 1), entry("b", 2)];
    chatOnce.mockResolvedValueOnce('["a refined", "b refined"]');

    const removed = await run();

    expect(removed).toBe(0);
    expect(store.map((m) => m.text)).toEqual(["a refined", "b refined"]);
  });

  it("refuses a model response that would throw most of the store away", async () => {
    store = DISTINCT.map((text, i) => entry(text, i));
    chatOnce.mockResolvedValueOnce('["only one left"]');

    await run();

    expect(store).toHaveLength(DISTINCT.length); // the locally-deduped store, untouched
  });

  it("keeps the local dedupe when the model returns junk", async () => {
    store = [entry("a", 1), entry("a", 2), entry("b", 3)];
    chatOnce.mockResolvedValueOnce("not json at all");

    await run();

    expect(store.map((m) => m.text)).toEqual(["a", "b"]);
  });

  it("reuses the existing entry when a fact survives verbatim", async () => {
    store = [{ text: "a", ts: 1, vector: [1, 0] }, entry("b", 2)];
    chatOnce.mockResolvedValueOnce('["a", "b"]');

    await run();

    expect(store.find((m) => m.text === "a")?.vector).toEqual([1, 0]);
  });
});
