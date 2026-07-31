import { fetch } from "@tauri-apps/plugin-http";
import type { Chunk, KnowledgeBase, Provider } from "./types";

/** Embed an array of texts via an OpenAI-compatible /embeddings endpoint. */
export async function embed(provider: Provider, model: string, input: string[]): Promise<number[][]> {
  const base = provider.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  const res = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, input }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Embeddings HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return (json.data ?? []).map((d: { embedding: number[] }) => d.embedding);
}

/** Split text into overlapping chunks by paragraph/size. */
export function chunkText(text: string, source: string, size = 1200, overlap = 200): { text: string; source: string }[] {
  const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const out: { text: string; source: string }[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    // prefer a paragraph/sentence boundary near the end
    if (end < clean.length) {
      const slice = clean.slice(i, end);
      const bp = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "));
      if (bp > size * 0.5) end = i + bp + 1;
    }
    const piece = clean.slice(i, end).trim();
    if (piece) out.push({ text: piece, source });
    if (end >= clean.length) break; // tail consumed — stepping back would repeat it forever
    const next = end - overlap;
    i = next > i ? next : end; // always move forward, even if overlap >= size
  }
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

/** Retrieve the top-k most similar chunks to a query embedding. */
export function topChunks(kb: KnowledgeBase, queryVec: number[], k = 5): Chunk[] {
  return kb.chunks
    .map((c) => ({ c, score: cosine(c.vector, queryVec) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map((x) => x.c);
}

/** Build the context block to prepend to the system prompt. */
export async function retrieveContext(
  kb: KnowledgeBase,
  query: string,
  provider: Provider,
): Promise<string> {
  if (!kb.chunks.length) return "";
  const [qvec] = await embed(provider, kb.embedModel, [query]);
  const hits = topChunks(kb, qvec, 5);
  if (!hits.length) return "";
  const blocks = hits.map((h, i) => `[${i + 1}] (${h.source})\n${h.text}`).join("\n\n");
  return `You have access to the following retrieved context from the "${kb.name}" knowledge base. Use it to answer; cite sources by name when relevant.\n\n${blocks}`;
}

/**
 * Retrieve and merge context from several knowledge bases for one query.
 * `resolve` maps a KB to the provider that can embed for it; KBs whose provider
 * is missing, or that fail to retrieve, are skipped (never fatal).
 */
export async function retrieveMultiContext(
  kbs: KnowledgeBase[],
  query: string,
  resolve: (kb: KnowledgeBase) => Provider | undefined,
): Promise<string> {
  const blocks: string[] = [];
  for (const kb of kbs) {
    const provider = resolve(kb);
    if (!provider) continue;
    try {
      const block = await retrieveContext(kb, query, provider);
      if (block) blocks.push(block);
    } catch {
      // skip a failing source rather than aborting the whole turn
    }
  }
  return blocks.join("\n\n");
}
