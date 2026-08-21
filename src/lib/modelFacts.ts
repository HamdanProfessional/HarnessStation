/**
 * Published facts about a model — what it accepts and emits, and how much
 * context it has — made available synchronously to the chat path.
 *
 * We already download all of this. `pricing/sources.ts` parses `modalities`,
 * `tool_call` and `limit.context` out of the models.dev feed, and then uses
 * them only to rank rows in the Value tab. Meanwhile `modality.ts` infers the
 * same facts from regexes on model ids, and compaction assumes a fixed 8000
 * tokens for every model ever made.
 *
 * This is the missing consumer. It follows the pattern `cost.ts` already
 * established for prices: a small index persisted to localStorage on catalog
 * refresh, so the next launch has the facts available synchronously before
 * anything has been fetched. The chat path cannot await a download to decide
 * how to label a dropdown.
 *
 * Published data beats a guess, but it is not complete — models.dev does not
 * list every model a provider returns. `whisper-large-v3` is there;
 * `playai-tts` and `llama-guard` are not. So this answers when it knows and
 * returns null when it does not, and the regex classifier stays as the
 * fallback rather than being deleted.
 */

import { canonicalModelKey } from "./pricing/key";

/** Compact on purpose: this is serialised to localStorage on every refresh. */
export interface ModelFacts {
  /** Accepted input modalities, e.g. ["text", "image"]. */
  in?: string[];
  /** Produced output modalities, e.g. ["text"]. */
  out?: string[];
  /** Context window in tokens. */
  ctx?: number;
  /** Whether the model supports tool calling. */
  tools?: boolean;
}

/** The subset of a catalog row this index needs. */
export interface FactsSourceModel {
  modelKey: string;
  capabilities?: {
    inputModalities?: string[];
    outputModalities?: string[];
    contextWindow?: number;
    supportsTools?: boolean;
  };
}

const CACHE_KEY = "modelFacts:index";

let index: Map<string, ModelFacts> | null = null;

function build(models: FactsSourceModel[]): Record<string, ModelFacts> {
  const out: Record<string, ModelFacts> = {};
  for (const m of models) {
    const c = m.capabilities;
    if (!c) continue;
    const facts: ModelFacts = {};
    if (c.inputModalities?.length) facts.in = c.inputModalities;
    if (c.outputModalities?.length) facts.out = c.outputModalities;
    if (typeof c.contextWindow === "number" && c.contextWindow > 0) facts.ctx = c.contextWindow;
    if (typeof c.supportsTools === "boolean") facts.tools = c.supportsTools;
    if (Object.keys(facts).length === 0) continue;

    const exact = m.modelKey.toLowerCase();
    const canonical = canonicalModelKey(m.modelKey);
    // First writer wins, matching how cost.ts resolves the same collision: the
    // catalog's own ordering decides, so a model already resolved is never
    // silently redescribed by a later duplicate.
    if (!(exact in out)) out[exact] = facts;
    if (canonical && !(canonical in out)) out[canonical] = facts;
  }
  return out;
}

/** Rebuild the index from a fetched catalog and persist it. */
export function primeModelFacts(models: FactsSourceModel[]): void {
  const built = build(models);
  index = new Map(Object.entries(built));
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(built));
  } catch {
    // A full or unavailable localStorage costs us the regex fallback next
    // launch, not correctness now.
  }
}

/** Drop the in-memory index so the next lookup re-reads the cache. */
export function invalidateModelFacts(): void {
  index = null;
}

function load(): Map<string, ModelFacts> {
  if (index) return index;
  index = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, ModelFacts>)) {
        if (v && typeof v === "object") index.set(k, v);
      }
    }
  } catch {
    /* no cache — callers fall back to inference */
  }
  return index;
}

/**
 * Published facts for a model id, or null when it is not in the catalog.
 *
 * Tries the id as given, then the canonical form, so `anthropic/claude-opus-5`
 * and `claude-opus-5` both resolve.
 */
export function factsFor(model: string): ModelFacts | null {
  if (!model) return null;
  const idx = load();
  const exact = idx.get(model.toLowerCase());
  if (exact) return exact;
  const canonical = canonicalModelKey(model);
  if (!canonical) return null;
  return idx.get(canonical) ?? null;
}

/** The model's real context window, when published. */
export function contextWindowOf(model: string): number | null {
  return factsFor(model)?.ctx ?? null;
}
