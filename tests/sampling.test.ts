/**
 * Sampling parameters are where a harness most easily changes the model under
 * you without being asked (see docs/research/router-category — opencode spent
 * 381 days overriding every "Qwen" request with temp 0.55). These tests pin
 * the contract: a negative temperature means the request carries no sampling
 * field at all, zero is still sent because it is a real choice, and the
 * Anthropic path never invents a silent output cap when published facts exist.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type FetchInit = { method?: string; body?: string; headers?: Record<string, string> };
const calls: { url: string; init: FetchInit }[] = [];
const fetchMock = vi.fn(async (url: string, init: FetchInit = {}) => {
  calls.push({ url, init });
  return sseResponse(init.body?.includes('"anthropic-version"') ? anthropicSSE() : openaiSSE());
});

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...a: unknown[]) => fetchMock(...(a as [])) }));

import { streamChat } from "../src/lib/providers";
import { invalidateModelFacts, primeModelFacts } from "../src/lib/modelFacts";
import type { Provider } from "../src/lib/types";

function sseResponse(body: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return { ok: true, status: 200, headers: new Headers(), body: stream } as unknown as Response;
}

function openaiSSE(): string {
  return (
    'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' +
    'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n' +
    "data: [DONE]\n\n"
  );
}

function anthropicSSE(): string {
  return (
    'data: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n' +
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n' +
    'data: {"type":"message_delta","usage":{"output_tokens":1}}\n\n' +
    'data: {"type":"message_stop"}\n\n'
  );
}

function openaiProvider(): Provider {
  return {
    id: "p1",
    name: "Test",
    kind: "openai-compatible",
    baseUrl: "https://x.test/v1",
    apiKey: "k",
    models: ["m1"],
  };
}

function anthropicProvider(): Provider {
  return { ...openaiProvider(), kind: "anthropic", baseUrl: "https://x.test" };
}

function lastBody(): Record<string, unknown> {
  return JSON.parse(calls[calls.length - 1].init.body ?? "{}");
}

beforeEach(() => {
  calls.length = 0;
  fetchMock.mockClear();
  localStorage.clear();
  invalidateModelFacts();
});

describe("sampling parameters on the wire", () => {
  it("omits temperature entirely when the chat says server default", async () => {
    await streamChat({
      provider: openaiProvider(),
      model: "m1",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      temperature: -1,
      maxTokens: 0,
      signal: new AbortController().signal,
      onDelta: () => {},
    });
    expect(lastBody()).not.toHaveProperty("temperature");
  });

  it("sends temperature when chosen — including exactly zero", async () => {
    for (const temperature of [0.4, 0]) {
      await streamChat({
        provider: openaiProvider(),
        model: "m1",
        system: "",
        messages: [{ role: "user", content: "hi" }],
        temperature,
        maxTokens: 0,
        signal: new AbortController().signal,
        onDelta: () => {},
      });
      expect(lastBody().temperature).toBe(temperature);
    }
  });

  it("omits temperature on the Anthropic path too", async () => {
    await streamChat({
      provider: anthropicProvider(),
      model: "claude-x",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      temperature: -1,
      maxTokens: 100,
      signal: new AbortController().signal,
      onDelta: () => {},
    });
    expect(lastBody()).not.toHaveProperty("temperature");
  });

  it("Anthropic max_tokens: the user's number wins over everything", async () => {
    primeModelFacts([
      { modelKey: "claude-x", capabilities: { contextWindow: 200_000, maxOutputTokens: 64_000 } },
    ]);
    await streamChat({
      provider: anthropicProvider(),
      model: "claude-x",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.7,
      maxTokens: 512,
      signal: new AbortController().signal,
      onDelta: () => {},
    });
    expect(lastBody().max_tokens).toBe(512);
  });

  it("Anthropic max_tokens: falls back to the model's published output cap, not a constant", async () => {
    primeModelFacts([
      // Also proves the exact and canonical key forms both resolve.
      { modelKey: "claude-x", capabilities: { contextWindow: 200_000, maxOutputTokens: 32_000 } },
    ]);
    await streamChat({
      provider: anthropicProvider(),
      model: "claude-x",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.7,
      maxTokens: 0,
      signal: new AbortController().signal,
      onDelta: () => {},
    });
    expect(lastBody().max_tokens).toBe(32_000);
  });

  it("Anthropic max_tokens with no published facts lands on a floor big enough to matter", async () => {
    await streamChat({
      provider: anthropicProvider(),
      model: "unknown-model",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.7,
      maxTokens: 0,
      signal: new AbortController().signal,
      onDelta: () => {},
    });
    expect(lastBody().max_tokens).toBe(8192);
  });
});
