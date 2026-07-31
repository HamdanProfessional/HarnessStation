import { fetch } from "@tauri-apps/plugin-http";
import type { Attachment, MediaKind, MediaModel, Settings } from "./types";

export interface MediaConfig {
  models: MediaModel[];
  defaults: { image?: string; audio?: string; video?: string; "3d"?: string };
}

export interface GeneratedMedia {
  dataUrl: string;
  mime: string;
}

function authHeaders(m: MediaModel): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (m.apiKey) h.Authorization = `Bearer ${m.apiKey}`;
  return h;
}

const base = (m: MediaModel) => m.baseUrl.replace(/\/+$/, "");

async function bytesToDataUrl(bytes: ArrayBuffer, mime: string): Promise<string> {
  const arr = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i += 0x8000) {
    bin += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

/** Fetch a remote media URL and inline it as a data URL (for engines that return links). */
async function urlToDataUrl(url: string, fallbackMime: string): Promise<string> {
  const res = await fetch(url);
  const mime = res.headers.get("content-type") || fallbackMime;
  return bytesToDataUrl(await res.arrayBuffer(), mime);
}

/** OpenAI-compatible image generation → data URL. */
async function openaiImage(m: MediaModel, prompt: string): Promise<GeneratedMedia> {
  const res = await fetch(`${base(m)}/images/generations`, {
    method: "POST",
    headers: authHeaders(m),
    body: JSON.stringify({
      model: m.model || undefined,
      prompt,
      n: 1,
      size: m.options || "1024x1024",
      response_format: "b64_json",
    }),
  });
  if (!res.ok) throw new Error(`Image HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const d = json.data?.[0];
  if (d?.b64_json) return { dataUrl: `data:image/png;base64,${d.b64_json}`, mime: "image/png" };
  if (d?.url) return { dataUrl: await urlToDataUrl(d.url, "image/png"), mime: "image/png" };
  throw new Error("Image response had no data.");
}

/** Automatic1111 / SD.Next / Forge local webui → data URL. */
async function a1111(m: MediaModel, prompt: string): Promise<GeneratedMedia> {
  const [w, h] = (m.options || "512x512").split("x").map((n) => parseInt(n, 10) || 512);
  const res = await fetch(`${base(m)}/sdapi/v1/txt2img`, {
    method: "POST",
    headers: authHeaders(m),
    body: JSON.stringify({ prompt, steps: 25, width: w, height: h, sampler_name: "Euler a" }),
  });
  if (!res.ok) throw new Error(`A1111 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const b64 = json.images?.[0];
  if (!b64) throw new Error("A1111 response had no image.");
  return { dataUrl: `data:image/png;base64,${b64}`, mime: "image/png" };
}

/** OpenAI-compatible speech synthesis → data URL (also covers local TTS servers). */
async function openaiSpeech(m: MediaModel, text: string): Promise<GeneratedMedia> {
  const res = await fetch(`${base(m)}/audio/speech`, {
    method: "POST",
    headers: authHeaders(m),
    body: JSON.stringify({
      model: m.model || "tts-1",
      input: text,
      voice: m.options || "alloy",
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`Speech HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const mime = res.headers.get("content-type") || "audio/mpeg";
  return { dataUrl: await bytesToDataUrl(await res.arrayBuffer(), mime), mime };
}

/** Replicate async predictions — generic for image/audio/video. Polls until done. */
async function replicate(m: MediaModel, prompt: string, kind: MediaKind): Promise<GeneratedMedia> {
  const headers = { ...authHeaders(m), Prefer: "wait" };
  const start = await fetch(`${base(m)}/predictions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ version: m.model, input: { prompt } }),
  });
  if (!start.ok) throw new Error(`Replicate HTTP ${start.status}: ${(await start.text()).slice(0, 300)}`);
  let pred = await start.json();
  // Prefer: wait usually returns terminal state; poll as a fallback.
  for (let i = 0; i < 60 && (pred.status === "starting" || pred.status === "processing"); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(pred.urls?.get ?? `${base(m)}/predictions/${pred.id}`, { headers });
    pred = await poll.json();
  }
  if (pred.status !== "succeeded") throw new Error(`Replicate ${pred.status}: ${pred.error ?? ""}`);
  const out = Array.isArray(pred.output) ? pred.output[pred.output.length - 1] : pred.output;
  if (typeof out !== "string") throw new Error("Replicate returned no output URL.");
  const fallback =
    kind === "video"
      ? "video/mp4"
      : kind === "audio"
        ? "audio/mpeg"
        : kind === "3d"
          ? "model/gltf-binary"
          : "image/png";
  // 3D meshes (.glb/.obj) are large and can't render inline — return the URL as-is.
  if (kind === "3d") return { dataUrl: out, mime: fallback };
  return { dataUrl: await urlToDataUrl(out, fallback), mime: fallback };
}

/** Generate media with a single configured model. Returns a data URL. */
export async function generateMedia(m: MediaModel, prompt: string): Promise<GeneratedMedia> {
  switch (m.engine) {
    case "openai-image":
      return openaiImage(m, prompt);
    case "a1111":
      return a1111(m, prompt);
    case "openai-speech":
      return openaiSpeech(m, prompt);
    case "replicate":
      return replicate(m, prompt, m.kind);
    default:
      throw new Error(`Unknown media engine: ${m.engine}`);
  }
}

/** Resolve the default (or first matching) model for a kind and generate. */
export async function runMediaTool(kind: MediaKind, prompt: string, cfg: MediaConfig): Promise<string> {
  if (!prompt.trim()) return "Error: empty prompt.";
  const id = cfg.defaults[kind];
  const m = cfg.models.find((x) => x.id === id && x.kind === kind) ?? cfg.models.find((x) => x.kind === kind);
  if (!m) {
    return `No ${kind} generation model is configured. Add one in Settings → Media models, then retry.`;
  }
  const { dataUrl, mime } = await generateMedia(m, prompt);
  if (kind === "3d") return `Generated 3D model (${mime}) — open/download: ${dataUrl}`;
  return dataUrl; // callers detect the leading "data:" and render it inline
}

export function mediaConfigFromSettings(s: Settings): MediaConfig {
  return { models: s.mediaModels ?? [], defaults: s.defaultMediaIds ?? {} };
}

/**
 * Turn a generated media data URL into a chat attachment (rendered inline).
 * Returns null for non-data-URL strings so plain tool text passes through.
 */
export function dataUrlToAttachment(dataUrl: string, toolName: string): Attachment | null {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const kind: Attachment["kind"] = mime.startsWith("image/")
    ? "image"
    : mime.startsWith("audio/")
      ? "audio"
      : mime.startsWith("video/")
        ? "video"
        : "text";
  if (kind === "text") return null;
  const ext = mime.split("/")[1]?.split("+")[0] || "bin";
  return { kind, name: `${toolName}.${ext}`, mime, data: dataUrl };
}
