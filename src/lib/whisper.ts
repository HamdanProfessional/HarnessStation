import { invoke } from "@tauri-apps/api/core";
import { BaseDirectory, exists, mkdir, remove, stat, writeFile } from "@tauri-apps/plugin-fs";
import { fetch } from "@tauri-apps/plugin-http";
import { downloadFile, extractZip } from "./local";
import { isLinux } from "./platform";

const opts = { baseDir: BaseDirectory.Home };
const ENGINE_DIR = "whisper/engine";

/** Speech-to-text models, fastest first. Smaller = lower latency, slightly less accurate. */
export const STT_MODELS = [
  { id: "tiny", file: "ggml-tiny.bin", label: "Tiny — fastest (~75 MB)", mb: 75 },
  { id: "base", file: "ggml-base.bin", label: "Base — fast, good (~142 MB)", mb: 142 },
  { id: "small", file: "ggml-small.bin", label: "Small — most accurate (~465 MB)", mb: 465 },
] as const;

export type SttModelId = (typeof STT_MODELS)[number]["id"];

export const DEFAULT_STT: SttModelId = "base";

/**
 * Languages the speech models handle well. "auto" detects per utterance, which is
 * convenient but slower and more error-prone — naming your language is better if
 * you always speak the same one.
 */
export const STT_LANGUAGES = [
  { id: "auto", label: "Auto-detect" },
  { id: "en", label: "English" },
  { id: "es", label: "Spanish — Español" },
  { id: "fr", label: "French — Français" },
  { id: "de", label: "German — Deutsch" },
  { id: "it", label: "Italian — Italiano" },
  { id: "pt", label: "Portuguese — Português" },
  { id: "nl", label: "Dutch — Nederlands" },
  { id: "ru", label: "Russian — Русский" },
  { id: "pl", label: "Polish — Polski" },
  { id: "tr", label: "Turkish — Türkçe" },
  { id: "ar", label: "Arabic — العربية" },
  { id: "fa", label: "Persian — فارسی" },
  { id: "ur", label: "Urdu — اردو" },
  { id: "hi", label: "Hindi — हिन्दी" },
  { id: "bn", label: "Bengali — বাংলা" },
  { id: "ta", label: "Tamil — தமிழ்" },
  { id: "id", label: "Indonesian — Bahasa" },
  { id: "vi", label: "Vietnamese — Tiếng Việt" },
  { id: "th", label: "Thai — ไทย" },
  { id: "zh", label: "Chinese — 中文" },
  { id: "ja", label: "Japanese — 日本語" },
  { id: "ko", label: "Korean — 한국어" },
  { id: "sw", label: "Swahili — Kiswahili" },
  { id: "so", label: "Somali — Soomaali" },
  { id: "uk", label: "Ukrainian — Українська" },
  { id: "he", label: "Hebrew — עברית" },
  { id: "el", label: "Greek — Ελληνικά" },
  { id: "sv", label: "Swedish — Svenska" },
  { id: "no", label: "Norwegian — Norsk" },
  { id: "da", label: "Danish — Dansk" },
  { id: "fi", label: "Finnish — Suomi" },
  { id: "cs", label: "Czech — Čeština" },
  { id: "ro", label: "Romanian — Română" },
  { id: "hu", label: "Hungarian — Magyar" },
  { id: "ms", label: "Malay — Melayu" },
  { id: "tl", label: "Tagalog" },
] as const;

export const DEFAULT_STT_LANG = "auto";

/** Human-readable name for a language code (for prompts and UI). */
export function sttLanguageName(code: string): string {
  const hit = STT_LANGUAGES.find((l) => l.id === code);
  if (!hit || hit.id === "auto") return "";
  return hit.label.split(" — ")[0];
}

/** How the transcriber should treat speech. */
export interface SttOptions {
  /** ISO code, or "auto" to detect. */
  language?: string;
  /** Transcribe non-English speech straight into English text. */
  translate?: boolean;
}

function modelFile(id: SttModelId): string {
  return (STT_MODELS.find((m) => m.id === id) ?? STT_MODELS[1]).file;
}

const modelRel = (id: SttModelId) => `whisper/${modelFile(id)}`;
const modelUrl = (id: SttModelId) =>
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelFile(id)}`;

/** Download whisper.cpp binaries + the chosen model on first use. */
export async function ensureWhisper(
  onStatus: (s: string) => void,
  model: SttModelId = DEFAULT_STT,
): Promise<void> {
  const engineReady = await exists(`.harnessx/${ENGINE_DIR}`, opts);
  if (!engineReady) {
    onStatus("Fetching whisper.cpp release info...");
    const res = await fetch("https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest", {
      headers: { "User-Agent": "HarnessStation" },
    });
    if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status}`);
    const rel = await res.json();
    const assets: { name: string; browser_download_url: string }[] = rel.assets ?? [];
    const asset = isLinux()
      ? assets.find((a) => /linux.*(x64|x86_64|amd64)/i.test(a.name) && !/cublas|cuda|arm/i.test(a.name))
      : (assets.find((a) => /bin-x64\.zip$/i.test(a.name) && !/cublas|cuda/i.test(a.name)) ??
        assets.find((a) => /win.*x64.*\.zip$/i.test(a.name)));
    if (!asset) {
      // whisper.cpp doesn't always publish a Linux binary. Point at the two real
      // fixes rather than failing with "not found".
      throw new Error(
        isLinux()
          ? "This whisper.cpp release has no prebuilt Linux binary. Install it from your package manager " +
            "(e.g. `sudo apt install whisper.cpp`) or build it, then symlink whisper-cli into " +
            "~/.harnessx/whisper/engine/. Speech-to-text is the only feature that needs it."
          : "No Windows x64 build found in the latest whisper.cpp release.",
      );
    }
    onStatus(`Downloading ${asset.name}...`);
    await downloadFile(asset.browser_download_url, `whisper/${asset.name}`, "whisper-engine");
    onStatus("Extracting whisper engine...");
    await extractZip(`whisper/${asset.name}`, ENGINE_DIR);
  }
  const rel = modelRel(model);
  const info = STT_MODELS.find((m) => m.id === model) ?? STT_MODELS[1];
  const path = `.harnessx/${rel}`;
  // An interrupted download leaves a truncated file that "exists" but can't load —
  // check the size and re-fetch instead of failing forever.
  if (await exists(path, opts)) {
    let ok = false;
    try {
      const s = await stat(path, opts);
      ok = (s.size ?? 0) > info.mb * 1024 * 1024 * 0.9;
    } catch {
      ok = false;
    }
    if (!ok) {
      onStatus("Previous download was incomplete — fetching the speech model again...");
      try {
        await remove(path, opts);
      } catch {
        /* will be overwritten */
      }
    } else {
      return;
    }
  }
  onStatus(`Downloading speech model (${info.id}, ~${info.mb} MB, one-time)...`);
  await downloadFile(modelUrl(model), rel, `whisper-model-${model}`);
  // Verify the download landed. A missing file here means it failed outright —
  // reporting that now beats a confusing "model missing" from whisper later.
  let size: number;
  try {
    size = (await stat(path, opts)).size ?? 0;
  } catch {
    throw new Error(
      "the speech model didn't download — check your connection and disk space, then try again",
    );
  }
  if (size < info.mb * 1024 * 1024 * 0.9) {
    throw new Error(
      `speech model download incomplete (${Math.round(size / 1e6)} MB of ~${info.mb} MB) — check your connection and try again`,
    );
  }
}

/** Save WAV bytes and run whisper.cpp on them; returns the transcript. */
export async function transcribeWav(
  wav: Uint8Array,
  model: SttModelId = DEFAULT_STT,
  stt: SttOptions = {},
): Promise<string> {
  if (!(await exists(".harnessx/tmp", opts))) await mkdir(".harnessx/tmp", { ...opts, recursive: true });
  await writeFile(".harnessx/tmp/dictation.wav", wav, opts);
  return transcribePath("tmp/dictation.wav", model, stt);
}

/** Run whisper.cpp on a WAV already written to disk (path relative to ~/.harnessx). */
export function transcribePath(
  wav: string,
  model: SttModelId = DEFAULT_STT,
  stt: SttOptions = {},
): Promise<string> {
  return invoke<string>("transcribe", {
    engineDir: ENGINE_DIR,
    model: modelRel(model),
    wav,
    language: stt.language || DEFAULT_STT_LANG,
    translate: stt.translate ?? false,
  });
}

// ---------- persistent server path (avoids reloading the model each utterance) ----------

const STT_PORT = 8178;
let serverModel: SttModelId | null = null;

/** Start whisper-server for `model` (idempotent) and wait until it answers. */
export async function startSttServer(model: SttModelId = DEFAULT_STT): Promise<boolean> {
  try {
    await invoke<number>("stt_serve", {
      engineDir: ENGINE_DIR,
      model: modelRel(model),
      port: STT_PORT,
    });
  } catch {
    return false;
  }
  // Loading the model takes a moment; poll until it responds.
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${STT_PORT}/`, { method: "GET" });
      if (res.status > 0) {
        serverModel = model;
        return true;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

export function stopSttServer(): Promise<void> {
  serverModel = null;
  return invoke<void>("stt_stop").catch(() => undefined);
}

/** Transcribe via the running server; returns null if it isn't usable. */
export async function transcribeViaServer(
  wav: string,
  model: SttModelId = DEFAULT_STT,
  stt: SttOptions = {},
): Promise<string | null> {
  if (serverModel !== model && !(await startSttServer(model))) return null;
  // Any failure below means this server is no longer usable. Forgetting it here is
  // what lets the next utterance restart it — otherwise one crash silently pins
  // the session to the much slower one-shot CLI for good.
  const giveUp = () => {
    serverModel = null;
    return null;
  };
  try {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const bytes = await readFile(`.harnessx/${wav}`, opts);
    const boundary = `----HSB${Date.now().toString(36)}`;
    const enc = new TextEncoder();
    const head = enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
        `Content-Type: audio/wav\r\n\r\n`,
    );
    const field = (name: string, value: string) =>
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}`;
    const tail = enc.encode(
      field("response_format", "json") +
        field("language", stt.language || DEFAULT_STT_LANG) +
        field("translate", stt.translate ? "true" : "false") +
        `\r\n--${boundary}--\r\n`,
    );
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);
    const res = await fetch(`http://127.0.0.1:${STT_PORT}/inference`, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    if (!res.ok) return giveUp();
    const json = await res.json();
    return typeof json?.text === "string" ? json.text.trim() : giveUp();
  } catch {
    return giveUp();
  }
}

/** Fast path: server if available, else the one-shot CLI. */
export async function transcribeFast(
  wav: string,
  model: SttModelId = DEFAULT_STT,
  stt: SttOptions = {},
): Promise<string> {
  const viaServer = await transcribeViaServer(wav, model, stt);
  if (viaServer !== null) return viaServer;
  return transcribePath(wav, model, stt);
}
