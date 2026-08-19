/**
 * AI workload cost calculator.
 *
 * The headline number on every AI pricing page is "$X per million input
 * tokens". For a real workload that figure is close to meaningless, because the
 * actual bill is shaped by:
 *
 *  - **prompt caching** — cache *reads* are typically 10x cheaper than fresh
 *    input, while cache *writes* cost 1.25–2x more. A cache-heavy agent can be
 *    cheaper or dearer than the sticker price depending entirely on hit rate;
 *  - **batch processing** — usually 50% off, but only if latency is tolerable;
 *  - **long-context tiers** — several providers charge a higher rate for the
 *    whole request once the prompt crosses a threshold;
 *  - **reasoning tokens** — billed as output, and invisible in the prompt;
 *  - **minimum spend and subscription floors**;
 *  - **rate limits** — a model you cannot push your volume through is not a
 *    cheaper option, it is a non-option.
 *
 * This models every one of those and returns a line-by-line breakdown plus the
 * assumptions it had to make.
 */

import { quantize } from "./money";
import type { PriceTier, PricedModel, RateLimits, TokenPricing } from "./types";

const MILLION = 1_000_000;
const MINUTES_PER_MONTH = 30 * 24 * 60;

/** What the user actually intends to run, per month. */
export interface Workload {
  inputTokens: number;
  outputTokens: number;
  /** Portion of `inputTokens` expected to be served from the prompt cache, 0..1. */
  cacheHitRate: number;
  /** Tokens written to cache per month. Estimated from requests when omitted. */
  cacheWriteTokens?: number;
  /** Reasoning/thinking tokens, billed as output by most providers. */
  reasoningTokens: number;
  requests: number;
  images: number;
  webSearches: number;
  /** Average prompt size, used to pick the long-context tier. Derived when omitted. */
  avgPromptTokens?: number;
  useBatch: boolean;
  /**
   * Peak-to-average traffic ratio for rate-limit feasibility. Real traffic is
   * never flat; 3x is conservative for interactive workloads.
   */
  peakFactor: number;
}

export const DEFAULT_WORKLOAD: Workload = {
  inputTokens: 10_000_000,
  outputTokens: 2_000_000,
  cacheHitRate: 0,
  reasoningTokens: 0,
  requests: 10_000,
  images: 0,
  webSearches: 0,
  useBatch: false,
  peakFactor: 3,
};

export function makeWorkload(partial: Partial<Workload> = {}): Workload {
  const w = { ...DEFAULT_WORKLOAD, ...partial };
  if (w.cacheHitRate < 0 || w.cacheHitRate > 1) {
    throw new Error("cacheHitRate must be within [0, 1]");
  }
  if (w.peakFactor < 1) throw new Error("peakFactor must be at least 1");
  for (const k of ["inputTokens", "outputTokens", "reasoningTokens", "requests", "images"] as const) {
    if (w[k] < 0) throw new Error(`${k} must not be negative`);
  }
  return w;
}

export function effectivePromptSize(w: Workload): number {
  if (w.avgPromptTokens) return Math.floor(w.avgPromptTokens);
  if (w.requests) return Math.floor(w.inputTokens / w.requests);
  return 0;
}

export interface LineItem {
  label: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  cost: number;
  note?: string;
}

export interface CostEstimate {
  modelId: string;
  modelKey: string;
  providerSlug: string;
  name: string;
  monthlyCost: number;
  lineItems: LineItem[];
  assumptions: string[];
  warnings: string[];
  /**
   * False when the workload cannot physically run here (rate limits, context
   * window, missing capability). Such options are shown, clearly marked, rather
   * than silently dropped — a hidden option looks like one that doesn't exist.
   */
  feasible: boolean;
  tpmUtilization?: number;
  rpmUtilization?: number;
  tierApplied?: string;
  /** Cost with no batching and no caching, so the saving is quantified. */
  baselineCost?: number;
}

export function savings(e: CostEstimate): number | undefined {
  if (e.baselineCost === undefined) return undefined;
  return quantize(e.baselineCost - e.monthlyCost);
}

export function savingsPct(e: CostEstimate): number | undefined {
  if (!e.baselineCost) return undefined;
  return Math.round(((e.baselineCost - e.monthlyCost) / e.baselineCost) * 10000) / 100;
}

function tokenCost(tokens: number, perMtok: number | undefined): number {
  if (perMtok === undefined) return 0;
  return (tokens / MILLION) * perMtok;
}

/** Select the applicable long-context tier for a given prompt size. */
export function tierFor(
  pricing: TokenPricing,
  promptTokens: number,
): [PriceTier | undefined, string | undefined] {
  if (!pricing.tiers?.length) return [undefined, undefined];
  let applicable: PriceTier | undefined;
  for (const tier of [...pricing.tiers].sort((a, b) => a.threshold - b.threshold)) {
    if (promptTokens >= tier.threshold) applicable = tier;
  }
  if (!applicable) return [undefined, undefined];
  return [applicable, applicable.note || `>= ${applicable.threshold.toLocaleString()} tokens`];
}

function rateFor(
  pricing: TokenPricing,
  tier: PriceTier | undefined,
  field: "input" | "output" | "cacheRead" | "cacheWrite",
): number | undefined {
  if (tier && tier[field] !== undefined) return tier[field];
  return pricing[field];
}

/**
 * Estimate cache-write volume when the user has not supplied it.
 *
 * Model: every cached read implies a prior write of the same prefix, amortized
 * across the requests that reuse it. With no reuse information the conservative
 * assumption is one write per request that misses.
 */
function cacheWriteTokens(w: Workload, hitRate: number): number {
  if (w.cacheWriteTokens !== undefined) return w.cacheWriteTokens;
  if (hitRate <= 0 || !w.requests) return 0;
  const misses = w.requests * (1 - hitRate);
  return quantize(misses * effectivePromptSize(w) * hitRate);
}

function baselineCost(pricing: TokenPricing, w: Workload, tier: PriceTier | undefined): number {
  const input = rateFor(pricing, tier, "input");
  const output = rateFor(pricing, tier, "output");
  let total = tokenCost(w.inputTokens, input) + tokenCost(w.outputTokens, output);
  total += tokenCost(w.reasoningTokens, pricing.reasoning ?? output);
  if (w.requests && pricing.perRequest) total += w.requests * pricing.perRequest;
  if (pricing.subscriptionMonthly) total += pricing.subscriptionMonthly;
  if (pricing.minMonthlySpend && total < pricing.minMonthlySpend) total = pricing.minMonthlySpend;
  return quantize(total);
}

/** Compute the monthly cost of `workload` on `model`. */
export function calculate(model: PricedModel, workload: Workload): CostEstimate {
  const pricing = model.pricing;
  const caps = model.capabilities;
  const estimate: CostEstimate = {
    modelId: model.id,
    modelKey: model.modelKey,
    providerSlug: model.providerSlug,
    name: model.name,
    monthlyCost: 0,
    lineItems: [],
    assumptions: [],
    warnings: [],
    feasible: true,
  };

  const promptSize = effectivePromptSize(workload);
  const [tier, tierLabel] = tierFor(pricing, promptSize);
  estimate.tierApplied = tierLabel;
  if (tierLabel) {
    estimate.assumptions.push(
      `long-context tier applied (${tierLabel}) based on an average prompt of ${promptSize.toLocaleString()} tokens`,
    );
  }

  const inputRate = rateFor(pricing, tier, "input");
  const outputRate = rateFor(pricing, tier, "output");
  const cachedRate = rateFor(pricing, tier, "cacheRead");
  const cacheWriteRate = rateFor(pricing, tier, "cacheWrite");
  const reasoningRate = pricing.reasoning ?? outputRate;

  if (inputRate === undefined && outputRate === undefined) {
    estimate.warnings.push("no token pricing published for this model");
    estimate.feasible = false;
    return estimate;
  }

  // -- caching --------------------------------------------------------------
  let hitRate = workload.cacheHitRate;
  if (hitRate > 0 && caps.supportsCaching === false) {
    estimate.warnings.push(
      "this model has no published prompt caching; the requested cache hit rate was ignored and all input is billed at the full rate",
    );
    hitRate = 0;
  }
  if (hitRate > 0 && cachedRate === undefined) {
    estimate.warnings.push(
      "caching is supported but no cached-input price is published; billed at the full input rate",
    );
    hitRate = 0;
  }

  const cachedInput = quantize(workload.inputTokens * hitRate);
  const freshInput = workload.inputTokens - cachedInput;

  // -- batch ----------------------------------------------------------------
  let discount = 0;
  if (workload.useBatch) {
    if (caps.supportsBatch === false || caps.supportsBatch === undefined) {
      estimate.warnings.push(
        "batch pricing is not published for this model; priced at standard rates",
      );
    } else {
      discount = pricing.batchDiscount ?? 0.5;
      estimate.assumptions.push(
        `batch pricing applied (${Math.round(discount * 100)}% off input and output; cache writes and per-request fees are not discounted)`,
      );
    }
  }
  const multiplier = 1 - discount;

  // -- line items -----------------------------------------------------------
  const items: LineItem[] = [];

  if (freshInput > 0 && inputRate !== undefined) {
    items.push({
      label: "Input tokens (uncached)",
      quantity: freshInput,
      unit: "tokens",
      unitPrice: inputRate,
      cost: quantize(tokenCost(freshInput, inputRate) * multiplier),
    });
  }
  if (cachedInput > 0 && cachedRate !== undefined) {
    items.push({
      label: "Input tokens (cache read)",
      quantity: cachedInput,
      unit: "tokens",
      unitPrice: cachedRate,
      cost: quantize(tokenCost(cachedInput, cachedRate) * multiplier),
      note: `${Math.round(workload.cacheHitRate * 100)}% cache hit rate`,
    });
  }

  const writes = cacheWriteTokens(workload, hitRate);
  if (writes > 0 && cacheWriteRate !== undefined) {
    items.push({
      label: "Cache writes",
      quantity: writes,
      unit: "tokens",
      unitPrice: cacheWriteRate,
      // Cache writes are not batch-discounted by any provider we model.
      cost: quantize(tokenCost(writes, cacheWriteRate)),
      note: "charged at a premium over standard input",
    });
    if (workload.cacheWriteTokens === undefined) {
      estimate.assumptions.push(
        `cache writes estimated at ${Math.round(writes).toLocaleString()} tokens (one write per distinct prompt prefix)`,
      );
    }
  }

  if (workload.outputTokens > 0 && outputRate !== undefined) {
    items.push({
      label: "Output tokens",
      quantity: workload.outputTokens,
      unit: "tokens",
      unitPrice: outputRate,
      cost: quantize(tokenCost(workload.outputTokens, outputRate) * multiplier),
    });
  }
  if (workload.reasoningTokens > 0 && reasoningRate !== undefined) {
    items.push({
      label: "Reasoning tokens",
      quantity: workload.reasoningTokens,
      unit: "tokens",
      unitPrice: reasoningRate,
      cost: quantize(tokenCost(workload.reasoningTokens, reasoningRate) * multiplier),
      note: "billed as output",
    });
  }
  if (workload.requests > 0 && pricing.perRequest) {
    items.push({
      label: "Per-request fee",
      quantity: workload.requests,
      unit: "requests",
      unitPrice: pricing.perRequest,
      cost: quantize(workload.requests * pricing.perRequest),
    });
  }
  if (workload.images > 0 && pricing.perImage) {
    items.push({
      label: "Images",
      quantity: workload.images,
      unit: "images",
      unitPrice: pricing.perImage,
      cost: quantize(workload.images * pricing.perImage),
    });
  }
  if (workload.webSearches > 0 && pricing.webSearchPer1k) {
    items.push({
      label: "Web searches",
      quantity: workload.webSearches,
      unit: "searches",
      unitPrice: pricing.webSearchPer1k,
      cost: quantize((workload.webSearches / 1000) * pricing.webSearchPer1k),
    });
  }

  let usage = items.reduce((sum, item) => sum + item.cost, 0);

  // -- floors ---------------------------------------------------------------
  if (pricing.minMonthlySpend && usage < pricing.minMonthlySpend) {
    items.push({
      label: "Minimum spend top-up",
      quantity: 1,
      unit: "month",
      unitPrice: pricing.minMonthlySpend,
      cost: quantize(pricing.minMonthlySpend - usage),
      note: `usage of $${usage.toFixed(2)} is below the $${pricing.minMonthlySpend} minimum`,
    });
    usage = pricing.minMonthlySpend;
  }
  if (pricing.subscriptionMonthly) {
    items.push({
      label: "Subscription",
      quantity: 1,
      unit: "month",
      unitPrice: pricing.subscriptionMonthly,
      cost: quantize(pricing.subscriptionMonthly),
    });
    usage += pricing.subscriptionMonthly;
  }

  estimate.lineItems = items;
  estimate.monthlyCost = quantize(usage);
  estimate.baselineCost = baselineCost(pricing, workload, tier);

  checkFeasibility(caps, model.limits, workload, estimate);
  return estimate;
}

/**
 * Can this workload actually run here?
 *
 * Cheapest-that-cannot-run is the most expensive kind of wrong answer, so
 * infeasibility is surfaced as loudly as price.
 */
function checkFeasibility(
  caps: PricedModel["capabilities"],
  limits: RateLimits | undefined,
  w: Workload,
  estimate: CostEstimate,
): void {
  const promptSize = effectivePromptSize(w);
  if (caps.contextWindow && promptSize > caps.contextWindow) {
    estimate.feasible = false;
    estimate.warnings.push(
      `average prompt of ${promptSize.toLocaleString()} tokens exceeds the ${caps.contextWindow.toLocaleString()}-token context window`,
    );
  }
  if (caps.maxOutputTokens && w.requests) {
    const perRequest = w.outputTokens / Math.max(1, w.requests);
    if (perRequest > caps.maxOutputTokens) {
      estimate.warnings.push(
        `average output of ${Math.round(perRequest).toLocaleString()} tokens per request exceeds the ${caps.maxOutputTokens.toLocaleString()}-token cap; responses will be truncated`,
      );
    }
  }

  const totalTokens = w.inputTokens + w.outputTokens + w.reasoningTokens;

  if (limits?.tpm) {
    const requiredTpm = (totalTokens / MINUTES_PER_MONTH) * w.peakFactor;
    const utilization = requiredTpm / limits.tpm;
    estimate.tpmUtilization = Math.round(utilization * 10000) / 10000;
    if (utilization > 1) {
      estimate.feasible = false;
      estimate.warnings.push(
        `workload needs about ${Math.round(requiredTpm).toLocaleString()} tokens/minute at a ${w.peakFactor}x peak, above the published ${limits.tpm.toLocaleString()} TPM limit`,
      );
    } else if (utilization > 0.7) {
      estimate.warnings.push(
        `workload would use ${Math.round(utilization * 100)}% of the published TPM limit; little headroom for spikes`,
      );
    }
  }
  if (limits?.rpm && w.requests) {
    const requiredRpm = (w.requests / MINUTES_PER_MONTH) * w.peakFactor;
    const utilization = requiredRpm / limits.rpm;
    estimate.rpmUtilization = Math.round(utilization * 10000) / 10000;
    if (utilization > 1) {
      estimate.feasible = false;
      estimate.warnings.push(
        `workload needs about ${Math.round(requiredRpm).toLocaleString()} requests/minute at a ${w.peakFactor}x peak, above the published ${limits.rpm.toLocaleString()} RPM limit`,
      );
    }
  }
  if (limits?.tpd && totalTokens / 30 > limits.tpd) {
    estimate.feasible = false;
    estimate.warnings.push(
      `workload needs about ${Math.round(totalTokens / 30).toLocaleString()} tokens/day, above the published ${limits.tpd.toLocaleString()} TPD limit`,
    );
  }
  if (w.images && caps.supportsVision === false) {
    estimate.feasible = false;
    estimate.warnings.push("this model does not accept image input");
  }
  if (!limits?.tpm && !limits?.rpm) {
    estimate.assumptions.push(
      "no rate limits are published for this model, so throughput could not be verified",
    );
  }
}

/**
 * Cost every candidate for the same workload, cheapest first.
 *
 * Infeasible options sort after feasible ones regardless of price: a model that
 * cannot run the workload is not a cheaper alternative.
 */
export function compare(
  models: PricedModel[],
  workload: Workload,
  opts: { includeInfeasible?: boolean } = {},
): CostEstimate[] {
  let estimates = models.map((m) => calculate(m, workload));
  if (opts.includeInfeasible === false) estimates = estimates.filter((e) => e.feasible);
  estimates.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (a.monthlyCost !== b.monthlyCost) return a.monthlyCost - b.monthlyCost;
    return a.providerSlug < b.providerSlug ? -1 : a.providerSlug > b.providerSlug ? 1 : 0;
  });
  return estimates;
}

/**
 * Cost as a function of cache hit rate — turns "should I invest in prompt
 * caching?" into a number instead of a guess.
 */
export function sensitivityCurve(
  model: PricedModel,
  workload: Workload,
  hitRates: number[] = [0, 0.25, 0.5, 0.75, 0.9],
): { cacheHitRate: number; monthlyCost: number; feasible: boolean }[] {
  return hitRates.map((rate) => {
    const e = calculate(model, { ...workload, cacheHitRate: rate });
    return { cacheHitRate: rate, monthlyCost: e.monthlyCost, feasible: e.feasible };
  });
}
