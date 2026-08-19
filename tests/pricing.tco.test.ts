import { describe, expect, it } from "vitest";
import {
  calculate,
  compare,
  makeWorkload,
  sensitivityCurve,
  tierFor,
  savings,
  type Workload,
} from "../src/lib/pricing/tco";
import type { PricedModel, TokenPricing } from "../src/lib/pricing/types";

function model(pricing: Partial<TokenPricing>, extra: Partial<PricedModel> = {}): PricedModel {
  return {
    id: "acme:m1",
    modelKey: "m1",
    providerSlug: "acme",
    providerName: "Acme",
    name: "M1",
    modality: "llm",
    pricing: { model: "usage", ...pricing },
    capabilities: {},
    provenance: { source: "test", fetchedAt: new Date().toISOString(), kind: "live" },
    ...extra,
  };
}

const W = (partial: Partial<Workload> = {}) =>
  makeWorkload({
    inputTokens: 0,
    outputTokens: 0,
    requests: 0,
    cacheHitRate: 0,
    reasoningTokens: 0,
    images: 0,
    webSearches: 0,
    useBatch: false,
    ...partial,
  });

describe("calculate — hand-computed totals", () => {
  it("prices plain input and output", () => {
    // 10M input @ $3/M = $30; 2M output @ $15/M = $30. Total $60.
    const e = calculate(
      model({ input: 3, output: 15 }),
      W({ inputTokens: 10_000_000, outputTokens: 2_000_000 }),
    );
    expect(e.monthlyCost).toBe(60);
    expect(e.feasible).toBe(true);
  });

  it("applies a cache hit rate at the cached rate", () => {
    // 10M input, 50% cached. 5M @ $3 = $15, 5M @ $0.30 = $1.50. Total $16.50.
    const e = calculate(
      model({ input: 3, cacheRead: 0.3 }, { capabilities: { supportsCaching: true } }),
      W({ inputTokens: 10_000_000, cacheHitRate: 0.5 }),
    );
    expect(e.monthlyCost).toBe(16.5);
  });

  it("ignores caching when the model does not publish it, and says so", () => {
    const e = calculate(
      model({ input: 3 }, { capabilities: { supportsCaching: false } }),
      W({ inputTokens: 10_000_000, cacheHitRate: 0.9 }),
    );
    expect(e.monthlyCost).toBe(30);
    expect(e.warnings.join(" ")).toMatch(/no published prompt caching/);
  });

  it("applies a batch discount only when batch is published", () => {
    // 10M @ $3 = $30, less 50% = $15.
    const withBatch = calculate(
      model({ input: 3 }, { capabilities: { supportsBatch: true } }),
      W({ inputTokens: 10_000_000, useBatch: true }),
    );
    expect(withBatch.monthlyCost).toBe(15);

    const without = calculate(
      model({ input: 3 }, { capabilities: { supportsBatch: false } }),
      W({ inputTokens: 10_000_000, useBatch: true }),
    );
    expect(without.monthlyCost).toBe(30);
    expect(without.warnings.join(" ")).toMatch(/batch pricing is not published/);
  });

  it("charges a long-context tier once the prompt crosses the threshold", () => {
    const m = model({
      input: 1,
      tiers: [{ threshold: 200_000, input: 2, note: "over 200k" }],
    });
    // 1M input over 10 requests = 100k avg prompt: below the threshold.
    const under = calculate(m, W({ inputTokens: 1_000_000, requests: 10 }));
    expect(under.monthlyCost).toBe(1);
    expect(under.tierApplied).toBeUndefined();

    // 1M input over 2 requests = 500k avg prompt: tier applies to everything.
    const over = calculate(m, W({ inputTokens: 1_000_000, requests: 2 }));
    expect(over.monthlyCost).toBe(2);
    expect(over.tierApplied).toBe("over 200k");
  });

  it("tops up to a minimum monthly spend", () => {
    // $3 of usage against a $50 floor bills $50.
    const e = calculate(
      model({ input: 3, minMonthlySpend: 50 }),
      W({ inputTokens: 1_000_000 }),
    );
    expect(e.monthlyCost).toBe(50);
    expect(e.lineItems.some((i) => i.label === "Minimum spend top-up")).toBe(true);
  });

  it("adds a subscription floor on top of usage", () => {
    const e = calculate(
      model({ input: 3, subscriptionMonthly: 20 }),
      W({ inputTokens: 1_000_000 }),
    );
    expect(e.monthlyCost).toBe(23);
  });

  it("bills reasoning tokens as output", () => {
    // 1M output @ $10 = $10; 1M reasoning at the same rate = $10. Total $20.
    const e = calculate(
      model({ output: 10 }),
      W({ outputTokens: 1_000_000, reasoningTokens: 1_000_000 }),
    );
    expect(e.monthlyCost).toBe(20);
  });

  it("quantifies the saving against an uncached, unbatched baseline", () => {
    const e = calculate(
      model({ input: 3, cacheRead: 0.3 }, { capabilities: { supportsCaching: true } }),
      W({ inputTokens: 10_000_000, cacheHitRate: 0.5 }),
    );
    expect(e.baselineCost).toBe(30);
    expect(savings(e)).toBe(13.5);
  });

  it("reports no pricing rather than inventing a zero", () => {
    const e = calculate(model({}), W({ inputTokens: 1_000_000 }));
    expect(e.feasible).toBe(false);
    expect(e.warnings.join(" ")).toMatch(/no token pricing/);
  });
});

describe("feasibility", () => {
  it("fails a prompt larger than the context window", () => {
    const e = calculate(
      model({ input: 1 }, { capabilities: { contextWindow: 8_000 } }),
      W({ inputTokens: 1_000_000, requests: 1 }),
    );
    expect(e.feasible).toBe(false);
    expect(e.warnings.join(" ")).toMatch(/exceeds the 8,000-token context window/);
  });

  it("fails a workload above the published TPM limit", () => {
    const e = calculate(
      model({ input: 1 }, { limits: { tpm: 1_000 } }),
      W({ inputTokens: 1_000_000_000 }),
    );
    expect(e.feasible).toBe(false);
    expect(e.tpmUtilization).toBeGreaterThan(1);
  });

  it("warns near the TPM ceiling without failing", () => {
    // 30d ≈ 43,200 min. 43.2M tokens at 3x peak ≈ 3,000 TPM against a 4,000 cap.
    const e = calculate(
      model({ input: 1 }, { limits: { tpm: 4_000 } }),
      W({ inputTokens: 43_200_000 }),
    );
    expect(e.feasible).toBe(true);
    expect(e.warnings.join(" ")).toMatch(/little headroom/);
  });

  it("rejects images on a model that cannot see", () => {
    const e = calculate(
      model({ input: 1 }, { capabilities: { supportsVision: false } }),
      W({ inputTokens: 1000, images: 5 }),
    );
    expect(e.feasible).toBe(false);
  });

  it("says so when no rate limits are published", () => {
    const e = calculate(model({ input: 1 }), W({ inputTokens: 1000 }));
    expect(e.assumptions.join(" ")).toMatch(/no rate limits are published/);
  });
});

describe("compare", () => {
  it("sorts infeasible options after feasible ones regardless of price", () => {
    const cheapButUnusable = model({ input: 0.01 }, {
      id: "a:cheap",
      providerSlug: "a",
      capabilities: { contextWindow: 100 },
    });
    const dearerButWorks = model({ input: 5 }, { id: "b:works", providerSlug: "b" });
    const out = compare([cheapButUnusable, dearerButWorks], W({ inputTokens: 1_000_000, requests: 1 }));
    expect(out[0].providerSlug).toBe("b");
    expect(out[1].feasible).toBe(false);
  });
});

describe("sensitivityCurve", () => {
  it("gets cheaper as the cache hit rate rises", () => {
    const curve = sensitivityCurve(
      model({ input: 3, cacheRead: 0.3 }, { capabilities: { supportsCaching: true } }),
      W({ inputTokens: 10_000_000 }),
    );
    const costs = curve.map((p) => p.monthlyCost);
    expect(costs[0]).toBeGreaterThan(costs[costs.length - 1]);
  });
});

describe("tierFor", () => {
  it("picks the highest threshold at or below the prompt size", () => {
    const pricing: TokenPricing = {
      model: "usage",
      tiers: [
        { threshold: 128_000, input: 2 },
        { threshold: 512_000, input: 4 },
      ],
    };
    expect(tierFor(pricing, 64_000)[0]).toBeUndefined();
    expect(tierFor(pricing, 200_000)[0]?.input).toBe(2);
    expect(tierFor(pricing, 900_000)[0]?.input).toBe(4);
  });
});

describe("makeWorkload", () => {
  it("rejects an out-of-range cache hit rate", () => {
    expect(() => makeWorkload({ cacheHitRate: 1.5 })).toThrow();
  });
  it("rejects a peak factor below 1", () => {
    expect(() => makeWorkload({ peakFactor: 0.5 })).toThrow();
  });
});
