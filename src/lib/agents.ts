import { streamChat } from "./providers";
import { prettyName } from "./format";
import { executeTool } from "./tools";
import { runWorkflow } from "./workflow";
import { recall, recallSearch, remember, extractAndStore } from "./memory";
import { retrieveMultiContext } from "./rag";
import { skillIndexPrompt, listSkills } from "./skills";
import { joinSwarm, leaveSwarm, takeInbox } from "./swarm";
import type { MediaConfig } from "./media";
import type { Agent, KnowledgeBase, Message, Provider, Tool } from "./types";

/** Synthetic tool ids: "agent:<id>" calls a sub-agent, "workflow:<id>" runs a workflow. */
export function agentToolId(id: string) {
  return `agent:${id}`;
}
export function workflowToolId(id: string) {
  return `workflow:${id}`;
}

export function parseSyntheticToolId(
  id: string,
): { kind: "agent" | "workflow"; id: string } | null {
  if (id.startsWith("agent:")) return { kind: "agent", id: id.slice(6) };
  if (id.startsWith("workflow:")) return { kind: "workflow", id: id.slice(9) };
  return null;
}

/** Build the synthetic Tool objects for every agent and workflow so they show up in tool lists. */
export function syntheticTools(agents: Agent[], workflows: { id: string; name: string; description: string }[]): Tool[] {
  const agentTools: Tool[] = agents.map((a) => ({
    id: agentToolId(a.id),
    name: `call_${a.name.replace(/[^\w]+/g, "_").toLowerCase()}`.slice(0, 60),
    description: `Delegate to the "${a.name}" agent. ${a.description}`.trim(),
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "The task or question for this agent." } },
      required: ["query"],
    },
    code: "",
    group: "Agents",
  }));
  const wfTools: Tool[] = workflows.map((w) => ({
    id: workflowToolId(w.id),
    name: `run_${w.name.replace(/[^\w]+/g, "_").toLowerCase()}`.slice(0, 60),
    description: `Run the "${w.name}" workflow. ${w.description}`.trim(),
    parameters: {
      type: "object",
      properties: { input: { type: "string", description: "Input passed to the workflow." } },
      required: ["input"],
    },
    code: "",
    group: "Workflows",
  }));
  return [...agentTools, ...wfTools];
}

export interface AgentRunContext {
  agents: Agent[];
  allTools: Tool[]; // real + mcp + synthetic tools
  workflows: { id: string; name: string; description: string; steps: unknown[] }[];
  providers: Provider[];
  knowledgeBases?: KnowledgeBase[];
  media?: MediaConfig;
  provider: Provider; // default when an agent has no providerId
  model: string; // default model
  signal: AbortSignal;
  onEvent?: (line: string) => void;
  depth?: number;
}

/** Resolve the concrete Tool objects an agent is allowed to use. */
export function resolveAgentTools(agent: Agent, all: Tool[]): Tool[] {
  const ids = new Set([
    ...agent.toolIds,
    ...agent.subAgentIds.map(agentToolId),
    ...agent.workflowIds.map(workflowToolId),
  ]);
  return all.filter((t) => ids.has(t.id));
}

const MAX_DEPTH = 4;

/** Run an agent to completion on a user task, handling tool + sub-agent + workflow calls. */
export async function runAgent(
  agent: Agent,
  task: string,
  ctx: AgentRunContext,
): Promise<string> {
  const depth = ctx.depth ?? 0;
  if (depth > MAX_DEPTH) return "[agent depth limit reached]";
  const provider = agent.providerId
    ? ctx.providers.find((p) => p.id === agent.providerId) ?? ctx.provider
    : ctx.provider;
  const model = agent.model || ctx.model;
  const memory = await recall(agent.id, task); // only the top-K relevant memories
  const memTools: Tool[] = [
    {
      id: `mem:remember:${agent.id}`,
      name: "remember",
      description: "Save a fact to your long-term memory so you recall it in future conversations.",
      parameters: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] },
      code: "",
    },
    {
      id: `mem:recall:${agent.id}`,
      name: "recall",
      description: "Search your long-term memory. Returns matching remembered facts.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: [] },
      code: "",
    },
  ];
  // Re-resolved every round so a tool the agent enables for itself mid-task
  // (via enable_tool) is callable on the very next step.
  let tools = [...resolveAgentTools(agent, ctx.allTools), ...memTools];
  const refreshTools = async () => {
    const { useStore } = await import("./store");
    const st = useStore.getState();
    const live = st.agents.find((a) => a.id === agent.id) ?? agent;
    tools = [...resolveAgentTools(live, st.allTools()), ...memTools];
  };

  // RAG: pull context from the agent's attached knowledge bases for this task
  let ragContext = "";
  const kbIds = agent.knowledgeBaseIds ?? [];
  if (kbIds.length && ctx.knowledgeBases?.length) {
    const kbs = ctx.knowledgeBases.filter((k) => kbIds.includes(k.id));
    if (kbs.length) {
      ragContext = await retrieveMultiContext(kbs, task, (kb) =>
        ctx.providers.find((p) => p.id === kb.embedProviderId),
      );
    }
  }

  const skillIndex = tools.some((t) => t.id === "use_skill")
    ? skillIndexPrompt(await listSkills())
    : "";

  const instructions = [
    agent.instructions,
    skillIndex,
    memory.length > 0 ? `Relevant long-term memory:\n${memory.map((m) => `- ${m}`).join("\n")}` : "",
    ragContext,
  ]
    .filter(Boolean)
    .join("\n\n");
  ctx.onEvent?.(`${"  ".repeat(depth)}▶ ${agent.name}: ${task.slice(0, 80)}`);

  // Join the swarm so concurrent agents can message this one and warn it when a
  // file it read gets edited underneath it.
  const session = joinSwarm(agent.name);
  try {
  const messages: Message[] = [{ role: "user", content: task }];
  // Same stuck-loop guard as the chat tool loop: a model that repeats the identical
  // call makes no progress, and 20 unattended rounds of it is real money.
  let lastSig = "";
  let repeats = 0;
  for (let round = 0; round < 20; round++) {
    if (round > 0) await refreshTools();
    let text = "";
    const result = await streamChat({
      provider,
      model,
      system: instructions,
      messages,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      tools,
      signal: ctx.signal,
      onDelta: (t) => (text += t),
    });
    if (!result.toolCalls?.length) {
      ctx.onEvent?.(`${"  ".repeat(depth)}✓ ${agent.name} done`);
      if (agent.autoMemory) {
        const transcript = [...messages, { role: "assistant", content: text }]
          .filter((m) => m.role !== "tool")
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n");
        void extractAndStore(agent.id, transcript, provider, model);
      }
      return text;
    }
    const sig = result.toolCalls.map((c) => `${c.name}:${c.arguments}`).join("|");
    repeats = sig === lastSig ? repeats + 1 : 0;
    lastSig = sig;
    if (repeats >= 2) {
      ctx.onEvent?.(`${"  ".repeat(depth)}✗ ${agent.name} stopped — repeated the same call`);
      return text || "[agent stopped: repeated the same tool call without progress]";
    }

    messages.push({ role: "assistant", content: text, toolCalls: result.toolCalls });
    for (const call of result.toolCalls) {
      const tool = tools.find((t) => t.name === call.name);
      let output: string;
      try {
        const args = JSON.parse(call.arguments || "{}");
        output = tool
          ? await dispatchTool(tool, args, ctx, depth, agent.id, session)
          : `Error: unknown tool ${call.name}`;
      } catch (e) {
        output = `Error: ${(e as Error).message || String(e)}`;
      }
      ctx.onEvent?.(`${"  ".repeat(depth)}  ↳ ${prettyName(call.name)}`);
      // don't feed large generated-media data URLs back into the model's context
      if (output.startsWith("data:")) output = `[${call.name} produced media for the user]`;
      // Deliver swarm traffic on the back of the tool result, so a concurrent
      // edit or a teammate's message reaches the agent at its next decision point.
      const notices = takeInbox(session);
      if (notices) output = `${output}\n\n${notices}`;
      messages.push({ role: "tool", content: output, toolCallId: call.id });
    }
  }
  return "[agent stopped: too many tool rounds]";
  } finally {
    leaveSwarm(session);
  }
}

async function dispatchTool(
  tool: Tool,
  args: Record<string, unknown>,
  ctx: AgentRunContext,
  depth: number,
  agentId: string,
  session?: string,
): Promise<string> {
  // Coordinator pattern: fan the subtasks out to helpers running concurrently.
  if (tool.id === "swarm_spawn") {
    const tasks = (Array.isArray(args.tasks) ? args.tasks : []).map(String).filter(Boolean);
    if (!tasks.length) return "No tasks given.";
    if (depth >= MAX_DEPTH) return "Already too deep to spawn more helpers — do it yourself.";
    const named = String(args.agent ?? "").toLowerCase();
    const helper =
      ctx.agents.find((a) => a.name.toLowerCase() === named) ??
      ctx.agents.find((a) => a.id === agentId) ??
      ctx.agents[0];
    if (!helper) return "No agent available to spawn.";
    const results = await Promise.all(
      tasks.map((t, i) =>
        runAgent({ ...helper, name: `${helper.name} #${i + 1}` }, t, {
          ...ctx,
          depth: depth + 1,
        }).catch((e) => `[failed] ${(e as Error).message || String(e)}`),
      ),
    );
    return results.map((r, i) => `--- helper ${i + 1} (${tasks[i].slice(0, 60)}) ---\n${r}`).join("\n\n");
  }
  if (tool.id.startsWith("mem:")) {
    const [, kind, agentId] = tool.id.split(":");
    if (kind === "remember") return remember(agentId, String(args.fact ?? ""));
    return recallSearch(agentId, String(args.query ?? ""));
  }
  const synthetic = parseSyntheticToolId(tool.id);
  if (synthetic?.kind === "agent") {
    const sub = ctx.agents.find((a) => a.id === synthetic.id);
    if (!sub) return `Error: agent ${synthetic.id} not found`;
    return runAgent(sub, String(args.query ?? ""), { ...ctx, depth: depth + 1 });
  }
  if (synthetic?.kind === "workflow") {
    const wf = ctx.workflows.find((w) => w.id === synthetic.id);
    if (!wf) return `Error: workflow ${synthetic.id} not found`;
    return runWorkflow(wf as never, {
      provider: ctx.provider,
      model: ctx.model,
      tools: ctx.allTools,
      input: String(args.input ?? ""),
      signal: ctx.signal,
      onLog: (l) => ctx.onEvent?.(`${"  ".repeat(depth)}  · ${l.step}`),
      media: ctx.media,
      // Without this a workflow reached through an agent can't run its own agent
      // steps or lanes — they'd fail with "agent steps aren't available here".
      runAgent: (id, input, signal) => {
        const sub = ctx.agents.find((a) => a.id === id);
        if (!sub) return Promise.resolve(`Error: agent ${id} not found`);
        return runAgent(sub, input, { ...ctx, signal, depth: depth + 1 });
      },
    });
  }
  return executeTool(tool, args, "", ctx.media, { kind: "agent", id: agentId }, session);
}
