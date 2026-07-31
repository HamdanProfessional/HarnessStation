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

export const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    id: "groq",
    name: "Groq",
    by: "groq.com",
    blurb:
      "Extremely fast inference on open models (Llama, Qwen, GPT-OSS, Kimi). Generous free tier.",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3-32b",
      "moonshotai/kimi-k2-instruct",
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
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.0-flash",
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
    models: [
      "deepseek/deepseek-r1:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "google/gemini-2.0-flash-exp:free",
      "qwen/qwen3-coder:free",
    ],
    keyUrl: "https://openrouter.ai/keys",
    free: true,
  },
  {
    id: "cerebras",
    name: "Cerebras",
    by: "cerebras.ai",
    blurb: "Fastest tokens/sec on the market for Llama and Qwen. Free tier for developers.",
    kind: "openai-compatible",
    baseUrl: "https://api.cerebras.ai/v1",
    models: ["llama-3.3-70b", "llama3.1-8b", "qwen-3-235b-a22b-instruct-2507"],
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
    models: ["deepseek-chat", "deepseek-reasoner"],
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    by: "x.ai",
    blurb: "Grok models from xAI via an OpenAI-compatible endpoint.",
    kind: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    models: ["grok-4", "grok-4-fast", "grok-3", "grok-3-mini"],
    keyUrl: "https://console.x.ai",
  },
  {
    id: "mistral",
    name: "Mistral",
    by: "mistral.ai",
    blurb: "Mistral's hosted models (Large, Small, Codestral). Free tier available.",
    kind: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-small-latest", "codestral-latest", "ministral-8b-latest"],
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
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "Qwen/Qwen2.5-72B-Instruct-Turbo",
      "deepseek-ai/DeepSeek-V3",
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
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
      "accounts/fireworks/models/llama-v3p3-70b-instruct",
      "accounts/fireworks/models/deepseek-v3",
      "accounts/fireworks/models/qwen2p5-72b-instruct",
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
      "meta-llama/Llama-3.3-70B-Instruct",
      "deepseek-ai/DeepSeek-V3",
      "Qwen/Qwen2.5-72B-Instruct",
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
      "meta-llama/Llama-3.3-70B-Instruct",
      "Qwen/Qwen2.5-72B-Instruct",
      "deepseek-ai/DeepSeek-V3",
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
    models: ["glm-5.2", "glm-5.1", "glm-5-turbo", "glm-4.7", "glm-4.7-flash"],
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
    models: ["glm-5.2", "glm-5.1", "glm-4.7"],
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
      "deepseek/deepseek-v3",
      "meta-llama/llama-3.3-70b-instruct",
      "qwen/qwen2.5-72b-instruct",
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
    models: [
      "deepseek-ai/DeepSeek-V3",
      "Qwen/Qwen2.5-72B-Instruct",
      "chutesai/Llama-4-Scout-17B-16E-Instruct",
    ],
    keyUrl: "https://chutes.ai/app/api",
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
