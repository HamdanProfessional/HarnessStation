import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Provider, Tool, ToolCall } from "../src/lib/types";

const streamChat = vi.fn();
const executeTool = vi.fn(async () => "tool output");
const runWorkflow = vi.fn(async () => "workflow output");

vi.mock("../src/lib/providers", () => ({
  streamChat: (...a: unknown[]) => streamChat(...a),
  chatOnce: vi.fn(async () => ""),
}));
vi.mock("../src/lib/tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/tools")>()),
  executeTool: (...a: unknown[]) => executeTool(...(a as [])),
}));
vi.mock("../src/lib/workflow", () => ({ runWorkflow: (...a: unknown[]) => runWorkflow(...(a as [])) }));
vi.mock("../src/lib/memory", () => ({
  recall: vi.fn(async () => []),
  recallSearch: vi.fn(async () => ""),
  remember: vi.fn(async () => "ok"),
  extractAndStore: vi.fn(async () => {}),
}));
vi.mock("../src/lib/rag", () => ({ retrieveMultiContext: vi.fn(async () => "") }));

// runAgent re-reads tools from the store each round (so a tool enabled mid-task is
// callable next step); stand in for it with the fixture list.
let liveTools: Tool[] = [];
let liveAgents: Agent[] = [];
vi.mock("../src/lib/store", () => ({
  useStore: { getState: () => ({ agents: liveAgents, allTools: () => liveTools }) },
}));
vi.mock("../src/lib/skills", () => ({ listSkills: vi.fn(async () => []), skillIndexPrompt: () => "" }));

const { runAgent } = await import("../src/lib/agents");

const provider: Provider = {
  id: "p1",
  name: "P",
  kind: "openai-compatible",
  baseUrl: "",
  apiKey: "",
  models: ["m1"],
};

const tool: Tool = { id: "t1", name: "do_thing", description: "", parameters: {}, code: "" };

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: "a1",
  name: "Helper",
  description: "",
  instructions: "be helpful",
  providerId: "",
  model: "",
  temperature: 0.7,
  maxTokens: 0,
  toolIds: ["t1"],
  workflowIds: [],
  subAgentIds: [],
  ...over,
});

const call = (name: string, args = "{}"): ToolCall => ({ id: "c1", name, arguments: args });

const ctx = (over: Record<string, unknown> = {}) => ({
  agents: [agent()],
  allTools: [tool],
  workflows: [] as { id: string; name: string; description: string; steps: unknown[] }[],
  providers: [provider],
  provider,
  model: "m1",
  signal: new AbortController().signal,
  ...over,
});

beforeEach(() => {
  liveTools = [tool];
  liveAgents = [agent()];
  streamChat.mockReset();
  executeTool.mockReset();
  executeTool.mockResolvedValue("tool output");
  runWorkflow.mockReset();
  runWorkflow.mockResolvedValue("workflow output");
});

describe("runAgent", () => {
  it("returns the model's answer when it asks for no tools", async () => {
    streamChat.mockImplementation(async (p: { onDelta: (t: string) => void }) => {
      p.onDelta("the answer");
      return { toolCalls: null };
    });

    expect(await runAgent(agent(), "do it", ctx())).toBe("the answer");
  });

  it("runs a tool then continues", async () => {
    let n = 0;
    streamChat.mockImplementation(async (p: { onDelta: (t: string) => void }) => {
      if (n++ === 0) return { toolCalls: [call("do_thing")] };
      p.onDelta("done with tools");
      return { toolCalls: null };
    });

    expect(await runAgent(agent(), "go", ctx())).toBe("done with tools");
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it("stops when the model repeats the identical call", async () => {
    // Regression: runAgent had no stuck-loop guard, so a repeating model burned
    // all 20 rounds unattended.
    streamChat.mockImplementation(async () => ({ toolCalls: [call("do_thing", '{"same":1}')] }));

    const out = await runAgent(agent(), "go", ctx());

    expect(out).toMatch(/repeated the same tool call/);
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(streamChat.mock.calls.length).toBeLessThan(5);
  });

  it("keeps going while the calls differ", async () => {
    let n = 0;
    streamChat.mockImplementation(async (p: { onDelta: (t: string) => void }) => {
      n++;
      if (n > 3) {
        p.onDelta("finished");
        return { toolCalls: null };
      }
      return { toolCalls: [call("do_thing", `{"page":${n}}`)] };
    });

    expect(await runAgent(agent(), "go", ctx())).toBe("finished");
    expect(executeTool).toHaveBeenCalledTimes(3);
  });

  it("stops at the round ceiling", async () => {
    let n = 0;
    streamChat.mockImplementation(async () => ({ toolCalls: [call("do_thing", `{"n":${n++}}`)] }));

    expect(await runAgent(agent(), "go", ctx())).toBe("[agent stopped: too many tool rounds]");
    expect(streamChat).toHaveBeenCalledTimes(20);
  });

  it("refuses to recurse past the depth limit", async () => {
    expect(await runAgent(agent(), "go", ctx({ depth: 9 }))).toBe("[agent depth limit reached]");
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("reports an unknown tool without throwing", async () => {
    let n = 0;
    streamChat.mockImplementation(async (p: { onDelta: (t: string) => void }) => {
      if (n++ === 0) return { toolCalls: [call("missing_tool")] };
      p.onDelta("recovered");
      return { toolCalls: null };
    });

    expect(await runAgent(agent(), "go", ctx())).toBe("recovered");
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("keeps generated media out of the model's context", async () => {
    executeTool.mockResolvedValueOnce("data:image/png;base64,AAAA");
    let n = 0;
    streamChat.mockImplementation(async (p: { onDelta: (t: string) => void }) => {
      if (n++ === 0) return { toolCalls: [call("do_thing")] };
      p.onDelta("ok");
      return { toolCalls: null };
    });

    await runAgent(agent(), "draw", ctx());

    const second = streamChat.mock.calls[1][0] as { messages: { content: string }[] };
    const toolMsg = second.messages.find((m) => m.content.includes("produced media"));
    expect(toolMsg).toBeTruthy();
    expect(second.messages.some((m) => m.content.startsWith("data:"))).toBe(false);
  });

  it("gives a workflow it invokes the context to run agent steps", async () => {
    // Regression: media and runAgent weren't forwarded, so an agent step inside a
    // workflow reached this way failed with "agent steps aren't available here".
    const wfTool: Tool = {
      id: "workflow:w1",
      name: "run_wf",
      description: "",
      parameters: {},
      code: "",
    };
    let n = 0;
    streamChat.mockImplementation(async (p: { onDelta: (t: string) => void }) => {
      if (n++ === 0) return { toolCalls: [call("run_wf", '{"input":"x"}')] };
      p.onDelta("done");
      return { toolCalls: null };
    });

    const media = { models: [], defaults: {} };
    await runAgent(
      agent({ workflowIds: ["w1"] }),
      "go",
      ctx({
        allTools: [tool, wfTool],
        workflows: [{ id: "w1", name: "W", description: "", steps: [] }],
        media,
      }),
    );

    const run = runWorkflow.mock.calls[0][1] as { runAgent?: unknown; media?: unknown };
    expect(typeof run.runAgent).toBe("function");
    expect(run.media).toBe(media);
  });
});
