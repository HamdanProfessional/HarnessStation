import { beforeEach, describe, expect, it } from "vitest";
import { invalidatePrices, messageCost, primeCostIndex } from "../src/lib/cost";

const model = (modelKey: string, input: number, output: number) => ({
  modelKey,
  pricing: { input, output },
});

beforeEach(() => {
  localStorage.clear();
  invalidatePrices();
});

describe("catalog-backed pricing", () => {
  it("prices on an exact model-key match", () => {
    primeCostIndex([model("gpt-4o-mini", 0.15, 0.6)]);
    // 1M in + 1M out = 0.15 + 0.60
    expect(messageCost("gpt-4o-mini", 1_000_000, 1_000_000)).toBeCloseTo(0.75, 10);
  });

  it("does not let a shorter key steal a longer key's price", () => {
    // The original bug: `gpt-4` matched `gpt-4o-mini` by substring and was
    // priced as the wrong model, with no indication anything had gone wrong.
    primeCostIndex([model("gpt-4o-mini", 0.15, 0.6), model("gpt-4", 30, 60)]);
    expect(messageCost("gpt-4", 1_000_000, 0)).toBeCloseTo(30, 10);
    expect(messageCost("gpt-4o-mini", 1_000_000, 0)).toBeCloseTo(0.15, 10);
  });

  it("matches a vendor-prefixed id against the bare key", () => {
    primeCostIndex([model("claude-opus-5", 5, 25)]);
    expect(messageCost("anthropic/claude-opus-5", 1_000_000, 0)).toBeCloseTo(5, 10);
  });

  it("matches a :free suffixed id against the base model", () => {
    primeCostIndex([model("glm-5.2", 0.4, 1.6)]);
    expect(messageCost("glm-5.2:free", 1_000_000, 0)).toBeCloseTo(0.4, 10);
  });

  it("is case-insensitive", () => {
    primeCostIndex([model("GPT-5.6-Luna", 1, 2)]);
    expect(messageCost("gpt-5.6-luna", 1_000_000, 0)).toBeCloseTo(1, 10);
  });

  it("returns null for a model the catalog has never seen", () => {
    primeCostIndex([model("gpt-4o-mini", 0.15, 0.6)]);
    expect(messageCost("some-local-gguf-q4", 1000, 1000)).toBeNull();
  });

  it("keeps the first price seen when many providers sell one model", () => {
    // Deterministic rather than cheapest-or-dearest: the estimate must not
    // change just because a feed reordered.
    primeCostIndex([model("deepseek-v4", 0.1, 0.3), model("deepseek-v4", 0.9, 2.7)]);
    expect(messageCost("deepseek-v4", 1_000_000, 0)).toBeCloseTo(0.1, 10);
  });

  it("skips models with no published price", () => {
    primeCostIndex([{ modelKey: "unpriced", pricing: {} }]);
    expect(messageCost("unpriced", 1000, 1000)).toBeNull();
  });

  it("survives a corrupt persisted index", () => {
    localStorage.setItem("hs-price-index-v1", "{not json");
    invalidatePrices();
    expect(() => messageCost("anything", 10, 10)).not.toThrow();
    expect(messageCost("anything", 10, 10)).toBeNull();
  });

  it("persists across an invalidate, so a fresh launch has exact prices", () => {
    primeCostIndex([model("gpt-4o-mini", 0.15, 0.6)]);
    invalidatePrices(); // simulates a new session reading from localStorage
    expect(messageCost("gpt-4o-mini", 1_000_000, 0)).toBeCloseTo(0.15, 10);
  });
});

describe("benchmark fallback", () => {
  const seedBench = (rows: { name: string; priceIn: number; priceOut: number }[]) => {
    localStorage.setItem("hs-benchmarks-v1", JSON.stringify({ rows }));
    invalidatePrices();
  };

  it("is used when the catalog has nothing", () => {
    seedBench([{ name: "Claude Opus 4.5", priceIn: 5, priceOut: 25 }]);
    expect(messageCost("claude opus 4.5", 1_000_000, 0)).toBeCloseTo(5, 10);
  });

  it("prefers the most specific matching name", () => {
    // With both present, the longer name must win regardless of insertion order.
    seedBench([
      { name: "GPT-4", priceIn: 30, priceOut: 60 },
      { name: "GPT-4o mini", priceIn: 0.15, priceOut: 0.6 },
    ]);
    expect(messageCost("gpt-4o mini", 1_000_000, 0)).toBeCloseTo(0.15, 10);
  });

  it("loses to the catalog when both have the model", () => {
    seedBench([{ name: "gpt-4o-mini", priceIn: 99, priceOut: 99 }]);
    primeCostIndex([model("gpt-4o-mini", 0.15, 0.6)]);
    expect(messageCost("gpt-4o-mini", 1_000_000, 0)).toBeCloseTo(0.15, 10);
  });
});
