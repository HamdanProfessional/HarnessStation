import type { BenchmarkModel } from "./gateway";

const CACHE_KEY = "hs-benchmarks-v1";

interface Priced {
  in: number; // $ per 1M input tokens
  out: number; // $ per 1M output tokens
}

let priceMap: Map<string, Priced> | null = null;

/** Build a model-name → pricing map from the cached Artificial Analysis benchmarks. */
function loadPrices(): Map<string, Priced> {
  if (priceMap) return priceMap;
  priceMap = new Map();
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    const rows: BenchmarkModel[] = cached?.rows ?? [];
    for (const r of rows) {
      if (r.priceIn === null && r.priceOut === null) continue;
      priceMap.set(r.name.toLowerCase(), { in: r.priceIn ?? 0, out: r.priceOut ?? 0 });
    }
  } catch {
    /* no cache */
  }
  return priceMap;
}

/** Call after Benchmarks refresh so new pricing is picked up. */
export function invalidatePrices() {
  priceMap = null;
}

function findPrice(model: string): Priced | null {
  const prices = loadPrices();
  const key = model.toLowerCase();
  if (prices.has(key)) return prices.get(key)!;
  // loose match: model name contained in a benchmark name or vice-versa
  for (const [name, p] of prices) {
    if (name.includes(key) || key.includes(name)) return p;
  }
  return null;
}

/** Estimated USD cost for a message's token usage on a model. Null if pricing unknown. */
export function messageCost(model: string, promptTokens?: number, completionTokens?: number): number | null {
  if (!promptTokens && !completionTokens) return null;
  const p = findPrice(model);
  if (!p) return null;
  return ((promptTokens ?? 0) * p.in + (completionTokens ?? 0) * p.out) / 1_000_000;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}
