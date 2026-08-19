/**
 * Price sources.
 *
 * Both feeds are public, unauthenticated, and send `Access-Control-Allow-Origin: *`,
 * so they work from the desktop app *and* from the browser build with no key,
 * no account and no gateway. That is the whole reason this feature can live
 * inside HarnessStation without compromising the "ships with no API keys of its
 * own" position — we are reading published price lists, not calling a service on
 * the user's behalf.
 *
 *   models.dev  — ~190 providers, ~6,700 models. The broad catalog: prices
 *                 already per-Mtok, plus capability flags and context limits.
 *   OpenRouter  — ~410 models it resells. Narrower, but it carries cache
 *                 read/write prices and an `artificial_analysis` quality index
 *                 for a subset, which is where the performance axis comes from.
 *
 * OpenRouter rows describe "buying model X *through* OpenRouter", which is a
 * genuinely different product from buying it from the developer — different
 * price, different routing, different limits. It is therefore recorded as its
 * own provider rather than merged into the developer's listing.
 */

import { fetch } from "@tauri-apps/plugin-http";
import { perTokenToMtok, quantize, toNumber } from "./money";
import type {
  ModelCapabilities,
  PricedModel,
  QualityIndex,
  SourceStatus,
  TokenPricing,
} from "./types";

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": "HarnessStation" }, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

/**
 * One shared classifier, so a Whisper or a prompt-guard model cannot be an
 * "llm" in one feed and something else in the other.
 */
export function classifyModality(input: {
  inputModalities?: string[];
  outputModalities?: string[];
  maxOutputTokens?: number;
  name?: string;
  key?: string;
}): string {
  const hay = `${input.key ?? ""} ${input.name ?? ""}`.toLowerCase();
  const out = (input.outputModalities ?? []).map((m) => m.toLowerCase());
  const inp = (input.inputModalities ?? []).map((m) => m.toLowerCase());

  if (out.includes("image")) return "image";
  if (out.includes("video")) return "video";
  if (out.includes("audio") || /\btts\b|text-to-speech|speech-\d|\bvoice\b/.test(hay)) return "speech";
  if (inp.includes("audio") && out.includes("text")) return "speech";
  if (/embed|embedding/.test(hay)) return "embedding";
  if (/rerank/.test(hay)) return "rerank";
  if (/moderation|guard|safety|shield/.test(hay)) return "moderation";
  if (/whisper|transcribe|transcription/.test(hay)) return "speech";
  // A generative chat model has to be able to write a real reply. A tiny or
  // absent output cap is the tell for a classifier mislabelled as an LLM.
  if (input.maxOutputTokens !== undefined && input.maxOutputTokens > 0 && input.maxOutputTokens < 16) {
    return "moderation";
  }
  return "llm";
}

/**
 * Decide what a price of zero actually means.
 *
 * The feeds publish `cost: 0` identically for a genuinely free tier and for a
 * model whose token price is zero only because a seat licence grants access.
 * Left unclassified, the second kind wins every "cheapest" ranking while being
 * unbuyable — so the three cases are separated on published signals, and
 * anything still ambiguous is marked `unknown` rather than guessed at.
 *
 * The signals, in order of confidence:
 *
 *  1. An explicit free marker on the model id (`:free`, `-free`) — that is the
 *     upstream saying so, and it is the strongest evidence available.
 *  2. A provider whose slug says it sells plans (`*-token-plan`,
 *     `*-coding-plan`). Named by the feed itself.
 *  3. A provider quoting zero for *every* model it lists, including frontier
 *     models built by somebody else. A reseller charging nothing for Claude
 *     Opus is charging for a seat. Requires at least 5 models, so a provider
 *     with one or two entries is not swept up by a small sample.
 *
 * `allZeroProviders` is computed per-feed and passed in, because the rule
 * depends on the whole provider's catalog rather than a single row.
 */
export function classifyPricingModel(args: {
  providerSlug: string;
  modelKey: string;
  input?: number;
  output?: number;
  allZeroProvider?: boolean;
}): TokenPricing["model"] {
  const { providerSlug, modelKey, input, output, allZeroProvider } = args;
  const isZero = (input ?? 0) === 0 && (output ?? 0) === 0;
  if (!isZero) return "usage";

  if (/[:\-_]free\b|\bfree\b/i.test(modelKey)) return "free";
  if (/(^|-)(token-|coding-)?plan(-|$)/i.test(providerSlug)) return "subscription";
  if (allZeroProvider) return "subscription";
  return "unknown";
}

/** Providers for which every priced model costs zero. */
export function allZeroProviders(
  rows: { providerSlug: string; input?: number; output?: number }[],
  minModels = 5,
): Set<string> {
  const tally = new Map<string, { total: number; zero: number }>();
  for (const r of rows) {
    const t = tally.get(r.providerSlug) ?? { total: 0, zero: 0 };
    t.total += 1;
    if ((r.input ?? 0) === 0 && (r.output ?? 0) === 0) t.zero += 1;
    tally.set(r.providerSlug, t);
  }
  const out = new Set<string>();
  for (const [slug, t] of tally) {
    if (t.total >= minModels && t.zero === t.total) out.add(slug);
  }
  return out;
}

function isoDate(value: unknown): string | undefined {
  if (!value) return undefined;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

// ---------------------------------------------------------------------------
// models.dev
// ---------------------------------------------------------------------------

interface ModelsDevModel {
  id?: string;
  name?: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  knowledge?: string;
  release_date?: string;
  open_weights?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  limit?: { context?: number; output?: number };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    reasoning?: number;
  };
}

interface ModelsDevProvider {
  id?: string;
  name?: string;
  doc?: string;
  models?: Record<string, ModelsDevModel>;
}

export function parseModelsDev(payload: unknown, fetchedAt: string): PricedModel[] {
  if (!payload || typeof payload !== "object") return [];
  const out: PricedModel[] = [];

  for (const [providerSlug, raw] of Object.entries(payload as Record<string, ModelsDevProvider>)) {
    if (!raw || typeof raw !== "object") continue;
    const providerName = raw.name || providerSlug;
    for (const [modelKey, m] of Object.entries(raw.models ?? {})) {
      const cost = m.cost ?? {};
      const input = toNumber(cost.input);
      const output = toNumber(cost.output);
      // No published price means no comparable offer. There is no such thing as
      // a ranked model without a price.
      if (input === undefined && output === undefined) continue;

      const inputModalities = m.modalities?.input;
      const outputModalities = m.modalities?.output;
      const capabilities: ModelCapabilities = {
        contextWindow: toNumber(m.limit?.context),
        maxOutputTokens: toNumber(m.limit?.output),
        inputModalities,
        outputModalities,
        supportsTools: m.tool_call,
        supportsVision: inputModalities ? inputModalities.includes("image") : undefined,
        supportsReasoning: m.reasoning,
        supportsCaching: cost.cache_read !== undefined ? true : undefined,
        supportsStructuredOutput: m.structured_output,
        openWeights: m.open_weights,
        knowledgeCutoff: isoDate(m.knowledge),
        releaseDate: isoDate(m.release_date),
      };

      const pricing: TokenPricing = {
        input,
        output,
        cacheRead: toNumber(cost.cache_read),
        cacheWrite: toNumber(cost.cache_write),
        reasoning: toNumber(cost.reasoning),
        // Provisional: a zero here cannot be classified until the whole feed
        // has been read, because the rule depends on the provider's full
        // catalog. Resolved in the second pass below.
        model: "usage",
      };

      out.push({
        id: `${providerSlug}:${modelKey}`,
        modelKey,
        providerSlug,
        providerName,
        name: m.name || modelKey,
        family: m.family,
        modality: classifyModality({
          inputModalities,
          outputModalities,
          maxOutputTokens: capabilities.maxOutputTokens,
          name: m.name,
          key: modelKey,
        }),
        pricing,
        capabilities,
        provenance: {
          source: "models.dev",
          sourceUrl: raw.doc || `https://models.dev/#${providerSlug}`,
          fetchedAt,
          kind: "live",
        },
      });
    }
  }
  return resolveZeroPrices(out);
}

/**
 * Second pass: decide what each zero price means, now that the whole feed is
 * available and per-provider patterns can be seen.
 */
export function resolveZeroPrices(models: PricedModel[]): PricedModel[] {
  const allZero = allZeroProviders(
    models.map((m) => ({
      providerSlug: m.providerSlug,
      input: m.pricing.input,
      output: m.pricing.output,
    })),
  );
  for (const m of models) {
    m.pricing.model = classifyPricingModel({
      providerSlug: m.providerSlug,
      modelKey: m.modelKey,
      input: m.pricing.input,
      output: m.pricing.output,
      allZeroProvider: allZero.has(m.providerSlug),
    });
  }
  return models;
}

// ---------------------------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------------------------

interface OpenRouterModel {
  id?: string;
  name?: string;
  created?: number;
  context_length?: number;
  hugging_face_id?: string | null;
  knowledge_cutoff?: string | null;
  expiration_date?: string | null;
  description?: string;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: Record<string, string>;
  top_provider?: { context_length?: number; max_completion_tokens?: number };
  supported_parameters?: string[];
  reasoning?: { mandatory?: boolean };
  benchmarks?: {
    artificial_analysis?: {
      intelligence_index?: number;
      coding_index?: number;
      agentic_index?: number;
    };
  };
}

function orModalities(arch: OpenRouterModel["architecture"]): [string[] | undefined, string[] | undefined] {
  let inputs = arch?.input_modalities;
  let outputs = arch?.output_modalities;
  if (!inputs && arch?.modality) {
    const [head, tail] = String(arch.modality).split("->");
    inputs = head?.split("+").filter(Boolean);
    outputs = tail?.split("+").filter(Boolean);
  }
  return [inputs?.length ? inputs : undefined, outputs?.length ? outputs : undefined];
}

export function parseOpenRouter(payload: unknown, fetchedAt: string): PricedModel[] {
  const rows = (payload as { data?: OpenRouterModel[] })?.data;
  if (!Array.isArray(rows)) return [];
  const out: PricedModel[] = [];

  for (const entry of rows) {
    const modelKey = String(entry.id ?? "");
    if (!modelKey) continue;
    const p = entry.pricing ?? {};
    const input = perTokenToMtok(p.prompt);
    const output = perTokenToMtok(p.completion);
    if (input === undefined && output === undefined) continue;

    const [inputModalities, outputModalities] = orModalities(entry.architecture);
    const supported = new Set(entry.supported_parameters ?? []);
    const maxOutputTokens = toNumber(entry.top_provider?.max_completion_tokens);

    let cacheRead = perTokenToMtok(p.input_cache_read);
    // OpenRouter occasionally reports a cache-read price above the base input
    // price for a routed provider. That is a real upstream quirk, not a parse
    // error, so the cache price is dropped rather than the whole record.
    if (cacheRead !== undefined && input !== undefined && cacheRead > input) cacheRead = undefined;

    const aa = entry.benchmarks?.artificial_analysis;
    const quality: QualityIndex | undefined = aa
      ? {
          intelligence: toNumber(aa.intelligence_index),
          coding: toNumber(aa.coding_index),
          agentic: toNumber(aa.agentic_index),
        }
      : undefined;

    const webSearch = toNumber(p.web_search);
    const vendor = modelKey.split("/")[0] || undefined;

    out.push({
      id: `openrouter:${modelKey}`,
      modelKey,
      providerSlug: "openrouter",
      providerName: "OpenRouter",
      name: entry.name || modelKey,
      family: vendor,
      developer: vendor,
      modality: classifyModality({
        inputModalities,
        outputModalities,
        maxOutputTokens,
        name: entry.name,
        key: modelKey,
      }),
      deprecated: !!entry.expiration_date,
      pricing: {
        input,
        output,
        cacheRead,
        cacheWrite: perTokenToMtok(p.input_cache_write),
        reasoning: perTokenToMtok(p.internal_reasoning),
        imageInput: perTokenToMtok(p.image),
        perRequest: toNumber(p.request),
        // OpenRouter quotes web search per request; normalize to per 1,000.
        webSearchPer1k: webSearch === undefined ? undefined : quantize(webSearch * 1000),
        model: "usage", // resolved in the second pass below
      },
      capabilities: {
        contextWindow: toNumber(entry.context_length) ?? toNumber(entry.top_provider?.context_length),
        maxOutputTokens,
        inputModalities,
        outputModalities,
        supportsTools: supported.has("tools") || supported.has("tool_choice"),
        supportsVision: inputModalities ? inputModalities.includes("image") : undefined,
        supportsReasoning: supported.has("reasoning") || !!entry.reasoning?.mandatory,
        supportsCaching: cacheRead !== undefined,
        supportsStructuredOutput: supported.has("structured_outputs"),
        openWeights: entry.hugging_face_id ? true : undefined,
        knowledgeCutoff: isoDate(entry.knowledge_cutoff),
        releaseDate: entry.created
          ? new Date(entry.created * 1000).toISOString().slice(0, 10)
          : undefined,
        // OpenRouter publishes neither batch pricing nor per-key rate limits.
        // Leaving these undefined is correct; a `false` would be a claim we
        // cannot support.
        supportsBatch: undefined,
      },
      quality,
      provenance: {
        source: "openrouter",
        sourceUrl: `https://openrouter.ai/${modelKey}`,
        fetchedAt,
        kind: "live",
      },
    });
  }
  return resolveZeroPrices(out);
}

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------

export interface SourceResult {
  models: PricedModel[];
  status: SourceStatus;
}

async function runSource(
  source: string,
  url: string,
  parse: (payload: unknown, fetchedAt: string) => PricedModel[],
  signal?: AbortSignal,
): Promise<SourceResult> {
  const started = Date.now();
  const fetchedAt = new Date().toISOString();
  try {
    const models = parse(await getJson(url, signal), fetchedAt);
    return {
      models,
      status: { source, ok: true, count: models.length, fetchedAt, ms: Date.now() - started },
    };
  } catch (e) {
    return {
      models: [],
      status: {
        source,
        ok: false,
        count: 0,
        error: (e as Error).message || String(e),
        fetchedAt,
        ms: Date.now() - started,
      },
    };
  }
}

/**
 * Fetch every model source concurrently.
 *
 * One feed failing must not empty the table, so each source is settled
 * independently and its outcome reported. A partial catalog with a visible
 * "models.dev unreachable" note is far more useful than a blank page.
 */
export async function fetchModelSources(signal?: AbortSignal): Promise<SourceResult[]> {
  return Promise.all([
    runSource("models.dev", MODELS_DEV_URL, parseModelsDev, signal),
    runSource("openrouter", OPENROUTER_URL, parseOpenRouter, signal),
  ]);
}
