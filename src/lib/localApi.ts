import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isWeb } from "./web";
import { useStore } from "./store";
import { streamChat } from "./providers";
import { rotate } from "./rotation";
import type { Agent, Message, Provider } from "./types";

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

/** GET /v1/models — every provider model plus every agent, OpenAI-shaped. */
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
  // With round-robin on, share it out between every provider that lists it;
  // an API client sending the same bare id in a loop is exactly the traffic
  // that pins one key to its rate limit while the others idle.
  const owner =
    (settings.roundRobin ? rotate(modelId, providers) : null) ??
    providers.find((p) => p.models.includes(modelId)) ??
    providers[0];
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

  const r = resolve(modelId);

  // Fold any system messages into the system prompt; map the rest to our shape.
  const systemParts = r.system ? [r.system] : [];
  const messages: Message[] = [];
  for (const raw of rawMessages) {
    const m = raw as { role?: string; content?: unknown };
    const role = String(m.role ?? "user");
    const content = typeof m.content === "string" ? m.content : stringifyContent(m.content);
    if (role === "system") systemParts.push(content);
    else if (role === "assistant") messages.push({ role: "assistant", content });
    else if (role === "tool") messages.push({ role: "tool", content });
    else messages.push({ role: "user", content });
  }

  return {
    provider: r.provider,
    model: r.model,
    system: systemParts.join("\n\n"),
    messages,
    temperature: typeof body.temperature === "number" ? body.temperature : r.temperature,
    // `max_tokens` is deprecated in favour of `max_completion_tokens`, but far
    // more clients still send it, so it wins when both are present.
    maxTokens:
      typeof body.max_tokens === "number"
        ? body.max_tokens
        : typeof body.max_completion_tokens === "number"
          ? body.max_completion_tokens
          : r.maxTokens,
  };
}

/** POST /v1/chat/completions — run the request and return one ChatCompletion object. */
async function chatCompletion(body: Record<string, unknown>) {
  const prepared = prepare(body);
  let text = "";
  const controller = new AbortController();
  const result = await streamChat({
    ...prepared,
    signal: controller.signal,
    onDelta: (delta) => {
      text += delta;
    },
  });

  const promptTokens = result.usage?.promptTokens ?? 0;
  const completionTokens = result.usage?.completionTokens ?? 0;
  return {
    id: completionId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: String(body.model ?? "").trim(),
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: finishReason(result.usage?.completionTokens, prepared.maxTokens),
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
async function chatCompletionStream(rid: number, body: Record<string, unknown>): Promise<void> {
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

    const result = await streamChat({
      ...prepared,
      signal: controller.signal,
      onDelta: (text) => {
        pushed = true;
        void push(frame({ content: text }));
      },
    });

    const finish = controller.signal.aborted ? "stop" : finishReason(result.usage?.completionTokens, prepared.maxTokens);
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
