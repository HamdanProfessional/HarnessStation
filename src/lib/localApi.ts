import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isWeb } from "./web";
import { useStore } from "./store";
import { streamChat } from "./providers";
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
 * Non-streaming for now: we accumulate the reply and return one ChatCompletion.
 * That's all the common clients (editors, scripts, SDKs with `stream:false`)
 * need, and it keeps the Rust front door a plain request/response.
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

/** POST /v1/chat/completions — run the request and return one ChatCompletion object. */
async function chatCompletion(body: Record<string, unknown>) {
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

  const temperature = typeof body.temperature === "number" ? body.temperature : r.temperature;
  const maxTokens =
    typeof body.max_tokens === "number"
      ? body.max_tokens
      : typeof body.max_completion_tokens === "number"
        ? body.max_completion_tokens
        : r.maxTokens;

  let text = "";
  const controller = new AbortController();
  const result = await streamChat({
    provider: r.provider,
    model: r.model,
    system: systemParts.join("\n\n"),
    messages,
    temperature,
    maxTokens,
    signal: controller.signal,
    onDelta: (delta) => {
      text += delta;
    },
  });

  const promptTokens = result.usage?.promptTokens ?? 0;
  const completionTokens = result.usage?.completionTokens ?? 0;
  return {
    id: `chatcmpl-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
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
