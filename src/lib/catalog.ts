/** A concrete, downloadable model file (one repo + one quant). */
export interface CatalogModel {
  publisher: string;
  model: string;
  file: string;
  url: string;
  sizeMB: number;
  quant: string;
  blurb: string;
}

/** A staff-pick model with multiple quantizations to choose from. */
export interface CatalogEntry {
  publisher: string; // HF user, e.g. "bartowski"
  repo: string; // HF repo name (usually ends in -GGUF)
  fileBase: string; // filename prefix before "-<QUANT>.gguf"
  displayName: string;
  params: string; // e.g. "8B"
  blurb: string;
  quants: { q: string; sizeMB: number }[];
  defaultQuant?: string;
}

/** Rough GGUF size (MB) for a given param count + quant, for fit badges. */
function q(quant: string, sizeMB: number) {
  return { q: quant, sizeMB };
}

/** Standard quant set for a model, sizes scaled from billions of params. */
function quantsFor(billions: number): { q: string; sizeMB: number }[] {
  const gb = (perB: number) => Math.round(billions * perB * 1024);
  return [
    q("Q4_K_S", gb(0.58)),
    q("Q4_K_M", gb(0.62)),
    q("Q5_K_M", gb(0.72)),
    q("Q6_K", gb(0.82)),
    q("Q8_0", gb(1.06)),
  ];
}

/** Category grouping for the cloud-provider cards. */
export const CLOUD_CATEGORY: Record<string, string> = {
  groq: "Free & fast",
  gemini: "Free & fast",
  cerebras: "Free & fast",
  mistral: "Free & fast",
  zai: "Frontier APIs",
  "zai-coding": "Coding plans (flat-rate)",
  minimax: "Coding plans (flat-rate)",
  moonshot: "Coding plans (flat-rate)",
  openrouter: "Aggregators (many models)",
  together: "Aggregators (many models)",
  fireworks: "Aggregators (many models)",
  deepinfra: "Aggregators (many models)",
  nebius: "Aggregators (many models)",
  novita: "Aggregators (many models)",
  chutes: "Aggregators (many models)",
  deepseek: "Frontier APIs",
  xai: "Frontier APIs",
  qwen: "Frontier APIs",
  "ollama-cloud": "Frontier APIs",
  openai: "Frontier APIs",
  anthropic: "Frontier APIs",
  perplexity: "Frontier APIs",
  cohere: "Frontier APIs",
  sambanova: "Free & fast",
  nvidia: "Free & fast",
  hyperbolic: "Aggregators (many models)",
  siliconflow: "Aggregators (many models)",
  featherless: "Aggregators (many models)",
  lambda: "Aggregators (many models)",
  "github-models": "Free & fast",
  avian: "Free & fast",
  upstage: "Frontier APIs",
  scaleway: "Aggregators (many models)",
  aimlapi: "Aggregators (many models)",
  "inference-net": "Aggregators (many models)",
  nscale: "Aggregators (many models)",
};

export const CLOUD_CATEGORY_ORDER = [
  "Free & fast",
  "Coding plans (flat-rate)",
  "Frontier APIs",
  "Aggregators (many models)",
];

export function resolveCatalog(e: CatalogEntry, quant: string): CatalogModel {
  const qq = e.quants.find((x) => x.q === quant) ?? e.quants[0];
  const file = `${e.fileBase}-${qq.q}.gguf`;
  return {
    publisher: e.publisher,
    model: e.repo,
    file,
    url: `https://huggingface.co/${e.publisher}/${e.repo}/resolve/main/${file}`,
    sizeMB: qq.sizeMB,
    quant: qq.q,
    blurb: e.blurb,
  };
}

/** Curated starter catalog (LM Studio "Staff Picks" style), each with quant choices. */
export const CATALOG: CatalogEntry[] = [
  {
    publisher: "LiquidAI",
    repo: "LFM2-1.2B-GGUF",
    fileBase: "LFM2-1.2B",
    displayName: "Liquid LFM2 1.2B",
    params: "1.2B",
    blurb: "Liquid AI's fast edge model — very small, great on CPU / low RAM.",
    quants: quantsFor(1.2),
    defaultQuant: "Q4_K_M",
  },
  {
    publisher: "bartowski",
    repo: "Llama-3.2-1B-Instruct-GGUF",
    fileBase: "Llama-3.2-1B-Instruct",
    displayName: "Llama 3.2 1B Instruct",
    params: "1B",
    blurb: "Tiny and fast — runs on almost anything. Good first test model.",
    quants: quantsFor(1),
    defaultQuant: "Q4_K_M",
  },
  {
    publisher: "bartowski",
    repo: "Llama-3.2-3B-Instruct-GGUF",
    fileBase: "Llama-3.2-3B-Instruct",
    displayName: "Llama 3.2 3B Instruct",
    params: "3B",
    blurb: "Small all-rounder with solid quality for its size.",
    quants: quantsFor(3),
    defaultQuant: "Q4_K_M",
  },
  {
    publisher: "unsloth",
    repo: "gemma-4-E2B-it-GGUF",
    fileBase: "gemma-4-E2B-it",
    displayName: "Gemma 4 E2B",
    params: "2B",
    blurb: "Google's efficient Gemma 4 (E2B). Tiny and fast — great on modest machines.",
    quants: [
      { q: "Q3_K_M", sizeMB: 2420 },
      { q: "Q4_K_M", sizeMB: 2960 },
      { q: "Q5_K_M", sizeMB: 3210 },
      { q: "Q6_K", sizeMB: 4290 },
      { q: "Q8_0", sizeMB: 4810 },
    ],
    defaultQuant: "Q4_K_M",
  },
  {
    publisher: "unsloth",
    repo: "gemma-4-E4B-it-GGUF",
    fileBase: "gemma-4-E4B-it",
    displayName: "Gemma 4 E4B",
    params: "4B",
    blurb: "Google's Gemma 4 (E4B) — a capable small all-rounder.",
    quants: [
      { q: "Q3_K_M", sizeMB: 3870 },
      { q: "Q4_K_M", sizeMB: 4750 },
      { q: "Q5_K_M", sizeMB: 5230 },
      { q: "Q6_K", sizeMB: 6750 },
      { q: "Q8_0", sizeMB: 7810 },
    ],
    defaultQuant: "Q4_K_M",
  },
  {
    publisher: "unsloth",
    repo: "GLM-4.7-Flash-GGUF",
    fileBase: "GLM-4.7-Flash",
    displayName: "GLM-4.7 Flash",
    params: "~30B",
    blurb: "Zhipu's GLM-4.7 Flash — strong mid-size model. Needs a good chunk of RAM/VRAM.",
    quants: [
      { q: "Q3_K_M", sizeMB: 13940 },
      { q: "Q4_K_M", sizeMB: 17460 },
      { q: "Q5_K_M", sizeMB: 20420 },
      { q: "Q6_K", sizeMB: 23550 },
      { q: "Q8_0", sizeMB: 30370 },
    ],
    defaultQuant: "Q4_K_M",
  },
  {
    publisher: "unsloth",
    repo: "Qwen3.6-27B-MTP-GGUF",
    fileBase: "Qwen3.6-27B",
    displayName: "Qwen 3.6 27B (MTP)",
    params: "27B",
    // The only staff pick that can use the "Multi-token prediction" switch in
    // Advanced. MTP heads have to be built into the GGUF; a normal build ignores
    // the flag silently, so a model that actually carries them is worth listing
    // even though 3.8 is the newer generation. No first-party 3.8 MTP build
    // exists yet — when one lands, this entry should follow it.
    blurb:
      "Qwen 3.6 with multi-token-prediction heads built in — turn on 'Multi-token prediction' in Advanced for roughly 1.5–2x tokens/sec, with no second model in memory. Needs llama.cpp build 9200+.",
    quants: [
      { q: "Q3_K_S", sizeMB: 11992 },
      { q: "Q3_K_M", sizeMB: 13179 },
      { q: "IQ4_XS", sizeMB: 14978 },
      { q: "Q4_K_S", sizeMB: 15375 },
      { q: "Q4_K_M", sizeMB: 16314 },
      { q: "Q5_K_M", sizeMB: 18915 },
      { q: "Q6_K", sizeMB: 21824 },
    ],
    defaultQuant: "Q4_K_M",
  },
  {
    publisher: "unsloth",
    repo: "Qwen3.8-27B-GGUF",
    // Sizes are the repo's real byte counts, not the quantsFor() estimate — the
    // Unsloth Dynamic quants don't scale uniformly. Q8_0 is deliberately absent:
    // it's the one file published without the "UD-" prefix, so fileBase wouldn't
    // resolve it.
    fileBase: "Qwen3.8-27B-UD",
    displayName: "Qwen 3.8 27B",
    params: "27B",
    blurb:
      "Alibaba's dense multimodal 27B (Apache 2.0), 262K context. Fits a single 24 GB GPU at Q4. Unsloth Dynamic quants. (Text works out of the box; the vision projector isn't auto-loaded.)",
    quants: [
      { q: "Q2_K_XL", sizeMB: 9373 },
      { q: "IQ3_XXS", sizeMB: 10428 },
      { q: "Q3_K_XL", sizeMB: 12537 },
      { q: "Q4_K_S", sizeMB: 14646 },
      { q: "Q4_K_M", sizeMB: 15701 },
      { q: "Q5_K_M", sizeMB: 18856 },
      { q: "Q6_K", sizeMB: 20965 },
    ],
    defaultQuant: "Q4_K_M",
  },
  {
    publisher: "unsloth",
    repo: "Qwen3.5-122B-A10B-GGUF",
    fileBase: "Qwen3.5-122B-A10B-UD",
    displayName: "Qwen3.5 122B (A10B MoE)",
    params: "122B · 10B active",
    blurb: "Huge MoE — near-frontier quality, only ~10B active params/token. Big download; needs 32 GB+ RAM even at IQ1. Unsloth Dynamic quants.",
    quants: [
      { q: "IQ1_M", sizeMB: 32640 },
      { q: "IQ2_XXS", sizeMB: 34940 },
      { q: "IQ2_M", sizeMB: 37340 },
      { q: "Q2_K_XL", sizeMB: 39900 },
      { q: "IQ3_XXS", sizeMB: 42670 },
      { q: "IQ3_S", sizeMB: 44400 },
    ],
    defaultQuant: "IQ2_M",
  },
  {
    publisher: "prism-ml",
    repo: "Bonsai-27B-gguf",
    fileBase: "Bonsai-27B-dspark",
    displayName: "Bonsai 27B (dspark)",
    params: "27B",
    blurb: "Prism-ML's Bonsai — a compact sparse variant. (Multimodal upstream; vision projector isn't auto-loaded, text works.)",
    quants: [
      { q: "Q4_1", sizeMB: 1700 },
      { q: "bf16", sizeMB: 6950 },
    ],
    defaultQuant: "Q4_1",
  },
];

/** A hosted cloud provider offering free or low-cost model access via an OpenAI-compatible endpoint. */
export interface CloudProvider {
  id: string;
  name: string;
  by: string;
  blurb: string;
  kind: "openai-compatible" | "anthropic";
  baseUrl: string;
  models: string[];
  keyUrl: string; // where to get an API key
  free?: boolean;
}

/**
 * Maps a `CLOUD_PROVIDERS` id to its provider slug in the live price catalog
 * (models.dev, via `lib/pricing/sources`).
 *
 * This list below is hand-maintained and goes stale silently: in Aug 2026 the
 * Groq rows still advertised `llama-3.3-70b-versatile` and the DeepSeek rows
 * still said `deepseek-chat`, months after both endpoints were retired. Nothing
 * caught it, because nothing was checking.
 *
 * The app already fetches ~6,700 priced models with their exact `modelKey`s, so
 * the answer was already in the building — it just wasn't wired to the question.
 * `tests/catalog.live.test.ts` joins the two on this map and reports ids the
 * live feed has never heard of.
 *
 * `null` means "the price catalog doesn't cover this provider", which is a
 * different statement from "we forgot". Both are unverifiable, but only one is
 * a bug. Note `hyperbolic` is deliberately null: models.dev has a `hyper` slug,
 * but that is Charm Hyper, a different company.
 *
 * Omitted ids default to the id itself. A test asserts every provider is
 * accounted for here, so adding a provider without deciding this fails the build
 * rather than quietly opting out of the check.
 */
export const PRICE_SLUG: Record<string, string | null> = {
  gemini: "google",
  together: "togetherai",
  fireworks: "fireworks-ai",
  "zai-coding": "zai-coding-plan",
  moonshot: "moonshotai",
  qwen: "alibaba",
  novita: "novita-ai",
  "inference-net": "inference",
  // Not carried by the price feed — unverifiable, not broken.
  hyperbolic: null,
  sambanova: null,
  featherless: null,
  lambda: null,
  "github-models": null,
  avian: null,
  aimlapi: null,
  nscale: null,
};

/** The price-catalog slug for a provider, or null when it isn't covered. */
export function priceSlugFor(id: string): string | null {
  return id in PRICE_SLUG ? PRICE_SLUG[id] : id;
}

export const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    id: "groq",
    name: "Groq",
    by: "groq.com",
    blurb:
      "Extremely fast inference on open models (GPT-OSS, Qwen, MiniMax) plus Groq's own agentic Compound systems. Generous free tier.",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    // Groq retired the Llama 3.x, Qwen3-32B and Kimi-K2 endpoints — those ids now
    // 404. The last two here are preview models and can move without notice.
    models: [
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "groq/compound",
      "groq/compound-mini",
      "qwen/qwen3.6-27b",
      "minimaxai/minimax-m2.7",
    ],
    keyUrl: "https://console.groq.com/keys",
    free: true,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    by: "ai.google.dev",
    blurb:
      "Google's Gemini models via an OpenAI-compatible endpoint. Free tier available in AI Studio.",
    kind: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: [
      "gemini-3.7-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ],
    keyUrl: "https://aistudio.google.com/apikey",
    free: true,
  },
  {
    id: "ollama-cloud",
    name: "Ollama Cloud",
    by: "ollama.com",
    blurb:
      "Run frontier models on Ollama's hosted GPUs. Uses your ollama.com key. Tip: hit 'refresh' in a chat to pull your exact available models.",
    kind: "openai-compatible",
    baseUrl: "https://ollama.com/v1",
    models: [
      "deepseek-v4-pro:cloud",
      "deepseek-v4-flash:cloud",
      "glm-5.2:cloud",
      "minimax-m3:cloud",
      "kimi-k2.7-code:cloud",
      "qwen3.5:122b-cloud",
      "gemma4:31b-cloud",
      "gpt-oss:120b-cloud",
      "gpt-oss:20b-cloud",
      "nemotron-3-ultra:cloud",
      "nemotron-3-super:120b-cloud",
      "mistral-large-3:cloud",
      "gemini-3-flash-preview:cloud",
    ],
    keyUrl: "https://ollama.com/settings/keys",
    free: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    by: "openrouter.ai",
    blurb:
      "One key for hundreds of models across providers. Many :free variants available.",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    // Which models carry a `:free` variant rotates constantly — these were live at
    // the last refresh. Hit "refresh" in a chat to pull the current list.
    models: [
      "nvidia/nemotron-3.5-lightning:free",
      "liquid/lfm-2.5-2.6b:free",
      "dots-studio/dots-3-note-preview:free",
      "poolside/laguna-s-2.1:free",
    ],
    keyUrl: "https://openrouter.ai/keys",
    free: true,
  },
  {
    id: "cerebras",
    name: "Cerebras",
    by: "cerebras.ai",
    blurb: "Fastest tokens/sec on the market, now serving GPT-OSS and Gemma 4. Free tier for developers.",
    kind: "openai-compatible",
    baseUrl: "https://api.cerebras.ai/v1",
    models: ["gpt-oss-120b", "gemma-4-31b"],
    keyUrl: "https://cloud.cerebras.ai",
    free: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    by: "deepseek.com",
    blurb: "DeepSeek's own API — chat and reasoning models at very low cost.",
    kind: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    // V4 renamed the endpoints: the old `deepseek-chat` / `deepseek-reasoner` ids
    // are no longer in the API docs. Off-peak pricing (UTC) is roughly half.
    models: ["deepseek-v4-pro", "deepseek-v4-flash"],
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    by: "x.ai",
    blurb: "Grok models from xAI via an OpenAI-compatible endpoint.",
    kind: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    models: ["grok-4.6", "grok-4.5", "grok-4.3"],
    keyUrl: "https://console.x.ai",
  },
  {
    id: "mistral",
    name: "Mistral",
    by: "mistral.ai",
    blurb: "Mistral's hosted models (Large, Small, Codestral). Free tier available.",
    kind: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    // `-latest` aliases still resolve (large → Mistral Large 3 / 2512) and keep this
    // row current on their own, so they're preferred over pinned dates where one exists.
    models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "codestral-latest", "ministral-8b-latest"],
    keyUrl: "https://console.mistral.ai/api-keys",
    free: true,
  },
  {
    id: "together",
    name: "Together AI",
    by: "together.ai",
    blurb: "Hundreds of open models on fast GPUs. Pay-as-you-go with free credits.",
    kind: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    models: [
      "deepseek-ai/DeepSeek-V4-Pro",
      "Qwen/Qwen3.8-2.4T-A95B",
      "moonshotai/Kimi-K3",
      "zai-org/GLM-5.2",
      "google/gemma-4-31B-it",
    ],
    keyUrl: "https://api.together.ai/settings/api-keys",
    free: true,
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    by: "fireworks.ai",
    blurb: "Fast serverless inference for open models. Free credits to start.",
    kind: "openai-compatible",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    models: [
      "accounts/fireworks/models/kimi-k3",
      "accounts/fireworks/models/deepseek-v4-pro",
      "accounts/fireworks/models/qwen3p8-2p4t-a95b",
      "accounts/fireworks/models/glm-5p2",
      "accounts/fireworks/models/minimax-m3",
    ],
    keyUrl: "https://fireworks.ai/account/api-keys",
    free: true,
  },
  {
    id: "deepinfra",
    name: "DeepInfra",
    by: "deepinfra.com",
    blurb: "Cheap serverless open models via an OpenAI-compatible API.",
    kind: "openai-compatible",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    models: [
      "deepseek-ai/DeepSeek-V4-Pro-0813",
      "Qwen/Qwen3.8-Max",
      "moonshotai/Kimi-K3",
      "zai-org/GLM-5.2",
    ],
    keyUrl: "https://deepinfra.com/dash/api_keys",
  },
  {
    id: "nebius",
    name: "Nebius AI",
    by: "nebius.com",
    blurb: "Open models on Nebius cloud GPUs. Free tier for new accounts.",
    kind: "openai-compatible",
    baseUrl: "https://api.studio.nebius.com/v1",
    models: [
      "deepseek-ai/DeepSeek-V4-Pro",
      "zai-org/GLM-5.2",
      "moonshotai/Kimi-K3",
      "MiniMaxAI/MiniMax-M3",
    ],
    keyUrl: "https://studio.nebius.com",
    free: true,
  },
  {
    id: "zai",
    name: "Z.ai (GLM)",
    by: "z.ai",
    blurb: "Zhipu's GLM models — strong and cheap, with a generous coding plan. Pay-as-you-go API.",
    kind: "openai-compatible",
    baseUrl: "https://api.z.ai/api/openai/v1",
    models: ["glm-5.3", "glm-5.2", "glm-5.1", "glm-5-turbo", "glm-4.7", "glm-4.7-flash"],
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
  },
  {
    id: "zai-coding",
    name: "Z.ai Coding Plan",
    by: "z.ai",
    blurb:
      "GLM Coding Plan endpoint — flat-rate subscription for heavy coding use. Uses the same z.ai API key on the coding-only URL.",
    kind: "openai-compatible",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    models: ["glm-5.3", "glm-5.2", "glm-5.1", "glm-4.7"],
    keyUrl: "https://z.ai/subscribe",
  },
  {
    id: "minimax",
    name: "MiniMax",
    by: "minimax.io",
    blurb: "MiniMax's own M-series — strong at agentic/coding work. Cheap PAYG plus a flat coding plan.",
    kind: "openai-compatible",
    baseUrl: "https://api.minimax.io/v1",
    models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2"],
    keyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
  },
  {
    id: "moonshot",
    name: "Moonshot (Kimi)",
    by: "moonshot.ai",
    blurb: "Kimi models with huge context. kimi-k2.7-code is a cheap, strong coding model.",
    kind: "openai-compatible",
    baseUrl: "https://api.moonshot.ai/v1",
    models: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.6", "kimi-k2.5"],
    keyUrl: "https://platform.moonshot.ai/console/api-keys",
  },
  {
    id: "qwen",
    name: "Alibaba Qwen",
    by: "aliyun (DashScope)",
    blurb: "Qwen models via Alibaba Model Studio. Strong coder variants; free trial quota.",
    kind: "openai-compatible",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    models: ["qwen3-max", "qwen-plus", "qwen-turbo", "qwen3-coder-plus"],
    keyUrl: "https://modelstudio.console.alibabacloud.com/",
    free: true,
  },
  {
    id: "novita",
    name: "Novita AI",
    by: "novita.ai",
    blurb: "Serverless open models (Llama, DeepSeek, Qwen) at low cost. Free credits to start.",
    kind: "openai-compatible",
    baseUrl: "https://api.novita.ai/v3/openai",
    models: [
      "deepseek/deepseek-v4-pro",
      "deepseek/deepseek-v4-flash",
      "moonshotai/kimi-k3",
      "zai-org/glm-5.2",
      "qwen/qwen3.7-max",
    ],
    keyUrl: "https://novita.ai/settings/key-management",
    free: true,
  },
  {
    id: "chutes",
    name: "Chutes",
    by: "chutes.ai",
    blurb: "Decentralized inference (Bittensor) — many open models near-free ($0–0.30 / 1M tokens).",
    kind: "openai-compatible",
    baseUrl: "https://llm.chutes.ai/v1",
    // Chutes suffixes its ids "-TEE" (models run in a trusted execution
    // environment); an id without it is not a valid model there.
    models: [
      "deepseek-ai/DeepSeek-V4-Flash-0731-TEE",
      "Qwen/Qwen3.8-27B-TEE",
      "moonshotai/Kimi-K3-TEE",
      "zai-org/GLM-5.2-TEE",
    ],
    keyUrl: "https://chutes.ai/app/api",
    free: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    by: "openai.com",
    blurb: "The GPT-5.6 family — Sol (deepest reasoning), Terra (balanced) and Luna (fastest), direct from OpenAI.",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    // The bare `gpt-5.6` alias routes to Sol; the tiers are listed explicitly so
    // the picker shows the cost/latency choice rather than hiding it behind one id.
    // o4-mini was dropped here: deprecated 2026-04-22, shuts down 2026-10-23.
    models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.1"],
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    by: "anthropic.com",
    blurb: "Claude models direct from Anthropic — Fable, Opus, Sonnet and Haiku. Great at coding and tool use.",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    by: "perplexity.ai",
    blurb: "Sonar models with live web search built in — cited, up-to-date answers.",
    kind: "openai-compatible",
    baseUrl: "https://api.perplexity.ai",
    models: ["sonar-pro", "sonar", "sonar-reasoning-pro", "sonar-deep-research"],
    keyUrl: "https://www.perplexity.ai/settings/api",
  },
  {
    id: "cohere",
    name: "Cohere",
    by: "cohere.com",
    blurb: "Command models via Cohere's OpenAI-compatible endpoint. Strong RAG and tool use.",
    kind: "openai-compatible",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    models: ["command-a-plus-05-2026", "command-a-03-2025", "command-a-reasoning-08-2025"],
    keyUrl: "https://dashboard.cohere.com/api-keys",
  },
  {
    id: "sambanova",
    name: "SambaNova Cloud",
    by: "sambanova.ai",
    blurb: "Very fast inference on open models (Llama, DeepSeek, Qwen). Free developer tier.",
    kind: "openai-compatible",
    baseUrl: "https://api.sambanova.ai/v1",
    models: ["Meta-Llama-3.3-70B-Instruct", "DeepSeek-V3-0324", "Qwen3-32B"],
    keyUrl: "https://cloud.sambanova.ai/apis",
    free: true,
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    by: "build.nvidia.com",
    blurb: "Hundreds of open models hosted by NVIDIA with free credits — Llama, DeepSeek, Qwen, Nemotron.",
    kind: "openai-compatible",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    models: [
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-3-ultra-550b-a55b",
      "z-ai/glm-5.2",
      "minimaxai/minimax-m3",
    ],
    keyUrl: "https://build.nvidia.com",
    free: true,
  },
  {
    id: "hyperbolic",
    name: "Hyperbolic",
    by: "hyperbolic.xyz",
    blurb: "Open models at low cost on a fast OpenAI-compatible API. Free credits to start.",
    kind: "openai-compatible",
    baseUrl: "https://api.hyperbolic.xyz/v1",
    models: ["meta-llama/Llama-3.3-70B-Instruct", "deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"],
    keyUrl: "https://app.hyperbolic.xyz/settings",
    free: true,
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    by: "siliconflow.com",
    blurb: "Large catalog of open models (DeepSeek, Qwen, GLM) on a fast API. Free tier available.",
    kind: "openai-compatible",
    baseUrl: "https://api.siliconflow.com/v1",
    models: ["deepseek-ai/DeepSeek-V4-Pro", "zai-org/GLM-5.2", "Qwen/Qwen3.6-27B"],
    keyUrl: "https://cloud.siliconflow.com/account/ak",
    free: true,
  },
  {
    id: "featherless",
    name: "Featherless AI",
    by: "featherless.ai",
    blurb: "Flat-rate access to thousands of open models from Hugging Face — no per-token billing.",
    kind: "openai-compatible",
    baseUrl: "https://api.featherless.ai/v1",
    models: ["meta-llama/Meta-Llama-3.1-70B-Instruct", "Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3"],
    keyUrl: "https://featherless.ai/account/api-keys",
  },
  {
    id: "lambda",
    name: "Lambda Inference",
    by: "lambda.ai",
    blurb: "Open models on Lambda's GPU cloud via an OpenAI-compatible API.",
    kind: "openai-compatible",
    baseUrl: "https://api.lambda.ai/v1",
    models: ["llama-4-maverick-17b-128e-instruct-fp8", "deepseek-v3-0324", "qwen3-32b-fp8"],
    keyUrl: "https://cloud.lambda.ai/api-keys",
  },
  {
    id: "github-models",
    name: "GitHub Models",
    by: "github.com",
    blurb: "Free access to top models (GPT, Llama, DeepSeek, Phi) for developers — uses a GitHub token.",
    kind: "openai-compatible",
    baseUrl: "https://models.github.ai/inference",
    models: ["openai/gpt-4.1", "openai/o4-mini", "meta/Llama-3.3-70B-Instruct", "deepseek/DeepSeek-V3"],
    keyUrl: "https://github.com/settings/personal-access-tokens",
    free: true,
  },
  {
    id: "avian",
    name: "Avian",
    by: "avian.io",
    blurb: "Very fast inference on open models (Llama, DeepSeek, Qwen).",
    kind: "openai-compatible",
    baseUrl: "https://api.avian.io/v1",
    models: ["Meta-Llama-3.3-70B-Instruct", "DeepSeek-R1", "Qwen2.5-72B-Instruct"],
    keyUrl: "https://avian.io/settings",
  },
  {
    id: "upstage",
    name: "Upstage (Solar)",
    by: "upstage.ai",
    blurb: "Upstage's Solar models — compact, strong, and document-savvy. Free trial credits.",
    kind: "openai-compatible",
    baseUrl: "https://api.upstage.ai/v1",
    models: ["solar-pro2", "solar-mini"],
    keyUrl: "https://console.upstage.ai/api-keys",
    free: true,
  },
  {
    id: "scaleway",
    name: "Scaleway",
    by: "scaleway.com",
    blurb: "EU-hosted open models (Llama, Qwen, DeepSeek) on a fast OpenAI-compatible API. Free beta.",
    kind: "openai-compatible",
    baseUrl: "https://api.scaleway.ai/v1",
    models: ["glm-5.2", "qwen3.6-35b-a3b", "mistral-medium-3.5-128b", "gemma-4-26b-a4b-it"],
    keyUrl: "https://console.scaleway.com/generative-api/models",
    free: true,
  },
  {
    id: "aimlapi",
    name: "AI/ML API",
    by: "aimlapi.com",
    blurb: "One key for 200+ models across providers via an OpenAI-compatible API.",
    kind: "openai-compatible",
    baseUrl: "https://api.aimlapi.com/v1",
    models: [
      "gpt-4o",
      "deepseek/deepseek-chat",
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "Qwen/Qwen2.5-72B-Instruct-Turbo",
    ],
    keyUrl: "https://aimlapi.com/app/keys",
  },
  {
    id: "inference-net",
    name: "Inference.net",
    by: "inference.net",
    blurb: "Low-cost serverless inference for open models via an OpenAI-compatible API.",
    kind: "openai-compatible",
    baseUrl: "https://api.inference.net/v1",
    // inference.net's roster is small and older than the aggregators' — these
    // are what it actually serves, not what we'd like it to serve.
    models: ["google/gemma-3", "meta/llama-3.1-8b-instruct", "meta/llama-3.2-3b-instruct"],
    keyUrl: "https://inference.net/dashboard/api-keys",
  },
  {
    id: "nscale",
    name: "Nscale",
    by: "nscale.com",
    blurb: "EU GPU cloud serving open models at low cost. Free credits for new accounts.",
    kind: "openai-compatible",
    baseUrl: "https://inference.api.nscale.com/v1",
    models: [
      "meta-llama/Llama-3.3-70B-Instruct",
      "Qwen/Qwen2.5-Coder-32B-Instruct",
      "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
    ],
    keyUrl: "https://console.nscale.com",
    free: true,
  },
];

export type Fit = "gpu" | "cpu" | "tight" | "no";

/** LM Studio-style fit badge from file size vs detected memory. */
export function fitFor(sizeMB: number, ramMB: number, vramMB: number | null): Fit {
  if (vramMB && sizeMB * 1.15 <= vramMB * 0.9) return "gpu";
  if (sizeMB * 1.3 <= ramMB * 0.5) return "cpu";
  if (sizeMB * 1.15 <= ramMB * 0.75) return "tight";
  return "no";
}

/**
 * Is this an FP4-format file (NVFP4 / MXFP4)?
 *
 * Matched against the whole filename, not just the quant field, because these
 * arrive as third-party HF builds — `Qwen3.8-27B-NVFP4-MTP-GGUF` and friends —
 * pasted in as a URL, where the format only shows up in the name.
 */
export function isFp4(nameOrQuant: string): boolean {
  return /(^|[^a-z0-9])(nvfp4|mxfp4|fp4)([^a-z0-9]|$)/i.test(nameOrQuant);
}

/**
 * Does this GPU have FP4 tensor cores?
 *
 * Only Blackwell does. Deliberately conservative: an unrecognised name reads as
 * "no", so the caveat below is shown rather than withheld. Being told to check
 * on a card that turns out to be fine is a smaller harm than being promised
 * speed the hardware can't deliver.
 */
export function isBlackwellGpu(name: string | null): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  // RTX PRO 6000 Blackwell and the datacenter parts say so outright.
  if (n.includes("blackwell")) return true;
  // GeForce RTX 50-series.
  if (/\brtx\s*-?\s*50\d0\b/.test(n)) return true;
  // B100 / B200 / GB200 / GB300.
  if (/\bg?b[123]00\b/.test(n)) return true;
  return false;
}

/**
 * Caveat to show beside the fit badge, or null when there's nothing to say.
 *
 * `fitFor` answers "does it fit", which for an FP4 file is a misleadingly
 * complete answer: the file is small enough on any card, but only Blackwell
 * accelerates it. Everyone else gets the memory saving and none of the speed,
 * and a badge reading "Full GPU offload possible" would quietly overpromise.
 */
export function fitCaveat(nameOrQuant: string, gpuName: string | null): string | null {
  if (!isFp4(nameOrQuant)) return null;
  if (isBlackwellGpu(gpuName)) return null;
  return "FP4: fits, but only Blackwell GPUs run it fast — this card gets the smaller download, not the speed-up.";
}

export const FIT_LABEL: Record<Fit, string> = {
  gpu: "Full GPU offload possible",
  cpu: "Fits in RAM (CPU)",
  tight: "Tight fit — close other apps",
  no: "Likely too large for this machine",
};

/** Parse a Hugging Face .gguf URL into catalog-ish fields. */
export function parseHfUrl(raw: string): CatalogModel | null {
  try {
    const u = new URL(raw.trim());
    if (!u.hostname.includes("huggingface.co")) return null;
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:resolve|blob)\/[^/]+\/(.+\.gguf)$/i);
    if (!m) return null;
    const url = raw.replace("/blob/", "/resolve/");
    return {
      publisher: m[1],
      model: m[2],
      file: m[3].split("/").pop()!,
      url,
      sizeMB: 0,
      quant: "",
      blurb: "",
    };
  } catch {
    return null;
  }
}
