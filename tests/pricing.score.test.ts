import { describe, expect, it } from "vitest";
import {
  freshnessScore,
  normalize,
  normalizeWeights,
  PRESETS,
  rank,
  specFitScore,
  UNKNOWN_AXIS_SCORE,
  type Candidate,
} from "../src/lib/pricing/score";

const c = (key: string, price?: number, extra: Partial<Candidate> = {}): Candidate => ({
  key,
  providerSlug: "p",
  price,
  ...extra,
});

describe("normalize", () => {
  it("scores the cheapest 1.0 and the dearest 0.0", () => {
    const out = normalize([1, 10, 100], false);
    expect(out[0]).toBe(1);
    expect(out[2]).toBe(0);
    expect(out[1]).toBeGreaterThan(0);
    expect(out[1]).toBeLessThan(1);
  });

  it("keeps cheap values distinguishable despite a huge outlier", () => {
    // The reason for the log scale: on a linear scale $0.10 and $0.17 both land
    // within a rounding error of 1.0 once a $500 option is in the set, so a
    // "cheapest" ranking can no longer tell them apart. Asserted against the
    // linear separation it replaces rather than a magic constant.
    const values = [0.1, 0.17, 500];
    const [a, b] = normalize(values, false);
    const logGap = a! - b!;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const linearGap = (values[1] - values[0]) / (max - min);

    expect(logGap).toBeGreaterThan(linearGap * 10);
  });

  it("is monotonic — getting cheaper never lowers the score", () => {
    const before = normalize([5, 10, 20, 40], false);
    const after = normalize([4, 10, 20, 40], false);
    expect(after[0]!).toBeGreaterThanOrEqual(before[0]!);
  });

  it("treats zero as a real price rather than dropping it", () => {
    const out = normalize([0, 5, 10], false);
    expect(out[0]).toBe(1);
    expect(out.every((v) => v !== undefined)).toBe(true);
  });

  it("scores a single measured value 1.0 in both directions", () => {
    // A lone measured value must not score 0.0, or it loses to an unmeasured
    // one carrying the 0.35 unknown prior.
    expect(normalize([7], false)).toEqual([1]);
    expect(normalize([7], true)).toEqual([1]);
    expect(normalize([7, 7, 7], false)).toEqual([1, 1, 1]);
  });

  it("passes undefined through untouched", () => {
    expect(normalize([undefined, undefined], false)).toEqual([undefined, undefined]);
    expect(normalize([1, undefined, 10], false)[1]).toBeUndefined();
  });
});

describe("weights", () => {
  it("normalizes to sum to 1", () => {
    const w = normalizeWeights({ price: 2, performance: 2, reliability: 0, specFit: 0 });
    expect(w.price + w.performance + w.reliability + w.specFit).toBeCloseTo(1);
    expect(w.price).toBeCloseTo(0.5);
  });

  it("rejects an all-zero weighting", () => {
    expect(() => normalizeWeights({ price: 0, performance: 0, reliability: 0, specFit: 0 })).toThrow();
  });
});

describe("rank", () => {
  it("puts the cheapest first under the cheapest preset", () => {
    const out = rank([c("a", 10), c("b", 1), c("c", 5)], PRESETS.cheapest);
    expect(out.map((s) => s.candidate.key)).toEqual(["b", "c", "a"]);
  });

  it("is deterministic for identical candidates", () => {
    const items = [
      { key: "z", providerSlug: "b", price: 1 },
      { key: "a", providerSlug: "b", price: 1 },
      { key: "a", providerSlug: "a", price: 1 },
    ];
    const once = rank(items, PRESETS.cheapest).map((s) => `${s.candidate.providerSlug}:${s.candidate.key}`);
    const twice = rank([...items].reverse(), PRESETS.cheapest).map(
      (s) => `${s.candidate.providerSlug}:${s.candidate.key}`,
    );
    expect(once).toEqual(twice);
    expect(once).toEqual(["a:a", "b:a", "b:z"]);
  });

  it("does not reward missing data over measured data", () => {
    const out = rank(
      [c("measured", 5, { performance: 100 }), c("unknown", 5)],
      { price: 0, performance: 1, reliability: 0, specFit: 0 },
    );
    expect(out[0].candidate.key).toBe("measured");
    expect(out[1].axisScores.performance).toBe(UNKNOWN_AXIS_SCORE);
  });

  it("reports per-axis contributions that sum to the score", () => {
    const [top] = rank([c("a", 1, { performance: 10, reliability: 0.5, specFit: 0.5 })]);
    const sum = Object.values(top.contributions).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(top.score, 6);
  });

  it("ranks an available offer above a sold-out one at the same price", () => {
    const out = rank(
      [c("gone", 5, { availability: "sold_out" }), c("here", 5)],
      PRESETS.cheapest,
    );
    expect(out[0].candidate.key).toBe("here");
    // Still listed, with its price: knowing a cheap option exists has value
    // even when you cannot buy it today.
    expect(out.map((s) => s.candidate.key)).toContain("gone");
  });

  it("explains why the winner won", () => {
    const [top] = rank([c("a", 1), c("b", 100)], PRESETS.cheapest);
    expect(top.explanation).toContain("lowest price");
  });

  it("returns an empty array for no candidates", () => {
    expect(rank([])).toEqual([]);
  });
});

describe("specFitScore", () => {
  it("scores an exact match 1.0", () => {
    expect(specFitScore({ context: 8000 }, { context: 8000 })).toBe(1);
  });

  it("scores below-requirement 0", () => {
    expect(specFitScore({ context: 8000 }, { context: 4000 })).toBe(0);
  });

  it("penalises over-provisioning", () => {
    const exact = specFitScore({ context: 8000 }, { context: 8000 })!;
    const over = specFitScore({ context: 8000 }, { context: 24000 })!;
    expect(over).toBeLessThan(exact);
    expect(specFitScore({ context: 8000 }, { context: 32000 })).toBe(0);
  });

  it("returns undefined when nothing is comparable", () => {
    expect(specFitScore({ context: undefined }, { context: 100 })).toBeUndefined();
    expect(specFitScore({ context: 100 }, { context: undefined })).toBeUndefined();
  });
});

describe("freshnessScore", () => {
  it("scores a fresh fetch 1.0 and an ancient one 0.0", () => {
    expect(freshnessScore(new Date().toISOString())).toBeCloseTo(1, 2);
    expect(freshnessScore(new Date(Date.now() - 1000 * 3600 * 1000).toISOString())).toBe(0);
  });

  it("scores unknown and unparseable timestamps 0", () => {
    expect(freshnessScore(undefined)).toBe(0);
    expect(freshnessScore("not a date")).toBe(0);
  });
});
