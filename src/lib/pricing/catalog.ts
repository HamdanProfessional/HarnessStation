/**
 * The price catalog: merge the sources, cache to disk, and answer queries.
 *
 * Cached at `~/.harnessx/pricing/catalog.json`, in the same plain-JSON, no-database
 * spirit as the rest of the app's storage. The cache exists so the tab paints
 * instantly and still works offline — never so we can ship a price list we
 * cannot date. A cached catalog always carries its `fetchedAt` and the UI always
 * shows it.
 */

import { canonicalModelKey } from "./key";
import { blended, quantize } from "./money";
import { fetchModelSources } from "./sources";
import { freshnessScore, PRESETS, rank, specFitScore, type Scored, type Weights } from "./score";
import type { GpuOffer, HostingOffer, PriceCatalog, PricedModel, SourceStatus } from "./types";

const DIR = ".harnessx/pricing";
const FILE = `${DIR}/catalog.json`;

/** Consider the cache worth refreshing after this long. */
export const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;

export const EMPTY_CATALOG: PriceCatalog = {
  models: [],
  hosting: [],
  gpu: [],
  fetchedAt: "",
  sources: [],
};

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

export { canonicalModelKey } from "./key";

/**
 * Merge model records from every source.
 *
 * Two things happen here:
 *
 * 1. **Deduplication by id.** If two feeds describe the same provider+model,
 *    the record with more published fields wins, because a row missing cache
 *    prices would otherwise silently overwrite one that has them.
 * 2. **Quality propagation.** OpenRouter publishes an Artificial Analysis
 *    intelligence index for a subset of models. That index is a property of the
 *    *model*, not of who resells it, so it is grafted onto every record with the
 *    same canonical key. Without this the performance axis would only ever work
 *    for OpenRouter rows, and "best value" would collapse to "cheapest".
 */
export function mergeModels(batches: PricedModel[][]): PricedModel[] {
  const byId = new Map<string, PricedModel>();
  for (const batch of batches) {
    for (const model of batch) {
      const existing = byId.get(model.id);
      if (!existing || fieldCount(model) > fieldCount(existing)) byId.set(model.id, model);
    }
  }

  const qualityByCanonical = new Map<string, PricedModel["quality"]>();
  for (const model of byId.values()) {
    if (!model.quality?.intelligence) continue;
    const key = canonicalModelKey(model.modelKey);
    if (!qualityByCanonical.has(key)) qualityByCanonical.set(key, model.quality);
  }

  const out: PricedModel[] = [];
  for (const model of byId.values()) {
    if (model.quality?.intelligence) {
      out.push(model);
      continue;
    }
    const inherited = qualityByCanonical.get(canonicalModelKey(model.modelKey));
    out.push(inherited ? { ...model, quality: inherited } : model);
  }
  return out;
}

function fieldCount(model: PricedModel): number {
  const count = (o: object) =>
    Object.values(o).filter((v) => v !== undefined && v !== null).length;
  return count(model.pricing) + count(model.capabilities) + (model.quality?.intelligence ? 1 : 0);
}

// ---------------------------------------------------------------------------
// fetch + cache
// ---------------------------------------------------------------------------

async function fs() {
  return import("@tauri-apps/plugin-fs");
}

export async function loadCatalog(): Promise<PriceCatalog | null> {
  try {
    const { BaseDirectory, exists, readTextFile } = await fs();
    const opts = { baseDir: BaseDirectory.Home };
    if (!(await exists(FILE, opts))) return null;
    const parsed = JSON.parse(await readTextFile(FILE, opts)) as PriceCatalog;
    if (!parsed || !Array.isArray(parsed.models)) return null;
    // Anything read from disk is cached by definition, whatever it claimed when
    // it was written.
    for (const m of parsed.models) m.provenance.kind = "cached";
    return { ...EMPTY_CATALOG, ...parsed };
  } catch {
    return null;
  }
}

export async function saveCatalog(catalog: PriceCatalog): Promise<void> {
  try {
    const { BaseDirectory, mkdir, writeTextFile } = await fs();
    const opts = { baseDir: BaseDirectory.Home };
    await mkdir(DIR, { ...opts, recursive: true });
    await writeTextFile(FILE, JSON.stringify(catalog), opts);
  } catch {
    // A cache that cannot be written is a performance problem, not a
    // correctness one — the tab still works, it just refetches next time.
  }
}

export interface RefreshResult {
  catalog: PriceCatalog;
  sources: SourceStatus[];
  /** Set by `refreshAll`: the rate European prices were converted at. */
  fx?: import("./fx").FxRate;
}

/**
 * Fetch every source, merge, and persist.
 *
 * Hosting and GPU offers are passed through from the previous catalog when the
 * caller does not supply fresh ones, so refreshing models alone never wipes the
 * hosting table.
 */
export async function refreshCatalog(
  opts: {
    signal?: AbortSignal;
    previous?: PriceCatalog | null;
    hosting?: HostingOffer[];
    gpu?: GpuOffer[];
  } = {},
): Promise<RefreshResult> {
  const results = await fetchModelSources(opts.signal);
  const models = mergeModels(results.map((r) => r.models));
  const sources = results.map((r) => r.status);

  // Every source failed — keep whatever we had rather than blanking the view.
  if (models.length === 0 && opts.previous?.models.length) {
    return { catalog: { ...opts.previous, sources }, sources };
  }

  const catalog: PriceCatalog = {
    models,
    hosting: opts.hosting ?? opts.previous?.hosting ?? [],
    gpu: opts.gpu ?? opts.previous?.gpu ?? [],
    fetchedAt: new Date().toISOString(),
    sources,
  };
  await saveCatalog(catalog);
  return { catalog, sources };
}

/**
 * Refresh everything — models, hosting and GPU — and fold the result into the
 * local price history.
 *
 * Each source settles independently, so a Vultr failure in the browser build
 * (it sends no CORS headers) still leaves you with models, Linode and whatever
 * else came back.
 */
export async function refreshAll(
  opts: { signal?: AbortSignal; previous?: PriceCatalog | null } = {},
): Promise<RefreshResult> {
  const { fetchInfraSources } = await import("./hosting");
  const [modelResults, infra] = await Promise.all([
    fetchModelSources(opts.signal),
    fetchInfraSources(opts.signal),
  ]);

  const models = mergeModels(modelResults.map((r) => r.models));
  const sources = [...modelResults.map((r) => r.status), ...infra.statuses];

  if (models.length === 0 && opts.previous?.models.length) {
    return { catalog: { ...opts.previous, sources }, sources, fx: infra.fx };
  }

  const catalog: PriceCatalog = {
    models,
    hosting: infra.hosting.length ? infra.hosting : (opts.previous?.hosting ?? []),
    gpu: infra.gpu.length ? infra.gpu : (opts.previous?.gpu ?? []),
    fetchedAt: new Date().toISOString(),
    sources,
  };
  await saveCatalog(catalog);

  try {
    const { loadHistory, recordSnapshot, saveHistory } = await import("./history");
    await saveHistory(recordSnapshot(await loadHistory(), catalog));
  } catch {
    // History is a bonus; never let it break a refresh.
  }

  return { catalog, sources, fx: infra.fx };
}

export function isStale(catalog: PriceCatalog | null, now = Date.now()): boolean {
  if (!catalog?.fetchedAt) return true;
  const t = Date.parse(catalog.fetchedAt);
  return !Number.isFinite(t) || now - t > REFRESH_AFTER_MS;
}

// ---------------------------------------------------------------------------
// query
// ---------------------------------------------------------------------------

export interface ModelQuery {
  /** Free-text match against name, key, provider and family. */
  text?: string;
  modality?: string;
  providers?: string[];
  minContext?: number;
  requireTools?: boolean;
  requireVision?: boolean;
  requireReasoning?: boolean;
  requireCaching?: boolean;
  requireOpenWeights?: boolean;
  /**
   * Only listings the feed explicitly classifies as free — a `:free` variant,
   * or a provider tier published at $0. Deliberately stricter than
   * `maxBlendedPrice: 0`, which also admits anything the feed simply left
   * unpriced.
   */
  requireFree?: boolean;
  /**
   * Hide $0 listings that are not verifiably free — seat-licensed models and
   * ones the feed leaves ambiguous.
   *
   * On by default in the UI. A plan-gated model priced at $0 outranks every
   * real offer on price while being unbuyable to anyone who has not bought the
   * plan, so showing it unlabelled at the top would make the whole ranking a
   * lie. Genuinely free tiers (explicitly marked upstream) are unaffected.
   */
  excludeUnpriceable?: boolean;
  maxBlendedPrice?: number;
  /** Only models the user has a configured provider for. */
  onlyConfigured?: string[];
}

export interface ModelCandidate {
  key: string;
  providerSlug: string;
  price?: number;
  performance?: number;
  reliability?: number;
  specFit?: number;
  availability?: string;
  model: PricedModel;
}

export function matches(model: PricedModel, q: ModelQuery): boolean {
  if (q.modality && model.modality !== q.modality) return false;
  if (model.deprecated) return false;
  if (q.providers?.length && !q.providers.includes(model.providerSlug)) return false;
  if (
    q.excludeUnpriceable &&
    (model.pricing.model === "subscription" || model.pricing.model === "unknown")
  ) {
    return false;
  }
  if (q.minContext && (model.capabilities.contextWindow ?? 0) < q.minContext) return false;
  if (q.requireTools && model.capabilities.supportsTools !== true) return false;
  if (q.requireVision && model.capabilities.supportsVision !== true) return false;
  if (q.requireReasoning && model.capabilities.supportsReasoning !== true) return false;
  if (q.requireCaching && model.capabilities.supportsCaching !== true) return false;
  if (q.requireOpenWeights && model.capabilities.openWeights !== true) return false;
  if (q.requireFree && model.pricing.model !== "free") return false;
  if (q.onlyConfigured && !q.onlyConfigured.includes(model.providerSlug)) return false;

  if (q.maxBlendedPrice !== undefined) {
    const price = blended(model.pricing.input, model.pricing.output);
    if (price === undefined || price > q.maxBlendedPrice) return false;
  }
  if (q.text?.trim()) {
    const needle = q.text.trim().toLowerCase();
    const hay = `${model.name} ${model.modelKey} ${model.providerSlug} ${model.providerName} ${model.family ?? ""}`.toLowerCase();
    if (!needle.split(/\s+/).every((word) => hay.includes(word))) return false;
  }
  return true;
}

/**
 * Reliability for a model record: how fresh it is and how directly it came from
 * the party that sets the price.
 *
 * There is no affiliate or commission input anywhere in this module — not
 * because of a policy, but because no such field exists on `PricedModel`. The
 * ranking cannot be biased by something it cannot see.
 */
export function modelReliability(model: PricedModel): number {
  const fresh = freshnessScore(model.provenance.fetchedAt);
  // A provider's own listing outranks an aggregator's copy of it.
  const authority = model.providerSlug === "openrouter" ? 0.75 : 0.9;
  const liveFactor = model.provenance.kind === "live" ? 1.0 : 0.9;
  return quantize(Math.max(0, Math.min(1, (0.6 * authority + 0.4 * fresh) * liveFactor)));
}

export function toCandidate(model: PricedModel, q: ModelQuery = {}): ModelCandidate {
  const specFit =
    q.minContext !== undefined
      ? specFitScore({ context: q.minContext }, { context: model.capabilities.contextWindow })
      : undefined;
  return {
    key: model.modelKey,
    providerSlug: model.providerSlug,
    price: blended(model.pricing.input, model.pricing.output),
    performance: model.quality?.intelligence,
    reliability: modelReliability(model),
    specFit,
    availability: model.deprecated ? "discontinued" : "available",
    model,
  };
}

/** Filter then rank. Returns scored candidates, best first. */
export function searchModels(
  catalog: PriceCatalog,
  query: ModelQuery = {},
  weights: Weights = PRESETS.bestValue,
  limit = 100,
): Scored<ModelCandidate>[] {
  const candidates = catalog.models
    .filter((m) => matches(m, query))
    .map((m) => toCandidate(m, query));
  return rank(candidates, weights, limit);
}

/**
 * How many models the `excludeUnpriceable` filter is hiding for a given query.
 *
 * Surfaced in the UI rather than silently dropped: quietly removing rows makes
 * a comparison tool lie about what it matched, which is the same objection as
 * quietly widening a filter.
 */
export function countUnpriceable(catalog: PriceCatalog, query: ModelQuery = {}): number {
  const withoutFilter = { ...query, excludeUnpriceable: false };
  return catalog.models.filter(
    (m) =>
      matches(m, withoutFilter) &&
      (m.pricing.model === "subscription" || m.pricing.model === "unknown"),
  ).length;
}

/** Distinct provider slugs present in the catalog, with model counts. */
export function providerCounts(catalog: PriceCatalog, modality = "llm"): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of catalog.models) {
    if (modality && m.modality !== modality) continue;
    counts.set(m.providerSlug, (counts.get(m.providerSlug) ?? 0) + 1);
  }
  return counts;
}
