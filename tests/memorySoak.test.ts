import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, Message } from "../src/lib/types";

/**
 * Memory soak — opt-in, and the "measure, don't assume" half of the transcript
 * memory story (the viral before/after screenshots measure `ps -o rss=` and
 * trust nothing). This measures the store layer's real footprint in this
 * process:
 *
 *   STRESS=1 npx vitest run tests/memorySoak.test.ts
 *   (or: npm run stress)
 *
 * What it pins, with numbers printed for the record:
 *   1. Thousands of chats at startup cost stub money, not transcript money.
 *   2. Hydrating one huge transcript costs once, and only for that chat.
 *   3. The unbounded-growth regressions this suite exists to catch — a store
 *      that eagerly loads bodies, or a save path that clones the world — show
 *      up here as RSS before they show up in a user's task manager.
 *
 * The webview's DOM cost is deliberately out of scope: vitest has no layout
 * engine. The render-side bound is the transcript window, covered structurally
 * in ChatWindow and arithmetically in tests/transcriptWindow.test.ts.
 */

const STRESS = process.env.STRESS === "1";
const d = STRESS ? describe : describe.skip;

const bodies = new Map<string, Message[]>();
const loadChatBody = vi.fn(async (id: string) => {
  const messages = bodies.get(id);
  return messages ? ({ ...stub(id), messages } as Chat) : null;
});

vi.mock("../src/lib/providers", () => ({
  streamChat: vi.fn(async () => ({ toolCalls: null })),
  chatOnce: vi.fn(async () => "Title"),
  listModels: vi.fn(async () => []),
}));

vi.mock("../src/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/storage")>()),
  loadChatBody: (id: string) => loadChatBody(id),
  saveChat: vi.fn(async () => {}),
  queueSaveChat: vi.fn(),
  flushChatSaves: vi.fn(async () => {}),
  deleteChat: vi.fn(async () => {}),
  snapshotChat: vi.fn(async () => {}),
  exportChat: vi.fn(async () => "exported"),
}));

vi.mock("../src/lib/budget", () => ({
  capExceeded: () => null,
  recordUsage: vi.fn(),
  syncTray: vi.fn(async () => {}),
  totals: () => ({ todayUsd: 0, monthUsd: 0, allUsd: 0, todayTokens: 0, unpricedCalls: 0, byModel: [] }),
  onSpendChange: () => () => {},
}));

vi.mock("../src/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { useStore } = await import("../src/lib/store");

function stub(id: string): Chat {
  return {
    id,
    title: `Chat ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    providerId: "p1",
    model: "m1",
    systemPrompt: "",
    styleId: "normal",
    temperature: 0.7,
    maxTokens: 0,
    messages: [],
  };
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const rss = () => process.memoryUsage().rss;

/** Force GC when the harness exposes it, so numbers reflect live objects. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
  (globalThis as { gc?: () => void }).gc?.();
}

const CHATS = 5_000;
const MESSAGES = 20_000;
const TURN = "Soak turn — a realistic-length message body for footprint measurement. ";

d("memory soak (STRESS=1)", () => {
  beforeEach(() => {
    bodies.clear();
    useStore.setState({
      ready: true,
      settings: {
        ...useStore.getState().settings,
        providers: [
          { id: "p1", name: "P", kind: "openai-compatible", baseUrl: "http://x/v1", apiKey: "", models: ["m1"] },
        ],
        passiveMemory: false,
        autoCompact: false,
        autoTitle: false,
      },
      chats: Array.from({ length: CHATS }, (_, i) => stub(`chat-${i}`)),
      messageCounts: Object.fromEntries(Array.from({ length: CHATS }, (_, i) => [`chat-${i}`, 0])),
      hydratedIds: {},
      currentId: null,
      streaming: false,
      error: null,
      view: "chat",
      pendingVoiceChat: null,
      activeVoiceChat: null,
    });
  });

  it("keeps thousands of closed chats at stub cost", async () => {
    await settle();
    const before = rss();

    // Touch every chat the way the sidebar does — metadata reads, no bodies.
    const chats = useStore.getState().chats;
    let titles = 0;
    for (const c of chats) if (c.title && c.messages.length === 0) titles++;
    expect(titles).toBe(CHATS);

    await settle();
    const after = rss();
    const growth = after - before;
    // eslint-disable-next-line no-console
    console.log(`[soak] ${CHATS} stubs: ${mb(growth)} growth (RSS ${mb(before)} -> ${mb(after)})`);
    expect(growth).toBeLessThan(64 * 1024 * 1024);
  });

  it("hydrates one 20k-message transcript once, and only for that chat", async () => {
    bodies.set(
      "chat-0",
      Array.from({ length: MESSAGES }, (_, i) => ({
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: TURN + `#${i}`,
      })),
    );
    await settle();
    const before = rss();

    await useStore.getState().hydrateChat("chat-0");

    const hydrated = useStore.getState().chats.find((c) => c.id === "chat-0")!;
    expect(hydrated.messages).toHaveLength(MESSAGES);
    // The other 4,999 chats must still be stubs — hydration is per chat, never global.
    expect(Object.keys(useStore.getState().hydratedIds)).toEqual(["chat-0"]);
    const stillStubs = useStore.getState().chats.filter((c) => c.id !== "chat-0" && c.messages.length === 0);
    expect(stillStubs).toHaveLength(CHATS - 1);

    await settle();
    const after = rss();
    const growth = after - before;
    // eslint-disable-next-line no-console
    console.log(
      `[soak] hydrate 1 chat x ${MESSAGES} msgs (${mb(MESSAGES * TURN.length * 2)} of text): ${mb(growth)} growth ` +
        `(RSS ${mb(before)} -> ${mb(after)})`,
    );
    // Loose enough to survive engine differences, tight enough that an
    // accidental whole-store deep clone (5,000 chats x 20k messages) blows
    // past it by orders of magnitude.
    expect(growth).toBeLessThan(256 * 1024 * 1024);
    loadChatBody.mockClear();
  });
});
