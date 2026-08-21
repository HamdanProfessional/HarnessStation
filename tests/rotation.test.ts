import { beforeEach, describe, expect, it } from "vitest";
import { candidatesFor, nextProvider, resetRotation, rotate, type Cursors } from "../src/lib/rotation";
import type { Provider } from "../src/lib/types";

const p = (over: Partial<Provider> = {}): Provider => ({
  id: "groq",
  name: "Groq",
  kind: "openai",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "sk-real",
  models: ["llama-3.3-70b"],
  ...over,
});

const groq = p();
const cerebras = p({ id: "cerebras", name: "Cerebras", baseUrl: "https://api.cerebras.ai/v1" });
const together = p({ id: "together", name: "Together", baseUrl: "https://api.together.xyz/v1" });

describe("who is eligible to serve a model", () => {
  it("only counts providers that list the exact model id", () => {
    const other = p({ id: "openai", models: ["gpt-4o"] });
    expect(candidatesFor("llama-3.3-70b", [groq, other, cerebras]).map((x) => x.id)).toEqual([
      "groq",
      "cerebras",
    ]);
  });

  it("skips a provider with no key — rotating onto a 401 is worse than not balancing", () => {
    const unkeyed = p({ id: "fireworks", apiKey: "   " });
    expect(candidatesFor("llama-3.3-70b", [groq, unkeyed]).map((x) => x.id)).toEqual(["groq"]);
  });

  it("still counts a local server, which authenticates with nothing", () => {
    const ollama = p({ id: "ollama", apiKey: "", baseUrl: "http://localhost:11434/v1" });
    const lmstudio = p({ id: "lm", apiKey: "", baseUrl: "http://127.0.0.1:1234/v1" });
    const named = p({ id: "local", apiKey: "", baseUrl: "" });
    expect(candidatesFor("llama-3.3-70b", [ollama, lmstudio, named])).toHaveLength(3);
  });
});

describe("the rotation itself", () => {
  it("cycles through every candidate before repeating one", () => {
    const all = [groq, cerebras, together];
    let cursors: Cursors = {};
    const order: string[] = [];
    for (let i = 0; i < 6; i++) {
      const step = nextProvider("llama-3.3-70b", all, cursors)!;
      order.push(step.provider.id);
      cursors = step.cursors;
    }
    expect(order).toEqual(["groq", "cerebras", "together", "groq", "cerebras", "together"]);
  });

  it("keeps a separate cursor per model, so one busy model doesn't skew another", () => {
    const all = [
      p({ id: "a", models: ["m1", "m2"] }),
      p({ id: "b", models: ["m1", "m2"] }),
    ];
    let cursors: Cursors = {};
    // Three turns on m1 leave its cursor mid-cycle.
    for (let i = 0; i < 3; i++) cursors = nextProvider("m1", all, cursors)!.cursors;
    // m2 has still never been asked, so it must start at the top.
    expect(nextProvider("m2", all, cursors)!.provider.id).toBe("a");
  });

  it("does not advance a cursor when there is only one candidate", () => {
    // Otherwise adding a second provider later would start it mid-cycle, which
    // looks like the rotation skipping a provider on its very first turn.
    let cursors: Cursors = {};
    for (let i = 0; i < 5; i++) cursors = nextProvider("llama-3.3-70b", [groq], cursors)!.cursors;
    expect(cursors).toEqual({});
    expect(nextProvider("llama-3.3-70b", [groq, cerebras], cursors)!.provider.id).toBe("groq");
  });

  it("returns null when nothing can serve the model, rather than guessing", () => {
    // The caller falls back to its own resolution, so switching rotation on can
    // never take away a provider the old code would have found.
    expect(nextProvider("gpt-4o", [groq, cerebras], {})).toBeNull();
    expect(nextProvider("llama-3.3-70b", [], {})).toBeNull();
  });

  it("is pure — the caller's cursors are never mutated", () => {
    const cursors: Cursors = { "llama-3.3-70b": 0 };
    nextProvider("llama-3.3-70b", [groq, cerebras], cursors);
    expect(cursors).toEqual({ "llama-3.3-70b": 0 });
  });

  it("survives a cursor left over from a larger pool", () => {
    // A provider removed between turns must not index past the end.
    const step = nextProvider("llama-3.3-70b", [groq, cerebras], { "llama-3.3-70b": 7 })!;
    expect(step.provider.id).toBe("cerebras");
  });
});

describe("the process-wide wrapper", () => {
  beforeEach(() => resetRotation());

  it("advances across calls", () => {
    const all = [groq, cerebras];
    expect(rotate("llama-3.3-70b", all)?.id).toBe("groq");
    expect(rotate("llama-3.3-70b", all)?.id).toBe("cerebras");
    expect(rotate("llama-3.3-70b", all)?.id).toBe("groq");
  });

  it("reports null for an unservable model so the caller keeps its own choice", () => {
    expect(rotate("gpt-4o", [groq])).toBeNull();
  });
});
