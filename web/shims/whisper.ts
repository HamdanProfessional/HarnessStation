/**
 * Speech-to-text for the web build.
 *
 * The desktop app runs whisper.cpp: it downloads a native binary and a ggml
 * model, then shells out per utterance. None of that works in a browser, so this
 * replaces the engine with transformers.js — Whisper compiled to WASM/WebGPU,
 * running in the tab — while keeping the module's public API identical, so
 * voice.ts and the dictation flow call it unchanged.
 *
 * Wired in by a Vite redirect (see web/vite.config.ts): any import of
 * src/lib/whisper.ts resolves here instead. The pure, platform-free pieces —
 * the model list, language names, defaults — are re-exported from the original
 * so there's one source of truth for them.
 */

import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { readWav } from "./wav";
import { readFile } from "./fs";

export {
  DEFAULT_STT,
  DEFAULT_STT_LANG,
  STT_LANGUAGES,
  STT_MODELS,
  sttLanguageName,
} from "../../src/lib/whisper";
export type { SttModelId, SttOptions } from "../../src/lib/whisper";

import type { SttModelId, SttOptions } from "../../src/lib/whisper";

/** App model id -> a transformers.js Whisper model (multilingual, so language works). */
const MODEL_FOR: Record<string, string> = {
  tiny: "Xenova/whisper-tiny",
  base: "Xenova/whisper-base",
  small: "Xenova/whisper-small",
};

let pipe: AutomaticSpeechRecognitionPipeline | null = null;
let loadedModel = "";
let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

async function getPipeline(
  model: SttModelId,
  onStatus?: (s: string) => void,
): Promise<AutomaticSpeechRecognitionPipeline> {
  const id = MODEL_FOR[model] ?? MODEL_FOR.base;
  if (pipe && loadedModel === id) return pipe;
  // A model switch (or first use) reloads; reuse an in-flight load so two
  // near-simultaneous utterances don't both fetch the weights.
  if (loading && loadedModel === id) return loading;

  loadedModel = id;
  loading = (async () => {
    onStatus?.(`Loading speech model (${model}, one-time)…`);
    const p = (await pipeline("automatic-speech-recognition", id, {
      dtype: "q8", // quarter the size, no audible accuracy cost
      progress_callback: (e: { status: string; progress?: number }) => {
        if (e.status === "progress" && typeof e.progress === "number") {
          onStatus?.(`Downloading speech model… ${Math.round(e.progress)}%`);
        }
      },
    } as never)) as AutomaticSpeechRecognitionPipeline;
    pipe = p;
    onStatus?.("Speech model ready");
    return p;
  })();
  loading.catch(() => {
    loading = null; // a failed load must not poison the next attempt
  });
  return loading;
}

/**
 * Preload the model so the first utterance isn't also a download. Matches the
 * desktop's ensureWhisper, which fetched the engine and model up front.
 */
export async function ensureWhisper(
  onStatus: (s: string) => void,
  model: SttModelId = "base" as SttModelId,
): Promise<void> {
  await getPipeline(model, onStatus);
}

async function transcribe(
  wav: string,
  model: SttModelId,
  stt: SttOptions,
): Promise<string> {
  const p = await getPipeline(model);
  const { samples } = readWav(await readFile(wav));
  if (samples.length === 0) return "";

  const language = stt.language && stt.language !== "auto" ? stt.language : undefined;
  const out = (await p(samples, {
    // Whisper's window is 30s; longer audio is chunked automatically.
    chunk_length_s: 30,
    stride_length_s: 5,
    language,
    task: stt.translate ? "translate" : "transcribe",
  } as never)) as { text: string } | { text: string }[];

  const text = Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text;
  return (text ?? "").trim();
}

export function transcribePath(
  wav: string,
  model: SttModelId = "base" as SttModelId,
  stt: SttOptions = {},
): Promise<string> {
  return transcribe(wav, model, stt);
}

/**
 * The desktop keeps a whisper-server warm to avoid reloading the model each
 * utterance. Here the pipeline is already resident in the tab, so there's no
 * server to run — transcribeFast just transcribes directly.
 */
export function transcribeFast(
  wav: string,
  model: SttModelId = "base" as SttModelId,
  stt: SttOptions = {},
): Promise<string> {
  return transcribe(wav, model, stt);
}

/** No persistent server in the browser; report "not started" so callers use the
 * direct path, which is already warm. */
export async function startSttServer(): Promise<boolean> {
  return false;
}

export async function stopSttServer(): Promise<void> {
  // Nothing to stop. The pipeline stays resident; dropping it would only force a
  // reload next time the avatar opens.
}
