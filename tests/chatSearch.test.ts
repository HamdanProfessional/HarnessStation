import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, Message } from "../src/lib/types";

// Deterministic fake embeddings built on topic axes with synonym groups, so a
// query can be about the same *topic* as a chat without sharing its literal
// words — exactly the case the semantic pass exists for.
const AXES: Record<string, string[]> = {
  ops: ["deploy", "kubernetes", "rollout", "cluster", "restart"],
  food: ["pasta", "parmesan", "italian", "dinner", "recipe"],
  money: ["invoice", "taxes", "billing", "receipt"],
};

function fakeVec(text: string): number[] {
  const lower = text.toLowerCase();
  return Object.values(AXES).map((words) => (words.some((w) => lower.includes(w)) ? 1 : 0));
}

const tryEmbed = vi.fn(async (texts: string[]) => texts.map(fakeVec));

vi.mock("../src/lib/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/embeddings")>()),
  tryEmbed: (...a: unknown[]) => tryEmbed(...(a as [string[]])),
}));

const vectors = new Map<string, { n: number; u: string; v: number[] }>();
vi.mock("../src/lib/storage", () => ({
  loadChatVectors: async () => Object.fromEntries(vectors),
  saveChatVectors: async (m: Record<string, { n: number; u: string; v: number[] }>) => {
    for (const [k, v] of Object.entries(m)) vectors.set(k, v);
  },
}));

const { chatSnippet, rankBySimilarity, resetSearchCache, searchChats, substringMatch } = await import(
  "../src/lib/chatSearch"
);

let msgN = 0;
const msg = (role: string, content: string): Message =>
  ({ id: `m-${msgN++}`, role, content, ts: 0 }) as Message;

const chat = (
  id: string,
  title: string,
  messages: [string, string][],
  updatedAt = "2026-08-01",
): Chat =>
  ({
    id,
    title,
    messages: messages.map(([r, c]) => msg(r, c)),
    createdAt: "2026-08-01",
    updatedAt,
    providerId: "p",
    model: "m",
    systemPrompt: "",
    styleId: "s",
    temperature: 0.7,
    maxTokens: 1000,
  }) as Chat;

beforeEach(() => {
  resetSearchCache();
  vectors.clear();
  tryEmbed.mockClear();
});

describe("substringMatch", () => {
  it("matches title and message content, case-insensitively", () => {
    const c = chat("1", "Deploy notes", [["user", "about pasta later"]]);
    expect(substringMatch(c, "deploy")).toBe(true);
    expect(substringMatch(c, "PASTA")).toBe(true);
    expect(substringMatch(c, "taxes")).toBe(false);
  });

  it("never matches an empty query", () => {
    expect(substringMatch(chat("1", "anything", []), "")).toBe(false);
  });
});

describe("chatSnippet", () => {
  it("includes the title and role-tagged messages", () => {
    const s = chatSnippet(chat("1", "Deploy notes", [["user", "why did kubernetes restart"]]));
    expect(s.startsWith("Deploy notes")).toBe(true);
    expect(s).toContain("user: why did kubernetes restart");
  });

  it("is capped hard so huge transcripts can't inflate the embed call", () => {
    const filler = "x".repeat(5000);
    const c = chat("1", "big", [
      ["user", filler],
      ["assistant", filler],
      ["user", filler],
    ]);
    expect(chatSnippet(c, 6000).length).toBeLessThanOrEqual(6000);
  });

  it("skips empty message bodies", () => {
    expect(chatSnippet(chat("1", "t", [["user", "   "]]))).toBe("t");
  });
});

describe("rankBySimilarity", () => {
  it("orders by similarity, drops sub-threshold hits, honours exclusions and k", () => {
    const q = fakeVec("deploy kubernetes");
    const vecs = new Map([
      ["close", fakeVec("kubernetes cluster rollout")],
      ["far", fakeVec("pasta recipe")],
      ["mid", fakeVec("invoice taxes")],
      ["excluded", fakeVec("deploy now")],
    ]);
    const hits = rankBySimilarity(q, vecs, 0.3, new Set(["excluded"]), 2);
    // close and excluded tie at 1.0; excluded is filtered out first.
    expect(hits.map((h) => h.id)).toEqual(["close"]);
    expect(hits.some((h) => h.id === "excluded")).toBe(false);
  });

  it("treats an all-zero vector as no similarity", () => {
    const hits = rankBySimilarity(fakeVec("deploy"), new Map([["none", [0, 0, 0]]]), 0.01);
    expect(hits).toEqual([]);
  });
});

describe("searchChats", () => {
  it("returns substring hits as exact and excludes them from the semantic set", async () => {
    const chats = [
      chat("a", "Kubernetes deploy", []),
      chat("b", "Cooking plans", [["user", "pasta with the good parmesan"]]),
    ];
    const res = await searchChats(chats, "deploy");
    expect(res.exact).toEqual(["a"]);
    expect(res.semantic.every((h) => h.id !== "a")).toBe(true);
  });

  it("finds chats about the same topic when no word is shared", async () => {
    const chats = [
      chat("a", "Weekend plan", [["user", "making dinner for friends on saturday"]]),
      chat("b", "Sprint review", [["user", "the cluster upgrade went fine"]]),
    ];
    // Shares no literal word with either transcript.
    const res = await searchChats(chats, "italian pasta ideas");
    expect(res.exact).toEqual([]);
    expect(res.semantic[0]?.id).toBe("a");
    expect(res.embedded).toBe(true);
  });

  it("embeds each unchanged transcript once across queries", async () => {
    const chats = [chat("a", "Ops talk", [["user", "kubernetes rollout stuck"]])];
    // Queries stay on-topic (same fake axis) but share no literal word, so
    // they reach the semantic path instead of being caught by the fast path.
    await searchChats(chats, "cluster problems");
    expect(tryEmbed.mock.calls.length).toBe(2); // transcript batch + query
    await searchChats(chats, "restart loop");
    expect(tryEmbed.mock.calls.length).toBe(3); // only the new query
  });

  it("re-embeds when the transcript changes", async () => {
    let chats = [chat("a", "Draft", [])];
    await searchChats(chats, "anything at all");
    chats = [chat("a", "Draft", [["user", "now covering invoice taxes"]], "2026-08-02")];
    await searchChats(chats, "receipts piling up");
    expect(tryEmbed.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("persists vectors to disk and reuses them in a fresh session", async () => {
    const chats = [chat("a", "Taxes chat", [["user", "invoice taxes question"]])];
    await searchChats(chats, "receipt tracking");
    expect(vectors.has("a")).toBe(true);

    resetSearchCache(); // memory gone, disk remains
    tryEmbed.mockClear();
    await searchChats(chats, "billing paperwork");
    expect(tryEmbed.mock.calls.length).toBe(1); // query only
  });

  it("a query that substring-matches some chats must not evict the others' cached vectors", async () => {
    const chats = [
      chat("food", "Pasta night", [["user", "pasta with parmesan"]]),
      chat("ops", "Cluster notes", [["user", "kubernetes cluster upgrade"]]),
    ];
    // Index everything.
    await searchChats(chats, "italian dinner");
    expect(vectors.has("food")).toBe(true);
    expect(vectors.has("ops")).toBe(true);

    // "pasta" exactly matches the food chat, so only "ops" re-embeds — and the
    // save must merge disk back in rather than rewriting the file with just ops.
    const touched = [chats[0], chat("ops", "Cluster notes", [["user", "kubernetes cluster upgrade"]], "2026-09-02")];
    await searchChats(touched, "pasta");
    expect(vectors.has("food")).toBe(true);
    expect(vectors.has("ops")).toBe(true);
  });

  it("degrades to exact-only when embeddings fail", async () => {
    tryEmbed.mockResolvedValueOnce(null as unknown as number[][]); // transcript batch fails
    const chats = [
      chat("a", "Exact hit", [["user", "kubernetes"]]),
      chat("b", "Only semantic", [["user", "cluster restarts nightly"]]),
    ];
    const res = await searchChats(chats, "kubernetes");
    expect(res.exact).toEqual(["a"]);
    expect(res.semantic).toEqual([]);
    expect(res.embedded).toBe(false);
  });

  it("handles an empty query without touching embeddings", async () => {
    await searchChats([chat("a", "x", [])], "   ");
    expect(tryEmbed).not.toHaveBeenCalled();
  });
});
