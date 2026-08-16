import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, Provider, Settings, Tool } from "../src/lib/types";

/**
 * Spoken sessions are ordinary Chat records: they save as you talk, resume where
 * they left off, and compact through the same path as a typed chat.
 */

const streamChat = vi.fn();

vi.mock("../src/lib/providers", () => ({
  streamChat: (...a: unknown[]) => streamChat(...a),
  chatOnce: vi.fn(async () => "summary of earlier turns"),
  listModels: vi.fn(async () => []),
}));

vi.mock("../src/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/storage")>()),
  saveChat: vi.fn(async () => {}),
  queueSaveChat: vi.fn(),
  flushChatSaves: vi.fn(async () => {}),
  loadChatBody: vi.fn(async () => null),
}));

vi.mock("../src/lib/budget", () => ({
  capExceeded: () => null,
  recordUsage: vi.fn(),
  syncTray: vi.fn(async () => {}),
  onSpendChange: () => () => {},
  totals: () => ({ todayUsd: 0, monthUsd: 0, allUsd: 0, todayTokens: 0, unpricedCalls: 0, byModel: [] }),
}));

vi.mock("../src/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../src/lib/audio", () => ({ startRecording: vi.fn() }));
const transcribeFast = vi.fn(async () => "heard you");
vi.mock("../src/lib/whisper", () => ({
  ensureWhisper: vi.fn(async () => {}),
  transcribeFast: (...a: unknown[]) => transcribeFast(...(a as [])),
  startSttServer: vi.fn(async () => true),
  stopSttServer: vi.fn(async () => {}),
  DEFAULT_STT: "base",
  DEFAULT_STT_LANG: "auto",
  sttLanguageName: () => "",
}));
vi.mock("../src/lib/tts", () => ({
  speakQueued: vi.fn(),
  stopSpeaking: vi.fn(async () => {}),
  whenSpoken: vi.fn(async () => {}),
  speakableText: (s: string) => s,
  warmSpeech: vi.fn(async () => {}),
}));
vi.mock("../src/lib/memory", () => ({
  recall: vi.fn(async () => []),
  recallBlock: vi.fn(async () => ""),
  shouldExtract: vi.fn(async () => false),
  markExtracted: vi.fn(),
  extractAndStore: vi.fn(async () => {}),
  GLOBAL_MEMORY: "__global__",
}));
vi.mock("../src/lib/rag", () => ({ retrieveMultiContext: vi.fn(async () => "") }));
vi.mock("../src/lib/skills", () => ({ skillIndexPrompt: () => "", listSkills: vi.fn(async () => []) }));

const { VoiceSession } = await import("../src/lib/voice");
const { useStore } = await import("../src/lib/store");

const provider: Provider = {
  id: "p1",
  name: "P",
  kind: "openai-compatible",
  baseUrl: "http://x/v1",
  apiKey: "",
  models: ["m1"],
};

const noop = () => {};
const callbacks = {
  onState: noop,
  onLevel: noop,
  onStatus: noop,
  onUser: noop,
  onDelta: noop,
  onAssistant: noop,
  onAction: noop,
  onError: noop,
};

function makeSession(settings?: Partial<Settings>) {
  const ctx = {
    settings: { ...useStore.getState().settings, ...settings },
    provider,
    model: "m1",
    tools: [] as Tool[],
    execTool: async () => "",
  };
  return new VoiceSession(callbacks, () => ctx);
}

/** Reach the private respond() without driving the microphone. */
const say = (s: InstanceType<typeof VoiceSession>, text: string) =>
  (s as unknown as { respond: (t: string) => Promise<void> }).respond(text);

const chatById = (id: string) => useStore.getState().chats.find((c) => c.id === id)!;

beforeEach(() => {
  transcribeFast.mockClear();
  streamChat.mockReset();
  streamChat.mockImplementation(async (p: { onDelta: (t: string) => void }) => {
    p.onDelta("spoken reply");
    return { toolCalls: null };
  });
  useStore.setState({
    ready: true,
    settings: {
      ...useStore.getState().settings,
      providers: [provider],
      passiveMemory: false,
      autoCompact: false,
    },
    chats: [],
    hydratedIds: {},
    currentId: null,
    activeVoiceChat: null,
    pendingVoiceChat: null,
  });
});

describe("saving a spoken conversation", () => {
  it("creates no chat until something is actually said", async () => {
    // Regression: starting a call created the chat immediately, so every
    // start/stop left an empty "Voice chat — …" cluttering the sidebar.
    const s = makeSession();
    await s.start("ptt");

    expect(s.getChatId()).toBeNull();
    expect(useStore.getState().chats).toHaveLength(0);
  });

  it("creates the chat on the first turn and writes to it", async () => {
    const s = makeSession();
    await s.start("ptt");

    await say(s, "what's the weather");

    const id = s.getChatId()!;
    expect(id).toBeTruthy();
    expect(chatById(id).kind).toBe("voice");
    expect(chatById(id).messages.map((m) => m.content)).toEqual([
      "what's the weather",
      "spoken reply",
    ]);
  });

  it("marks the call live in the sidebar once it exists", async () => {
    const s = makeSession();
    await s.start("ptt");
    expect(useStore.getState().activeVoiceChat).toBeNull();

    await say(s, "hello");

    expect(useStore.getState().activeVoiceChat).toBe(s.getChatId());
  });

  it("titles the chat from the first thing said", async () => {
    const s = makeSession();
    await s.start("ptt");

    await say(s, "remind me about the deploy");

    expect(chatById(s.getChatId()!).title).toBe("remind me about the deploy");
  });

  it("keeps appending across turns", async () => {
    const s = makeSession();
    await s.start("ptt");

    await say(s, "first");
    await say(s, "second");

    expect(chatById(s.getChatId()!).messages).toHaveLength(4);
  });

  it("starting a new conversation leaves the previous one saved", async () => {
    const s = makeSession();
    await s.start("ptt");
    await say(s, "the first conversation");
    const first = s.getChatId()!;

    await s.clearHistory();

    // The new call has no chat of its own until it is spoken into.
    expect(s.getChatId()).toBeNull();
    expect(chatById(first).messages).toHaveLength(2);
    expect(s.getHistory()).toEqual([]);

    await say(s, "the second conversation");
    expect(s.getChatId()).not.toBe(first);
  });
});

describe("resuming a spoken conversation", () => {
  it("picks up the saved transcript and continues it", async () => {
    const s = makeSession();
    await s.start("ptt");
    await say(s, "what did I ask you to remember");
    const id = s.getChatId()!;

    // A later session resumes the same chat.
    const later = makeSession();
    await later.start("ptt", id);

    expect(later.getChatId()).toBe(id);
    expect(later.getHistory().map((m) => m.content)).toEqual([
      "what did I ask you to remember",
      "spoken reply",
    ]);

    await say(later, "carry on");
    expect(chatById(id).messages).toHaveLength(4);
  });

  it("sends the earlier turns back to the model, so it has the context", async () => {
    const s = makeSession();
    await s.start("ptt");
    await say(s, "my name is Sam");
    const id = s.getChatId()!;

    const later = makeSession();
    await later.start("ptt", id);
    await say(later, "what's my name");

    const sent = streamChat.mock.calls.at(-1)![0] as { messages: { content: string }[] };
    expect(sent.messages.map((m) => m.content)).toContain("my name is Sam");
  });
});

describe("compaction", () => {
  it("folds older turns into a summary and stops resending them", async () => {
    const s = makeSession();
    await s.start("ptt");
    for (const q of ["one", "two", "three", "four", "five", "six", "seven"]) await say(s, q);
    const id = s.getChatId()!;

    await s.compactNow();

    const chat = chatById(id);
    expect(chat.summary).toBe("summary of earlier turns");
    expect(chat.summaryUpto).toBeGreaterThan(0);

    await say(s, "after compacting");
    const sent = streamChat.mock.calls.at(-1)![0] as {
      system: string;
      messages: { content: string }[];
    };
    expect(sent.system).toContain("summary of earlier turns");
    expect(sent.messages.map((m) => m.content)).not.toContain("one");
  });

  it("auto-compacts once the transcript passes the threshold", async () => {
    // compactChat always keeps the last 6 messages in full, so there has to be
    // more than that before there is anything to fold away.
    const s = makeSession({ autoCompact: true, compactThreshold: 5 });
    await s.start("ptt");

    for (const q of ["one", "two", "three", "four", "five"]) await say(s, q);
    const id = s.getChatId()!;

    expect(chatById(id).summary).toBe("summary of earlier turns");
    expect(chatById(id).summaryUpto).toBeGreaterThan(0);
  });
});

describe("hands-free keeps listening across a turn", () => {
  /** Drive the private finishUtterance with a fake recorder. */
  const fakeRec = () => ({
    stopPath: vi.fn(async () => "tmp/dictation.wav"),
    takePath: vi.fn(async () => "tmp/segment.wav"),
    snapshotPath: vi.fn(async () => "tmp/partial.wav"),
  });

  const drive = async (
    s: InstanceType<typeof VoiceSession>,
    mode: "auto" | "ptt",
    rec: ReturnType<typeof fakeRec>,
  ) => {
    const inner = s as unknown as {
      recorder: unknown;
      mode: string;
      heardSpeech: boolean;
      listenStart: number;
      finishUtterance: () => Promise<void>;
    };
    inner.recorder = rec;
    inner.mode = mode;
    inner.heardSpeech = true; // the VAD heard speech in this segment
    inner.listenStart = Date.now() - 3000;
    await inner.finishUtterance();
    return inner;
  };

  it("takes the segment without closing the mic, and still transcribes", async () => {
    // Regression: heardSpeech was reset for the next segment *before* the check
    // that decides whether to transcribe, so hands-free mode listened forever
    // and never transcribed anything.
    const s = makeSession();
    await s.start("auto");
    const rec = fakeRec();

    const inner = await drive(s, "auto", rec);

    expect(rec.takePath).toHaveBeenCalledTimes(1);
    expect(rec.stopPath).not.toHaveBeenCalled();
    expect(transcribeFast).toHaveBeenCalledWith("tmp/segment.wav", expect.anything(), expect.anything());
    expect(inner.recorder).toBe(rec); // mic still open for what comes next
  });

  it("push-to-talk still stops the mic, because the key defines the turn", async () => {
    const s = makeSession();
    await s.start("ptt");
    const rec = fakeRec();

    const inner = await drive(s, "ptt", rec);

    expect(rec.stopPath).toHaveBeenCalledTimes(1);
    expect(rec.takePath).not.toHaveBeenCalled();
    expect(inner.recorder).toBeNull();
  });

  it("skips transcription when the segment held no speech", async () => {
    const s = makeSession();
    await s.start("auto");
    const rec = fakeRec();
    const inner = s as unknown as {
      recorder: unknown;
      mode: string;
      heardSpeech: boolean;
      listenStart: number;
      finishUtterance: () => Promise<void>;
    };
    inner.recorder = rec;
    inner.mode = "auto";
    inner.heardSpeech = false; // silence
    inner.listenStart = Date.now() - 3000;

    await inner.finishUtterance();

    expect(transcribeFast).not.toHaveBeenCalled();
  });
});
