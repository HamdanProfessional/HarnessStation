import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isWeb } from "./web";
import { useStore } from "./store";
import { streamChat, streamChain } from "./providers";
import { slugifyName } from "./format";

import type { Agent, ComboStep, Message, Provider, Tool, ToolCall } from "./types";

/**
 * Local OpenAI-compatible API server (host side).
 *
 * The Rust side (localapi.rs) binds a loopback HTTP server and, for each
 * request, emits a `localapi-request` event with a method (`models` / `chat`)
 * and the parsed params. This module answers those events using the app's
 * configured providers and agents, so any tool that speaks the OpenAI API can
 * drive the models the user has set up here.
 *
 * Streams when the client asks for it. `stream: true` used to be ignored — the
 * server answered every request with one whole ChatCompletion and
 * `Content-Type: application/json`, so a client expecting SSE either failed to
 * parse the reply or waited for frames that never arrived. Since the OpenAI
 * SDKs, LangChain and most editor integrations stream by default, that was the
 * common path, not the rare one.
 */

interface ApiRequest {
  rid: number;
  method: string;
  params: unknown;
}

let stop: UnlistenFn | null = null;

/** The default loopback port — deliberately clear of Ollama (11434) and LM Studio (1234). */
export const DEFAULT_LOCAL_API_PORT = 11435;

/** Start the server and begin answering its requests. Desktop only. */
export async function startLocalApi(port = DEFAULT_LOCAL_API_PORT): Promise<number> {
  if (isWeb()) throw new Error("The local API server is a desktop feature.");
  await stopLocalApiListener();
  stop = await listen<ApiRequest>("localapi-request", (event) => {
    void handle(event.payload);
  });
  return invoke<number>("local_api_start", { port });
}

/** Stop the server and the event listener. */
export async function stopLocalApi(): Promise<void> {
  await stopLocalApiListener();
  if (isWeb()) return;
  await invoke("local_api_stop").catch(() => {});
}

async function stopLocalApiListener(): Promise<void> {
  stop?.();
  stop = null;
}

/** The port the server is bound to, or null when stopped. */
export async function localApiStatus(): Promise<number | null> {
  if (isWeb()) return null;
  return invoke<number | null>("local_api_status").catch(() => null);
}

async function reply(rid: number, result: unknown, error?: string): Promise<void> {
  await invoke("local_api_reply", { rid, result: error ? null : result, error: error ?? null }).catch(
    () => {},
  );
}

async function handle(req: ApiRequest): Promise<void> {
  try {
    if (req.method === "models") {
      await reply(req.rid, listModels());
    } else if (req.method === "chat") {
      await reply(req.rid, await chatCompletion((req.params ?? {}) as Record<string, unknown>));
    } else if (req.method === "chat_stream") {
      // Owns its own error reporting: once SSE headers are on the wire there is
      // no status code left to send, so a failure has to arrive as a frame.
      await chatCompletionStream(req.rid, (req.params ?? {}) as Record<string, unknown>);
    } else if (req.method === "anthropic_messages") {
      await reply(req.rid, await anthropicMessages((req.params ?? {}) as Record<string, unknown>));
    } else if (req.method === "anthropic_messages_stream") {
      await handleAnthropicMessagesStream(req.rid, (req.params ?? {}) as Record<string, unknown>);
    } else if (req.method === "anthropic_count_tokens") {
      await reply(req.rid, anthropicCountTokens((req.params ?? {}) as Record<string, unknown>));
    } else {
      await reply(req.rid, null, `unknown method "${req.method}"`);
    }
  } catch (e) {
    await reply(req.rid, null, (e as Error).message || String(e));
  }
}

/** A slug clients can pass as `model` to select an agent by name. */
export function agentSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** GET /v1/models — every provider model, every agent, and every combo. */
function listModels() {
  const { settings, agents } = useStore.getState();
  const created = Math.floor(Date.now() / 1000);
  const data: { id: string; object: "model"; created: number; owned_by: string }[] = [];
  for (const p of settings.providers) {
    for (const m of p.models) {
      data.push({ id: `${p.id}/${m}`, object: "model", created, owned_by: p.name });
    }
  }
  for (const a of agents) {
    data.push({ id: `agent/${agentSlug(a.name)}`, object: "model", created, owned_by: "agent" });
  }
  for (const c of settings.combos ?? []) {
    data.push({ id: `combo/${slugifyName(c.name)}`, object: "model", created, owned_by: "combo" });
  }
  return { object: "list", data };
}

interface Resolved {
  provider: Provider;
  model: string;
  system: string;
  temperature: number;
  maxTokens: number;
}

/** Turn a client-supplied `model` id into a concrete provider + model (+ agent system prompt). */
function resolve(modelId: string): Resolved {
  const { settings, agents } = useStore.getState();
  const providers = settings.providers;
  if (!providers.length) throw new Error("No providers are configured in HarnessStation.");

  // Agent form: "agent/<slug>", "agent:<id>", a bare agent name, or its slug.
  const agentRef = modelId.replace(/^agent[/:]/i, "");
  const agent =
    agents.find((a) => a.id === agentRef) ??
    agents.find((a) => agentSlug(a.name) === agentSlug(agentRef));
  if (/^agent[/:]/i.test(modelId) && !agent) throw new Error(`No agent matches "${modelId}".`);
  if (agent) return resolveAgent(agent, providers);

  // "providerId/model" form.
  const slash = modelId.indexOf("/");
  if (slash > 0) {
    const pid = modelId.slice(0, slash);
    const model = modelId.slice(slash + 1);
    const provider = providers.find((p) => p.id === pid);
    if (provider) return { provider, model, system: "", temperature: 0.7, maxTokens: 2048 };
  }

  // Bare model name — first provider that lists it, else the default provider.
  // Round-robin does not participate: it rotates the keys *within* whichever
  // provider is chosen, which happens further down in streamChat. Picking a
  // different provider here would silently change which service answered an
  // API client's request.
  const owner = providers.find((p) => p.models.includes(modelId)) ?? providers[0];
  return { provider: owner, model: modelId, system: "", temperature: 0.7, maxTokens: 2048 };
}

function resolveAgent(agent: Agent, providers: Provider[]): Resolved {
  const provider =
    providers.find((p) => p.id === agent.providerId) ??
    providers.find((p) => p.models.length > 0) ??
    providers[0];
  const model = agent.model || provider.models[0] || "";
  if (!model) throw new Error(`Agent "${agent.name}" has no model and its provider lists none.`);
  return {
    provider,
    model,
    system: agent.instructions ?? "",
    temperature: agent.temperature ?? 0.7,
    maxTokens: agent.maxTokens ?? 2048,
  };
}

/**
 * Resolve a `combo/<slug>` model id to its ordered provider+model steps, or
 * null when the id is not a combo. Throws for a combo id that matches nothing
 * — the client named something that does not exist.
 */
export function comboStepsFor(modelId: string): { provider: Provider; model: string }[] | null {
  if (!modelId.startsWith("combo/")) return null;
  const slug = modelId.slice("combo/".length);
  const { settings } = useStore.getState();
  const combo = (settings.combos ?? []).find((c) => slugifyName(c.name) === slug);
  if (!combo) throw new Error(`No combo matches "${modelId}".`);
  const steps = combo.steps
    .map((s: ComboStep) => ({
      provider: settings.providers.find((p) => p.id === s.providerId),
      model: s.model,
    }))
    .filter((s): s is { provider: Provider; model: string } => !!s.provider);
  if (!steps.length) throw new Error(`Combo "${combo.name}" has no usable steps — check Settings → Combos.`);
  return steps;
}

/**
 * Turn an OpenAI request body into the arguments `streamChat` takes.
 *
 * Shared by the streaming and non-streaming paths so the two cannot drift on
 * which model they resolve, how system messages are folded in, or which of
 * `max_tokens` / `max_completion_tokens` wins.
 */
export function prepare(body: Record<string, unknown>) {
  const modelId = String(body.model ?? "").trim();
  if (!modelId) throw new Error("`model` is required.");
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  if (!rawMessages.length) throw new Error("`messages` must be a non-empty array.");

  // A combo id addresses a chain, not one provider+model pair; its steps are
  // carried alongside and the completion paths switch on them.
  const comboSteps = comboStepsFor(modelId);
  const r = comboSteps ? null : resolve(modelId);

  // Fold any system messages into the system prompt; map the rest to our shape.
  const systemParts = r?.system ? [r.system] : [];
  const messages: Message[] = [];
  for (const raw of rawMessages) {
    const m = raw as {
      role?: string;
      content?: unknown;
      tool_calls?: unknown;
      tool_call_id?: unknown;
    };
    const role = String(m.role ?? "user");
    const content = typeof m.content === "string" ? m.content : stringifyContent(m.content);
    if (role === "system") systemParts.push(content);
    else if (role === "assistant") messages.push(assistantFromOpenai(content, m.tool_calls));
    else if (role === "tool")
      messages.push({
        role: "tool",
        content,
        toolCallId: typeof m.tool_call_id === "string" ? m.tool_call_id : undefined,
      });
    else messages.push({ role: "user", content });
  }

  return {
    provider: comboSteps ? comboSteps[0].provider : r!.provider,
    model: comboSteps ? comboSteps[0].model : r!.model,
    system: systemParts.join("\n\n"),
    messages,
    temperature: typeof body.temperature === "number" ? body.temperature : (comboSteps ? 0.7 : r!.temperature),
    // `max_tokens` is deprecated in favour of `max_completion_tokens`, but far
    // more clients still send it, so it wins when both are present.
    maxTokens:
      typeof body.max_tokens === "number"
        ? body.max_tokens
        : typeof body.max_completion_tokens === "number"
          ? body.max_completion_tokens
          : (comboSteps ? 2048 : r!.maxTokens),
    tools: toolsFromOpenai(body.tools, body.tool_choice),
    comboSteps: comboSteps ?? undefined,
  };
}

/**
 * Client-supplied OpenAI `tools`, mapped to the app's Tool shape so they ride
 * through to the provider unchanged. This is what makes HarnessStation usable
 * as an inference endpoint for real agents: opencode, Aider, LangChain —
 * anything that speaks function calling can now drive the models configured
 * here, local GGUFs included.
 *
 * `tool_choice: "none"` drops them; every other choice behaves as "auto",
 * which is what the provider layer implements anyway.
 */
export function toolsFromOpenai(tools: unknown, toolChoice: unknown): Tool[] | undefined {
  if (!Array.isArray(tools) || !tools.length) return undefined;
  if (toolChoice === "none") return undefined;
  const out: Tool[] = [];
  for (const t of tools as { type?: string; function?: { name?: string; description?: string; parameters?: unknown } }[]) {
    if (t?.type !== "function" || !t.function?.name) continue;
    out.push({
      id: t.function.name,
      name: t.function.name,
      description: t.function.description ?? "",
      parameters:
        t.function.parameters && typeof t.function.parameters === "object"
          ? (t.function.parameters as Record<string, unknown>)
          : { type: "object", properties: {} },
      code: "",
      builtin: false,
    });
  }
  return out.length ? out : undefined;
}

/** An assistant turn from client history, carrying its requested tool calls. */
function assistantFromOpenai(content: string, toolCalls: unknown): Message {
  const calls = openaiToolCallsToApp(toolCalls);
  const msg: Message = { role: "assistant", content };
  if (calls) msg.toolCalls = calls;
  return msg;
}

/** OpenAI `tool_calls` array -> app ToolCall[]; null when absent or malformed. */
export function openaiToolCallsToApp(raw: unknown): ToolCall[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out: ToolCall[] = [];
  for (const c of raw as { id?: string; function?: { name?: string; arguments?: string } }[]) {
    if (!c?.function?.name) continue;
    out.push({
      id: typeof c.id === "string" && c.id ? c.id : `call_${out.length}`,
      name: c.function.name,
      arguments:
        typeof c.function.arguments === "string" ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}),
    });
  }
  return out.length ? out : null;
}

/** App ToolCall[] -> the shape OpenAI clients expect on an assistant message. */
export function appToolCallsToOpenai(calls: ToolCall[]) {
  return calls.map((c) => ({
    id: c.id,
    type: "function",
    function: { name: c.name, arguments: c.arguments },
  }));
}

/** POST /v1/chat/completions — run the request and return one ChatCompletion object. */
export async function chatCompletion(body: Record<string, unknown>) {
  const prepared = prepare(body);
  let text = "";
  const controller = new AbortController();
  const params = {
    ...prepared,
    signal: controller.signal,
    onDelta: (delta: string) => {
      text += delta;
    },
  };
  const result = await (prepared.comboSteps ? streamChain(prepared.comboSteps, params) : streamChat(params));

  const promptTokens = result.usage?.promptTokens ?? 0;
  const completionTokens = result.usage?.completionTokens ?? 0;
  const calls = result.toolCalls ?? [];
  const message: Record<string, unknown> = { role: "assistant", content: text };
  if (calls.length) {
    // Function calling: the model wants tools executed. Executing them is the
    // caller's job — the same contract as every OpenAI-compatible server.
    message.tool_calls = appToolCallsToOpenai(calls);
  }
  return {
    id: completionId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: String(body.model ?? "").trim(),
    choices: [
      {
        index: 0,
        message,
        finish_reason: calls.length ? "tool_calls" : finishReason(result.usage?.completionTokens, prepared.maxTokens),
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

/**
 * POST /v1/chat/completions with `stream: true` — emit OpenAI SSE chunks.
 *
 * This used to be silently ignored: the server answered every request with one
 * whole ChatCompletion object and `Content-Type: application/json`. A client
 * that asked for a stream either failed to parse it or sat waiting for frames
 * that never came, and since `stream: true` is what the OpenAI SDKs, LangChain
 * and most editor integrations send by default, "non-streaming for now" meant
 * "broken for most callers".
 *
 * Chunk shapes are built here rather than in Rust so the side that knows what a
 * model is also decides what a chunk looks like.
 */
export async function chatCompletionStream(rid: number, body: Record<string, unknown>): Promise<void> {
  const id = completionId();
  const created = Math.floor(Date.now() / 1000);
  const modelId = String(body.model ?? "").trim();
  const controller = new AbortController();
  let pushed = false;

  const frame = (delta: Record<string, unknown>, finish: string | null = null) => ({
    id,
    object: "chat.completion.chunk",
    created,
    model: modelId,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });

  /** Push a chunk; a false return means the client hung up, so stop generating. */
  const push = async (chunk: unknown): Promise<void> => {
    const alive = await invoke<boolean>("local_api_push", { rid, chunk }).catch(() => false);
    if (!alive) controller.abort();
  };

  try {
    if (!modelId) throw new Error("`model` is required.");
    const prepared = prepare(body);

    // The role arrives in its own opening chunk, exactly as OpenAI does it —
    // clients that build a message from the stream expect it before any text.
    await push(frame({ role: "assistant" }));

    const streamParams = {
      ...prepared,
      signal: controller.signal,
      onDelta: (text: string) => {
        pushed = true;
        void push(frame({ content: text }));
      },
    };
    const result = await (prepared.comboSteps
      ? streamChain(prepared.comboSteps, streamParams)
      : streamChat(streamParams));

    // Tool calls arrive whole rather than fragmented: the provider layer
    // reassembles the stream internally, so by the time we see them there is
    // nothing left to incrementally emit. OpenAI clients accept a single delta
    // carrying the complete arguments.
    const calls = result.toolCalls ?? [];
    for (const [i, c] of calls.entries()) {
      pushed = true;
      await push(
        frame({
          tool_calls: [
            { index: i, id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } },
          ],
        }),
      );
      if (controller.signal.aborted) break;
    }

    const finish = controller.signal.aborted
      ? "stop"
      : calls.length
        ? "tool_calls"
        : finishReason(result.usage?.completionTokens, prepared.maxTokens);
    await push(frame({}, finish));
    if (result.usage) {
      // Optional in the spec but widely read; clients that track spend need it.
      await push({
        id,
        object: "chat.completion.chunk",
        created,
        model: modelId,
        choices: [],
        usage: {
          prompt_tokens: result.usage.promptTokens,
          completion_tokens: result.usage.completionTokens,
          total_tokens: result.usage.promptTokens + result.usage.completionTokens,
        },
      });
    }
    await invoke("local_api_end", { rid, error: null }).catch(() => {});
  } catch (e) {
    const message = (e as Error).message || String(e);
    // If text already went out, the client has a partial message; closing with
    // a finish_reason is more use to it than an error frame it may not expect
    // mid-stream.
    if (pushed) {
      await push(frame({}, "stop"));
      await invoke("local_api_end", { rid, error: null }).catch(() => {});
    } else {
      await invoke("local_api_end", { rid, error: message }).catch(() => {});
    }
  }
}

/**
 * `length` when the reply stopped because it ran out of budget, else `stop`.
 *
 * Previously hardcoded to "stop", which tells a client the answer is complete
 * when it may have been cut off mid-sentence — the one case where a caller most
 * needs to know to ask for more.
 */
function finishReason(completionTokens: number | undefined, maxTokens: number): "stop" | "length" {
  if (!completionTokens || maxTokens <= 0) return "stop";
  return completionTokens >= maxTokens ? "length" : "stop";
}

function completionId(): string {
  return `chatcmpl-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** OpenAI allows array-of-parts content; flatten any text parts we recognise. */
export function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return String((part as { text: unknown }).text ?? "");
        return "";
      })
      .join("");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Anthropic Messages protocol (inbound)
//
// Claude Code — and anything built on anthropic-sdk — speaks /v1/messages.
// Serving it means any model configured here, local GGUFs included, can sit
// under `ANTHROPIC_BASE_URL`. Translation only: Anthropic shapes on the wire,
// the app's provider layer underneath. Tool calling passes through on
// openai-compatible providers, exactly like the OpenAI path.
// ---------------------------------------------------------------------------

interface AnthropicBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

/** Flatten Anthropic `system` (string or text blocks) to one string. */
export function anthropicSystem(system: unknown): string {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((b) => (b && typeof b === "object" && (b as AnthropicBlock).type === "text" ? String((b as AnthropicBlock).text ?? "") : ""))
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

/** Anthropic `tools` -> app Tool[]. Direct: name + input_schema need no renaming. */
export function anthropicToolsToApp(tools: unknown): Tool[] | undefined {
  if (!Array.isArray(tools) || !tools.length) return undefined;
  const out: Tool[] = [];
  for (const t of tools as { name?: string; description?: string; input_schema?: unknown }[]) {
    if (!t?.name) continue;
    out.push({
      id: t.name,
      name: t.name,
      description: t.description ?? "",
      parameters:
        t.input_schema && typeof t.input_schema === "object"
          ? (t.input_schema as Record<string, unknown>)
          : { type: "object", properties: {} },
      code: "",
      builtin: false,
    });
  }
  return out.length ? out : undefined;
}

/**
 * Anthropic `messages` -> app Messages.
 *
 * The structural difference from OpenAI: tool *results* ride inside the next
 * user message as tool_result blocks, and assistant tool calls appear as
 * tool_use blocks in content. Both unfold into the flat shape our provider
 * layer already speaks.
 */
export function anthropicMessagesToApp(messages: unknown): Message[] {
  if (!Array.isArray(messages)) return [];
  const out: Message[] = [];
  for (const raw of messages) {
    const m = raw as { role?: string; content?: unknown };
    const role = m.role === "assistant" ? "assistant" : "user";
    if (typeof m.content === "string") {
      out.push({ role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) continue;
    let text = "";
    let calls: ToolCall[] | null = null;
    for (const block of m.content as AnthropicBlock[]) {
      if (block?.type === "text") {
        text += String(block.text ?? "");
      } else if (block?.type === "tool_use" && block.name) {
        calls ??= [];
        calls.push({
          id: block.id || `call_${calls.length}`,
          name: block.name,
          arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {}),
        });
      } else if (block?.type === "tool_result") {
        out.push({
          role: "tool",
          content: stringifyContent(block.content),
          toolCallId: block.tool_use_id,
        });
      }
    }
    if (calls?.length) {
      out.push({ role: "assistant", content: text, toolCalls: calls });
    } else if (text) {
      out.push({ role, content: text });
    }
  }
  return out;
}

/**
 * Resolve the request's model for the Anthropic path.
 *
 * One deliberate difference from the OpenAI path: Claude Code sends its own
 * model names (`claude-sonnet-4-5`…) because it does not know ours. An unknown
 * *bare* name therefore falls back to the default provider's first model
 * rather than being forwarded verbatim to a provider that will 404 it.
 * Explicit forms — `provider/model`, `agent/x`, an agent's bare name — are
 * honoured exactly as given.
 */
function resolveAnthropic(modelId: string): Resolved {
  const { agents } = useStore.getState();
  const agentRef = modelId.replace(/^agent[/:]/i, "");
  const isAgentRef =
    /^agent[/:]/i.test(modelId) || agents.some((a) => agentSlug(a.name) === agentSlug(agentRef));
  const r = resolve(modelId);
  if (
    !isAgentRef &&
    !modelId.includes("/") &&
    !r.provider.models.includes(r.model) &&
    r.provider.models.length
  ) {
    return { ...r, model: r.provider.models[0] };
  }
  return r;
}

/** Everything the provider layer needs, derived from an Anthropic request body. */
export function anthropicToChatParams(body: Record<string, unknown>) {
  const modelId = String(body.model ?? "").trim();
  if (!modelId) throw new Error("`model` is required.");
  // Combos are protocol-agnostic: the chain is resolved the same way, and the
  // first step's provider just happens to receive the translated request.
  const comboSteps = comboStepsFor(modelId);
  const r = comboSteps ? null : resolveAnthropic(modelId);
  const systemParts = [r?.system, anthropicSystem(body.system)].filter(Boolean);

  return {
    provider: comboSteps ? comboSteps[0].provider : r!.provider,
    model: comboSteps ? comboSteps[0].model : r!.model,
    system: systemParts.join("\n\n"),
    messages: anthropicMessagesToApp(body.messages),
    temperature: typeof body.temperature === "number" ? body.temperature : (comboSteps ? 0.7 : r!.temperature),
    // Anthropic requires max_tokens; the resolved default covers absent ones.
    maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : (comboSteps ? 2048 : r!.maxTokens),
    tools: anthropicToolsToApp(body.tools),
    comboSteps: comboSteps ?? undefined,
  };
}

function stopReason(calls: ToolCall[], completionTokens: number | undefined, maxTokens: number): string {
  if (calls.length) return "tool_use";
  if (!completionTokens || maxTokens <= 0) return "end_turn";
  return completionTokens >= maxTokens ? "max_tokens" : "end_turn";
}

/** ToolCall arguments arrive as a JSON string; tool_use blocks carry an object. */
function inputObject(argumentsJson: string): Record<string, unknown> {
  try {
    const v = JSON.parse(argumentsJson || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Build the complete non-streaming Anthropic message from a provider result. */
export function chatResultToAnthropic(
  modelId: string,
  text: string,
  calls: ToolCall[],
  usage: { promptTokens?: number; completionTokens?: number } | undefined,
  maxTokens: number,
) {
  const content: Record<string, unknown>[] = [];
  if (text) content.push({ type: "text", text });
  for (const c of calls) {
    content.push({ type: "tool_use", id: c.id, name: c.name, input: inputObject(c.arguments) });
  }
  const inputTokens = usage?.promptTokens ?? 0;
  const outputTokens = usage?.completionTokens ?? 0;
  return {
    id: `msg_${completionId().replace("chatcmpl-", "")}`,
    type: "message",
    role: "assistant",
    model: modelId,
    content,
    stop_reason: stopReason(calls, usage?.completionTokens, maxTokens),
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

/** POST /v1/messages — non-streaming. */
export async function anthropicMessages(body: Record<string, unknown>) {
  const prepared = anthropicToChatParams(body);
  let text = "";
  const controller = new AbortController();
  const params = {
    ...prepared,
    signal: controller.signal,
    onDelta: (d: string) => {
      text += d;
    },
  };
  const result = await (prepared.comboSteps ? streamChain(prepared.comboSteps, params) : streamChat(params));
  return chatResultToAnthropic(
    String(body.model ?? "").trim(),
    text,
    result.toolCalls ?? [],
    result.usage,
    prepared.maxTokens,
  );
}

// ---------- streaming frames ----------

/** One preformatted Anthropic SSE frame; Rust writes these verbatim. */
export function anthropicFrame(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** POST /v1/messages with `stream: true` — named-event SSE, pushed preformatted. */
export async function handleAnthropicMessagesStream(rid: number, body: Record<string, unknown>): Promise<void> {
  const push = (s: string): Promise<boolean> =>
    invoke<boolean>("local_api_push", { rid, chunk: s }).catch(() => false);

  // Frame order matters (block_start before its deltas), and pushes are async
  // IPC — so they are chained through `tail` rather than fired concurrently.
  // A dead client aborts generation, exactly like the OpenAI path: paying a
  // provider to finish a reply nobody is reading is the one unrecoverable waste.
  let tail: Promise<unknown> = Promise.resolve();
  const send = (event: string, data: Record<string, unknown>) => {
    tail = tail.then(async () => {
      const alive = await push(anthropicFrame(event, data));
      if (!alive) controller.abort();
    });
  };
  const sendRaw = (s: string) => {
    tail = tail.then(async () => {
      const alive = await push(s);
      if (!alive) controller.abort();
    });
  };

  const controller = new AbortController();
  let opened = false; // whether a text content_block is open
  let index = 0;

  try {
    const prepared = anthropicToChatParams(body);
    const id = `msg_${completionId().replace("chatcmpl-", "")}`;

    send("message_start", {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        model: String(body.model ?? "").trim(),
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });

    const streamParams = {
      ...prepared,
      signal: controller.signal,
      onDelta: (text: string) => {
        if (!opened) {
          opened = true;
          send("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
        }
        send("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text } });
      },
    };
    const result = await (prepared.comboSteps
      ? streamChain(prepared.comboSteps, streamParams)
      : streamChat(streamParams));

    if (opened) {
      send("content_block_stop", { type: "content_block_stop", index });
      index++;
    }

    const calls = result.toolCalls ?? [];
    for (const c of calls) {
      if (controller.signal.aborted) break;
      send("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: c.id, name: c.name, input: {} },
      });
      send("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: c.arguments || "{}" },
      });
      send("content_block_stop", { type: "content_block_stop", index });
      index++;
    }

    send("message_delta", {
      type: "message_delta",
      delta: {
        stop_reason: controller.signal.aborted ? "end_turn" : stopReason(calls, result.usage?.completionTokens, prepared.maxTokens),
        stop_sequence: null,
      },
      usage: { output_tokens: result.usage?.completionTokens ?? 0 },
    });
    send("message_stop", { type: "message_stop" });
    await tail;
    await invoke("local_api_end", { rid, error: null }).catch(() => {});
  } catch (e) {
    const message = (e as Error).message || String(e);
    // Anthropic streams report failure as an error *event*, not a JSON body —
    // local_api_end's error frame is OpenAI-shaped, so it is not used here.
    sendRaw(anthropicFrame("error", { type: "error", error: { type: "api_error", message } }));
    await tail;
    await invoke("local_api_end", { rid, error: null }).catch(() => {});
  }
}

/**
 * POST /v1/messages/count_tokens — Claude Code asks before large requests.
 * No tokenizer this side of the wire: characters/4 is the same estimate the
 * compaction code uses, which is honest enough for a budget hint.
 */
export function anthropicCountTokens(body: Record<string, unknown>) {
  const chars = anthropicSystem(body.system).length + JSON.stringify(body.messages ?? []).length;
  return { input_tokens: Math.ceil(chars / 4) };
}
