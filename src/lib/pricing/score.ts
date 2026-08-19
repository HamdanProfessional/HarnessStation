/**
 * Multi-objective ranking.
 *
 *   score = w_price·price + w_performance·performance
 *         + w_reliability·reliability + w_fit·specFit
 *
 * Normalization runs across the *candidate set*, not against absolute
 * constants, because "cheap" only means anything relative to the alternatives
 * for the same requirement.
 *
 * Two properties this guarantees, both covered by tests:
 *
 * 1. **Explainable.** Every result carries its per-axis contribution, so the UI
 *    can answer "why is this first?" with numbers rather than a shrug.
 * 2. **Stable.** Ties break deterministically (price, then provider, then key),
 *    so repeating an identical query never reshuffles the table.
 */

import { quantize } from "./money";

export const AXES = ["price", "performance", "reliability", "specFit"] as const;
export type Axis = (typeof AXES)[number];

export type Weights = Record<Axis, number>;

export const PRESETS: Record<string, Weights> = {
  /** Lowest cost that satisfies the constraints. */
  cheapest: { price: 1.0, performance: 0.0, reliability: 0.0, specFit: 0.0 },
  /** Price against measured quality — the "best worth" default. */
  bestValue: { price: 0.45, performance: 0.35, reliability: 0.1, specFit: 0.1 },
  /** Quality first, cost last. */
  bestQuality: { price: 0.05, performance: 0.65, reliability: 0.15, specFit: 0.15 },
  balanced: { price: 0.35, performance: 0.25, reliability: 0.2, specFit: 0.2 },
  /** For production: fresh data from first-party feeds. */
  mostReliable: { price: 0.15, performance: 0.15, reliability: 0.55, specFit: 0.15 },
};

export function normalizeWeights(w: Weights): Weights {
  const total = AXES.reduce((sum, a) => sum + Math.max(0, w[a]), 0);
  if (total <= 0) throw new Error("at least one weight must be greater than zero");
  return AXES.reduce((out, a) => {
    out[a] = Math.max(0, w[a]) / total;
    return out;
  }, {} as Weights);
}

/** A candidate, reduced to exactly what the ranking is allowed to see. */
export interface Candidate {
  key: string;
  providerSlug: string;
  /** Lower is better. Blended per-Mtok for models, monthly USD for hosting, hourly for GPU. */
  price?: number;
  /** Higher is better. A quality index, benchmark score or throughput figure. */
  performance?: number;
  /** 0..1 how fresh and first-party this record is. */
  reliability?: number;
  /** 0..1 how well it matches the stated requirement. */
  specFit?: number;
  availability?: string;
}

export interface Scored<T extends Candidate = Candidate> {
  candidate: T;
  score: number;
  axisScores: Record<Axis, number>;
  contributions: Record<Axis, number>;
  explanation: string;
}

/**
 * Values are compared on a log scale before normalizing. Two requirements pull
 * against each other and this is what satisfies both.
 *
 * **Robustness.** Prices span orders of magnitude — a results page legitimately
 * holds a $0.02/Mtok open model and a $75/Mtok frontier one. On a linear scale
 * the expensive one owns the entire range, every cheap candidate lands within a
 * fraction of a percent of the top, and a "cheapest" ranking can no longer tell
 * $0.10 from $0.17 — the one thing it exists to do. On a log scale that same
 * outlier costs about half the range instead of all of it.
 *
 * **Monotonicity.** Improving a candidate must never lower its score.
 * Percentile clipping and Tukey fences both break this, because the bound is
 * computed from the population the candidate belongs to: a candidate that gets
 * cheap enough to tighten the interquartile range pulls the scale in behind it
 * and *loses* points for having improved. Anchoring on the true min and max
 * removes the feedback loop entirely.
 *
 * Zero and negative values are shifted rather than dropped: a free tier is a
 * real price and must not fall out of the comparison.
 */
const LOG_SHIFT = 1e-9;

function logScale(value: number, floor: number): number {
  return Math.log10(Math.max(value - floor, 0) + 1 + LOG_SHIFT);
}

/** Map values onto 0..1 with the best at 1.0. `undefined` stays `undefined`. */
export function normalize(
  values: (number | undefined)[],
  higherIsBetter: boolean,
): (number | undefined)[] {
  const present = values.filter((v): v is number => v !== undefined);
  if (present.length === 0) return values.map(() => undefined);

  const floor = Math.min(0, ...present);
  const scaled = new Map<number, number>();
  for (const v of present) if (!scaled.has(v)) scaled.set(v, logScale(v, floor));

  const all = [...scaled.values()];
  const low = Math.min(...all);
  const high = Math.max(...all);

  if (high <= low) {
    // No spread to measure: every value we have is equally good on this axis.
    // Both directions must agree here. Inverting a "lower is better" result of
    // 1.0 gives 0.0, which made a lone measured value score *worse* than a
    // missing one — "we know nothing" would beat "we measured it".
    return values.map((v) => (v === undefined ? undefined : 1.0));
  }

  const span = high - low;
  return values.map((v) => {
    if (v === undefined) return undefined;
    const position = (scaled.get(v)! - low) / span;
    return higherIsBetter ? position : 1 - position;
  });
}

/**
 * Missing data must not be rewarded. An axis we cannot evaluate scores at this
 * neutral-but-slightly-pessimistic level, so "we don't know" never beats "we
 * measured it and it's good".
 */
export const UNKNOWN_AXIS_SCORE = 0.35;

const AVAILABILITY_MULTIPLIER: Record<string, number> = {
  available: 1.0,
  limited: 0.9,
  // A sold-out offer at a great price is worth nothing to a buyer, but it is
  // still shown, with its price, because knowing it exists has value.
  sold_out: 0.25,
  discontinued: 0.1,
};

/**
 * Freshness, 1.0 for just-fetched decaying to 0.0 at `horizonHours`.
 *
 * Unlike the server-side original there is no staleness *gate* here: the app
 * fetches its own data, so anything on screen is as fresh as the last refresh
 * and the honest move is to show it with its age rather than hide it.
 */
export function freshnessScore(fetchedAt: string | undefined, horizonHours = 288): number {
  if (!fetchedAt) return 0;
  const when = Date.parse(fetchedAt);
  if (!Number.isFinite(when)) return 0;
  const ageHours = (Date.now() - when) / 3_600_000;
  if (ageHours <= 0) return 1;
  if (ageHours >= horizonHours) return 0;
  return 1 - ageHours / horizonHours;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function orUnknown(v: number | undefined): number {
  return v === undefined ? UNKNOWN_AXIS_SCORE : clamp01(v);
}

function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Score and order candidates. A pure function of `(candidates, weights)`. */
export function rank<T extends Candidate>(
  candidates: T[],
  weights: Weights = PRESETS.bestValue,
  limit?: number,
): Scored<T>[] {
  if (candidates.length === 0) return [];
  const w = normalizeWeights(weights);

  const priceScores = normalize(candidates.map((c) => c.price), false);
  const perfScores = normalize(candidates.map((c) => c.performance), true);

  const scored: Scored<T>[] = candidates.map((candidate, i) => {
    const axisScores: Record<Axis, number> = {
      price: orUnknown(priceScores[i]),
      performance: orUnknown(perfScores[i]),
      reliability: orUnknown(candidate.reliability),
      specFit: orUnknown(candidate.specFit),
    };
    const contributions = AXES.reduce((out, a) => {
      out[a] = w[a] * axisScores[a];
      return out;
    }, {} as Record<Axis, number>);
    let score = AXES.reduce((sum, a) => sum + contributions[a], 0);
    score *= AVAILABILITY_MULTIPLIER[candidate.availability ?? "available"] ?? 1.0;
    return { candidate, score: quantize(score), axisScores, contributions, explanation: "" };
  });

  // Deterministic ordering: score desc, then price asc, then a stable key.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = a.candidate.price ?? Infinity;
    const pb = b.candidate.price ?? Infinity;
    if (pa !== pb) return pa - pb;
    if (a.candidate.providerSlug !== b.candidate.providerSlug) {
      return a.candidate.providerSlug < b.candidate.providerSlug ? -1 : 1;
    }
    return a.candidate.key < b.candidate.key ? -1 : a.candidate.key > b.candidate.key ? 1 : 0;
  });

  explain(scored);
  return limit ? scored.slice(0, limit) : scored;
}

/** Attach a short, factual reason to each result. */
function explain(scored: Scored<never>[] | Scored<Candidate>[]): void {
  const prices = scored
    .map((s) => s.candidate.price)
    .filter((p): p is number => p !== undefined)
    .sort((a, b) => a - b);
  const median = percentile(prices, 0.5);
  const cheapest = prices.length ? prices[0] : undefined;

  for (const item of scored) {
    const parts: string[] = [];
    const dominant = AXES.reduce((best, a) =>
      item.contributions[a] > item.contributions[best] ? a : best,
    );
    parts.push(`strongest on ${dominant === "specFit" ? "spec fit" : dominant}`);

    const price = item.candidate.price;
    if (price !== undefined && cheapest !== undefined && price <= cheapest * 1.0001) {
      parts.push("lowest price of all matches");
    } else if (price !== undefined && median) {
      const delta = ((price - median) / median) * 100;
      parts.push(`${Math.abs(delta).toFixed(0)}% ${delta < 0 ? "below" : "above"} the median price`);
    }
    if (item.candidate.availability && item.candidate.availability !== "available") {
      parts.push(`currently ${item.candidate.availability.replace(/_/g, " ")}`);
    }
    item.explanation = parts.join("; ");
  }
}

/**
 * How well an offer matches a requirement, penalising *over*-provisioning.
 *
 * A 1M-context model is a poor answer to "I need 8k": it satisfies the
 * constraint but you pay for the headroom, and a naive filter ranks it
 * identically to an 8k model. Scores 1.0 at an exact match, decaying as the
 * ratio grows, and 0.0 below the requirement.
 *
 * `tolerance` is the ratio at which the score reaches zero — at the default, 4x
 * the requirement scores 0.
 */
export function specFitScore(
  requirements: Record<string, number | undefined>,
  actual: Record<string, number | undefined>,
  tolerance = 4.0,
): number | undefined {
  const pairs: [number, number][] = [];
  for (const [name, required] of Object.entries(requirements)) {
    const provided = actual[name];
    if (required === undefined || provided === undefined || required <= 0) continue;
    pairs.push([required, provided]);
  }
  if (pairs.length === 0) return undefined;

  const scores = pairs.map(([required, provided]) => {
    if (provided < required) return 0;
    const ratio = provided / required;
    if (ratio <= 1) return 1;
    return Math.max(0, 1 - (ratio - 1) / (tolerance - 1));
  });
  return quantize(scores.reduce((a, b) => a + b, 0) / scores.length);
}
