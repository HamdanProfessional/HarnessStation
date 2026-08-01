import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Three tiers: chat, project, global. The routing is the whole point — without
 * it every fact drifts into global and the model ends up "knowing" one project's
 * stack while you're asking about something else entirely.
 */

const stores = new Map<string, string[]>();
const recall = vi.fn(async (scope: string, _task: string, k = 8) =>
  (stores.get(scope) ?? []).slice(0, k),
);
const remember = vi.fn(async (scope: string, fact: string) => {
  stores.set(scope, [...(stores.get(scope) ?? []), fact]);
  return "ok";
});
const chatOnce = vi.fn(async () => "[]");

vi.mock("../src/lib/memory", () => ({
  GLOBAL_MEMORY: "__global__",
  recall: (...a: unknown[]) => recall(...(a as [string, string, number])),
  remember: (...a: unknown[]) => remember(...(a as [string, string])),
}));
vi.mock("../src/lib/providers", () => ({ chatOnce: (...a: unknown[]) => chatOnce(...(a as [])) }));

const {
  chatScope,
  extractScoped,
  parseScopedFacts,
  projectScope,
  recallForChat,
  scopesFor,
  targetScope,
} = await import("../src/lib/memoryScopes");

const provider = {
  id: "p",
  name: "P",
  kind: "openai-compatible" as const,
  baseUrl: "",
  apiKey: "",
  models: [],
};

const solo = { id: "c1" };
const inProject = { id: "c2", projectId: "proj1" };

beforeEach(() => {
  stores.clear();
  recall.mockClear();
  remember.mockClear();
  chatOnce.mockReset();
  chatOnce.mockResolvedValue("[]");
});

describe("which scopes a chat can see", () => {
  it("reads chat and global when it belongs to no project", () => {
    expect(scopesFor(solo).map((s) => s.tier)).toEqual(["chat", "global"]);
  });

  it("reads all three inside a project, narrowest first", () => {
    const s = scopesFor(inProject);
    expect(s.map((x) => x.tier)).toEqual(["chat", "project", "global"]);
    expect(s[0].scope).toBe(chatScope("c2"));
    expect(s[1].scope).toBe(projectScope("proj1"));
  });

  it("keeps each tier in its own store", () => {
    expect(chatScope("c1")).not.toBe(projectScope("c1"));
  });
});

describe("recallForChat", () => {
  it("gathers from every tier a chat can see", async () => {
    stores.set(chatScope("c2"), ["we chose option B here"]);
    stores.set(projectScope("proj1"), ["the project targets embedded ARM"]);
    stores.set("__global__", ["the user is called Sam"]);

    const out = await recallForChat(inProject, "what are we doing", { model: "gpt-4o" });

    expect(out.block).toContain("we chose option B here");
    expect(out.block).toContain("the project targets embedded ARM");
    expect(out.block).toContain("the user is called Sam");
    expect(out.byTier).toEqual({ chat: 1, project: 1, global: 1 });
  });

  it("never reads another project's memory", async () => {
    stores.set(projectScope("other"), ["a secret from a different project"]);
    stores.set("__global__", ["the user is called Sam"]);

    const out = await recallForChat(inProject, "anything", { model: "gpt-4o" });

    expect(out.block).not.toContain("a secret from a different project");
  });

  it("returns nothing when there is nothing to say", async () => {
    const out = await recallForChat(solo, "hello", { model: "gpt-4o" });
    expect(out.block).toBe("");
    expect(out.tokens).toBe(0);
  });

  it("fits a big store into a small model, dropping the rest", async () => {
    // The case that motivated the budget: a large store against an 8k model.
    const many = Array.from({ length: 300 }, (_, i) => `fact ${i} ${"detail ".repeat(12)}`);
    stores.set("__global__", many);

    const small = await recallForChat(solo, "q", { model: "gemma-2-2b", k: 300 });
    const large = await recallForChat(solo, "q", { model: "claude-sonnet-5", k: 300 });

    expect(small.tokens).toBeLessThan(8_192 * 0.25);
    expect(small.dropped).toBeGreaterThan(0);
    // The same store gives the big model much more.
    expect(large.byTier.global).toBeGreaterThan(small.byTier.global);
  });

  it("can be switched off with a zero share", async () => {
    stores.set("__global__", ["something"]);
    const out = await recallForChat(solo, "q", { model: "gpt-4o", share: 0 });
    expect(out.block).toBe("");
  });

  it("survives a tier that fails to load", async () => {
    stores.set("__global__", ["still here"]);
    recall.mockImplementationOnce(async () => {
      throw new Error("corrupt file");
    });

    const out = await recallForChat(inProject, "q", { model: "gpt-4o" });

    expect(out.block).toContain("still here");
  });
});

describe("routing a fact to its tier", () => {
  it("files personal facts globally, even from inside a project", () => {
    expect(targetScope("global", inProject)).toBe("__global__");
  });

  it("keeps project facts in the project", () => {
    expect(targetScope("project", inProject)).toBe(projectScope("proj1"));
  });

  it("files a project fact globally when there is no project, rather than losing it", () => {
    expect(targetScope("project", solo)).toBe("__global__");
  });

  it("keeps chat facts to the one conversation", () => {
    expect(targetScope("chat", inProject)).toBe(chatScope("c2"));
  });
});

describe("parseScopedFacts", () => {
  it("reads scope/fact objects", () => {
    const out = parseScopedFacts('[{"scope":"project","fact":"uses Rust"},{"scope":"global","fact":"is Sam"}]');
    expect(out).toEqual([
      { scope: "project", fact: "uses Rust" },
      { scope: "global", fact: "is Sam" },
    ]);
  });

  it("treats a bare string as a fact about the user", () => {
    // Older prompt shape, or a model that ignored the instruction.
    expect(parseScopedFacts('["is Sam"]')).toEqual([{ scope: "global", fact: "is Sam" }]);
  });

  it("defaults an unknown scope to global rather than guessing", () => {
    expect(parseScopedFacts('[{"scope":"nonsense","fact":"x"}]')).toEqual([
      { scope: "global", fact: "x" },
    ]);
  });

  it("finds the array inside surrounding chatter", () => {
    expect(parseScopedFacts('Sure! [{"scope":"chat","fact":"y"}] hope that helps')).toHaveLength(1);
  });

  it("drops junk instead of throwing", () => {
    expect(parseScopedFacts("not json")).toEqual([]);
    expect(parseScopedFacts('[{"scope":"global"}]')).toEqual([]);
    expect(parseScopedFacts('{"scope":"global","fact":"x"}')).toEqual([]);
  });

  it("caps how much one turn can write", () => {
    const many = JSON.stringify(
      Array.from({ length: 30 }, (_, i) => ({ scope: "global", fact: `f${i}` })),
    );
    expect(parseScopedFacts(many)).toHaveLength(8);
  });
});

describe("extractScoped", () => {
  it("writes each fact to the store its tier names", async () => {
    chatOnce.mockResolvedValueOnce(
      '[{"scope":"global","fact":"the user is Sam"},{"scope":"project","fact":"this project is embedded firmware"},{"scope":"chat","fact":"we picked option B"}]',
    );

    await extractScoped(inProject, "transcript", provider, "m");

    expect(stores.get("__global__")).toEqual(["the user is Sam"]);
    expect(stores.get(projectScope("proj1"))).toEqual(["this project is embedded firmware"]);
    expect(stores.get(chatScope("c2"))).toEqual(["we picked option B"]);
  });

  it("still reaches global from inside a project", async () => {
    // The behaviour asked for: a project confines project facts, not personal ones.
    chatOnce.mockResolvedValueOnce('[{"scope":"global","fact":"prefers metric units"}]');
    await extractScoped(inProject, "t", provider, "m");
    expect(stores.get("__global__")).toEqual(["prefers metric units"]);
  });

  it("is best-effort — a failed extraction never breaks the turn", async () => {
    chatOnce.mockRejectedValueOnce(new Error("model offline"));
    await expect(extractScoped(solo, "t", provider, "m")).resolves.toEqual([]);
    expect(remember).not.toHaveBeenCalled();
  });
});
