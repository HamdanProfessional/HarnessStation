import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, Message } from "../src/lib/types";

/**
 * Scale test for lib/chatSearch.ts — opt-in because it deliberately builds
 * thousands of synthetic conversations and runs hundreds of rankings:
 *
 *   STRESS=1 npx vitest run tests/searchScale.test.ts
 *
 * Embeddings and storage are faked deterministically, so what's measured is
 * the algorithmic path — snippet building, cache keys, batch chunking, cosine
 * ranking over thousands of candidates — not network or disk.
 */

vi.mock("../src/lib/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/embeddings")>();
  return { ...actual, tryEmbed: (...a: unknown[]) => tryEmbed(...(a as [string[]])) };
});

const vectors = new Map<string, { n: number; u: string; v: number[] }>();
vi.mock("../src/lib/storage", () => ({
  loadChatVectors: async () => Object.fromEntries(vectors),
  saveChatVectors: async (m: Record<string, { n: number; u: string; v: number[] }>) => {
    for (const [k, v] of Object.entries(m)) vectors.set(k, v);
  },
}));

// ---------- deterministic fake embeddings ----------

const TOPICS: [string, string][] = [
  ["kubernetes", "clusters"],
  ["pasta", "gnocchi"],
  ["invoice", "receipt"],
  ["jogging", "marathon"],
  ["guitar", "fretboard"],
  ["react", "hooks"],
  ["gardening", "compost"],
  ["economy", "inflation"],
  ["novel", "protagonist"],
  ["flight", "layover"],
  ["kittens", "tabby"],
  ["cryptography", "ciphers"],
];
const STOPWORDS = new Set([
  "the", "and", "was", "with", "this", "that", "have", "from", "your", "about",
  "into", "over", "after", "before", "when", "while", "they", "them", "then",
]);

// One axis per topic plus a shared background dimension.
const DIM = TOPICS.length + 1;

function fakeVec(text: string): number[] {
  // Structurally clean rather than realistic: topic tokens (and their
  // synonyms) light up one axis, everything else feeds a tiny shared
  // background dimension. Hash-bucket collisions at this vocabulary size
  // would otherwise drown the signal the test is trying to measure.
  const vec = new Array(DIM).fill(0);
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  let background = 0;
  let axisHit = false;
  for (const raw of words) {
    if (STOPWORDS.has(raw)) continue;
    const t = TOPICS.findIndex(([a, b]) => a === raw || b === raw);
    if (t !== -1 && !axisHit) {
      vec[t] = 1;
      axisHit = true;
    } else {
      background++;
    }
  }
  vec[DIM - 1] = Math.min(0.05, background * 0.001);
  return vec;
}

const tryEmbed = vi.fn(async (texts: string[]) => texts.map(fakeVec));

// ---------- fixture factory ----------

const CHATS = 3000;
const MSGS_PER_CHAT = 30;

function filler(i: number): string {
  // Deterministic prose with enough shared vocabulary to be realistic.
  const words = ["the", "plan", "worked", "with", "some", "changes", "today", "notes", "about"];
  return Array.from({ length: 14 }, (_, k) => words[(i + k) % words.length]).join(" ");
}

function buildChats(): Chat[] {
  const chats: Chat[] = [];
  for (let c = 0; c < CHATS; c++) {
    const topic = TOPICS[c % TOPICS.length][0];
    const messages: Message[] = Array.from({ length: MSGS_PER_CHAT }, (_, m) => ({
      id: `m-${c}-${m}`,
      role: m % 2 ? "assistant" : "user",
      content: `${filler(c * MSGS_PER_CHAT + m)} ${topic} detail line ${m}`,
    }));
    chats.push({
      id: `chat-${c}`,
      title: `Conversation ${c}`,
      messages,
      createdAt: "2026-08-01",
      updatedAt: "2026-08-02",
      providerId: "p",
      model: "m",
      systemPrompt: "",
      styleId: "s",
      temperature: 0.7,
      maxTokens: 1000,
    } as Chat);
  }
  return chats;
}

const { resetSearchCache, searchChats } = await import("../src/lib/chatSearch");

const stress = process.env.STRESS === "1";

beforeEach(() => {
  resetSearchCache();
  vectors.clear();
  tryEmbed.mockClear();
});

describe.skipIf(!stress)("chatSearch at scale", () => {
  it(
    "indexes thousands of chats once, then answers queries from cache",
    async () => {
      const chats = buildChats();

      // First query pays for indexing every transcript (batched).
      // Threshold lowered from the 0.35 default: synthetic bag-of-bucket
      // vectors dilute long transcripts far more than real embedding models
      // do, and what's under test here is ranking and caching, not cutoffs.
      const THRESH = 0.08;
      const t0 = performance.now();
      const first = await searchChats(chats, `${TOPICS[5][1]} patterns`, { threshold: THRESH });
      const indexMs = performance.now() - t0;

      expect(first.exact).toEqual([]); // no literal overlap by construction
      expect(first.semantic[0]?.id).toBe(`chat-${5}`); // react/hooks chats win

      // Warm queries: cache hits all around, only the query embeds.
      tryEmbed.mockClear();
      const warmStart = performance.now();
      const warmMs: number[] = [];
      for (let q = 0; q < 25; q++) {
        const t = performance.now();
        await searchChats(chats, `${TOPICS[q % TOPICS.length][1]} stuff`, { threshold: THRESH });
        warmMs.push(performance.now() - t);
      }
      const warmTotal = performance.now() - warmStart;

      // Every warm query embedded exactly one text (itself) — nothing re-indexed.
      expect(tryEmbed.mock.calls.reduce((a, c) => a + c[0].length, 0)).toBe(25);

      const sorted = [...warmMs].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      console.log(
        `[searchScale] chats=${CHATS} msgs=${CHATS * MSGS_PER_CHAT} · ` +
          `index=${Math.round(indexMs)}ms · warm avg=${Math.round(warmTotal / 25)}ms · ` +
          `warm p95=${Math.round(p95)}ms`,
      );

      // Generous budgets: this must never become the slow path.
      expect(indexMs).toBeLessThan(30_000);
      expect(p95).toBeLessThan(500);

      // Ranking stays correct across every topic, not just the first one.
      for (let t = 0; t < TOPICS.length; t++) {
        const r = await searchChats(chats, `${TOPICS[t][1]} question`, { threshold: THRESH });
        // Ties within a topic resolve to its first chat by insertion order.
        expect(r.semantic[0]?.id ?? "(none)").toBe(`chat-${t}`);
      }
    },
    120_000,
  );

  it("re-indexes only changed transcripts at scale", async () => {
    const chats = buildChats().slice(0, 500);
    await searchChats(chats, `${TOPICS[2][1]} check`);
    const batchCallsBefore = tryEmbed.mock.calls.length - 25; // minus query embeds so far
    void batchCallsBefore;

    tryEmbed.mockClear();
    // Touch ten chats' timestamps: exactly ten transcripts must re-embed.
    const touched = [...chats];
    for (let k = 0; k < 10; k++) {
      touched[k] = { ...touched[k], updatedAt: "2026-09-01" };
    }
    await searchChats(touched, `${TOPICS[3][1]} check`);
    const embeddedTexts = tryEmbed.mock.calls.reduce((a, c) => a + c[0].length, 0);
    expect(embeddedTexts).toBe(10 + 1); // changed transcripts + the query
  }, 60_000);
});
