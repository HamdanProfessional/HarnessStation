import { describe, expect, it } from "vitest";
import { chatCapable, groupByModality, modalityOf, type Modality } from "../src/lib/modality";

/** Real ids, as providers actually return them from /v1/models. */
const REAL: [string, Modality][] = [
  // Groq — the list that prompted this. All of these arrive in one array.
  ["llama-3.3-70b-versatile", "text"],
  ["allam-2-7b", "text"],
  ["groq/compound", "text"],
  ["groq/compound-mini", "text"],
  ["meta-llama/llama-guard-4-12b", "guard"],
  ["meta-llama/llama-prompt-guard-2-86m", "guard"],
  ["whisper-large-v3", "speech-in"],
  ["whisper-large-v3-turbo", "speech-in"],
  ["distil-whisper-large-v3-en", "speech-in"],
  ["playai-tts", "speech-out"],
  ["playai-tts-arabic", "speech-out"],
  ["canopylabs/orpheus-v1-english", "speech-out"],
  ["canopylabs/orpheus-arabic-saudi", "speech-out"],

  // OpenAI
  ["gpt-4o", "text"],
  ["gpt-4o-mini", "text"],
  ["gpt-4o-transcribe", "speech-in"],
  ["gpt-4o-mini-tts", "speech-out"],
  ["text-embedding-3-large", "embed"],
  ["dall-e-3", "image"],
  ["omni-moderation-latest", "guard"],
  ["sora-2", "video"],

  // Others in the catalog
  ["claude-sonnet-5", "text"],
  ["gemini-3.7-pro", "text"],
  ["qwen3-embedding-8b", "embed"],
  ["BAAI/bge-reranker-v2-m3", "rerank"],
  ["nomic-embed-text-v1.5", "embed"],
  ["black-forest-labs/FLUX.1-schnell", "image"],
  ["stable-diffusion-xl-base-1.0", "image"],
  ["veo-3", "video"],
  ["nvidia/parakeet-tdt-0.6b", "speech-in"],
  ["hexgrad/Kokoro-82M", "speech-out"],
  ["ibm-granite/granite-guardian-3.2-5b", "guard"],
];

describe("classifying a model id", () => {
  for (const [id, want] of REAL) {
    it(`${id} → ${want}`, () => expect(modalityOf(id)).toBe(want));
  }

  it("defaults to text, because a wrong guess must not hide a chat model", () => {
    // A brand new chat model nobody has heard of has to keep working. Text is
    // the only default where being wrong is merely untidy rather than broken.
    expect(modalityOf("some-brand-new-model-2027")).toBe("text");
    expect(modalityOf("")).toBe("text");
    expect(modalityOf("   ")).toBe("text");
  });
});

describe("the qualifier beats the family name", () => {
  it("reads llama-guard as a guardrail, not as a llama chat model", () => {
    // Both rules match the string; ordering is what makes this right, so it is
    // worth a test of its own rather than trusting the rule list's order.
    expect(modalityOf("meta-llama/llama-guard-4-12b")).toBe("guard");
  });

  it("reads qwen3-embedding as an embedder, not as a qwen3 chat model", () => {
    expect(modalityOf("qwen3-embedding-4b")).toBe("embed");
  });

  it("reads a reranker as rerank even though its name says bge", () => {
    expect(modalityOf("BAAI/bge-reranker-v2-m3")).toBe("rerank");
  });
});

describe("near misses that must stay chat", () => {
  it("does not read a vision or audio-capable chat model as a media model", () => {
    // These take images or audio *as input* and reply with text — they are chat
    // models, and filing them under Image would be the most damaging error here
    // because they are among the most-used models there are.
    for (const id of [
      "gpt-4o-audio-preview",
      "gpt-4o-realtime-preview",
      "claude-sonnet-5",
      "gemini-3.7-flash",
      "qwen2.5-vl-72b-instruct",
      "llama-4-scout-17b-16e-instruct",
    ]) {
      expect(modalityOf(id), id).toBe("text");
    }
  });

  it("does not let a substring inside an unrelated word trigger a rule", () => {
    expect(modalityOf("taiwan-llm-13b")).toBe("text"); // contains "wan"
    expect(modalityOf("diabolo-7b")).toBe("text"); // contains "dia"
    expect(modalityOf("mistral-large")).toBe("text"); // contains "stt"? no — guards the boundary
  });
});

describe("grouping a provider's list", () => {
  it("splits one flat list into labelled groups, chat first", () => {
    const groups = groupByModality([
      "playai-tts",
      "whisper-large-v3",
      "llama-3.3-70b-versatile",
      "meta-llama/llama-guard-4-12b",
    ]);
    expect(groups.map((g) => g.modality)).toEqual(["text", "guard", "speech-in", "speech-out"]);
    expect(groups[0].models).toEqual(["llama-3.3-70b-versatile"]);
  });

  it("emits no empty groups", () => {
    const groups = groupByModality(["gpt-4o", "gpt-4o-mini"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].modality).toBe("text");
  });

  it("loses nothing — every model lands in exactly one group", () => {
    const all = REAL.map(([id]) => id);
    const out = groupByModality(all).flatMap((g) => g.models);
    expect(out.slice().sort()).toEqual(all.slice().sort());
  });

  it("keeps a provider's own ordering inside a group", () => {
    const groups = groupByModality(["zeta", "alpha", "middle"]);
    expect(groups[0].models).toEqual(["zeta", "alpha", "middle"]);
  });
});

describe("what a chat turn can actually send to", () => {
  it("allows text and guardrails, since both speak chat-completions", () => {
    expect(chatCapable("text")).toBe(true);
    // Guardrails answer "safe"/"unsafe" over the same endpoint. Running one on
    // purpose is legitimate, so it is labelled rather than blocked.
    expect(chatCapable("guard")).toBe(true);
  });

  it("rules out everything that needs a different endpoint", () => {
    for (const m of ["speech-in", "speech-out", "image", "video", "embed", "rerank"] as Modality[]) {
      expect(chatCapable(m), m).toBe(false);
    }
  });
});
