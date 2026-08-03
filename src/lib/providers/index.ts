import { fetch } from "@tauri-apps/plugin-http";
import type { Message, Provider, Tool, ToolCall } from "../types";
import { toOpenAITools } from "../tools";
import { readSSE } from "./sse";

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

export async function streamChat(p: ChatParams): Promise<ChatResult> {
  if (p.provider.kind === "anthropic") return streamAnthropic(p);
  return streamOpenAI(p);
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
function makeThinkSplitter(onContent: (t: string) => void, onReasoning?: (t: string) => void) {
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

function toOpenAIMessages(system: string, messages: Message[]) {
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
    : {};

  // Provider-level escape hatch: whatever the user put in extraBody wins over
  // everything we computed, so an odd backend can always be satisfied.
  const extraBody = p.provider.extraBody ?? {};

  const send = (extra: Record<string, unknown>) =>
    fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, ...extra, ...extraBody }),
      signal: p.signal,
    });

  let res = await send(thinkOff);
  if (!res.ok && p.noThinking && (res.status === 400 || res.status === 422)) {
    res = await send({});
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
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": p.provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: p.model,
      system: p.system || undefined,
      messages,
      max_tokens: p.maxTokens > 0 ? p.maxTokens : 4096,
      temperature: p.temperature,
      stream: true,
    }),
    signal: p.signal,
  });
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
  const res = await fetch(`${base}/models`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.data ?? []).map((m: { id: string }) => m.id).sort();
}
