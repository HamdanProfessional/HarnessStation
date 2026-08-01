/**
 * Kokoro — local neural text-to-speech.
 *
 * An 82M-parameter model that runs in the app's own webview through ONNX
 * Runtime. It is a large step up from Piper: real prosody, no metallic edge, and
 * a set of distinct voices rather than one reading. It costs nothing per word,
 * works with no network once fetched, and needs no key — which is the point,
 * given the cloud engines alongside it bill per character.
 *
 * The trade is a one-time model download (~90 MB quantised) and CPU-bound
 * synthesis: roughly real-time on a modern laptop, so a long paragraph takes a
 * beat before it starts. That's why speech is synthesised a sentence at a time
 * upstream — the first sentence plays while the rest are still being made.
 *
 * Everything here loads lazily. The dependency is tens of megabytes of WASM and
 * must never land in the initial bundle for the many users who never open the
 * voice avatar at all.
 */

export interface KokoroVoice {
  id: string;
  label: string;
  /** Blurb shown in the picker. */
  note: string;
}

/**
 * The voices worth offering. Kokoro ships more, but most are variations of these
 * and a picker with fifty near-identical entries helps nobody.
 */
export const KOKORO_VOICES: KokoroVoice[] = [
  { id: "af_heart", label: "Heart (US, female)", note: "Warm and natural — the best all-rounder." },
  { id: "af_bella", label: "Bella (US, female)", note: "Bright and expressive." },
  { id: "af_nicole", label: "Nicole (US, female)", note: "Soft, close-mic, quieter." },
  { id: "am_michael", label: "Michael (US, male)", note: "Even and unhurried." },
  { id: "am_fenrir", label: "Fenrir (US, male)", note: "Deeper, more weight." },
  { id: "bf_emma", label: "Emma (UK, female)", note: "British, measured." },
  { id: "bm_george", label: "George (UK, male)", note: "British, warm." },
];

export const DEFAULT_KOKORO_VOICE = "af_heart";

export function kokoroVoice(id: string): KokoroVoice {
  return KOKORO_VOICES.find((v) => v.id === id) ?? KOKORO_VOICES[0];
}

/** HF repo holding the ONNX export. */
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/**
 * Quantisation. `q8` is the sweet spot: a quarter of the size of fp32 for no
 * difference anyone has been able to hear, and it keeps first-run download to
 * something a user will actually wait for.
 */
const DTYPE = "q8";

type TTS = {
  generate: (text: string, opts: { voice: string }) => Promise<{ toBlob: () => Blob }>;
};

let loading: Promise<TTS> | null = null;
let loaded: TTS | null = null;

export type LoadProgress = (percent: number, label: string) => void;

/**
 * Load the model, reusing the in-flight promise if a second caller arrives.
 *
 * Without that guard, two sentences queued in quick succession would each start
 * their own download of the same 90 MB.
 */
export function loadKokoro(onProgress?: LoadProgress): Promise<TTS> {
  if (loaded) return Promise.resolve(loaded);
  if (loading) return loading;

  loading = (async () => {
    const { KokoroTTS } = await import("kokoro-js");
    const tts = (await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: DTYPE,
      // WebGPU where the webview offers it, WASM everywhere else. WASM is the
      // honest default: WebView2's WebGPU support varies by Windows build, and
      // silently failing to a broken backend is worse than being slower.
      device: (await webgpuAvailable()) ? "webgpu" : "wasm",
      progress_callback: (p: { status: string; progress?: number; file?: string }) => {
        if (!onProgress) return;
        if (p.status === "progress" && typeof p.progress === "number") {
          onProgress(Math.round(p.progress), `Downloading voice model… ${p.file ?? ""}`.trim());
        } else if (p.status === "done") {
          onProgress(100, "Voice model ready");
        }
      },
    } as never)) as unknown as TTS;
    loaded = tts;
    return tts;
  })();

  // A failed download must not poison every later attempt.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

async function webgpuAvailable(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

/** Has the model already been loaded this session? */
export function kokoroLoaded(): boolean {
  return loaded !== null;
}

/**
 * Whether the model is in the browser's cache, so "auto" can use Kokoro without
 * ever triggering a 90 MB download the user didn't ask for.
 *
 * transformers.js stores weights in the Cache Storage API under the file URL, so
 * asking the cache is the cheapest reliable answer — no network, no load.
 */
export async function kokoroCached(): Promise<boolean> {
  if (loaded) return true;
  try {
    if (typeof caches === "undefined") return false;
    const cache = await caches.open("transformers-cache");
    const keys = await cache.keys();
    return keys.some((r) => r.url.includes("Kokoro-82M") && r.url.endsWith(".onnx"));
  } catch {
    return false;
  }
}

/** Synthesise one utterance and return a blob URL for playback. */
export async function kokoroSynthesize(
  text: string,
  voice = DEFAULT_KOKORO_VOICE,
  onProgress?: LoadProgress,
): Promise<string> {
  const tts = await loadKokoro(onProgress);
  const audio = await tts.generate(text, { voice: kokoroVoice(voice).id });
  return URL.createObjectURL(audio.toBlob());
}

/**
 * Kokoro is English-only in this build.
 *
 * Handing it another script produces confident nonsense rather than an error, so
 * the caller has to check before routing — silence would be better than a voice
 * reading Urdu as if it were English.
 */
export function kokoroSupports(lang: string): boolean {
  return !lang || lang === "en";
}
