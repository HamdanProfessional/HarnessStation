/**
 * In-browser model inference (web build only), via WebLLM (MLC).
 *
 * The model runs entirely in the tab on WebGPU — no server, no key, and after
 * the first download (cached in the browser), no network. This is the "run a
 * model locally" story for people who can't or won't install the desktop app,
 * within the hard limits of a browser: small models (≈1–3B, quantised) and a
 * one-time multi-gigabyte download.
 *
 * It speaks the same OpenAI-shaped streaming the rest of the app expects, so we
 * reuse the message builder and think-splitter from the OpenAI path and only
 * swap the transport. Loaded lazily from streamChat so the WebGPU/WASM engine
 * never touches the desktop bundle.
 */
import type { ChatParams, ChatResult, Usage } from "./index";
import { makeThinkSplitter, toOpenAIMessages } from "./index";
import { toOpenAITools } from "../tools";

/** Curated small models known to run in a browser. Value = MLC model id. */
export interface WebLlmModel {
  id: string;
  label: string;
  size: string; // rough download size, shown before committing to it
}
export const WEBLLM_MODELS: WebLlmModel[] = [
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B", size: "~0.9 GB" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B", size: "~2.0 GB" },
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 1.5B", size: "~1.1 GB" },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Qwen2.5 3B", size: "~2.0 GB" },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", label: "Phi-3.5 mini", size: "~2.2 GB" },
  { id: "gemma-2-2b-it-q4f16_1-MLC", label: "Gemma 2 2B", size: "~1.6 GB" },
  { id: "SmolLM2-1.7B-Instruct-q4f16_1-MLC", label: "SmolLM2 1.7B", size: "~1.1 GB" },
];

// One resident engine, reused across turns; reloaded only when the model changes
// (each model is its own multi-hundred-MB set of weights).
type Engine = import("@mlc-ai/web-llm").MLCEngineInterface;
let engine: Engine | null = null;
let loadedModel = "";
let loadingModel = "";

/** Push a one-line loading status into the chat's activity row. */
async function setActivity(text: string): Promise<void> {
  const { useStore } = await import("../store");
  useStore.setState({ activity: text });
}

async function getEngine(model: string): Promise<Engine> {
  if (engine && loadedModel === model) return engine;
  const webllm = await import("@mlc-ai/web-llm");
  const onProgress = (r: { text: string; progress: number }) => {
    // r.text already reads e.g. "Fetching param cache… 45%"; surface it verbatim.
    void setActivity(r.text || `Loading ${model}…`);
  };
  loadingModel = model;
  if (!engine) {
    engine = await webllm.CreateMLCEngine(model, { initProgressCallback: onProgress });
  } else {
    await engine.reload(model);
  }
  loadedModel = model;
  loadingModel = "";
  await setActivity("");
  return engine;
}

/** Is a model currently downloading/initialising? (for the UI). */
export function webllmLoading(): string {
  return loadingModel;
}

export async function streamWebLLM(p: ChatParams): Promise<ChatResult> {
  if (!("gpu" in navigator)) {
    throw new Error(
      "This browser has no WebGPU, so it can't run a model in the tab. Use Chrome or Edge, or install the desktop app for full local models.",
    );
  }
  const eng = await getEngine(p.model);

  // Abort → stop generation and unblock the stream.
  const onAbort = () => void eng.interruptGenerate();
  p.signal.addEventListener("abort", onAbort, { once: true });

  const request: Record<string, unknown> = {
    messages: toOpenAIMessages(p.system, p.messages),
    stream: true,
    stream_options: { include_usage: true },
    temperature: p.temperature,
  };
  if (p.maxTokens > 0) request.max_tokens = p.maxTokens;
  if (p.tools?.length) request.tools = toOpenAITools(p.tools);

  const think = makeThinkSplitter(p.onDelta, p.onReasoning);
  const calls: { id: string; name: string; arguments: string }[] = [];
  let cursor = -1;
  let usage: Usage | undefined;

  // Small models sometimes choke on a big tools array; if the tool-enabled call
  // fails, fall back to a plain chat so the user still gets a reply.
  const run = async (withTools: boolean) => {
    const body = withTools ? request : { ...request, tools: undefined };
    const chunks = (await eng.chat.completions.create(body as never)) as unknown as AsyncIterable<any>;
    for await (const chunk of chunks) {
      if (p.signal.aborted) break;
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
        };
      }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) think.push(delta.content);
      for (const tc of delta.tool_calls ?? []) {
        const i = typeof tc.index === "number" ? tc.index : ++cursor;
        if (i > cursor) cursor = i;
        calls[i] ??= { id: "", name: "", arguments: "" };
        if (tc.id) calls[i].id = tc.id;
        if (tc.function?.name) calls[i].name += tc.function.name;
        if (tc.function?.arguments) calls[i].arguments += tc.function.arguments;
      }
    }
  };

  try {
    try {
      await run(!!p.tools?.length);
    } catch (e) {
      if (p.tools?.length && !p.signal.aborted) await run(false);
      else throw e;
    }
  } finally {
    p.signal.removeEventListener("abort", onAbort);
    think.flush();
    void setActivity("");
  }

  const valid = calls.filter((c) => c.name);
  const stamp = Date.now().toString(36);
  valid.forEach((c, i) => {
    if (!c.id) c.id = `call_${stamp}_${i}`;
  });
  return { toolCalls: valid.length ? valid : null, usage };
}
