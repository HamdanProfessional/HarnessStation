import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

/**
 * Cloud text-to-speech, using the user's own key.
 *
 * Four services with four different request shapes, normalised to one call. The
 * app ships no keys for any of them — the same rule as every model provider —
 * so an engine with no key configured simply isn't offered.
 *
 * All of these bill per character, which shapes the design: the caller
 * synthesises a sentence at a time, and a failure falls back to a local voice
 * rather than retrying and charging twice.
 */

export type SpeechEngine = "openai" | "elevenlabs" | "cartesia" | "groq";

export interface SpeechProvider {
  engine: SpeechEngine;
  /** The user's key. Never leaves the machine except to its own service. */
  apiKey: string;
  /** Override for self-hosted or proxied endpoints. */
  baseUrl?: string;
  model?: string;
  voice?: string;
  /** 0.25–4.0 on the services that support it. */
  speed?: number;
}

export interface EngineInfo {
  id: SpeechEngine;
  label: string;
  note: string;
  defaultModel: string;
  defaultVoice: string;
  /** Where the user gets a key. */
  keyUrl: string;
  /** Voices worth listing; these services all accept others too. */
  voices: { id: string; label: string }[];
}

export const SPEECH_ENGINES: EngineInfo[] = [
  {
    id: "openai",
    label: "OpenAI",
    note: "Reliable and cheap. gpt-4o-mini-tts takes a style instruction, so the persona actually changes the delivery.",
    defaultModel: "gpt-4o-mini-tts",
    defaultVoice: "alloy",
    keyUrl: "https://platform.openai.com/api-keys",
    voices: [
      { id: "alloy", label: "Alloy — neutral" },
      { id: "echo", label: "Echo — male, even" },
      { id: "fable", label: "Fable — British, warm" },
      { id: "nova", label: "Nova — female, bright" },
      { id: "onyx", label: "Onyx — male, deep" },
      { id: "shimmer", label: "Shimmer — female, soft" },
    ],
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    note: "The most human of the four, and the most expensive. Flash v2.5 is the one to use for a conversation.",
    defaultModel: "eleven_flash_v2_5",
    defaultVoice: "21m00Tcm4TlvDq8ikWAM",
    keyUrl: "https://elevenlabs.io/app/settings/api-keys",
    voices: [
      { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel — female, calm" },
      { id: "AZnzlk1XvdvUeBnXmlld", label: "Domi — female, strong" },
      { id: "EXAVITQu4vr4xnSDxMaL", label: "Sarah — female, soft" },
      { id: "TxGEqnHWrfWFTfGW9XjX", label: "Josh — male, deep" },
      { id: "VR6AewLTigWG4xSOukaG", label: "Arnold — male, firm" },
    ],
  },
  {
    id: "cartesia",
    label: "Cartesia",
    note: "Built for low latency — the fastest to first audio, which is what you notice in conversation.",
    defaultModel: "sonic-2",
    defaultVoice: "a0e99841-438c-4a64-b679-ae501e7d6091",
    keyUrl: "https://play.cartesia.ai/keys",
    voices: [{ id: "a0e99841-438c-4a64-b679-ae501e7d6091", label: "Barbershop Man" }],
  },
  {
    id: "groq",
    label: "Groq (PlayAI)",
    note: "Very fast and inexpensive; fewer voices than the others.",
    defaultModel: "playai-tts",
    defaultVoice: "Fritz-PlayAI",
    keyUrl: "https://console.groq.com/keys",
    voices: [
      { id: "Fritz-PlayAI", label: "Fritz — male" },
      { id: "Arista-PlayAI", label: "Arista — female" },
      { id: "Atlas-PlayAI", label: "Atlas — male, deep" },
      { id: "Celeste-PlayAI", label: "Celeste — female, warm" },
    ],
  },
];

export function engineInfo(id: SpeechEngine): EngineInfo {
  return SPEECH_ENGINES.find((e) => e.id === id) ?? SPEECH_ENGINES[0];
}

/** Is this provider configured enough to be used? */
export function speechConfigured(p?: SpeechProvider | null): p is SpeechProvider {
  return !!p && !!p.apiKey.trim();
}

interface Request {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Build the request for one engine.
 *
 * Split out from the fetch so the shapes can be tested without a network or a
 * key — getting a header name wrong here fails at runtime with an opaque 401,
 * which is exactly the sort of thing worth pinning down in a test.
 */
export function buildSpeechRequest(
  p: SpeechProvider,
  text: string,
  instructions = "",
): Request {
  const info = engineInfo(p.engine);
  const model = p.model?.trim() || info.defaultModel;
  const voice = p.voice?.trim() || info.defaultVoice;
  const speed = p.speed ?? 1;

  switch (p.engine) {
    case "elevenlabs": {
      const base = p.baseUrl?.trim() || "https://api.elevenlabs.io";
      return {
        // The voice is part of the path here, not the body.
        url: `${base.replace(/\/$/, "")}/v1/text-to-speech/${encodeURIComponent(voice)}`,
        headers: { "xi-api-key": p.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: model, output_format: "mp3_44100_128" }),
      };
    }

    case "cartesia": {
      const base = p.baseUrl?.trim() || "https://api.cartesia.ai";
      return {
        url: `${base.replace(/\/$/, "")}/tts/bytes`,
        headers: {
          Authorization: `Bearer ${p.apiKey}`,
          // Cartesia versions its API by date header rather than by path.
          "Cartesia-Version": "2024-06-10",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_id: model,
          transcript: text,
          voice: { mode: "id", id: voice },
          output_format: { container: "mp3", bit_rate: 128000, sample_rate: 44100 },
          language: "en",
        }),
      };
    }

    case "groq": {
      const base = p.baseUrl?.trim() || "https://api.groq.com/openai";
      return {
        url: `${base.replace(/\/$/, "")}/v1/audio/speech`,
        headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, voice, input: text, response_format: "wav" }),
      };
    }

    default: {
      const base = p.baseUrl?.trim() || "https://api.openai.com/v1";
      return {
        url: `${base.replace(/\/$/, "")}/audio/speech`,
        headers: { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          voice,
          input: text,
          speed,
          // Only gpt-4o-mini-tts honours this; the older models ignore the field
          // rather than rejecting the request, so it's safe to always send.
          ...(instructions ? { instructions } : {}),
          response_format: "mp3",
        }),
      };
    }
  }
}

/** Synthesise one utterance. Returns a blob URL ready to play. */
export async function cloudSynthesize(
  p: SpeechProvider,
  text: string,
  instructions = "",
): Promise<string> {
  const req = buildSpeechRequest(p, text, instructions);
  const res = await tauriFetch(req.url, {
    method: "POST",
    headers: req.headers,
    body: req.body,
  });
  if (!res.ok) {
    throw new Error(await speechError(res, engineInfo(p.engine).label));
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Turn a failed response into something a user can act on.
 *
 * "Request failed with status 401" tells them nothing; the common failures here
 * are a wrong key, an empty balance and a bad voice id, and each has a different
 * fix.
 */
async function speechError(res: Response, label: string): Promise<string> {
  let detail = "";
  try {
    const text = await res.text();
    const json = JSON.parse(text) as { error?: { message?: string } | string; detail?: string };
    detail =
      typeof json.error === "string"
        ? json.error
        : json.error?.message || json.detail || text.slice(0, 200);
  } catch {
    /* not JSON; the status carries the meaning */
  }

  if (res.status === 401 || res.status === 403) {
    return `${label} rejected the key. Check it in Settings › Voice.${detail ? ` (${detail})` : ""}`;
  }
  if (res.status === 429) {
    return `${label} is rate-limiting, or the account is out of credit.${detail ? ` (${detail})` : ""}`;
  }
  if (res.status === 404 || res.status === 422 || res.status === 400) {
    return `${label} didn't accept that voice or model.${detail ? ` (${detail})` : ""}`;
  }
  return `${label} failed (${res.status})${detail ? `: ${detail}` : ""}`;
}
