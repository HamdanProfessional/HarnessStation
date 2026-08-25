import { cosine, tryEmbed } from "./embeddings";
import type { Chat } from "./types";

/**
 * Search across conversations.
 *
 * The sidebar's substring match is the fast path and stays authoritative for
 * exact hits. This module adds the semantic pass behind it: chats that mean
 * what you typed but don't say it. It reuses the app's embedding stack
 * (Settings → embeddings provider), degrading to substring-only when none is
 * configured — search must never get slower or fail because embeddings are.
 *
 * Vectors are cached per chat keyed by message count + updatedAt, so indexing
 * cost is paid once per changed transcript, not per keystroke or session.
 */

export interface ChatSearchHit {
  id: string;
  score: number;
}

/** Substring over title and message text — the same rule the sidebar has always used. */
export function substringMatch(chat: Chat, q: string): boolean {
  const needle = q.toLowerCase();
  if (!needle) return false;
  return (
    chat.title.toLowerCase().includes(needle) ||
    chat.messages.some((m) => m.content.toLowerCase().includes(needle))
  );
}

/**
 * The text embedded per chat: the title plus role-tagged message text,
 * newest-last so recent context lands at the end of the vector. Capped hard —
 * a transcript of base64-era messages must never turn into an embedding bill.
 */
export function chatSnippet(chat: Pick<Chat, "title" | "messages">, cap = 6000): string {
  const parts: string[] = [chat.title];
  let len = chat.title.length;
  for (const m of chat.messages) {
    const text = m.content?.trim();
    if (!text) continue;
    const piece = `${m.role}: ${text}`;
    parts.push(piece);
    len += piece.length + 1;
    if (len >= cap) break;
  }
  return parts.join("\n").slice(0, cap);
}

const DEFAULT_K = 8;
const DEFAULT_THRESHOLD = 0.35;

/** Rank vectors against the query vector; drops excluded ids and sub-threshold noise. */
export function rankBySimilarity(
  queryVec: number[],
  vectors: Map<string, number[]>,
  threshold = DEFAULT_THRESHOLD,
  exclude: Set<string> = new Set(),
  k = DEFAULT_K,
): ChatSearchHit[] {
  return [...vectors.entries()]
    .filter(([id]) => !exclude.has(id))
    .map(([id, vec]) => ({ id, score: cosine(vec, queryVec) }))
    .filter((h) => h.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---------- session cache ----------

interface CacheEntry {
  key: string;
  vec: number[];
}

const cache = new Map<string, CacheEntry>();
/** The on-disk map, kept so a save can merge instead of clobber. */
let disk: Record<string, { n: number; u: string; v: number[] }> = {};

function cacheKey(chat: Chat): string {
  return `${chat.messages.length}|${chat.updatedAt}`;
}

let diskLoaded = false;
const BATCH = 16; // texts per /embeddings call

async function ensureVectors(chats: Chat[], all: Chat[]): Promise<{ indexed: boolean; ok: boolean }> {
  if (!diskLoaded) {
    diskLoaded = true;
    try {
      const { loadChatVectors } = await import("./storage");
      disk = await loadChatVectors();
      for (const [id, e] of Object.entries(disk)) {
        // Only trust entries still plausibly current; stale ones re-embed below.
        if (e && Array.isArray(e.v)) cache.set(id, { key: `${e.n}|${e.u}`, vec: e.v });
      }
    } catch {
      /* cache unavailable — everything embeds this session */
    }
  }

  const missing = chats.filter((c) => cache.get(c.id)?.key !== cacheKey(c));
  if (!missing.length) return { indexed: false, ok: true };

  // Chunked so a large first index doesn't build one enormous request body;
  // any failing chunk aborts the pass and search falls back to exact-only.
  const snippets = missing.map((c) => chatSnippet(c));
  const vecs: number[][] | null = await (async () => {
    const out: number[][] = [];
    for (let i = 0; i < snippets.length; i += BATCH) {
      const part = await tryEmbed(snippets.slice(i, i + BATCH));
      if (!part) return null;
      out.push(...part);
    }
    return out;
  })();
  if (!vecs || vecs.length !== missing.length) return { indexed: true, ok: false };
  missing.forEach((c, i) => cache.set(c.id, { key: cacheKey(c), vec: vecs[i] }));
  await persist(all);
  return { indexed: true, ok: true };
}

/**
 * Write the merged cache back: fresh entries for what this pass (re)embedded,
 * disk entries for every other live chat — a query that substring-matches half
 * the list must not silently evict the other half's vectors. Pruned to live
 * chat ids, so deletes clean the file.
 */
async function persist(all: Chat[]): Promise<void> {
  try {
    const { saveChatVectors } = await import("./storage");
    const live = new Set(all.map((c) => c.id));
    const out: Record<string, { n: number; u: string; v: number[] }> = {};
    for (const [id, e] of Object.entries(disk)) {
      if (live.has(id)) out[id] = e;
    }
    for (const c of all) {
      const e = cache.get(c.id);
      if (!e) continue;
      const [n, u] = e.key.split("|");
      out[c.id] = { n: Number(n), u, v: e.vec };
    }
    disk = out;
    await saveChatVectors(out);
  } catch {
    /* best-effort */
  }
}

/** Test seam: drop all cached vectors (memory + the loaded-disk flag). */
export function resetSearchCache(): void {
  cache.clear();
  disk = {};
  diskLoaded = false;
}

export interface ChatSearchResult {
  /** Ids matching the substring fast path (the sidebar renders these as today). */
  exact: string[];
  /** Semantically closest non-exact chats, best first. */
  semantic: ChatSearchHit[];
  /** True while first-time embedding work ran for this query's chats. */
  indexing: boolean;
  /** False when an embeddings provider is unconfigured or failing. */
  embedded: boolean;
}

/**
 * Search the given chats for `query`. Callers pass their already-scoped list
 * (e.g. inside a project). Exact matches are computed here too so the two
 * result sets can never overlap.
 */
export async function searchChats(
  chats: Chat[],
  query: string,
  opts: { k?: number; threshold?: number } = {},
): Promise<ChatSearchResult> {
  const q = query.trim();
  if (!q) return { exact: [], semantic: [], indexing: false, embedded: false };

  const exactIds = chats.filter((c) => substringMatch(c, q)).map((c) => c.id);
  const exact = new Set(exactIds);
  const rest = chats.filter((c) => !exact.has(c.id));
  if (!rest.length) return { exact: exactIds, semantic: [], indexing: false, embedded: true };

  const { indexed, ok } = await ensureVectors(rest, chats);
  if (!ok) return { exact: exactIds, semantic: [], indexing: indexed, embedded: false };
  const queryVec = (await tryEmbed([q]))?.[0];
  if (!queryVec) return { exact: exactIds, semantic: [], indexing: indexed, embedded: false };

  const vectors = new Map<string, number[]>();
  for (const c of rest) {
    const e = cache.get(c.id);
    if (e && e.key === cacheKey(c)) vectors.set(c.id, e.vec);
  }
  return {
    exact: exactIds,
    semantic: rankBySimilarity(queryVec, vectors, opts.threshold, exact, opts.k),
    indexing: indexed,
    embedded: true,
  };
}
