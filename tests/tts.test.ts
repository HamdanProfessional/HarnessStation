import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../src/lib/types";

const invoke = vi.fn(async () => undefined);
let speakResolvers: (() => void)[] = [];

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...(a as [])) }));

// The system voice call is what actually takes time; hold it open so the queue
// can be inspected mid-drain.
vi.mock("../src/lib/sysvoice", () => ({
  detectLang: () => "en",
  missingVoiceHelp: () => "no voice",
  voiceForLang: async () => ({ name: "Voice", engine: "sapi", lang: "en-US" }),
  winrtSpeakToDataUrl: vi.fn(),
}));
vi.mock("../src/lib/media", () => ({
  generateMedia: vi.fn(),
  mediaConfigFromSettings: () => ({ models: [], defaults: {} }),
}));
vi.mock("../src/lib/speechRewrite", () => ({ speechModel: () => null, rewriteForSpeech: vi.fn() }));
vi.mock("../src/lib/whisper", () => ({ sttLanguageName: () => "" }));
// "auto" consults the neural voice before falling back to the system one.
vi.mock("../src/lib/piper", () => ({
  piperReady: vi.fn(async () => false),
  ensurePiper: vi.fn(async () => {}),
  piperSynthesize: vi.fn(async () => "data:audio/wav;base64,AA"),
  DEFAULT_PIPER_VOICE: "en_US-amy-medium",
}));
vi.mock("../src/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const { invalidateNeuralVoice, speakQueued, stopSpeaking, whenSpoken, speakableText } =
  await import("../src/lib/tts");
const piperMod = await import("../src/lib/piper");
const ready = piperMod.piperReady as unknown as ReturnType<typeof vi.fn>;
const synth = piperMod.piperSynthesize as unknown as ReturnType<typeof vi.fn>;

const settings = { voice: { humanDelivery: false } } as unknown as Settings;

beforeEach(() => {
  speakResolvers = [];
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => {
    if (cmd !== "speak") return Promise.resolve(undefined);
    // Resolve only when the test says so.
    return new Promise<undefined>((r) => speakResolvers.push(() => r(undefined)));
  });
});

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Wait until an utterance has actually reached the speech engine. */
const awaitSpeakCall = async () => {
  for (let i = 0; i < 200 && !speakResolvers.length; i++) await flush();
};

const finishOne = async () => {
  await awaitSpeakCall();
  speakResolvers.shift()?.();
  await flush();
};

// The queue is module state: an utterance left mid-flight keeps `draining` true
// and silently swallows everything the next test queues.
afterEach(async () => {
  while (speakResolvers.length) {
    speakResolvers.shift()!();
    await flush();
  }
  await stopSpeaking();
  await flush();
});

describe("whenSpoken", () => {
  it("resolves immediately when nothing is queued", async () => {
    await expect(whenSpoken()).resolves.toBeUndefined();
  });

  it("resolves every concurrent waiter, not just the last one", async () => {
    // Regression: a single callback slot meant a second caller overwrote the
    // first, and the first promise never settled.
    speakQueued("hello there", settings);
    await awaitSpeakCall();

    const settled: string[] = [];
    const a = whenSpoken().then(() => settled.push("a"));
    const b = whenSpoken().then(() => settled.push("b"));

    await finishOne();
    await Promise.all([a, b]);

    expect(settled.sort()).toEqual(["a", "b"]);
  });

  it("resolves waiters when speech is stopped mid-queue", async () => {
    speakQueued("one two three", settings);
    speakQueued("four five six", settings);
    await awaitSpeakCall();

    const waiting = whenSpoken();
    await stopSpeaking();

    await expect(waiting).resolves.toBeUndefined();
  });

  it("resolves once the queue drains normally", async () => {
    speakQueued("a full sentence here", settings);
    await awaitSpeakCall();
    const waiting = whenSpoken();
    await finishOne();
    await expect(waiting).resolves.toBeUndefined();
  });
});

describe("stopSpeaking", () => {
  it("drops anything still queued", async () => {
    speakQueued("first utterance", settings);
    speakQueued("second utterance", settings);
    await awaitSpeakCall();

    await stopSpeaking();
    await finishOne();

    // Only the first ever reached the speech engine.
    expect(invoke.mock.calls.filter((c) => c[0] === "speak")).toHaveLength(1);
  });
});

describe("speakableText", () => {
  it("removes code fences, markdown and emoji", () => {
    expect(speakableText("Here:\n```js\nconst x=1;\n```\ndone")).toBe("Here: (code omitted) done");
    expect(speakableText("**bold** and `code` and _em_")).toBe("bold and code and em");
    expect(speakableText("nice 🎉 work")).toBe("nice work");
  });

  it("keeps link text but drops the URL", () => {
    expect(speakableText("see [the docs](https://example.com)")).toBe("see the docs");
    expect(speakableText("![alt](img.png)shown")).toBe("shown");
  });

  it("strips heading and bullet markers", () => {
    expect(speakableText("## Title\n- one\n- two")).toBe("Title one two");
  });
});

describe("engine selection", () => {
  const speakCalls = () => invoke.mock.calls.filter((c) => c[0] === "speak");

  beforeEach(() => {
    ready.mockReset();
    ready.mockResolvedValue(false);
    synth.mockReset();
    synth.mockResolvedValue("data:audio/wav;base64,AA");
    invalidateNeuralVoice(); // the install check is cached between utterances
  });

  it("uses the Windows voice on auto when the neural voice is not installed", async () => {
    ready.mockResolvedValue(false);

    speakQueued("a reasonably long sentence", { voice: { ttsEngine: "auto" } } as never);
    await awaitSpeakCall();

    expect(speakCalls()).toHaveLength(1);
    expect(synth).not.toHaveBeenCalled();
  });

  it("prefers the neural voice on auto once it is installed", async () => {
    // The whole point of the change: "auto" should mean the best available voice,
    // not always the flat built-in one.
    ready.mockResolvedValue(true);

    speakQueued("a reasonably long sentence", { voice: { ttsEngine: "auto" } } as never);
    for (let i = 0; i < 50 && !synth.mock.calls.length; i++) await flush();

    expect(synth).toHaveBeenCalled();
    expect(speakCalls()).toHaveLength(0); // never reached the Windows voice
  });

  it("always uses the Windows voice when it is pinned", async () => {
    ready.mockResolvedValue(true);

    speakQueued("a reasonably long sentence", { voice: { ttsEngine: "windows" } } as never);
    await awaitSpeakCall();

    expect(speakCalls()).toHaveLength(1);
    expect(synth).not.toHaveBeenCalled();
  });

  it("falls back to the Windows voice if the neural engine fails", async () => {
    ready.mockResolvedValue(true);
    synth.mockRejectedValueOnce(new Error("onnx failed"));

    speakQueued("a reasonably long sentence", { voice: { ttsEngine: "auto" } } as never);
    await awaitSpeakCall();

    expect(speakCalls()).toHaveLength(1); // speech never goes silent
  });
});
