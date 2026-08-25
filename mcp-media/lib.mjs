/**
 * HarnessStation Media — an MCP server for image / speech / video / 3D
 * generation through endpoints *you* configure.
 *
 * This is the migration target the freeze note points at: media generation
 * leaves the app tree and becomes an independently-versioned satellite. It
 * speaks the same wire protocol HarnessStation's own client speaks
 * (newline-delimited JSON-RPC over stdio, protocol 2025-03-26) and mirrors the
 * four built-in media tools, so it is a drop-in replacement surface.
 *
 * Configuration comes from MEDIA_CONFIG, a path to either a dedicated config
 * file ({ "models": [...], "defaults": {...} }) or your existing
 * HarnessStation settings.json (the .mediaModels / .defaultMediaIds fields are
 * picked out). API keys may be set per-model in that file; MEDIA_API_KEY is
 * the fallback Bearer token for models without one.
 *
 * Everything here is deliberately dependency-free: Node 20+ global fetch,
 * readline, process.std*. Logs go to stderr — stdout is protocol-only.
 */

// ---------- config ----------

/** Parse and normalize a config document (dedicated file or settings.json). */
export function loadConfig(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("MEDIA_CONFIG is not valid JSON");
  }
  const models = Array.isArray(raw?.mediaModels)
    ? raw.mediaModels
    : Array.isArray(raw?.models)
      ? raw.models
      : [];
  const defaults = raw?.defaultMediaIds ?? raw?.defaults ?? {};
  if (!Array.isArray(models)) throw new Error("config has no models array");
  return {
    models: models.filter(
      (m) => m && typeof m.baseUrl === "string" && typeof m.engine === "string",
    ),
    defaults: defaults && typeof defaults === "object" ? defaults : {},
  };
}

/** Resolve the configured model for a kind: the default, else the first. */
export function resolveModel(config, kind) {
  const id = config.defaults[kind];
  return (
    config.models.find((m) => m.id === id && m.kind === kind) ??
    config.models.find((m) => m.kind === kind)
  );
}

// ---------- tool surface ----------

const STR = { type: "string", description: "" };

/** The four tools, mirroring the app's built-in media tools one-for-one. */
export function toolDefinitions() {
  return [
    {
      name: "generate_image",
      description:
        "Generate an image from a text prompt. Returns an inline data URL the conversation renders.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { ...STR, description: "What to draw" },
          size: { ...STR, description: 'Image size like "1024x1024"; overrides the model default' },
        },
        required: ["prompt"],
      },
    },
    {
      name: "generate_speech",
      description: "Synthesize speech from text. Returns an inline audio data URL.",
      inputSchema: {
        type: "object",
        properties: {
          text: { ...STR, description: "What to say" },
          voice: { ...STR, description: "Voice id; overrides the model default" },
        },
        required: ["text"],
      },
    },
    {
      name: "generate_video",
      description: "Generate a short video from a text prompt (Replicate-class engines).",
      inputSchema: {
        type: "object",
        properties: { prompt: { ...STR, description: "What happens in the clip" } },
        required: ["prompt"],
      },
    },
    {
      name: "generate_3d",
      description:
        "Generate a 3D model from a text prompt. Returns a URL — meshes are too large to inline.",
      inputSchema: {
        type: "object",
        properties: { prompt: { ...STR, description: "The object to model" } },
        required: ["prompt"],
      },
    },
  ];
}

// ---------- engines (ported from the app's lib/media.ts) ----------

function authHeaders(m, envKey) {
  const h = { "Content-Type": "application/json" };
  const key = m.apiKey || envKey;
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

const base = (m) => String(m.baseUrl).replace(/\/+$/, "");
const mimeFromResponse = (res, fallback) => res.headers.get("content-type") || fallback;

async function bytesToDataUrl(res, mime) {
  const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return `data:${mime};base64,${b64}`;
}

async function urlToDataUrl(fetchImpl, url, fallbackMime) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Media download HTTP ${res.status}`);
  return bytesToDataUrl(res, mimeFromResponse(res, fallbackMime));
}

async function openaiImage(fetchImpl, m, prompt, size, envKey) {
  const res = await fetchImpl(`${base(m)}/images/generations`, {
    method: "POST",
    headers: authHeaders(m, envKey),
    body: JSON.stringify({
      model: m.model || undefined,
      prompt,
      n: 1,
      size: size || m.options || "1024x1024",
      response_format: "b64_json",
    }),
  });
  if (!res.ok) throw new Error(`Image HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const d = (await res.json()).data?.[0];
  if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
  if (d?.url) return urlToDataUrl(fetchImpl, d.url, "image/png");
  throw new Error("Image response had no data.");
}

async function a1111(fetchImpl, m, prompt, size, envKey) {
  const [w, h] = (size || m.options || "512x512").split("x").map((n) => parseInt(n, 10) || 512);
  const res = await fetchImpl(`${base(m)}/sdapi/v1/txt2img`, {
    method: "POST",
    headers: authHeaders(m, envKey),
    body: JSON.stringify({ prompt, steps: 25, width: w, height: h, sampler_name: "Euler a" }),
  });
  if (!res.ok) throw new Error(`A1111 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const b64 = (await res.json()).images?.[0];
  if (!b64) throw new Error("A1111 response had no image.");
  return `data:image/png;base64,${b64}`;
}

async function openaiSpeech(fetchImpl, m, text, voice, envKey) {
  const res = await fetchImpl(`${base(m)}/audio/speech`, {
    method: "POST",
    headers: authHeaders(m, envKey),
    body: JSON.stringify({
      model: m.model || "tts-1",
      input: text,
      voice: voice || m.options || "alloy",
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`Speech HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return bytesToDataUrl(res, mimeFromResponse(res, "audio/mpeg"));
}

async function replicate(fetchImpl, m, prompt, kind, envKey) {
  const headers = { ...authHeaders(m, envKey), Prefer: "wait" };
  const start = await fetchImpl(`${base(m)}/predictions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ version: m.model, input: { prompt } }),
  });
  if (!start.ok) throw new Error(`Replicate HTTP ${start.status}: ${(await start.text()).slice(0, 300)}`);
  let pred = await start.json();
  // Prefer: wait usually returns a terminal state; poll as the fallback.
  for (let i = 0; i < 60 && (pred.status === "starting" || pred.status === "processing"); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await fetchImpl(pred.urls?.get ?? `${base(m)}/predictions/${pred.id}`, { headers });
    pred = await poll.json();
  }
  if (pred.status !== "succeeded") throw new Error(`Replicate ${pred.status}: ${pred.error ?? ""}`);
  const out = Array.isArray(pred.output) ? pred.output[pred.output.length - 1] : pred.output;
  if (typeof out !== "string") throw new Error("Replicate returned no output URL.");
  const fallback =
    kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : kind === "3d" ? "model/gltf-binary" : "image/png";
  // 3D meshes (.glb/.obj) are large — hand back the link instead of inlining.
  if (kind === "3d") return out;
  return urlToDataUrl(fetchImpl, out, fallback);
}

const KIND_OF_TOOL = {
  generate_image: "image",
  generate_speech: "audio",
  generate_video: "video",
  generate_3d: "3d",
};

// ---------- RPC handling ----------

const textContent = (text) => ({ content: [{ type: "text", text }] });

/**
 * Handle one JSON-RPC request. Returns a result object, or null when the
 * message is a notification (or unknown and ignorable). Errors from tool
 * execution come back as isError results, the way tool callers expect — only
 * protocol-level problems throw.
 */
export async function handleRequest(msg, ctx) {
  const { config, fetchImpl = fetch, envKey = "" } = ctx;
  if (msg === null || typeof msg !== "object") return null;
  const { method, id } = msg;
  const reply = (result) =>
    id === undefined || id === null ? null : { jsonrpc: "2.0", id, result };

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: msg.params?.protocolVersion ?? "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "harnessstation-media", version: "0.1.0" },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: toolDefinitions() });
    case "tools/call": {
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      const kind = KIND_OF_TOOL[name];
      if (!kind) return reply({ ...textContent(`Unknown tool: ${name}`), isError: true });
      const prompt = String(args.prompt ?? args.text ?? "").trim();
      if (!prompt) return reply({ ...textContent("Error: empty prompt."), isError: true });
      const m = resolveModel(config, kind);
      if (!m) {
        // Same contract as the built-ins: a missing configuration is plain
        // guidance text, not a failure — the model can tell the user what to do.
        return reply(
          textContent(
            `No ${kind} generation model is configured. Set MEDIA_CONFIG to a file with a ${kind} model, then retry.`,
          ),
        );
      }
      try {
        let out;
        switch (m.engine) {
          case "openai-image":
            out = await openaiImage(fetchImpl, m, prompt, args.size, envKey);
            break;
          case "a1111":
            out = await a1111(fetchImpl, m, prompt, args.size, envKey);
            break;
          case "openai-speech":
            out = await openaiSpeech(fetchImpl, m, prompt, args.voice, envKey);
            break;
          case "replicate":
            out = await replicate(fetchImpl, m, prompt, kind, envKey);
            break;
          default:
            throw new Error(`Unknown media engine: ${m.engine}`);
        }
        return reply(textContent(out));
      } catch (e) {
        return reply({ ...textContent(String(e.message || e)), isError: true });
      }
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    default:
      return null; // unknown methods are ignored, never fatal
  }
}
