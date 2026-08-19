/**
 * Shared types for the Value tab: price intelligence for AI models, hosting and
 * GPU compute.
 *
 * Money is USD, and token prices are **per million tokens** everywhere in this
 * module. Sources quote in wildly different units (OpenRouter is per-token
 * strings, models.dev is already per-Mtok numbers, hosting APIs are per-month or
 * per-hour in mixed currencies) so normalization happens at the adapter
 * boundary and nothing downstream has to ask what unit a number is in.
 *
 * On precision: the reference implementation used Python `Decimal` because
 * float cents can flip the order of two near-identical offers. JavaScript has no
 * decimal type, so instead every comparison and tie-break runs through
 * `quantize()` in ./money, which rounds to a fixed 8 decimal places first. That
 * preserves the property that actually mattered — a stable, reproducible
 * ordering — without pulling in a bignum dependency.
 */

/** Where a number came from, and how much we trust it. */
export interface Provenance {
  /** Which adapter produced this record, e.g. "openrouter" | "models.dev". */
  source: string;
  /** Page a human can open to check the number themselves. */
  sourceUrl?: string;
  /** When this record was fetched (ISO 8601). */
  fetchedAt: string;
  /**
   * "live" means fetched from the provider's own API this session; "cached"
   * means read from disk and possibly stale. There is no third option — we
   * never ship a bundled price list, because a price we cannot date is a price
   * we cannot stand behind.
   */
  kind: "live" | "cached";
}

/** Capability flags. `undefined` means "not published", which is not `false`. */
export interface ModelCapabilities {
  contextWindow?: number;
  maxOutputTokens?: number;
  inputModalities?: string[];
  outputModalities?: string[];
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  supportsCaching?: boolean;
  supportsBatch?: boolean;
  supportsStructuredOutput?: boolean;
  openWeights?: boolean;
  knowledgeCutoff?: string;
  releaseDate?: string;
}

/**
 * Token prices in USD per million tokens.
 *
 * `null` and `undefined` mean different things and both are load-bearing:
 * `undefined` is "the provider does not publish this", `0` is "published, and
 * it is free". Collapsing them makes every free tier look like missing data.
 */
export interface TokenPricing {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  imageInput?: number;
  perRequest?: number;
  perImage?: number;
  webSearchPer1k?: number;
  /**
   * usage        — metered per token, the normal API model
   * free         — genuinely free at the published limits, explicitly marked
   * subscription — token price is 0 only because a seat fee grants access
   * unknown      — priced at 0 with no way to tell which of the above it is
   *
   * Without this distinction a plan-gated model at $0.00 wins every "cheapest"
   * search while being unbuyable to anyone who has not paid for the plan —
   * the single most misleading result this feature could produce.
   *
   * `unknown` exists because the upstream feeds are genuinely ambiguous: a
   * `cost` of zero is published identically for a free tier and for a seat
   * licence. Guessing would be worse than admitting it, so unknown-zero rows
   * are kept, labelled, and excluded from value ranking by default.
   */
  model: "usage" | "free" | "subscription" | "unknown";
  /** Long-context tiers: a higher rate for the whole request past a threshold. */
  tiers?: PriceTier[];
  batchDiscount?: number;
  minMonthlySpend?: number;
  subscriptionMonthly?: number;
}

export interface PriceTier {
  /** Prompt size at or above which this tier applies. */
  threshold: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  note?: string;
}

/** Published throughput ceilings. A model you can't push your volume through is not an option. */
export interface RateLimits {
  tpm?: number;
  rpm?: number;
  tpd?: number;
}

/** Independent quality signals, when a source publishes them. */
export interface QualityIndex {
  intelligence?: number;
  coding?: number;
  agentic?: number;
}

/** One model as sold by one provider. The same model from two providers is two records. */
export interface PricedModel {
  /** Stable identity: `${providerSlug}:${modelKey}`. */
  id: string;
  /** The exact string to send as `model` in an API call. */
  modelKey: string;
  providerSlug: string;
  providerName: string;
  name: string;
  family?: string;
  developer?: string;
  /** llm | embedding | image | speech | video | rerank | moderation */
  modality: string;
  deprecated?: boolean;
  pricing: TokenPricing;
  capabilities: ModelCapabilities;
  limits?: RateLimits;
  quality?: QualityIndex;
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// hosting + GPU (phase 2)
// ---------------------------------------------------------------------------

/** A VPS / dedicated / bare-metal plan. Prices normalized to USD per month. */
export interface HostingOffer {
  id: string;
  planKey: string;
  providerSlug: string;
  providerName: string;
  name: string;
  vcpu?: number;
  ramMB?: number;
  diskGB?: number;
  diskType?: string;
  transferGB?: number;
  /** Headline monthly price, USD, after FX normalization. */
  monthlyUsd?: number;
  hourlyUsd?: number;
  /** Monthly price including setup amortization, IPv4 and known add-ons. */
  effectiveMonthlyUsd?: number;
  setupFeeUsd?: number;
  ipv4FeeUsd?: number;
  egressOveragePerGBUsd?: number;
  /** Currency the provider actually quoted, before conversion. */
  quotedCurrency?: string;
  quotedAmount?: number;
  regions?: string[];
  countries?: string[];
  provenance: Provenance;
}

/** A rentable GPU instance. Prices normalized to USD per hour. */
export interface GpuOffer {
  id: string;
  offerKey: string;
  providerSlug: string;
  providerName: string;
  name: string;
  gpuModel?: string;
  gpuCount?: number;
  vramGBPerGpu?: number;
  vcpu?: number;
  ramMB?: number;
  hourlyUsd?: number;
  monthlyUsd?: number;
  availability?: "available" | "limited" | "sold_out" | "discontinued";
  regions?: string[];
  countries?: string[];
  provenance: Provenance;
}

/** Everything the Value tab holds, as cached on disk. */
export interface PriceCatalog {
  models: PricedModel[];
  hosting: HostingOffer[];
  gpu: GpuOffer[];
  fetchedAt: string;
  /** Per-source outcome, so the UI can say which feed failed rather than showing a blank page. */
  sources: SourceStatus[];
}

export interface SourceStatus {
  source: string;
  ok: boolean;
  count: number;
  error?: string;
  fetchedAt: string;
  /** Milliseconds the fetch took, for the diagnostics line. */
  ms?: number;
}
