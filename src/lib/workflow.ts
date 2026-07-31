import { chatOnce } from "./providers";
import { executeTool } from "./tools";
import type { MediaConfig } from "./media";
import type { Condition, ParallelLane, Provider, Tool, Workflow, WorkflowStep } from "./types";

export interface WorkflowLog {
  step: string;
  kind: string;
  output: string;
  ms?: number; // wall-clock duration of the step, when known
}

interface RunCtx {
  provider: Provider;
  model: string;
  tools: Tool[];
  input: string;
  signal: AbortSignal;
  onLog: (log: WorkflowLog) => void;
  onStepStart?: (name: string) => void;
  /** Runs one of the user's agents (for agent steps/lanes). Injected by the caller. */
  runAgent?: (agentId: string, input: string, signal: AbortSignal) => Promise<string>;
  /** Media generation config, forwarded to tool execution. */
  media?: MediaConfig;
}

type TCtx = { input: string; prev: string; steps: Record<string, string> };

/** Evaluate a single condition. Supports back-compat with old { contains } cases. */
export function evaluateCondition(c: Condition, prev: string, tctx: TCtx): boolean {
  const legacy = c as unknown as { contains?: string };
  const op = c.op ?? "contains";
  const rawLeft = c.left && c.left.trim() ? c.left : "{{prev}}";
  const left = interpolate(rawLeft, tctx) || prev;
  const right = interpolate(c.right ?? legacy.contains ?? "", tctx);
  const l = (left ?? "").trim();
  const r = right.trim();
  const lc = l.toLowerCase();
  const rc = r.toLowerCase();
  switch (op) {
    case "contains":
      return lc.includes(rc);
    case "not_contains":
      return !lc.includes(rc);
    case "eq":
      return l === r;
    case "neq":
      return l !== r;
    case "starts":
      return lc.startsWith(rc);
    case "ends":
      return lc.endsWith(rc);
    case "empty":
      return l === "";
    case "not_empty":
      return l !== "";
    case "regex":
      try {
        return new RegExp(right).test(left ?? "");
      } catch {
        return false;
      }
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      const a = parseFloat(l);
      const b = parseFloat(r);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (op === "gt") return a > b;
      if (op === "lt") return a < b;
      if (op === "gte") return a >= b;
      return a <= b;
    }
    default:
      return false;
  }
}

function interpolate(template: string, ctx: TCtx): string {
  return template
    .replace(/\{\{\s*input\s*\}\}/g, ctx.input)
    .replace(/\{\{\s*prev\s*\}\}/g, ctx.prev)
    .replace(/\{\{\s*steps\.([\w-]+)\s*\}\}/g, (_, name) => ctx.steps[name] ?? "");
}

/** Run a single prompt (with or without a tool loop). Shared by prompt steps and parallel lanes. */
async function runPrompt(
  instructions: string,
  prompt: string,
  useTools: boolean,
  run: RunCtx,
): Promise<string> {
  if (useTools && run.tools.length && run.provider.kind === "openai-compatible") {
    return promptWithTools(instructions, prompt, run);
  }
  return chatOnce(run.provider, run.model, instructions, prompt, run.signal);
}

/** Run one parallel lane (a prompt or an agent) and return its output. */
async function runLane(lane: ParallelLane, tctx: TCtx, run: RunCtx): Promise<string> {
  if (lane.kind === "agent") {
    if (!run.runAgent) return "[agent lane not supported in this context]";
    const input = interpolate(lane.agentInput || "{{prev}}", tctx);
    return run.runAgent(lane.agentId ?? "", input, run.signal);
  }
  const prompt = interpolate(lane.prompt || "{{prev}}", tctx);
  return runPrompt(lane.instructions ?? "", prompt, !!lane.useTools, run);
}

/**
 * Run a workflow: steps execute in order; switch steps jump to a step by name
 * (or "end"). Returns the last step's output. Hard cap of 100 executed steps.
 */
export async function runWorkflow(wf: Workflow, run: RunCtx): Promise<string> {
  const stepOutputs: Record<string, string> = {};
  let prev = run.input;
  let index = 0;
  let executed = 0;

  const now = () => Date.now();

  while (index < wf.steps.length) {
    if (executed++ > 100) throw new Error("Workflow exceeded 100 steps — possible loop.");
    const step: WorkflowStep = wf.steps[index];
    run.onStepStart?.(step.name);
    const tctx = { input: run.input, prev, steps: stepOutputs };
    const t0 = now();

    if (step.type === "prompt") {
      const prompt = interpolate(step.prompt, tctx);
      const output = await runPrompt(step.instructions, prompt, step.useTools, run);
      stepOutputs[step.name] = output;
      prev = output;
      run.onLog({ step: step.name, kind: "prompt", output, ms: now() - t0 });
      index++;
    } else if (step.type === "function") {
      const tool = run.tools.find((t) => t.id === step.toolId);
      if (!tool) throw new Error(`Step "${step.name}": tool ${step.toolId} not found.`);
      let args: Record<string, unknown> = {};
      const raw = interpolate(step.args || "{}", tctx);
      try {
        args = JSON.parse(raw);
      } catch {
        throw new Error(`Step "${step.name}": args is not valid JSON after interpolation:\n${raw}`);
      }
      const output = await executeTool(tool, args, "", run.media);
      stepOutputs[step.name] = output;
      prev = output;
      run.onLog({ step: step.name, kind: `function ${tool.name}`, output, ms: now() - t0 });
      index++;
    } else if (step.type === "agent") {
      if (!run.runAgent) throw new Error(`Step "${step.name}": agent steps aren't available here.`);
      const input = interpolate(step.input || "{{prev}}", tctx);
      const output = await run.runAgent(step.agentId, input, run.signal);
      stepOutputs[step.name] = output;
      prev = output;
      run.onLog({ step: step.name, kind: "agent", output, ms: now() - t0 });
      index++;
    } else if (step.type === "parallel") {
      const results = await Promise.all(
        step.lanes.map(async (lane, li) => ({
          label: lane.label || `lane${li + 1}`,
          out: await runLane(lane, tctx, run),
        })),
      );
      const merged = results.map((r) => `## ${r.label}\n${r.out}`).join("\n\n");
      stepOutputs[step.name] = merged;
      prev = merged;
      run.onLog({
        step: step.name,
        kind: `parallel (${step.lanes.length} lanes)`,
        output: merged,
        ms: now() - t0,
      });
      index++;
    } else {
      // switch: first condition that evaluates true wins
      const hit = step.cases.find((c) => evaluateCondition(c, prev, tctx));
      const target = hit ? hit.goto : step.defaultGoto;
      run.onLog({
        step: step.name,
        kind: "switch",
        output: hit
          ? `matched (${hit.left || "{{prev}}"} ${hit.op} ${hit.right}) -> ${target}`
          : `no match -> default -> ${target}`,
        ms: now() - t0,
      });
      if (target === "end") break;
      const targetIndex = wf.steps.findIndex((s) => s.name === target);
      if (targetIndex === -1) throw new Error(`Step "${step.name}": goto target "${target}" not found.`);
      index = targetIndex;
    }
  }
  return prev;
}

/** Simple tool loop for workflow prompt steps (max 4 rounds). */
async function promptWithTools(instructions: string, prompt: string, run: RunCtx): Promise<string> {
  const { streamChat } = await import("./providers");
  const messages: import("./types").Message[] = [{ role: "user", content: prompt }];
  for (let round = 0; round < 4; round++) {
    let text = "";
    const result = await streamChat({
      provider: run.provider,
      model: run.model,
      system: instructions,
      messages,
      temperature: 0.7,
      maxTokens: 0,
      tools: run.tools,
      signal: run.signal,
      onDelta: (t) => {
        text += t;
      },
    });
    if (!result.toolCalls?.length) return text;
    messages.push({ role: "assistant", content: text, toolCalls: result.toolCalls });
    for (const call of result.toolCalls) {
      const tool = run.tools.find((t) => t.name === call.name);
      let output: string;
      try {
        output = tool
          ? await executeTool(tool, JSON.parse(call.arguments || "{}"), "", run.media)
          : `Error: unknown tool ${call.name}`;
      } catch (e) {
        output = `Error: ${(e as Error).message}`;
      }
      run.onLog({ step: "(tool call)", kind: `function ${call.name}`, output });
      messages.push({ role: "tool", content: output, toolCallId: call.id });
    }
  }
  return "Workflow stopped: too many tool rounds.";
}
