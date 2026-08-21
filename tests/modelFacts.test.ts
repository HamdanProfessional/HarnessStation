import { beforeEach, describe, expect, it } from "vitest";
import {
  contextWindowOf,
  factsFor,
  invalidateModelFacts,
  primeModelFacts,
  type FactsSourceModel,
} from "../src/lib/modelFacts";
import { classifyModel, modalityFromLists, modalityOf } from "../src/lib/modality";

const model = (modelKey: string, caps: FactsSourceModel["capabilities"]): FactsSourceModel => ({
  modelKey,
  capabilities: caps,
});

beforeEach(() => {
  localStorage.clear();
  invalidateModelFacts();
});

describe("the facts index", () => {
  it("answers for a model it was primed with", () => {
    primeModelFacts([
      model("whisper-large-v3", { inputModalities: ["audio"], outputModalities: ["text"] }),
    ]);
    expect(factsFor("whisper-large-v3")).toEqual({ in: ["audio"], out: ["text"] });
  });

  it("resolves a vendor-prefixed id via the canonical key", () => {
    primeModelFacts([model("claude-opus-5", { contextWindow: 200_000 })]);
    expect(contextWindowOf("anthropic/claude-opus-5")).toBe(200_000);
  });

  it("returns null for a model the catalog does not cover", () => {
    // models.dev has whisper but not playai-tts. Returning null is what lets
    // the name-based fallback take over instead of asserting something wrong.
    primeModelFacts([model("whisper-large-v3", { inputModalities: ["audio"] })]);
    expect(factsFor("playai-tts")).toBeNull();
    expect(factsFor("")).toBeNull();
  });

  it("survives a reload by reading the persisted index", () => {
    // The chat path cannot await a download to label a dropdown, so the facts
    // have to be there synchronously on the next launch.
    primeModelFacts([model("gpt-4o", { contextWindow: 128_000 })]);
    invalidateModelFacts();
    expect(contextWindowOf("gpt-4o")).toBe(128_000);
  });

  it("skips rows with no usable capabilities rather than storing empty objects", () => {
    primeModelFacts([model("bare-model", {}), model("real", { contextWindow: 1000 })]);
    expect(factsFor("bare-model")).toBeNull();
    expect(factsFor("real")).toEqual({ ctx: 1000 });
  });

  it("ignores a nonsense context window", () => {
    primeModelFacts([model("weird", { contextWindow: 0 })]);
    expect(contextWindowOf("weird")).toBeNull();
  });

  it("keeps the first of two rows for the same model", () => {
    // Matches how cost.ts resolves the same collision: the catalog's ordering
    // decides, so a resolved model is never silently redescribed later.
    primeModelFacts([model("dup", { contextWindow: 111 }), model("dup", { contextWindow: 999 })]);
    expect(contextWindowOf("dup")).toBe(111);
  });
});

describe("reading a modality out of published lists", () => {
  it("calls a model that emits audio a speech model", () => {
    expect(modalityFromLists(["text"], ["audio"])).toBe("speech-out");
  });

  it("calls a model that takes audio and emits text a transcriber", () => {
    expect(modalityFromLists(["audio"], ["text"])).toBe("speech-in");
  });

  it("keeps a vision chat model as chat, not as an image model", () => {
    // The single most damaging misfiling available: gpt-4o and Claude accept
    // images and emit text. Output is checked first precisely for this.
    expect(modalityFromLists(["text", "image"], ["text"])).toBe("text");
    expect(modalityFromLists(["text", "audio", "image"], ["text"])).toBe("text");
  });

  it("calls a model that emits images an image model", () => {
    expect(modalityFromLists(["text"], ["image"])).toBe("image");
  });

  it("gives up rather than guessing when the lists say nothing", () => {
    expect(modalityFromLists([], [])).toBeNull();
    expect(modalityFromLists(undefined, undefined)).toBeNull();
    expect(modalityFromLists(["text"], ["something-new"])).toBeNull();
  });
});

describe("published data versus the name", () => {
  it("believes the catalog over the regexes", () => {
    // A model whose name suggests nothing, but which the provider says emits
    // audio, is a speech model.
    primeModelFacts([model("quiet-name-9", { inputModalities: ["text"], outputModalities: ["audio"] })]);
    expect(modalityOf("quiet-name-9")).toBe("text"); // name alone
    expect(classifyModel("quiet-name-9")).toBe("speech-out"); // with facts
  });

  it("corrects a regex false positive when the catalog disagrees", () => {
    // "canary" matches the speech-in rule, but if the catalog says text-to-text
    // the published answer wins.
    primeModelFacts([model("canary-chat-7b", { inputModalities: ["text"], outputModalities: ["text"] })]);
    expect(modalityOf("canary-chat-7b")).toBe("speech-in");
    expect(classifyModel("canary-chat-7b")).toBe("text");
  });

  it("falls back to the name for models the catalog omits", () => {
    primeModelFacts([model("something-else", { contextWindow: 1 })]);
    expect(classifyModel("playai-tts")).toBe("speech-out");
    expect(classifyModel("meta-llama/llama-guard-4-12b")).toBe("guard");
  });

  it("keeps guardrails classified by name, which modality cannot express", () => {
    // A safety classifier takes text and emits text — identical to a chat model
    // by modality alone. Published data would silently reclassify it as chat.
    primeModelFacts([
      model("meta-llama/llama-guard-4-12b", {
        inputModalities: ["text"],
        outputModalities: ["text"],
      }),
    ]);
    expect(classifyModel("meta-llama/llama-guard-4-12b")).toBe("guard");
  });

  it("still works with no index at all", () => {
    expect(classifyModel("whisper-large-v3")).toBe("speech-in");
    expect(classifyModel("gpt-4o")).toBe("text");
  });
});
