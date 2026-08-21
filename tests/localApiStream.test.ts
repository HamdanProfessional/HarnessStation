import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `prepare` reaches the Zustand store for providers and agents, so the store is
 * stubbed rather than booted. Everything under test is the request-shaping —
 * which model gets resolved, how system turns are folded in, which token cap
 * wins — that the streaming and non-streaming paths now share.
 */
const state = {
  settings: {
    providers: [
      {
        id: "groq",
        name: "Groq",
        kind: "openai",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: "k",
        models: ["llama-3.3-70b"],
      },
      {
        id: "openai",
        name: "OpenAI",
        kind: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "k",
        models: ["gpt-4o"],
      },
    ],
    roundRobin: false,
  },
  agents: [
    {
      id: "a1",
      name: "Research Assistant",
      providerId: "openai",
      model: "gpt-4o",
      instructions: "You research things.",
      temperature: 0.2,
      maxTokens: 999,
    },
  ],
};

vi.mock("../src/lib/store", () => ({ useStore: { getState: () => state } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../src/lib/providers", () => ({ streamChat: vi.fn() }));

const { prepare, stringifyContent, agentSlug } = await import("../src/lib/localApi");

beforeEach(() => {
  state.settings.roundRobin = false;
});

describe("shaping an OpenAI request", () => {
  it("resolves the providerId/model form", () => {
    const p = prepare({ model: "groq/llama-3.3-70b", messages: [{ role: "user", content: "hi" }] });
    expect(p.provider.id).toBe("groq");
    expect(p.model).toBe("llama-3.3-70b");
  });

  it("resolves a bare model name to the provider that lists it", () => {
    expect(prepare({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }).provider.id).toBe(
      "openai",
    );
  });

  it("resolves an agent and adopts its instructions and settings", () => {
    const p = prepare({ model: "agent/research-assistant", messages: [{ role: "user", content: "hi" }] });
    expect(p.system).toBe("You research things.");
    expect(p.temperature).toBe(0.2);
    expect(p.maxTokens).toBe(999);
  });

  it("folds system messages into the system prompt, in order", () => {
    const p = prepare({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "hi" },
        { role: "system", content: "Answer in English." },
      ],
    });
    expect(p.system).toBe("Be terse.\n\nAnswer in English.");
    // The system turns must not also survive as conversation messages.
    expect(p.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("prepends an agent's instructions ahead of the caller's system turns", () => {
    const p = prepare({
      model: "agent/research-assistant",
      messages: [
        { role: "system", content: "Also cite sources." },
        { role: "user", content: "hi" },
      ],
    });
    expect(p.system).toBe("You research things.\n\nAlso cite sources.");
  });

  it("flattens array-of-parts content", () => {
    const p = prepare({
      model: "gpt-4o",
      messages: [{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }],
    });
    expect(p.messages[0].content).toBe("ab");
  });

  it("prefers max_tokens over max_completion_tokens when both are sent", () => {
    // max_tokens is deprecated but far more widely sent; a client that supplies
    // both almost always means the older field.
    const base = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] };
    expect(prepare({ ...base, max_tokens: 10, max_completion_tokens: 20 }).maxTokens).toBe(10);
    expect(prepare({ ...base, max_completion_tokens: 20 }).maxTokens).toBe(20);
  });

  it("falls back to the resolved default when neither cap is given", () => {
    expect(prepare({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }).maxTokens).toBe(2048);
  });

  it("honours temperature 0, rather than treating it as unset", () => {
    // A falsy-check here would silently rewrite deterministic requests to 0.7,
    // which is the difference between reproducible output and not.
    expect(prepare({ model: "gpt-4o", messages: [{ role: "user", content: "x" }], temperature: 0 }).temperature).toBe(0);
  });
});

describe("requests it should refuse", () => {
  it("rejects a missing model", () => {
    expect(() => prepare({ messages: [{ role: "user", content: "hi" }] })).toThrow(/`model` is required/);
    expect(() => prepare({ model: "   ", messages: [{ role: "user", content: "hi" }] })).toThrow();
  });

  it("rejects empty or missing messages", () => {
    expect(() => prepare({ model: "gpt-4o" })).toThrow(/non-empty array/);
    expect(() => prepare({ model: "gpt-4o", messages: [] })).toThrow(/non-empty array/);
  });

  it("names the agent that could not be found", () => {
    expect(() => prepare({ model: "agent/nope", messages: [{ role: "user", content: "hi" }] })).toThrow(
      /No agent matches "agent\/nope"/,
    );
  });
});

describe("helpers", () => {
  it("slugs agent names so they survive as model ids", () => {
    expect(agentSlug("Research Assistant")).toBe("research-assistant");
  });

  it("drops non-text parts rather than stringifying them", () => {
    expect(stringifyContent([{ type: "image_url", image_url: { url: "x" } }, "!"])).toBe("!");
  });
});
