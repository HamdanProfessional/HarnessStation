import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Condition, Provider, Tool, Workflow } from "../src/lib/types";

// The workflow engine is the part worth testing; the model call and the tool
// sandbox are stubbed so a run is deterministic and offline.
const chatOnce = vi.fn(async (_p: Provider, _m: string, instructions: string, prompt: string) =>
  `[${instructions}|${prompt}]`,
);
const executeTool = vi.fn(async (tool: Tool, args: Record<string, unknown>) =>
  `${tool.name}(${JSON.stringify(args)})`,
);

vi.mock("../src/lib/providers", () => ({
  chatOnce: (...a: unknown[]) => (chatOnce as never as Function)(...a),
  streamChat: vi.fn(async () => ({ toolCalls: [] })),
}));
vi.mock("../src/lib/tools", () => ({
  executeTool: (...a: unknown[]) => (executeTool as never as Function)(...a),
}));

const { evaluateCondition, runWorkflow } = await import("../src/lib/workflow");

const provider: Provider = {
  id: "p",
  name: "P",
  kind: "openai-compatible",
  baseUrl: "http://x/v1",
  apiKey: "",
  models: [],
};

const tctx = (over: Partial<{ input: string; prev: string; steps: Record<string, string> }> = {}) => ({
  input: "",
  prev: "",
  steps: {},
  ...over,
});

const cond = (over: Partial<Condition>): Condition => ({ left: "", op: "contains", right: "", goto: "end", ...over });

function makeRun(over: Partial<Parameters<typeof runWorkflow>[1]> = {}) {
  const logs: { step: string; kind: string; output: string }[] = [];
  const run = {
    provider,
    model: "m",
    tools: [] as Tool[],
    input: "INPUT",
    signal: new AbortController().signal,
    onLog: (l: { step: string; kind: string; output: string }) => logs.push(l),
    ...over,
  };
  return { run, logs };
}

beforeEach(() => {
  chatOnce.mockClear();
  executeTool.mockClear();
});

describe("evaluateCondition", () => {
  it("defaults the left side to {{prev}}", () => {
    expect(evaluateCondition(cond({ right: "yes" }), "YES please", tctx({ prev: "YES please" }))).toBe(true);
  });

  it("compares case-insensitively for contains/starts/ends", () => {
    expect(evaluateCondition(cond({ left: "Hello World", op: "contains", right: "WORLD" }), "", tctx())).toBe(true);
    expect(evaluateCondition(cond({ left: "Hello", op: "starts", right: "he" }), "", tctx())).toBe(true);
    expect(evaluateCondition(cond({ left: "Hello", op: "ends", right: "LO" }), "", tctx())).toBe(true);
    expect(evaluateCondition(cond({ left: "Hello", op: "not_contains", right: "zzz" }), "", tctx())).toBe(true);
  });

  it("compares eq/neq case-sensitively after trimming", () => {
    expect(evaluateCondition(cond({ left: "  ok  ", op: "eq", right: "ok" }), "", tctx())).toBe(true);
    expect(evaluateCondition(cond({ left: "OK", op: "eq", right: "ok" }), "", tctx())).toBe(false);
    expect(evaluateCondition(cond({ left: "OK", op: "neq", right: "ok" }), "", tctx())).toBe(true);
  });

  it("handles numeric comparisons and rejects non-numbers", () => {
    expect(evaluateCondition(cond({ left: "10", op: "gt", right: "2" }), "", tctx())).toBe(true);
    expect(evaluateCondition(cond({ left: "10", op: "lt", right: "2" }), "", tctx())).toBe(false);
    expect(evaluateCondition(cond({ left: "2", op: "gte", right: "2" }), "", tctx())).toBe(true);
    expect(evaluateCondition(cond({ left: "2", op: "lte", right: "2" }), "", tctx())).toBe(true);
    expect(evaluateCondition(cond({ left: "abc", op: "gt", right: "2" }), "", tctx())).toBe(false);
  });

  it("treats a blank left side as empty", () => {
    expect(evaluateCondition(cond({ left: "{{prev}}", op: "empty" }), "", tctx({ prev: "   " }))).toBe(true);
    expect(evaluateCondition(cond({ left: "{{prev}}", op: "not_empty" }), "", tctx({ prev: "x" }))).toBe(true);
  });

  it("applies regex and swallows an invalid pattern", () => {
    expect(evaluateCondition(cond({ left: "abc123", op: "regex", right: "\\d+" }), "", tctx())).toBe(true);
    expect(evaluateCondition(cond({ left: "abc", op: "regex", right: "([" }), "", tctx())).toBe(false);
  });

  it("interpolates {{input}} and {{steps.NAME}}", () => {
    const c = cond({ left: "{{steps.first}}", op: "eq", right: "{{input}}" });
    expect(evaluateCondition(c, "", tctx({ input: "same", steps: { first: "same" } }))).toBe(true);
  });

  it("accepts legacy { contains } cases with no op", () => {
    const legacy = { left: "", right: undefined, goto: "end", contains: "yes" } as unknown as Condition;
    expect(evaluateCondition(legacy, "yes!", tctx({ prev: "yes!" }))).toBe(true);
  });
});

describe("runWorkflow", () => {
  it("threads {{input}}, {{prev}} and {{steps.NAME}} through the steps", async () => {
    const wf: Workflow = {
      id: "w",
      name: "W",
      description: "",
      steps: [
        { type: "prompt", name: "one", instructions: "sys", prompt: "got {{input}}", useTools: false },
        { type: "prompt", name: "two", instructions: "sys2", prompt: "prev={{prev}} one={{steps.one}}", useTools: false },
      ],
    };
    const { run, logs } = makeRun();
    const out = await runWorkflow(wf, run);

    expect(chatOnce.mock.calls[0][3]).toBe("got INPUT");
    expect(chatOnce.mock.calls[1][3]).toBe("prev=[sys|got INPUT] one=[sys|got INPUT]");
    expect(out).toBe("[sys2|prev=[sys|got INPUT] one=[sys|got INPUT]]");
    expect(logs.map((l) => l.step)).toEqual(["one", "two"]);
  });

  it("runs a function step with interpolated JSON args", async () => {
    const tool: Tool = { id: "t1", name: "echo", description: "", parameters: {}, code: "" };
    const wf: Workflow = {
      id: "w",
      name: "W",
      description: "",
      steps: [{ type: "function", name: "call", toolId: "t1", args: '{"q":"{{input}}"}' }],
    };
    const { run } = makeRun({ tools: [tool] });
    expect(await runWorkflow(wf, run)).toBe('echo({"q":"INPUT"})');
  });

  it("fails loudly on a missing tool or invalid args JSON", async () => {
    const wf = (args: string, toolId: string): Workflow => ({
      id: "w",
      name: "W",
      description: "",
      steps: [{ type: "function", name: "call", toolId, args }],
    });
    const tool: Tool = { id: "t1", name: "echo", description: "", parameters: {}, code: "" };
    await expect(runWorkflow(wf("{}", "nope"), makeRun({ tools: [tool] }).run)).rejects.toThrow(/tool nope not found/);
    await expect(runWorkflow(wf("{oops}", "t1"), makeRun({ tools: [tool] }).run)).rejects.toThrow(/not valid JSON/);
  });

  it("jumps on a matching switch case and ends at 'end'", async () => {
    const wf: Workflow = {
      id: "w",
      name: "W",
      description: "",
      steps: [
        { type: "prompt", name: "start", instructions: "s", prompt: "yes", useTools: false },
        { type: "switch", name: "route", cases: [cond({ right: "yes", goto: "hit" })], defaultGoto: "end" },
        { type: "prompt", name: "skipped", instructions: "s", prompt: "no", useTools: false },
        { type: "prompt", name: "hit", instructions: "s", prompt: "landed", useTools: false },
      ],
    };
    const { run, logs } = makeRun();
    const out = await runWorkflow(wf, run);
    expect(out).toBe("[s|landed]");
    expect(logs.map((l) => l.step)).toEqual(["start", "route", "hit"]);
  });

  it("takes defaultGoto when nothing matches", async () => {
    const wf: Workflow = {
      id: "w",
      name: "W",
      description: "",
      steps: [{ type: "switch", name: "route", cases: [cond({ right: "zzz", goto: "x" })], defaultGoto: "end" }],
    };
    const { run, logs } = makeRun();
    expect(await runWorkflow(wf, run)).toBe("INPUT");
    expect(logs[0].output).toContain("no match -> default -> end");
  });

  it("rejects a goto target that does not exist", async () => {
    const wf: Workflow = {
      id: "w",
      name: "W",
      description: "",
      steps: [{ type: "switch", name: "route", cases: [], defaultGoto: "ghost" }],
    };
    await expect(runWorkflow(wf, makeRun().run)).rejects.toThrow(/goto target "ghost" not found/);
  });

  it("stops a self-looping workflow at the 100-step cap", async () => {
    const wf: Workflow = {
      id: "w",
      name: "W",
      description: "",
      steps: [
        { type: "prompt", name: "loop", instructions: "s", prompt: "again", useTools: false },
        { type: "switch", name: "back", cases: [], defaultGoto: "loop" },
      ],
    };
    await expect(runWorkflow(wf, makeRun().run)).rejects.toThrow(/exceeded 100 steps/);
  });

  it("merges parallel lanes under their labels", async () => {
    const wf: Workflow = {
      id: "w",
      name: "W",
      description: "",
      steps: [
        {
          type: "parallel",
          name: "fan",
          lanes: [
            { label: "A", kind: "prompt", instructions: "sA", prompt: "{{input}}" },
            { label: "", kind: "prompt", instructions: "sB", prompt: "b" },
          ],
        },
      ],
    };
    const out = await runWorkflow(wf, makeRun().run);
    expect(out).toBe("## A\n[sA|INPUT]\n\n## lane2\n[sB|b]");
  });

  it("routes agent steps and lanes through runAgent", async () => {
    const runAgent = vi.fn(async (id: string, input: string) => `agent:${id}:${input}`);
    const wf: Workflow = {
      id: "w",
      name: "W",
      description: "",
      steps: [
        { type: "agent", name: "a", agentId: "a1", input: "{{input}}" },
        { type: "parallel", name: "p", lanes: [{ label: "L", kind: "agent", agentId: "a2" }] },
      ],
    };
    const out = await runWorkflow(wf, makeRun({ runAgent }).run);
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(runAgent.mock.calls[1][1]).toBe("agent:a1:INPUT"); // lane defaults to {{prev}}
    expect(out).toBe("## L\nagent:a2:agent:a1:INPUT");
  });

  it("errors on an agent step when no runAgent is injected", async () => {
    const wf: Workflow = {
      id: "w",
      name: "W",
      description: "",
      steps: [{ type: "agent", name: "a", agentId: "a1", input: "" }],
    };
    await expect(runWorkflow(wf, makeRun().run)).rejects.toThrow(/agent steps aren't available here/);
  });

  it("reports a step duration on every log entry", async () => {
    const wf: Workflow = {
      id: "w",
      name: "W",
      description: "",
      steps: [{ type: "prompt", name: "one", instructions: "s", prompt: "p", useTools: false }],
    };
    const { run, logs } = makeRun();
    await runWorkflow(wf, run);
    expect((logs[0] as { ms?: number }).ms).toBeGreaterThanOrEqual(0);
  });
});
