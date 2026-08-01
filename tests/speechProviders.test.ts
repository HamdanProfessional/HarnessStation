import { describe, expect, it } from "vitest";
import {
  buildSpeechRequest,
  engineInfo,
  speechConfigured,
  SPEECH_ENGINES,
  type SpeechProvider,
} from "../src/lib/speechProviders";

/**
 * Four services, four different request shapes. Getting a header name or a field
 * wrong here fails at runtime as an opaque 401 or 422 that looks like a bad key,
 * so the shapes are pinned down rather than discovered in the field.
 */

const provider = (over: Partial<SpeechProvider> = {}): SpeechProvider => ({
  engine: "openai",
  apiKey: "sk-test",
  ...over,
});

describe("building a speech request", () => {
  it("sends OpenAI the voice in the body and the key as a bearer", () => {
    const req = buildSpeechRequest(provider(), "hello");
    expect(req.url).toBe("https://api.openai.com/v1/audio/speech");
    expect(req.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(req.body);
    expect(body).toMatchObject({ input: "hello", voice: "alloy", model: "gpt-4o-mini-tts" });
  });

  it("passes a delivery instruction to OpenAI only when there is one", () => {
    expect(JSON.parse(buildSpeechRequest(provider(), "hi", "Speak calmly.").body).instructions).toBe(
      "Speak calmly.",
    );
    // An empty string would be sent as a field; older models ignore it, but an
    // absent field is what we actually mean.
    expect(JSON.parse(buildSpeechRequest(provider(), "hi", "").body)).not.toHaveProperty(
      "instructions",
    );
  });

  it("puts the ElevenLabs voice in the path and uses its own key header", () => {
    const req = buildSpeechRequest(
      provider({ engine: "elevenlabs", apiKey: "el-key", voice: "VOICE123" }),
      "hello",
    );
    expect(req.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/VOICE123");
    // Not a bearer token — ElevenLabs rejects Authorization outright.
    expect(req.headers["xi-api-key"]).toBe("el-key");
    expect(req.headers.Authorization).toBeUndefined();
    expect(JSON.parse(req.body)).toMatchObject({ text: "hello", model_id: "eleven_flash_v2_5" });
  });

  it("url-encodes a voice id that lands in the path", () => {
    const req = buildSpeechRequest(provider({ engine: "elevenlabs", voice: "a b/c" }), "x");
    expect(req.url).toContain("a%20b%2Fc");
  });

  it("sends Cartesia its dated version header and a nested voice object", () => {
    const req = buildSpeechRequest(provider({ engine: "cartesia", apiKey: "c-key" }), "hello");
    expect(req.url).toBe("https://api.cartesia.ai/tts/bytes");
    expect(req.headers["Cartesia-Version"]).toBe("2024-06-10");
    const body = JSON.parse(req.body);
    // Cartesia calls it "transcript", not "input" or "text".
    expect(body.transcript).toBe("hello");
    expect(body.voice).toEqual({ mode: "id", id: engineInfo("cartesia").defaultVoice });
  });

  it("uses Groq's OpenAI-compatible route", () => {
    const req = buildSpeechRequest(provider({ engine: "groq", apiKey: "g" }), "hello");
    expect(req.url).toBe("https://api.groq.com/openai/v1/audio/speech");
    expect(JSON.parse(req.body)).toMatchObject({ input: "hello", voice: "Fritz-PlayAI" });
  });

  it("honours a custom base URL, with or without a trailing slash", () => {
    for (const baseUrl of ["http://localhost:8080/v1", "http://localhost:8080/v1/"]) {
      expect(buildSpeechRequest(provider({ baseUrl }), "x").url).toBe(
        "http://localhost:8080/v1/audio/speech",
      );
    }
  });

  it("falls back to each engine's defaults when model and voice are blank", () => {
    for (const info of SPEECH_ENGINES) {
      const req = buildSpeechRequest(
        provider({ engine: info.id, model: "  ", voice: "  " }),
        "hello",
      );
      expect(req.body + req.url, info.id).toContain(info.defaultVoice);
      expect(req.body, info.id).toContain(info.defaultModel);
    }
  });

  it("never puts the key anywhere but a header", () => {
    for (const info of SPEECH_ENGINES) {
      const req = buildSpeechRequest(provider({ engine: info.id, apiKey: "SECRET-KEY" }), "hello");
      expect(req.body, info.id).not.toContain("SECRET-KEY");
      expect(req.url, info.id).not.toContain("SECRET-KEY");
    }
  });
});

describe("deciding whether a cloud voice is usable", () => {
  it("needs a non-blank key", () => {
    expect(speechConfigured(null)).toBe(false);
    expect(speechConfigured(undefined)).toBe(false);
    expect(speechConfigured(provider({ apiKey: "" }))).toBe(false);
    expect(speechConfigured(provider({ apiKey: "   " }))).toBe(false);
    expect(speechConfigured(provider())).toBe(true);
  });

  it("describes every engine well enough to choose one", () => {
    for (const e of SPEECH_ENGINES) {
      expect(e.note.length, e.id).toBeGreaterThan(20);
      expect(e.keyUrl, e.id).toMatch(/^https:\/\//);
      expect(e.voices.length, e.id).toBeGreaterThan(0);
      // The default has to be one the picker can actually show as selected.
      expect(e.voices.some((v) => v.id === e.defaultVoice), e.id).toBe(true);
    }
  });
});
