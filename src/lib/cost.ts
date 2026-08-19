/**
 * Per-message cost estimation.
 *
 * Prices are looked up in three passes, most precise first:
 *
 *  1. **Exact model key** from the price catalog (`lib/pricing`). The app knows
 *     the exact string it sent as `model`, and the catalog is keyed by that
 *     same string, so this is an identity match rather than a guess.
 *  2. **Canonical key** — the same thing with the vendor namespace and any
 *     `:free` suffix removed, so `anthropic/claude-opus-5` finds `claude-opus-5`.
 *  3. **Loose name match** against the cached Artificial Analysis benchmark
 *     rows. This is the original behaviour and remains as a fallback for a
 *     fresh install that has not fetched the catalog yet.
 *
 * Pass 3 is a last resort on purpose. Matching by substring is how `gpt-4` ends
 * up priced as `gpt-4o-mini` — a wrong number presented with the same
 * confidence as a right one. It now runs only when the catalog has nothing, and
 * picks the *longest* matching name rather than whichever happened to be
 * enumerated first, so the result no longer depends on map ordering.
 *
 * This module stays synchronous: it is called for every rendered message and
 * inside the budget cap check. The catalog index is therefore mirrored into
 * localStorage, and `primeCostIndex` refreshes it whenever the Value tab
 * fetches new prices.
 */
import type { BenchmarkModel } from "./gateway";
import { canonicalModelKey } from "./pricing/key";

const BENCH_CACHE_KEY = "hs-benchmarks-v1";
const INDEX_CACHE_KEY = "hs-price-index-v1";

interface Priced {
  in: number; // $ per 1M input tokens
  out: number; // $ per 1M output tokens
}

/** Exact and canonical keys from the price catalog. */
let catalogIndex: Map<string, Priced> | null = null;
/** Display-name keyed rows from the benchmark feed. */
let benchIndex: Map<string, Priced> | null = null;

/** Minimal shape needed from a catalog model — avoids importing the heavy module. */
export interface CostIndexModel {
  modelKey: string;
  pricing: { input?: number; output?: number };
}

function buildIndex(models: CostIndexModel[]): Record<string, Priced> {
  const out: Record<string, Priced> = {};
  for (const m of models) {
    const input = m.pricing.input;
    const output = m.pricing.output;
    if (input === undefined && output === undefined) continue;
    const priced: Priced = { in: input ?? 0, out: output ?? 0 };

    const exact = m.modelKey.toLowerCase();
    const canonical = canonicalModelKey(m.modelKey);

    // The same model is sold by many providers at different prices. For a
    // chat-cost estimate the cheapest is the wrong guess and the dearest is
    // alarmist, so the *first* seen wins and the catalog's own ordering
    // decides — deterministic, and never silently reprices a model that was
    // already resolved.
    if (!(exact in out)) out[exact] = priced;
    if (canonical && !(canonical in out)) out[canonical] = priced;
  }
  return out;
}

/**
 * Rebuild the price index from a fetched catalog and persist it.
 *
 * Called by the Value tab after a refresh. Persisting means the next launch has
 * exact pricing available synchronously, before anything has been fetched.
 */
export function primeCostIndex(models: CostIndexModel[]): void {
  const index = buildIndex(models);
  catalogIndex = new Map(Object.entries(index));
  try {
    localStorage.setItem(INDEX_CACHE_KEY, JSON.stringify(index));
  } catch {
    // A full or unavailable localStorage costs precision on the next launch,
    // not correctness now.
  }
}

function loadCatalogIndex(): Map<string, Priced> {
  if (catalogIndex) return catalogIndex;
  catalogIndex = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_CACHE_KEY) ?? "null");
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, Priced>)) {
        if (v && typeof v.in === "number" && typeof v.out === "number") catalogIndex.set(k, v);
      }
    }
  } catch {
    /* no cache */
  }
  return catalogIndex;
}

function loadBenchIndex(): Map<string, Priced> {
  if (benchIndex) return benchIndex;
  benchIndex = new Map();
  try {
    const cached = JSON.parse(localStorage.getItem(BENCH_CACHE_KEY) ?? "null");
    const rows: BenchmarkModel[] = cached?.rows ?? [];
    for (const r of rows) {
      if (r.priceIn === null && r.priceOut === null) continue;
      benchIndex.set(r.name.toLowerCase(), { in: r.priceIn ?? 0, out: r.priceOut ?? 0 });
    }
  } catch {
    /* no cache */
  }
  return benchIndex;
}

/** Call after a Benchmarks or price-catalog refresh so new pricing is picked up. */
export function invalidatePrices() {
  catalogIndex = null;
  benchIndex = null;
}

function findPrice(model: string): Priced | null {
  const key = model.toLowerCase();

  // 1. exact model key from the catalog
  const catalog = loadCatalogIndex();
  const exact = catalog.get(key);
  if (exact) return exact;

  // 2. canonical key (vendor namespace and :free suffix stripped)
  const canonical = canonicalModelKey(model);
  if (canonical) {
    const byCanonical = catalog.get(canonical);
    if (byCanonical) return byCanonical;
  }

  // 3. loose match against benchmark display names — last resort
  const bench = loadBenchIndex();
  const exactBench = bench.get(key);
  if (exactBench) return exactBench;

  let best: Priced | null = null;
  let bestLen = 0;
  for (const [name, priced] of bench) {
    if (!name.includes(key) && !key.includes(name)) continue;
    // Prefer the most specific name that matches, so a short generic entry
    // cannot shadow the precise one.
    if (name.length > bestLen) {
      best = priced;
      bestLen = name.length;
    }
  }
  return best;
}

/** Estimated USD cost for a message's token usage. Null when pricing is unknown. */
export function messageCost(
  model: string,
  promptTokens?: number,
  completionTokens?: number,
): number | null {
  if (!promptTokens && !completionTokens) return null;
  const p = findPrice(model);
  if (!p) return null;
  return ((promptTokens ?? 0) * p.in + (completionTokens ?? 0) * p.out) / 1_000_000;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}
