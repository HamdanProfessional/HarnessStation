import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatCost, invalidatePrices, messageCost } from "../src/lib/cost";
import { capExceeded, onSpendChange, recordUsage, resetSpend, totals } from "../src/lib/budget";

/** Pricing comes from the cached Artificial Analysis benchmark rows in localStorage. */
function seedPrices(rows: { name: string; priceIn: number | null; priceOut: number | null }[]) {
  localStorage.setItem("hs-benchmarks-v1", JSON.stringify({ rows }));
  invalidatePrices();
}

beforeEach(() => {
  resetSpend();
  invalidatePrices();
});

describe("messageCost", () => {
  it("prices per million tokens", () => {
    seedPrices([{ name: "GPT-5", priceIn: 2, priceOut: 10 }]);
    expect(messageCost("gpt-5", 1_000_000, 1_000_000)).toBeCloseTo(12, 10);
    expect(messageCost("gpt-5", 1000, 500)).toBeCloseTo(0.002 + 0.005, 10);
  });

  it("matches the benchmark name case-insensitively and loosely", () => {
    seedPrices([{ name: "Claude Opus 4.5", priceIn: 5, priceOut: 25 }]);
    expect(messageCost("claude opus 4.5", 1_000_000, 0)).toBeCloseTo(5, 10);
    // a longer local id that contains the benchmark name still matches
    expect(messageCost("anthropic/claude opus 4.5-latest", 1_000_000, 0)).toBeCloseTo(5, 10);
  });

  it("returns null when the model is unknown or has no tokens", () => {
    seedPrices([{ name: "GPT-5", priceIn: 2, priceOut: 10 }]);
    expect(messageCost("some-local-gguf", 100, 100)).toBeNull();
    expect(messageCost("gpt-5", 0, 0)).toBeNull();
    expect(messageCost("gpt-5")).toBeNull();
  });

  it("skips rows with no pricing at all", () => {
    seedPrices([{ name: "Free Model", priceIn: null, priceOut: null }]);
    expect(messageCost("free model", 1000, 1000)).toBeNull();
  });

  it("treats a one-sided price as zero on the other side", () => {
    seedPrices([{ name: "Embed", priceIn: 1, priceOut: null }]);
    expect(messageCost("embed", 1_000_000, 1_000_000)).toBeCloseTo(1, 10);
  });
});

describe("formatCost", () => {
  it("uses more decimals as the amount gets smaller", () => {
    expect(formatCost(0.0001234)).toBe("$0.0001");
    expect(formatCost(0.5)).toBe("$0.500");
    expect(formatCost(12.345)).toBe("$12.35");
  });
});

describe("spend ledger", () => {
  it("accumulates usage into one row per provider+model+day", () => {
    seedPrices([{ name: "GPT-5", priceIn: 2, priceOut: 10 }]);
    recordUsage("p1", "gpt-5", 1000, 500);
    recordUsage("p1", "gpt-5", 1000, 500);
    const t = totals();
    expect(t.byModel).toHaveLength(1);
    expect(t.byModel[0]).toMatchObject({ model: "gpt-5", tokens: 3000, calls: 2 });
    expect(t.todayUsd).toBeCloseTo(0.014, 10);
    expect(t.monthUsd).toBeCloseTo(0.014, 10);
    expect(t.todayTokens).toBe(3000);
  });

  it("ignores calls that reported no tokens", () => {
    recordUsage("p1", "gpt-5", 0, 0);
    expect(totals().byModel).toEqual([]);
  });

  it("counts unpriced models separately instead of pretending they cost nothing", () => {
    recordUsage("p1", "mystery-model", 1000, 1000);
    const t = totals();
    expect(t.unpricedCalls).toBe(1);
    expect(t.allUsd).toBe(0);
    expect(t.byModel[0].tokens).toBe(2000);
  });

  it("sorts the model breakdown by spend, descending", () => {
    seedPrices([
      { name: "cheap", priceIn: 1, priceOut: 1 },
      { name: "pricey", priceIn: 100, priceOut: 100 },
    ]);
    recordUsage("p", "cheap", 1_000_000, 0);
    recordUsage("p", "pricey", 1_000_000, 0);
    expect(totals().byModel.map((m) => m.model)).toEqual(["pricey", "cheap"]);
  });

  it("survives a corrupt ledger in localStorage", () => {
    localStorage.setItem("hs-spend-v1", "{not json");
    expect(() => recordUsage("p", "m", 1, 1)).not.toThrow();
    expect(totals().byModel).toHaveLength(1);
  });

  it("drops rows older than 90 days on the next write", () => {
    const old = new Date(Date.now() - 120 * 86_400_000);
    const day = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, "0")}-${String(old.getDate()).padStart(2, "0")}`;
    localStorage.setItem(
      "hs-spend-v1",
      JSON.stringify({
        rows: [{ day, providerId: "p", model: "old", promptTokens: 1, completionTokens: 1, usd: 5, calls: 1 }],
        unpricedCalls: 0,
      }),
    );
    recordUsage("p", "new", 1, 1);
    expect(totals().byModel.map((m) => m.model)).toEqual(["new"]);
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const fn = vi.fn();
    const off = onSpendChange(fn);
    recordUsage("p", "m", 1, 1);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    recordUsage("p", "m", 1, 1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("resetSpend clears everything", () => {
    recordUsage("p", "m", 10, 10);
    resetSpend();
    expect(totals()).toMatchObject({ allUsd: 0, todayTokens: 0, unpricedCalls: 0, byModel: [] });
  });
});

describe("capExceeded", () => {
  beforeEach(() => {
    seedPrices([{ name: "GPT-5", priceIn: 1000, priceOut: 1000 }]); // $1 per 1k tokens
  });

  it("passes when no cap is configured", () => {
    recordUsage("p", "gpt-5", 100_000, 0);
    expect(capExceeded()).toBeNull();
  });

  it("passes while under the cap", () => {
    recordUsage("p", "gpt-5", 1000, 0); // $1
    expect(capExceeded(5)).toBeNull();
  });

  it("blocks once daily spend reaches the cap", () => {
    recordUsage("p", "gpt-5", 5000, 0); // $5
    expect(capExceeded(5)).toMatch(/Daily spend cap reached/);
  });

  it("blocks on the monthly cap even when the daily one is fine", () => {
    recordUsage("p", "gpt-5", 3000, 0); // $3
    expect(capExceeded(100, 3)).toMatch(/Monthly spend cap reached/);
  });

  it("cannot cap a model with no pricing data", () => {
    recordUsage("p", "unpriced-local", 10_000_000, 10_000_000);
    expect(capExceeded(0.01)).toBeNull();
  });
});
