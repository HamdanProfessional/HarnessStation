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
vi.mock("../src/lib/whisper", () => ({
  ensureWhisper: vi.fn(async () => {}),
  transcribeFast: vi.fn(async () => ""),
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
  });
});

describe("saving a spoken conversation", () => {
  it("creates a voice chat on start and writes the turns to it", async () => {
    const s = makeSession();
    await s.start("ptt");

    const id = s.getChatId()!;
    expect(id).toBeTruthy();
    expect(chatById(id).kind).toBe("voice");

    await say(s, "what's the weather");

    expect(chatById(id).messages.map((m) => m.content)).toEqual([
      "what's the weather",
      "spoken reply",
    ]);
  });

  it("titles the chat from the first thing said", async () => {
    const s = makeSession();
    await s.start("ptt");
    const id = s.getChatId()!;
    expect(chatById(id).title).toMatch(/^Voice chat — /);

    await say(s, "remind me about the deploy");

    expect(chatById(id).title).toBe("remind me about the deploy");
  });

  it("keeps appending across turns", async () => {
    const s = makeSession();
    await s.start("ptt");
    const id = s.getChatId()!;

    await say(s, "first");
    await say(s, "second");

    expect(chatById(id).messages).toHaveLength(4);
  });

  it("starting a new conversation leaves the previous one saved", async () => {
    const s = makeSession();
    await s.start("ptt");
    const first = s.getChatId()!;
    await say(s, "the first conversation");

    await s.clearHistory();
    const second = s.getChatId()!;

    expect(second).not.toBe(first);
    expect(chatById(first).messages).toHaveLength(2);
    expect(s.getHistory()).toEqual([]);
  });
});

describe("resuming a spoken conversation", () => {
  it("picks up the saved transcript and continues it", async () => {
    const s = makeSession();
    await s.start("ptt");
    const id = s.getChatId()!;
    await say(s, "what did I ask you to remember");

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
    const id = s.getChatId()!;
    await say(s, "my name is Sam");

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
    const id = s.getChatId()!;
    for (const q of ["one", "two", "three", "four", "five", "six", "seven"]) await say(s, q);

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
    const id = s.getChatId()!;

    for (const q of ["one", "two", "three", "four", "five"]) await say(s, q);

    expect(chatById(id).summary).toBe("summary of earlier turns");
    expect(chatById(id).summaryUpto).toBeGreaterThan(0);
  });
});
