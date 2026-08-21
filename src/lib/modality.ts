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

import { factsFor } from "./modelFacts";

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

/** Classify a model id by name alone. Anything unrecognised is text. */
export function modalityOf(id: string): Modality {
  const s = (id ?? "").trim();
  if (!s) return "text";
  for (const [modality, re] of RULES) if (re.test(s)) return modality;
  return "text";
}

/**
 * Derive a modality from published input/output lists.
 *
 * Returns null when the lists do not pin it down, so the caller falls back to
 * the name. Output is checked before input because it is the more decisive
 * signal: a model that *emits* audio is a speech model whatever it accepts,
 * while a model that *accepts* audio and emits text is a transcriber — and a
 * vision chat model also accepts images but is emphatically not an image model.
 */
export function modalityFromLists(input?: string[], output?: string[]): Modality | null {
  const out = new Set((output ?? []).map((s) => s.toLowerCase()));
  const inp = new Set((input ?? []).map((s) => s.toLowerCase()));
  if (out.size === 0 && inp.size === 0) return null;

  if (out.has("audio") || out.has("speech")) return "speech-out";
  if (out.has("video")) return "video";
  if (out.has("image")) return "image";
  if (out.has("embedding")) return "embed";

  // Emits text. What it takes in decides between chat and transcription.
  if (out.has("text")) {
    if ((inp.has("audio") || inp.has("speech")) && !inp.has("text")) return "speech-in";
    return "text";
  }
  return null;
}

/**
 * Classify a model, preferring what the provider published over its name.
 *
 * The name-based rules are good but they are guesses; models.dev states the
 * answer for the models it covers. It does not cover everything — Groq's
 * `playai-tts` and `llama-guard` are absent while `whisper-large-v3` is present
 * — so the regexes remain the fallback rather than being retired.
 *
 * Guardrails are the one case the published data cannot express: a safety
 * classifier takes text and emits text, so it is indistinguishable from a chat
 * model by modality alone. The name check runs first for those.
 */
export function classifyModel(id: string): Modality {
  const named = modalityOf(id);
  if (named === "guard") return named;

  const facts = factsFor(id);
  const published = facts ? modalityFromLists(facts.in, facts.out) : null;
  return published ?? named;
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
    const k = classifyModel(m);
    const at = buckets.get(k);
    if (at) at.push(m);
    else buckets.set(k, [m]);
  }
  return MODALITY_ORDER.filter((k) => buckets.has(k)).map((k) => ({
    modality: k,
    models: buckets.get(k)!,
  }));
}
