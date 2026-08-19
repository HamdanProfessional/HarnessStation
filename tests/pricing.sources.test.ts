import { describe, expect, it } from "vitest";
import {
  allZeroProviders,
  classifyModality,
  classifyPricingModel,
  parseModelsDev,
  parseOpenRouter,
} from "../src/lib/pricing/sources";
import { canonicalModelKey, matches, mergeModels, modelReliability } from "../src/lib/pricing/catalog";
import { blended, perTokenToMtok, quantize } from "../src/lib/pricing/money";
import type { PricedModel } from "../src/lib/pricing/types";

const AT = "2026-08-17T00:00:00.000Z";

// Trimmed from a real https://openrouter.ai/api/v1/models response.
const OPENROUTER_FIXTURE = {
  data: [
    {
      id: "anthropic/claude-opus-5-fast",
      name: "Claude Opus 5 (Fast)",
      created: 1784912546,
      context_length: 1000000,
      architecture: {
        modality: "text+image+file->text",
        input_modalities: ["text", "image", "file"],
        output_modalities: ["text"],
      },
      pricing: {
        prompt: "0.00001",
        completion: "0.00005",
        web_search: "0.01",
        input_cache_read: "0.000001",
        input_cache_write: "0.0000125",
      },
      top_provider: { context_length: 1000000, max_completion_tokens: 128000 },
      supported_parameters: ["tools", "tool_choice", "reasoning", "structured_outputs"],
      benchmarks: { artificial_analysis: { intelligence_index: 71, coding_index: 80.2 } },
    },
    {
      id: "vendor/dynamic-price",
      name: "Dynamically Priced",
      pricing: { prompt: "-1", completion: "-1" },
    },
    {
      id: "vendor/free-model",
      name: "Free Model",
      pricing: { prompt: "0", completion: "0" },
      context_length: 32768,
    },
    {
      id: "vendor/bad-cache",
      name: "Bad Cache",
      // cache read above base input — a real upstream quirk, not a parse error
      pricing: { prompt: "0.000001", completion: "0.000002", input_cache_read: "0.00001" },
    },
  ],
};

// Trimmed from a real https://models.dev/api.json response.
const MODELS_DEV_FIXTURE = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    doc: "https://docs.anthropic.com",
    models: {
      "claude-opus-5": {
        id: "claude-opus-5",
        name: "Claude Opus 5",
        family: "claude-opus",
        reasoning: true,
        tool_call: true,
        structured_output: true,
        knowledge: "2026-01-31",
        release_date: "2026-04-14",
        open_weights: false,
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        limit: { context: 1000000, output: 128000 },
        cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
      },
      "no-price": { id: "no-price", name: "Unpriced", cost: {} },
    },
  },
};

describe("perTokenToMtok", () => {
  it("converts a per-token string to per-Mtok", () => {
    expect(perTokenToMtok("0.00001")).toBe(10);
    expect(perTokenToMtok("0.000001")).toBe(1);
  });

  it("keeps zero as a real price", () => {
    expect(perTokenToMtok("0")).toBe(0);
  });

  it("treats a negative sentinel as unknown, not free", () => {
    expect(perTokenToMtok("-1")).toBeUndefined();
  });

  it("treats empty and null as unpublished", () => {
    expect(perTokenToMtok("")).toBeUndefined();
    expect(perTokenToMtok(null)).toBeUndefined();
    expect(perTokenToMtok(undefined)).toBeUndefined();
  });
});

describe("blended", () => {
  it("weights input 3:1 against output by default", () => {
    // (3*3 + 15) / 4 = 6
    expect(blended(3, 15)).toBe(6);
  });
  it("returns undefined when neither side is published", () => {
    expect(blended(undefined, undefined)).toBeUndefined();
  });
});

describe("parseOpenRouter", () => {
  const models = parseOpenRouter(OPENROUTER_FIXTURE, AT);

  it("skips models with no usable price", () => {
    expect(models.find((m) => m.modelKey === "vendor/dynamic-price")).toBeUndefined();
  });

  it("keeps genuinely free models", () => {
    const free = models.find((m) => m.modelKey === "vendor/free-model");
    expect(free?.pricing.input).toBe(0);
    expect(free?.pricing.model).toBe("free");
  });

  it("converts prices to per-Mtok", () => {
    const m = models.find((m) => m.modelKey === "anthropic/claude-opus-5-fast")!;
    expect(m.pricing.input).toBe(10);
    expect(m.pricing.output).toBe(50);
    expect(m.pricing.cacheRead).toBe(1);
    expect(m.pricing.cacheWrite).toBe(12.5);
  });

  it("normalizes web search to per 1,000 requests", () => {
    const m = models.find((m) => m.modelKey === "anthropic/claude-opus-5-fast")!;
    expect(m.pricing.webSearchPer1k).toBe(10);
  });

  it("drops a cache price above the base input rate", () => {
    const m = models.find((m) => m.modelKey === "vendor/bad-cache")!;
    expect(m.pricing.cacheRead).toBeUndefined();
    expect(m.pricing.input).toBe(1);
  });

  it("reads capabilities from supported_parameters", () => {
    const m = models.find((m) => m.modelKey === "anthropic/claude-opus-5-fast")!;
    expect(m.capabilities.supportsTools).toBe(true);
    expect(m.capabilities.supportsVision).toBe(true);
    expect(m.capabilities.supportsReasoning).toBe(true);
    expect(m.capabilities.contextWindow).toBe(1000000);
  });

  it("carries the quality index through", () => {
    const m = models.find((m) => m.modelKey === "anthropic/claude-opus-5-fast")!;
    expect(m.quality?.intelligence).toBe(71);
  });

  it("attributes rows to OpenRouter, not the developer", () => {
    expect(models.every((m) => m.providerSlug === "openrouter")).toBe(true);
  });

  it("returns an empty array for a malformed payload", () => {
    expect(parseOpenRouter({}, AT)).toEqual([]);
    expect(parseOpenRouter(null, AT)).toEqual([]);
  });
});

describe("parseModelsDev", () => {
  const models = parseModelsDev(MODELS_DEV_FIXTURE, AT);

  it("reads per-Mtok prices as published", () => {
    const m = models.find((m) => m.modelKey === "claude-opus-5")!;
    expect(m.pricing.input).toBe(5);
    expect(m.pricing.output).toBe(25);
    expect(m.pricing.cacheRead).toBe(0.5);
  });

  it("drops models with no published price", () => {
    expect(models.find((m) => m.modelKey === "no-price")).toBeUndefined();
  });

  it("attributes rows to the real provider", () => {
    expect(models[0].providerSlug).toBe("anthropic");
    expect(models[0].providerName).toBe("Anthropic");
  });

  it("returns an empty array for a malformed payload", () => {
    expect(parseModelsDev(null, AT)).toEqual([]);
  });
});

describe("classifyPricingModel", () => {
  it("treats a nonzero price as ordinary metered usage", () => {
    expect(
      classifyPricingModel({ providerSlug: "acme", modelKey: "m", input: 1, output: 2 }),
    ).toBe("usage");
  });

  it("trusts an explicit free marker on the model id", () => {
    expect(
      classifyPricingModel({ providerSlug: "kilo", modelKey: "tencent/hy3:free", input: 0, output: 0 }),
    ).toBe("free");
  });

  it("reads plan providers off their own slug", () => {
    expect(
      classifyPricingModel({ providerSlug: "alibaba-token-plan", modelKey: "kimi", input: 0, output: 0 }),
    ).toBe("subscription");
    expect(
      classifyPricingModel({ providerSlug: "zai-coding-plan", modelKey: "glm", input: 0, output: 0 }),
    ).toBe("subscription");
  });

  it("treats a provider that charges nothing for anything as seat-licensed", () => {
    // Reselling Claude Opus at $0 is a seat fee, not a price.
    expect(
      classifyPricingModel({
        providerSlug: "kenari",
        modelKey: "claude-opus-4-7",
        input: 0,
        output: 0,
        allZeroProvider: true,
      }),
    ).toBe("subscription");
  });

  it("admits it cannot tell rather than guessing", () => {
    expect(
      classifyPricingModel({ providerSlug: "nvidia", modelKey: "nvidia/llama-3.3", input: 0, output: 0 }),
    ).toBe("unknown");
  });
});

describe("allZeroProviders", () => {
  const rows = (slug: string, prices: number[]) =>
    prices.map((p) => ({ providerSlug: slug, input: p, output: p }));

  it("flags a provider whose every model is zero", () => {
    expect(allZeroProviders(rows("kenari", [0, 0, 0, 0, 0])).has("kenari")).toBe(true);
  });

  it("does not flag a provider with a free tier alongside paid models", () => {
    expect(allZeroProviders(rows("nvidia", [0, 0, 0, 0, 1])).has("nvidia")).toBe(false);
  });

  it("ignores providers too small to draw a conclusion from", () => {
    expect(allZeroProviders(rows("tiny", [0, 0])).has("tiny")).toBe(false);
  });
});

describe("classifyModality", () => {
  it("keeps a chat model an llm", () => {
    expect(classifyModality({ outputModalities: ["text"], name: "GPT" })).toBe("llm");
  });
  it("detects embeddings, rerankers and moderation", () => {
    expect(classifyModality({ key: "text-embedding-3-large" })).toBe("embedding");
    expect(classifyModality({ key: "bge-reranker-v2" })).toBe("rerank");
    expect(classifyModality({ key: "llama-guard-3" })).toBe("moderation");
  });
  it("detects speech and image models", () => {
    expect(classifyModality({ key: "whisper-large-v3" })).toBe("speech");
    expect(classifyModality({ outputModalities: ["image"] })).toBe("image");
  });
});

describe("mergeModels", () => {
  const base = (over: Partial<PricedModel>): PricedModel => ({
    id: "x:y",
    modelKey: "y",
    providerSlug: "x",
    providerName: "X",
    name: "Y",
    modality: "llm",
    pricing: { model: "usage", input: 1, output: 2 },
    capabilities: {},
    provenance: { source: "test", fetchedAt: AT, kind: "live" },
    ...over,
  });

  it("prefers the record with more published fields", () => {
    const sparse = base({});
    const rich = base({ capabilities: { contextWindow: 128000, supportsTools: true } });
    expect(mergeModels([[sparse], [rich]])[0].capabilities.contextWindow).toBe(128000);
    expect(mergeModels([[rich], [sparse]])[0].capabilities.contextWindow).toBe(128000);
  });

  it("propagates a quality index to the same model sold elsewhere", () => {
    // The intelligence index is a property of the model, not of who resells it.
    const viaOpenRouter = base({
      id: "openrouter:anthropic/claude-opus-5",
      modelKey: "anthropic/claude-opus-5",
      providerSlug: "openrouter",
      quality: { intelligence: 71 },
    });
    const viaAnthropic = base({
      id: "anthropic:claude-opus-5",
      modelKey: "claude-opus-5",
      providerSlug: "anthropic",
    });
    const merged = mergeModels([[viaOpenRouter], [viaAnthropic]]);
    const direct = merged.find((m) => m.providerSlug === "anthropic")!;
    expect(direct.quality?.intelligence).toBe(71);
  });

  it("does not overwrite a model's own quality index", () => {
    const a = base({ id: "a:m", providerSlug: "a", modelKey: "m", quality: { intelligence: 50 } });
    const b = base({ id: "b:m", providerSlug: "b", modelKey: "m", quality: { intelligence: 90 } });
    const merged = mergeModels([[a], [b]]);
    expect(merged.find((m) => m.providerSlug === "a")!.quality?.intelligence).toBe(50);
    expect(merged.find((m) => m.providerSlug === "b")!.quality?.intelligence).toBe(90);
  });
});

describe("canonicalModelKey", () => {
  it("strips the vendor namespace and punctuation", () => {
    expect(canonicalModelKey("anthropic/claude-opus-5")).toBe(canonicalModelKey("claude-opus-5"));
    expect(canonicalModelKey("openai/gpt-4o")).toBe("gpt4o");
  });
  it("keeps genuinely different versions distinct", () => {
    expect(canonicalModelKey("gpt-4o")).not.toBe(canonicalModelKey("gpt-4o-2024-08-06"));
  });
});

describe("matches", () => {
  const m: PricedModel = {
    id: "acme:big",
    modelKey: "big",
    providerSlug: "acme",
    providerName: "Acme",
    name: "Big Model",
    modality: "llm",
    pricing: { model: "usage", input: 1, output: 3 },
    capabilities: { contextWindow: 200_000, supportsTools: true, supportsVision: false },
    provenance: { source: "test", fetchedAt: AT, kind: "live" },
  };

  it("filters on capability requirements", () => {
    expect(matches(m, { requireTools: true })).toBe(true);
    expect(matches(m, { requireVision: true })).toBe(false);
    // Unpublished is not the same as false, and must not pass a hard filter.
    expect(matches(m, { requireCaching: true })).toBe(false);
  });

  it("filters on context and price", () => {
    expect(matches(m, { minContext: 128_000 })).toBe(true);
    expect(matches(m, { minContext: 500_000 })).toBe(false);
    expect(matches(m, { maxBlendedPrice: 2 })).toBe(true); // blended = 1.5
    expect(matches(m, { maxBlendedPrice: 1 })).toBe(false);
  });

  it("matches free text across name, key and provider", () => {
    expect(matches(m, { text: "big" })).toBe(true);
    expect(matches(m, { text: "acme big" })).toBe(true);
    expect(matches(m, { text: "nonsense" })).toBe(false);
  });

  it("excludes deprecated models", () => {
    expect(matches({ ...m, deprecated: true }, {})).toBe(false);
  });

  it("can exclude listings whose $0 is not verifiably free", () => {
    const sub = { ...m, pricing: { ...m.pricing, model: "subscription" as const } };
    const unknown = { ...m, pricing: { ...m.pricing, model: "unknown" as const } };
    const free = { ...m, pricing: { ...m.pricing, model: "free" as const } };

    expect(matches(sub, {})).toBe(true);
    expect(matches(sub, { excludeUnpriceable: true })).toBe(false);
    expect(matches(unknown, { excludeUnpriceable: true })).toBe(false);
    // A genuinely free tier is a real, buyable offer and must survive.
    expect(matches(free, { excludeUnpriceable: true })).toBe(true);
  });
});

describe("modelReliability", () => {
  it("ranks a first-party feed above an aggregator", () => {
    const fresh = { source: "s", fetchedAt: new Date().toISOString(), kind: "live" as const };
    const direct = modelReliability({ providerSlug: "anthropic", provenance: fresh } as PricedModel);
    const resold = modelReliability({ providerSlug: "openrouter", provenance: fresh } as PricedModel);
    expect(direct).toBeGreaterThan(resold);
  });

  it("decays as the record ages", () => {
    const old = new Date(Date.now() - 200 * 3600 * 1000).toISOString();
    const now = new Date().toISOString();
    const a = modelReliability({ providerSlug: "x", provenance: { source: "s", fetchedAt: now, kind: "live" } } as PricedModel);
    const b = modelReliability({ providerSlug: "x", provenance: { source: "s", fetchedAt: old, kind: "live" } } as PricedModel);
    expect(a).toBeGreaterThan(b);
  });
});

describe("quantize", () => {
  it("makes float-dusty values compare equal", () => {
    expect(quantize(0.1 + 0.2)).toBe(0.3);
  });
});
