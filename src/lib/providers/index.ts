import { fetch } from "@tauri-apps/plugin-http";
import type { Message, Provider, Tool, ToolCall } from "../types";
import { toOpenAITools } from "../tools";
import { readSSE } from "./sse";
import { gatewayUrl } from "../gateway";
import { isWeb } from "../web";
import { keysOf, rotate, rotateKeys } from "../rotation";
import { backoffMs, retryAfterMs, shouldWait } from "./backoff";

// Some providers' HTTPS APIs send no CORS headers, so a browser can't call them
// directly (Ollama Cloud, notably). On the web build we route those through the
// gateway's /api/llm-proxy, which adds CORS and streams the reply back. On the
// desktop app this import's `fetch` is Tauri's native HTTP (no CORS), so we never
// proxy there.
const NO_CORS_HOSTS = new Set([
  "ollama.com",
  "api.sambanova.ai",
  "integrate.api.nvidia.com",
  "api.lambda.ai",
  "models.github.ai",
  "api.avian.io",
  "api.anthropic.com",
]);

function needsProxy(url: string): boolean {
  if (!isWeb()) return false;
  try {
    return NO_CORS_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** fetch a provider endpoint, transparently proxying no-CORS hosts on the web. */
function llmFetch(url: string, init: Parameters<typeof fetch>[1]): ReturnType<typeof fetch> {
  const g = gatewayUrl();
  if (g && needsProxy(url)) {
    const headers = { ...((init?.headers as Record<string, string>) ?? {}), "X-Upstream-Url": url };
    return fetch(`${g.replace(/\/+$/, "")}/api/llm-proxy`, { ...init, headers });
  }
  return fetch(url, init);
}

export interface ChatParams {
  provider: Provider;
  model: string;
  system: string;
  messages: Message[];
  temperature: number;
  maxTokens: number;
  tools?: Tool[];
  jsonSchema?: string;
  /** Ask the model not to produce reasoning tokens (voice wants speed, not thought). */
  noThinking?: boolean;
  /** Reasoning-effort hint (openai-style `reasoning_effort`); ignored when `noThinking`. */
  effort?: "low" | "medium" | "high";
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onReasoning?: (text: string) => void;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResult {
  toolCalls: ToolCall[] | null;
  usage?: Usage;
}

/** A provider request that failed with an HTTP status, so failover can classify it. */
export class ProviderError extends Error {
  status?: number;
  /** Response headers, kept so failover can read Retry-After off a 429. */
  headers?: Headers;
  constructor(message: string, status?: number, headers?: Headers) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

/** Errors worth trying another key / provider for: transient, rate, or auth. */
export function isRetryableError(e: unknown): boolean {
  if (e instanceof ProviderError && typeof e.status === "number") {
    return e.status === 401 || e.status === 403 || e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500;
  }
  // A network-level throw (fetch failed, DNS, reset) — worth another endpoint.
  if (e instanceof Error) return /network|fetch|timeout|ECONN|socket|Failed to fetch/i.test(e.message);
  return false;
}

export interface Attempt {
  provider: Provider;
  /** Model to use for this attempt, or null to keep the caller's model. */
  model: string | null;
}


/**
 * The ordered list of (provider, key) attempts for a request: every key on the
 * chosen provider first, then each fallback provider (with its own keys). Pure,
 * so it's unit-tested.
 */
export function buildAttempts(provider: Provider, all: Provider[]): Attempt[] {
  const out: Attempt[] = [];
  for (const key of keysOf(provider)) out.push({ provider: { ...provider, apiKey: key }, model: null });
  for (const id of provider.fallbacks ?? []) {
    const fb = all.find((x) => x.id === id && x.id !== provider.id);
    if (!fb) continue;
    for (const key of keysOf(fb)) out.push({ provider: { ...fb, apiKey: key }, model: fb.models[0] ?? null });
  }
  return out;
}

/** Dispatch a single request to the right backend (no failover). */
function streamOnce(p: ChatParams): Promise<ChatResult> {
  if (p.provider.kind === "anthropic") return streamAnthropic(p);
  // In-browser model (web build only). Lazily loaded so the WebGPU/WASM engine
  // is never pulled in unless a webllm provider is actually used.
  if (p.provider.kind === "webllm") return import("./webllm").then((m) => m.streamWebLLM(p));
  return streamOpenAI(p);
}

/**
 * Send a chat request with resilience: rotate through the provider's keys and
 * then its fallback providers if a request is rate-limited, rejected, or the
 * connection fails — but only before any text has streamed, so a reply is never
 * duplicated. Falls back to a single attempt when nothing is configured.
 */
export async function streamChat(p: ChatParams): Promise<ChatResult> {
  let all: Provider[] = [];
  let roundRobin = false;
  try {
    const { useStore } = await import("../store");
    const s = useStore.getState().settings;
    all = s.providers;
    roundRobin = s.roundRobin === true;
  } catch {
    /* store unavailable (tests / workflows) — just use the one provider */
  }
  // Round-robin picks the *entry* provider; failover still owns what happens
  // after an error. Keeping them separate means a rotation can never mask a
  // provider that is down — it just changes which working one goes first.
  // Two independent rotations: which provider leads, and which of that
  // provider's keys leads. A single provider with several keys benefits from
  // the second even though the first has nothing to choose between.
  const picked = roundRobin ? (rotate(p.model, all) ?? p.provider) : p.provider;
  const entry = roundRobin ? rotateKeys(picked) : picked;
  const attempts = buildAttempts(entry, all);
  let lastErr: unknown;
  // Counts only the attempts we actually paused for, so the exponential curve
  // tracks how long we have been rate-limited rather than how many keys exist.
  let waited = 0;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    let emitted = false;
    const mark = <T>(fn?: (t: T) => void) => (fn ? (t: T) => { emitted = true; fn(t); } : undefined);
    try {
      return await streamOnce({
        ...p,
        provider: a.provider,
        model: a.model ?? p.model,
        onDelta: mark(p.onDelta)!,
        onReasoning: mark(p.onReasoning),
      });
    } catch (e) {
      lastErr = e;
      // Once tokens have reached the user, or the error isn't transient, or
      // there's nothing left to try — surface it.
      if (emitted || !isRetryableError(e) || i === attempts.length - 1) throw e;

      // A 429 or an overloaded 5xx means "this key works, just not yet". Moving
      // straight to the next key spends the whole pool inside a second and
      // rate-limits all of it; the provider usually said how long to wait, so
      // wait. Auth failures fall through with no delay — waiting on a bad key
      // helps nobody.
      const status = e instanceof ProviderError ? e.status : undefined;
      if (shouldWait(status)) {
        const headers = e instanceof ProviderError ? e.headers : undefined;
        const delay = backoffMs(waited, retryAfterMs(headers));
        waited++;
        if (p.signal?.aborted) throw e;
        await new Promise((r) => setTimeout(r, delay));
        if (p.signal?.aborted) throw e;
      }
    }
  }
  throw lastErr;
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/** Longest suffix of `text` that is a prefix of `tag` — used to hold back a tag split across chunks. */
function partialTagHold(text: string, tag: string): number {
  for (let k = Math.min(tag.length - 1, text.length); k > 0; k--) {
    if (text.slice(text.length - k) === tag.slice(0, k)) return k;
  }
  return 0;
}

/**
 * Route inline <think>…</think> segments of the content stream to the reasoning channel.
 * Many models (DeepSeek-R1, Qwen3, GLM, most local GGUF) emit thinking as tags in `content`
 * rather than a dedicated reasoning field. Handles tags split across streamed chunks.
 */
export function makeThinkSplitter(onContent: (t: string) => void, onReasoning?: (t: string) => void) {
  let mode: "content" | "think" = "content";
  let buf = "";
  const push = (chunk: string) => {
    buf += chunk;
    for (;;) {
      if (mode === "content") {
        const idx = buf.indexOf(THINK_OPEN);
        if (idx === -1) {
          const hold = partialTagHold(buf, THINK_OPEN);
          const emit = buf.slice(0, buf.length - hold);
          if (emit) onContent(emit);
          buf = hold ? buf.slice(buf.length - hold) : "";
          return;
        }
        if (idx > 0) onContent(buf.slice(0, idx));
        buf = buf.slice(idx + THINK_OPEN.length);
        mode = "think";
      } else {
        const idx = buf.indexOf(THINK_CLOSE);
        if (idx === -1) {
          const hold = partialTagHold(buf, THINK_CLOSE);
          const emit = buf.slice(0, buf.length - hold);
          if (emit) onReasoning?.(emit);
          buf = hold ? buf.slice(buf.length - hold) : "";
          return;
        }
        if (idx > 0) onReasoning?.(buf.slice(0, idx));
        buf = buf.slice(idx + THINK_CLOSE.length);
        mode = "content";
      }
    }
  };
  const flush = () => {
    if (!buf) return;
    if (mode === "think") onReasoning?.(buf);
    else onContent(buf);
    buf = "";
  };
  return { push, flush };
}

/** Ensure a tool call's arguments are a valid JSON-object string (some models emit empty/garbled). */
function safeArgs(args: string): string {
  const s = (args ?? "").trim();
  if (!s) return "{}";
  try {
    JSON.parse(s);
    return s;
  } catch {
    return "{}";
  }
}

function textWithAttachments(m: Message): string {
  const texts = (m.attachments ?? []).filter((a) => a.kind === "text");
  if (!texts.length) return m.content;
  const blocks = texts.map((a) => `\n\n--- Attached file: ${a.name} ---\n${a.data}`).join("");
  return m.content + blocks;
}

/**
 * Drop tool calls and tool responses that have lost their partner.
 *
 * The user can delete individual items from a conversation — a tool call, its
 * response, either on its own. That's useful for trimming context, but a
 * tool_call with no matching tool message (or vice versa) is rejected by the
 * OpenAI API. So a pair only survives here if BOTH halves are present; a
 * half-deleted pair is dropped rather than sent malformed. An assistant message
 * left with neither text nor a surviving call goes too.
 */
export function sanitizeToolPairs(messages: Message[]): Message[] {
  const responded = new Set<string>();
  const called = new Set<string>();
  for (const m of messages) {
    if (m.role === "tool" && m.toolCallId) responded.add(m.toolCallId);
    if (m.role === "assistant") for (const c of m.toolCalls ?? []) called.add(c.id);
  }
  const valid = new Set([...called].filter((id) => responded.has(id)));

  const out: Message[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      if (m.toolCallId && valid.has(m.toolCallId)) out.push(m);
      continue;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      const kept = m.toolCalls.filter((c) => valid.has(c.id));
      if (kept.length === m.toolCalls.length) {
        out.push(m);
      } else if (kept.length || m.content.trim()) {
        out.push({ ...m, toolCalls: kept.length ? kept : undefined });
      }
      // else: an assistant turn that was only tool calls, all now orphaned — drop.
      continue;
    }
    out.push(m);
  }
  return out;
}

export function toOpenAIMessages(system: string, messages: Message[]) {
  const out: Record<string, unknown>[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of sanitizeToolPairs(messages)) {
    if (m.role === "tool") {
      out.push({ role: "tool", content: m.content, tool_call_id: m.toolCallId });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: safeArgs(c.arguments) },
        })),
      });
    } else if (m.role === "user" && m.attachments?.some((a) => a.kind === "image")) {
      // multimodal content array: text first, then images
      const parts: Record<string, unknown>[] = [{ type: "text", text: textWithAttachments(m) }];
      for (const a of m.attachments) {
        if (a.kind === "image") parts.push({ type: "image_url", image_url: { url: a.data } });
      }
      out.push({ role: "user", content: parts });
    } else {
      out.push({ role: m.role, content: textWithAttachments(m) });
    }
  }
  return out;
}

async function streamOpenAI(p: ChatParams): Promise<ChatResult> {
  const base = p.provider.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (p.provider.apiKey) headers.Authorization = `Bearer ${p.provider.apiKey}`;
  const body: Record<string, unknown> = {
    model: p.model,
    messages: toOpenAIMessages(p.system, p.messages),
    stream: true,
    temperature: p.temperature,
  };
  if (p.maxTokens > 0) body.max_tokens = p.maxTokens;
  if (p.tools?.length) body.tools = toOpenAITools(p.tools);
  body.stream_options = { include_usage: true };
  if (p.jsonSchema?.trim()) {
    try {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "response", strict: true, schema: JSON.parse(p.jsonSchema) },
      };
    } catch {
      /* invalid schema — ignore, send as normal */
    }
  }

  // Every vendor spells "don't think" differently and there's no standard, so we
  // send all the known switches. They're ignored by servers that don't know them —
  // and if a strict one rejects the request, we retry once with them stripped.
  const thinkOff: Record<string, unknown> = p.noThinking
    ? {
        reasoning: { enabled: false },
        thinking: { type: "disabled" },
        enable_thinking: false,
        think: false,
        chat_template_kwargs: { enable_thinking: false },
        reasoning_effort: "none",
      }
    : p.effort
      ? // A chosen effort level: send the two common spellings; unknown servers ignore them.
        { reasoning_effort: p.effort, reasoning: { effort: p.effort } }
      : {};

  // Provider-level escape hatch: whatever the user put in extraBody wins over
  // everything we computed, so an odd backend can always be satisfied.
  const extraBody = p.provider.extraBody ?? {};

  const send = (extra: Record<string, unknown>) =>
    llmFetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, ...extra, ...extraBody }),
      signal: p.signal,
    });

  let res = await send(thinkOff);
  if (!res.ok && (p.noThinking || p.effort) && (res.status === 400 || res.status === 422)) {
    res = await send({});
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new ProviderError(`${p.provider.name}: ${res.status} ${detail.slice(0, 300)}`, res.status, res.headers);
  }

  // accumulate streamed tool-call fragments by index
  const calls: { id: string; name: string; arguments: string }[] = [];
  let cursor = -1; // last call index, for providers that omit `index` (e.g. MiniMax)
  let usage: Usage | undefined;
  const think = makeThinkSplitter(p.onDelta, p.onReasoning);
  await readSSE(res, (data) => {
    if (data === "[DONE]") return;
    try {
      const parsed = JSON.parse(data);
      if (parsed.usage) {
        usage = {
          promptTokens: parsed.usage.prompt_tokens ?? 0,
          completionTokens: parsed.usage.completion_tokens ?? 0,
        };
      }
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) return;
      if (delta.content) think.push(delta.content);
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (reasoning) p.onReasoning?.(reasoning);
      for (const tc of delta.tool_calls ?? []) {
        let i: number;
        if (typeof tc.index === "number") {
          i = tc.index; // provider gives explicit indices — trust them
          if (i > cursor) cursor = i;
        } else if (tc.id || tc.function?.name) {
          i = ++cursor; // no index + a new id/name → this is a NEW tool call
        } else {
          i = cursor < 0 ? (cursor = 0) : cursor; // argument-only fragment → current call
        }
        calls[i] ??= { id: "", name: "", arguments: "" };
        if (tc.id) calls[i].id = tc.id;
        if (tc.function?.name) calls[i].name += tc.function.name;
        if (tc.function?.arguments) calls[i].arguments += tc.function.arguments;
      }
    } catch {
      /* ignore malformed chunks */
    }
  });
  think.flush();
  const valid = calls.filter((c) => c.name);
  // Some models (e.g. MiniMax) return tool calls without an id. Synthesize a
  // stable, unique one so the follow-up assistant tool_call and its tool result
  // reference the same id — otherwise strict endpoints reject "invalid tool call".
  const stamp = Date.now().toString(36);
  valid.forEach((c, i) => {
    if (!c.id) c.id = `call_${stamp}_${i}`;
  });
  return { toolCalls: valid.length ? valid : null, usage };
}

async function streamAnthropic(p: ChatParams): Promise<ChatResult> {
  const base = p.provider.baseUrl.replace(/\/+$/, "");
  // Anthropic path: plain text chat only (tool messages flattened)
  const messages = p.messages
    .filter((m) => m.role !== "tool" && (m.content || !m.toolCalls))
    .map((m) => {
      const imgs = (m.attachments ?? []).filter((a) => a.kind === "image");
      if (m.role === "user" && imgs.length) {
        const parts: Record<string, unknown>[] = [{ type: "text", text: textWithAttachments(m) }];
        for (const a of imgs) {
          const [meta, b64] = a.data.split(",");
          const mime = /data:(.*?);/.exec(meta)?.[1] ?? "image/png";
          parts.push({ type: "image", source: { type: "base64", media_type: mime, data: b64 } });
        }
        return { role: "user" as const, content: parts };
      }
      return { role: m.role as "user" | "assistant", content: textWithAttachments(m) };
    });
  // Prompt caching: mark the system prompt as an ephemeral cache breakpoint so a
  // tool loop (which resends the same system on every round) pays for it once and
  // reads it back cheaply for ~5 minutes. Always on — it only ever saves money.
  const system = p.system
    ? [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }]
    : undefined;
  const res = await llmFetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": p.provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: p.model,
      system,
      messages,
      max_tokens: p.maxTokens > 0 ? p.maxTokens : 4096,
      temperature: p.temperature,
      stream: true,
      ...(p.provider.extraBody ?? {}),
    }),
    signal: p.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new ProviderError(`${p.provider.name}: ${res.status} ${detail.slice(0, 300)}`, res.status, res.headers);
  }
  let promptTokens = 0;
  let completionTokens = 0;
  await readSSE(res, (data) => {
    try {
      const ev = JSON.parse(data);
      if (ev.type === "content_block_delta") {
        if (ev.delta?.type === "text_delta") p.onDelta(ev.delta.text);
        else if (ev.delta?.type === "thinking_delta") p.onReasoning?.(ev.delta.thinking ?? "");
      } else if (ev.type === "message_start") {
        promptTokens = ev.message?.usage?.input_tokens ?? 0;
      } else if (ev.type === "message_delta") {
        completionTokens = ev.usage?.output_tokens ?? completionTokens;
      }
    } catch {
      /* ignore */
    }
  });
  return { toolCalls: null, usage: { promptTokens, completionTokens } };
}

/** Non-streaming helper for workflows: returns the full completion text. */
export async function chatOnce(
  provider: Provider,
  model: string,
  system: string,
  userText: string,
  signal: AbortSignal,
): Promise<string> {
  let out = "";
  await streamChat({
    provider,
    model,
    system,
    messages: [{ role: "user", content: userText }],
    temperature: 0.7,
    maxTokens: 0,
    signal,
    onDelta: (t) => {
      out += t;
    },
  });
  return out;
}

/** List models from an OpenAI-compatible endpoint (GET /models). */
export async function listModels(provider: Provider): Promise<string[]> {
  const base = provider.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {};
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  const res = await llmFetch(`${base}/models`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.data ?? []).map((m: { id: string }) => m.id).sort();
}
