import { beforeEach, describe, expect, it } from "vitest";
import {
  candidatesFor,
  keysOf,
  nextKeyOrder,
  nextProvider,
  resetRotation,
  rotate,
  rotateKeys,
  type Cursors,
} from "../src/lib/rotation";
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


describe("rotating the keys on one provider", () => {
  beforeEach(() => resetRotation());

  it("lists the main key first, then the spares", () => {
    expect(keysOf(p({ apiKey: "main", apiKeys: ["s1", " s2 ", "  "] }))).toEqual(["main", "s1", "s2"]);
  });

  it("gives a keyless provider exactly one attempt, not zero", () => {
    expect(keysOf(p({ apiKey: "", apiKeys: [] }))).toEqual([""]);
  });

  it("moves the starting key along on each request", () => {
    let cursors: Cursors = {};
    const first: string[] = [];
    for (let i = 0; i < 4; i++) {
      const step = nextKeyOrder("groq", ["k1", "k2", "k3"], cursors);
      first.push(step.keys[0]);
      cursors = step.cursors;
    }
    expect(first).toEqual(["k1", "k2", "k3", "k1"]);
  });

  it("keeps every other key behind the leader, so failover is unchanged", () => {
    // The point of rotating is to change who goes first, never to drop a
    // spare — a rate-limited turn must still fall through to all the others.
    const step = nextKeyOrder("groq", ["k1", "k2", "k3"], { "key:groq": 1 });
    expect(step.keys).toEqual(["k2", "k3", "k1"]);
  });

  it("leaves a single key alone and burns no cursor", () => {
    const step = nextKeyOrder("groq", ["only"], {});
    expect(step.keys).toEqual(["only"]);
    expect(step.cursors).toEqual({});
  });

  it("counts each provider's keys separately from every other provider", () => {
    let cursors: Cursors = {};
    cursors = nextKeyOrder("groq", ["a", "b"], cursors).cursors;
    expect(nextKeyOrder("cerebras", ["x", "y"], cursors).keys[0]).toBe("x");
  });

  it("does not collide with the per-model cursors", () => {
    // Both live in one map; a provider id that matches a model name must not
    // make one rotation drive the other.
    // A model literally named "groq", plus a provider whose id is "groq".
    const serving = [p({ id: "a", models: ["groq"] }), p({ id: "b", models: ["groq"] })];
    let cursors: Cursors = {};
    cursors = nextProvider("groq", serving, cursors)!.cursors;
    expect(cursors).toEqual({ groq: 1 });
    // The key cursor is namespaced, so it is still at the top.
    expect(nextKeyOrder("groq", ["k1", "k2"], cursors).keys[0]).toBe("k1");
  });

  it("rewrites the provider so the rotated key is the one that gets used", () => {
    const prov = p({ apiKey: "k1", apiKeys: ["k2"] });
    expect(rotateKeys(prov).apiKey).toBe("k1");
    expect(rotateKeys(prov).apiKey).toBe("k2");
    expect(rotateKeys(prov).apiKey).toBe("k1");
  });

  it("returns a provider with one key untouched", () => {
    const prov = p({ apiKey: "solo", apiKeys: [] });
    expect(rotateKeys(prov)).toBe(prov);
  });
});
