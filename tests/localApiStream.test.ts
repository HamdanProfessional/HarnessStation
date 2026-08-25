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
    combos: [
      {
        id: "c1",
        name: "Cheap first",
        steps: [
          { providerId: "groq", model: "llama-3.3-70b" },
          { providerId: "openai", model: "gpt-4o" },
        ],
      },
    ],
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
vi.mock("../src/lib/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/providers")>();
  return {
    ...actual,
    streamChat: vi.fn(),
    // A minimal stand-in for the real walker: same contract (steps in order,
    // first success wins), delegating to the mocked streamChat above so tests
    // can watch each hop.
    streamChain: async (steps: { provider: unknown; model: string }[], p: unknown) => {
      const mod = await import("../src/lib/providers");
      let lastErr: unknown;
      for (const s of steps) {
        try {
          return await mod.streamChat({ ...(p as object), provider: s.provider, model: s.model });
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr;
    },
  };
});

const { prepare, stringifyContent, agentSlug } = await import("../src/lib/localApi");
const {
  anthropicToChatParams,
  anthropicCountTokens,
  chatResultToAnthropic,
} = await import("../src/lib/localApi");
const core = await import("@tauri-apps/api/core");
const providers = await import("../src/lib/providers");
const { comboStepsFor } = await import("../src/lib/localApi");

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

describe("combo model ids", () => {
  it("resolves combo/<slug> to its ordered provider+model steps", () => {
    const steps = comboStepsFor("combo/cheap-first")!;
    expect(steps.map((s) => `${s.provider.id}:${s.model}`)).toEqual(["groq:llama-3.3-70b", "openai:gpt-4o"]);
  });

  it("throws for a combo id that matches nothing", () => {
    expect(() => comboStepsFor("combo/missing")).toThrow(/No combo matches/);
    expect(comboStepsFor("gpt-4o")).toBeNull();
  });

  it("prepare carries the steps and points provider/model at the first hop", () => {
    const p = prepare({ model: "combo/cheap-first", messages: [{ role: "user", content: "hi" }] });
    expect(p.comboSteps).toHaveLength(2);
    expect(p.provider.id).toBe("groq");
    expect(p.model).toBe("llama-3.3-70b");
  });

  it("the non-streaming path walks the chain", async () => {
    const providersMod = await import("../src/lib/providers");
    const seen: string[] = [];
    vi.mocked(providersMod.streamChat).mockImplementation(async (p) => {
      seen.push(`${p.provider.id}:${p.model}`);
      if (p.provider.id === "groq") throw new Error("rate limited");
      return { toolCalls: null, usage: { promptTokens: 1, completionTokens: 2 } };
    });

    const { chatCompletion } = await import("../src/lib/localApi");
    const r = await chatCompletion({ model: "combo/cheap-first", messages: [{ role: "user", content: "hi" }] });
    expect(seen).toEqual(["groq:llama-3.3-70b", "openai:gpt-4o"]);
    expect(r.choices[0].message.content).toBe("");
    expect(r.model).toBe("combo/cheap-first");
  });

  it("the anthropic path resolves combos too", () => {
    const p = anthropicToChatParams({
      model: "combo/cheap-first",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(p.comboSteps).toHaveLength(2);
    expect(p.provider.id).toBe("groq");
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

// ---------------------------------------------------------------------------
// Anthropic Messages protocol (inbound) — what Claude Code speaks
// ---------------------------------------------------------------------------

const anthropicTools = [
  {
    name: "read_file",
    description: "Read a file",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
];

const anthropicBody = {
  model: "openai/gpt-4o",
  max_tokens: 4096,
  system: [{ type: "text", text: "Be brief." }],
  messages: [
    { role: "user", content: "list the files" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Checking." },
        { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.txt" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_1", content: "hello world" },
        { type: "text", text: "and now?" },
      ],
    },
  ],
  tools: anthropicTools,
};

describe("anthropic request translation", () => {
  it("maps an Anthropic body onto the provider layer's shape", () => {
    const p = anthropicToChatParams(anthropicBody);
    expect(p.model).toBe("gpt-4o");
    expect(p.system).toBe("Be brief.");
    expect(p.maxTokens).toBe(4096);
    // tool_use unfolds into an assistant message with toolCalls...
    expect(p.messages[1]).toEqual({
      role: "assistant",
      content: "Checking.",
      toolCalls: [{ id: "toolu_1", name: "read_file", arguments: '{"path":"a.txt"}' }],
    });
    // ...and tool_result into a flat tool message carrying the call id.
    expect(p.messages[2]).toEqual({ role: "tool", content: "hello world", toolCallId: "toolu_1" });
    expect(p.messages[3]).toEqual({ role: "user", content: "and now?" });
    expect(p.tools?.[0]).toMatchObject({ name: "read_file", description: "Read a file" });
    expect(p.tools?.[0].parameters).toEqual(anthropicTools[0].input_schema);
  });

  it("accepts a plain-string system prompt and no tools", () => {
    const p = anthropicToChatParams({
      model: "gpt-4o",
      max_tokens: 100,
      system: "Be terse.",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(p.system).toBe("Be terse.");
    expect(p.tools).toBeUndefined();
  });

  it("falls back to the provider's first model for unknown Claude-style names", () => {
    // Claude Code sends its own model names because it cannot know ours.
    const p = anthropicToChatParams({
      model: "claude-sonnet-4-5",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(p.provider.id).toBe("groq");
    expect(p.model).toBe("llama-3.3-70b");
  });

  it("honours explicit provider/model and agent choices verbatim", () => {
    const explicit = anthropicToChatParams({
      model: "openai/gpt-4o",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(explicit.model).toBe("gpt-4o");
    const agent = anthropicToChatParams({
      model: "agent/research-assistant",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(agent.system).toBe("You research things.");
    expect(agent.model).toBe("gpt-4o");
  });

  it("counts tokens as characters/4 over system plus serialized messages", () => {
    // The estimate covers the JSON envelope too — structure is tokens the
    // provider will also see.
    const r = anthropicCountTokens({ system: "abcd", messages: [{ role: "user", content: "12345678" }] });
    expect(r.input_tokens).toBe(Math.ceil(('abcd'.length + JSON.stringify([{ role: "user", content: "12345678" }]).length) / 4));
  });
});

describe("anthropic response shaping", () => {
  it("renders text plus tool_use blocks with parsed input objects", () => {
    const r = chatResultToAnthropic(
      "gpt-4o",
      "Reading it.",
      [{ id: "toolu_1", name: "read_file", arguments: '{"path":"a.txt"}' }],
      { promptTokens: 12, completionTokens: 34 },
      4096,
    );
    expect(r.type).toBe("message");
    expect(r.stop_reason).toBe("tool_use");
    expect(r.content).toEqual([
      { type: "text", text: "Reading it." },
      { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.txt" } },
    ]);
    expect(r.usage).toEqual({ input_tokens: 12, output_tokens: 34 });
  });

  it("reports max_tokens when the budget cut the reply", () => {
    const r = chatResultToAnthropic("m", "partial", [], { completionTokens: 4096 }, 4096);
    expect(r.stop_reason).toBe("max_tokens");
  });

  it("is end_turn for a plain complete reply", () => {
    const r = chatResultToAnthropic("m", "done", [], { completionTokens: 5 }, 4096);
    expect(r.stop_reason).toBe("end_turn");
    expect(r.content).toEqual([{ type: "text", text: "done" }]);
  });
});

describe("anthropic streaming", () => {
  beforeEach(() => {
    vi.mocked(providers.streamChat).mockReset();
    vi.mocked(core.invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "local_api_push") {
        pushed.push((args as { chunk: string }).chunk);
        return true;
      }
      return undefined as unknown as boolean;
    });
  });

  let pushed: string[];
  const frames = () =>
    pushed
      .filter((c) => typeof c === "string" && c.startsWith("event: "))
      .map((c) => /^event: (\w+)/.exec(c)![1]);
  const dataOf = (i: number) => JSON.parse(pushed[i].split("\ndata: ")[1]);

  it("emits the named-event sequence: start, text block, tool_use block, delta, stop", async () => {
    pushed = [];
    vi.mocked(providers.streamChat).mockImplementation(async ({ onDelta }) => {
      onDelta("Hel");
      onDelta("lo");
      return {
        toolCalls: [{ id: "toolu_9", name: "read_file", arguments: '{"path":"b.txt"}' }],
        usage: { promptTokens: 10, completionTokens: 5 },
      };
    });

    const { handleAnthropicMessagesStream } = await import("../src/lib/localApi");
    await handleAnthropicMessagesStream(1, {
      model: "openai/gpt-4o",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      tools: anthropicTools,
    });

    expect(frames()).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    // Tool arguments arrive as an input_json_delta partial.
    const toolStart = pushed.find((c) => c.includes('"tool_use"'))!;
    expect(JSON.parse(toolStart.split("\ndata: ")[1]).content_block).toMatchObject({
      type: "tool_use",
      id: "toolu_9",
      name: "read_file",
    });
    const delta = pushed.find((c) => c.includes("input_json_delta"))!;
    expect(JSON.parse(delta.split("\ndata: ")[1]).delta.partial_json).toBe('{"path":"b.txt"}');
    // The final delta carries stop_reason tool_use.
    const last = dataOf(pushed.length - 2);
    expect(last.delta.stop_reason).toBe("tool_use");
  });

  it("reports failures as an error event, in the protocol's own shape", async () => {
    pushed = [];
    vi.mocked(providers.streamChat).mockRejectedValue(new Error("no provider"));
    const { handleAnthropicMessagesStream } = await import("../src/lib/localApi");
    await handleAnthropicMessagesStream(2, {
      model: "gpt-4o",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(frames()).toEqual(["message_start", "error"]);
    const err = JSON.parse(pushed[1].split("\ndata: ")[1]);
    expect(err.type).toBe("error");
    expect(err.error.message).toContain("no provider");
  });
});
