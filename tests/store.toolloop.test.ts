import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, Provider, Tool, ToolCall } from "../src/lib/types";

/**
 * Cover for runCompletion's tool loop — the most intricate path in the app and,
 * until now, the least tested: multi-round tool calling, the stuck-loop guard,
 * the round ceiling and the mid-chain spend cap.
 */

const streamChat = vi.fn();
const executeTool = vi.fn(async () => "tool output");
const capExceeded = vi.fn<() => string | null>(() => null);

vi.mock("../src/lib/providers", () => ({
  streamChat: (...a: unknown[]) => streamChat(...a),
  chatOnce: vi.fn(async () => "Title"),
  listModels: vi.fn(async () => []),
}));

vi.mock("../src/lib/tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/tools")>()),
  executeTool: (...a: unknown[]) => executeTool(...(a as [])),
}));

vi.mock("../src/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/storage")>()),
  saveChat: vi.fn(async () => {}),
  queueSaveChat: vi.fn(),
  flushChatSaves: vi.fn(async () => {}),
}));

vi.mock("../src/lib/budget", () => ({
  capExceeded: () => capExceeded(),
  recordUsage: vi.fn(),
  syncTray: vi.fn(async () => {}),
  totals: () => ({ todayUsd: 0, monthUsd: 0, allUsd: 0, todayTokens: 0, unpricedCalls: 0, byModel: [] }),
  onSpendChange: () => () => {},
}));

vi.mock("../src/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { useStore } = await import("../src/lib/store");

const provider: Provider = {
  id: "p1",
  name: "P",
  kind: "openai-compatible",
  baseUrl: "http://x/v1",
  apiKey: "",
  models: ["m1"],
};

const myTool: Tool = {
  id: "my_tool",
  name: "my_tool",
  description: "d",
  parameters: { type: "object", properties: {} },
  code: "",
};

const chat = (): Chat => ({
  id: "A",
  title: "Chat A",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  providerId: "p1",
  model: "m1",
  systemPrompt: "",
  styleId: "normal",
  temperature: 0.7,
  maxTokens: 0,
  enabledTools: ["my_tool"],
  messages: [],
});

const call = (id: string, name: string, args = "{}"): ToolCall => ({ id, name, arguments: args });
const msgs = () => useStore.getState().chats.find((c) => c.id === "A")!.messages;

/** Reply with tool calls on the listed rounds, then a plain answer. */
function respond(...rounds: (ToolCall[] | null)[]) {
  let i = 0;
  streamChat.mockImplementation(async (p: { onDelta: (t: string) => void }) => {
    const r = rounds[i++] ?? null;
    if (!r) {
      p.onDelta("final answer");
      return { toolCalls: null };
    }
    return { toolCalls: r };
  });
}

beforeEach(() => {
  streamChat.mockReset();
  executeTool.mockReset();
  executeTool.mockResolvedValue("tool output");
  capExceeded.mockReset();
  capExceeded.mockReturnValue(null);
  useStore.setState({
    ready: true,
    settings: {
      ...useStore.getState().settings,
      providers: [provider],
      passiveMemory: false,
      autoCompact: false,
      autoTitle: false,
      autoContinue: true,
    },
    chats: [chat()],
    customTools: [myTool],
    mcpTools: [],
    agents: [],
    workflows: [],
    currentId: "A",
    streaming: false,
    error: null,
  });
});

describe("tool loop", () => {
  it("runs the tool, records the result, and sends a second round", async () => {
    respond([call("c1", "my_tool", '{"q":"x"}')], null);

    await useStore.getState().sendMessage("do it");

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool.mock.calls[0][1]).toEqual({ q: "x" });
    expect(streamChat).toHaveBeenCalledTimes(2);

    expect(msgs().map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(msgs()[1].toolCalls).toHaveLength(1);
    expect(msgs()[2]).toMatchObject({ content: "tool output", toolCallId: "c1" });
    expect(msgs()[3].content).toBe("final answer");
  });

  it("runs every call in a multi-call round", async () => {
    respond([call("c1", "my_tool"), call("c2", "my_tool")], null);

    await useStore.getState().sendMessage("do both");

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(msgs().filter((m) => m.role === "tool").map((m) => m.toolCallId)).toEqual(["c1", "c2"]);
  });

  it("reports an unknown tool back to the model instead of throwing", async () => {
    respond([call("c1", "nope")], null);

    await useStore.getState().sendMessage("hi");

    expect(executeTool).not.toHaveBeenCalled();
    expect(msgs().find((m) => m.role === "tool")?.content).toBe("Error: unknown tool nope");
    expect(useStore.getState().error).toBeNull();
  });

  it("feeds a thrown tool error back as the tool result", async () => {
    executeTool.mockRejectedValueOnce(new Error("file not found"));
    respond([call("c1", "my_tool")], null);

    await useStore.getState().sendMessage("hi");

    expect(msgs().find((m) => m.role === "tool")?.content).toBe("Error: file not found");
    expect(msgs().at(-1)?.content).toBe("final answer");
  });

  it("survives malformed tool arguments", async () => {
    respond([call("c1", "my_tool", "{not json")], null);

    await useStore.getState().sendMessage("hi");

    expect(msgs().find((m) => m.role === "tool")?.content).toMatch(/^Error:/);
    expect(useStore.getState().error).toBeNull();
  });

  it("renders a generated data URL as an attachment, not raw text", async () => {
    executeTool.mockResolvedValueOnce("data:image/png;base64,AAAA");
    respond([call("c1", "my_tool")], null);

    await useStore.getState().sendMessage("draw");

    const toolMsg = msgs().find((m) => m.role === "tool")!;
    expect(toolMsg.content).toBe("[image generated: my_tool.png]");
    expect(toolMsg.attachments?.[0]).toMatchObject({ kind: "image", mime: "image/png" });
  });
});

describe("stuck-loop guard", () => {
  it("stops when the model repeats the identical call three times", async () => {
    streamChat.mockImplementation(async () => ({ toolCalls: [call("c", "my_tool", '{"same":1}')] }));

    await useStore.getState().sendMessage("go");

    expect(msgs().at(-1)?.content).toMatch(/repeated the same tool call/);
    // rounds 1 and 2 ran the tool; the third identical round trips the guard
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(useStore.getState().streaming).toBe(false);
  });

  it("does not trip when the arguments change each round", async () => {
    let n = 0;
    streamChat.mockImplementation(async (p: { onDelta: (t: string) => void }) => {
      n++;
      if (n > 3) {
        p.onDelta("done");
        return { toolCalls: null };
      }
      return { toolCalls: [call(`c${n}`, "my_tool", `{"page":${n}}`)] };
    });

    await useStore.getState().sendMessage("paginate");

    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(msgs().at(-1)?.content).toBe("done");
  });
});

describe("round ceiling", () => {
  it("stops at the limit and tells the user the task may be unfinished", async () => {
    useStore.setState({ settings: { ...useStore.getState().settings, autoContinue: false } });
    let n = 0;
    // vary the args so the repeat guard never fires — only the ceiling can stop this
    streamChat.mockImplementation(async () => ({ toolCalls: [call(`c${n}`, "my_tool", `{"n":${n++}}`)] }));

    await useStore.getState().sendMessage("forever");

    expect(streamChat).toHaveBeenCalledTimes(25); // autoContinue off
    expect(msgs().at(-1)?.content).toMatch(/Reached the tool-step limit/);
  });
});

describe("spend cap", () => {
  it("refuses to start when already over the cap", async () => {
    capExceeded.mockReturnValue("Daily spend cap reached");

    await useStore.getState().sendMessage("hi");

    expect(streamChat).not.toHaveBeenCalled();
    expect(useStore.getState().error).toBe("Daily spend cap reached");
  });

  it("breaks a running tool chain once the cap is hit mid-flight", async () => {
    let n = 0;
    streamChat.mockImplementation(async () => ({ toolCalls: [call(`c${n}`, "my_tool", `{"n":${n++}}`)] }));
    capExceeded.mockImplementation(() => (n >= 2 ? "Daily spend cap reached" : null));

    await useStore.getState().sendMessage("spend");

    expect(msgs().at(-1)?.content).toMatch(/_Stopped: Daily spend cap reached_/);
    expect(streamChat.mock.calls.length).toBeLessThan(5);
  });
});
