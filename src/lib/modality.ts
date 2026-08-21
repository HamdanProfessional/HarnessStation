/**
 * What kind of model an id refers to.
 *
 * Providers return one flat `models` list with everything in it. Groq's includes
 * `whisper-large-v3`, `playai-tts`, `canopylabs/orpheus-*` and
 * `llama-prompt-guard-*` alongside its chat models; OpenAI's mixes in
 * `text-embedding-3-*` and `gpt-4o-transcribe`. Presented as one alphabetical
 * dropdown, picking a speech model for a chat looks exactly like picking a chat
 * model, and fails only once a message is sent.
 *
 * This classifies by id, because that is all a bare `/v1/models` response gives
 * us — no provider returns a modality field. Naming conventions are strong
 * enough to be useful and weak enough to be wrong, so the classification is
 * used to *group and label*, never to hide a model or block a choice. A
 * misfiled model stays reachable in the wrong group; a hidden one would look
 * like the provider had stopped offering it.
 */

export type Modality =
  | "text"
  | "guard"
  | "speech-in"
  | "speech-out"
  | "image"
  | "video"
  | "embed"
  | "rerank";

/** Group headings, in the order a chat's picker should show them. */
export const MODALITY_LABEL: Record<Modality, string> = {
  text: "Chat",
  guard: "Guardrail",
  "speech-in": "Speech to text",
  "speech-out": "Text to speech",
  image: "Image",
  video: "Video",
  embed: "Embedding",
  rerank: "Rerank",
};

/** A short tag for a dense list, where the full heading would not fit. */
export const MODALITY_TAG: Record<Modality, string> = {
  text: "chat",
  guard: "guard",
  "speech-in": "stt",
  "speech-out": "tts",
  image: "image",
  video: "video",
  embed: "embed",
  rerank: "rerank",
};

export const MODALITY_ORDER: Modality[] = [
  "text",
  "guard",
  "speech-in",
  "speech-out",
  "image",
  "video",
  "embed",
  "rerank",
];

/**
 * Ordered most-specific first: a guard model is often named after the chat
 * family it guards (`llama-guard`, `granite-guardian`), and an embedding model
 * after the text family it embeds (`qwen3-embedding`), so the qualifier has to
 * win over the family name.
 */
const RULES: [Modality, RegExp][] = [
  // Safety classifiers. These *are* chat-completions models, which is why they
  // are labelled rather than filtered out — they answer, just with "safe" or
  // "unsafe" instead of a reply.
  [
    "guard",
    /(^|[^a-z])(guard|guardian|guardrail|shield|moderation|moderat\w*|safety|nemoguard|granite-guardian)([^a-z]|$)/i,
  ],
  ["rerank", /rerank|cross-?encoder/i],
  ["embed", /embed|embedding|(^|[/-])(bge|gte|e5|nomic-embed)([^a-z]|$)/i],
  [
    "speech-in",
    /whisper|transcrib\w*|speech-?to-?text|(^|[^a-z])(stt|asr|parakeet|canary)([^a-z]|$)/i,
  ],
  [
    "speech-out",
    /text-?to-?speech|orpheus|kokoro|xtts|speecht5|voicecraft|(^|[^a-z])(tts|bark|dia|csm|voice)([^a-z]|$)/i,
  ],
  [
    "video",
    /(^|[^a-z])(sora|veo|kling|runway|mochi|wan)([^a-z]|$)|video|hunyuan-video|text-?to-?video/i,
  ],
  [
    "image",
    /(^|[^a-z])(dall-?e|sdxl|flux|imagen|midjourney|ideogram|recraft|kandinsky|playground-v\d)([^a-z]|$)|stable-?diffusion|text-?to-?image|(^|[^a-z])image([^a-z]|$)/i,
  ],
];

/** Classify a model id. Anything unrecognised is text — the safe default. */
export function modalityOf(id: string): Modality {
  const s = (id ?? "").trim();
  if (!s) return "text";
  for (const [modality, re] of RULES) if (re.test(s)) return modality;
  return "text";
}

/**
 * Whether a chat turn can use this model at all.
 *
 * Guardrails count: they speak the chat-completions protocol, and running one
 * deliberately is a legitimate thing to do. Everything else needs a different
 * endpoint entirely and would fail on send.
 */
export function chatCapable(m: Modality): boolean {
  return m === "text" || m === "guard";
}

/** Bucket a flat model list, dropping empty groups, in display order. */
export function groupByModality(models: string[]): { modality: Modality; models: string[] }[] {
  const buckets = new Map<Modality, string[]>();
  for (const m of models) {
    const k = modalityOf(m);
    const at = buckets.get(k);
    if (at) at.push(m);
    else buckets.set(k, [m]);
  }
  return MODALITY_ORDER.filter((k) => buckets.has(k)).map((k) => ({
    modality: k,
    models: buckets.get(k)!,
  }));
}
