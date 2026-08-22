import { beforeEach, describe, expect, it } from "vitest";
import {
  keyCount,
  keysOf,
  nextKeyOrder,
  resetRotation,
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

  it("namespaces its cursor so a stray key in the map cannot drive it", () => {
    // Cursors are one flat map. The key slot is prefixed, so an entry that
    // happens to share the provider's id must not move the key rotation.
    const cursors: Cursors = { groq: 1 };
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

describe("counting a provider's keys", () => {
  it("counts the main key and the spares together", () => {
    expect(keyCount(p({ apiKey: "main", apiKeys: ["s1", "s2"] }))).toBe(3);
  });

  it("ignores blank and whitespace entries", () => {
    // An empty line in the "extra keys" textarea must not read as a key, or the
    // UI would offer to rotate across something that does not exist.
    expect(keyCount(p({ apiKey: "main", apiKeys: ["", "   ", "s1"] }))).toBe(2);
  });

  it("reports zero for a keyless local provider", () => {
    // Deliberately different from keysOf, which yields [""] so callers still get
    // one attempt. Here zero has to mean zero, or a local server would look
    // like it had something to rotate.
    expect(keyCount(p({ apiKey: "", apiKeys: [] }))).toBe(0);
    expect(keysOf(p({ apiKey: "", apiKeys: [] }))).toHaveLength(1);
  });

  it("handles a provider that has never had spares", () => {
    expect(keyCount({ apiKey: "solo" })).toBe(1);
  });
});

describe("what rotation must never do", () => {
  it("returns the same provider it was given", () => {
    // The whole point of the change: round-robin spreads load across keys on
    // one provider. Sending a turn to a different provider would silently
    // change the service, price and quantisation behind "the same" model id.
    const prov = p({ id: "groq", apiKey: "k1", apiKeys: ["k2", "k3"] });
    for (let i = 0; i < 5; i++) {
      const out = rotateKeys(prov);
      expect(out.id).toBe("groq");
      expect(out.baseUrl).toBe(prov.baseUrl);
      expect(out.models).toEqual(prov.models);
    }
  });

  it("keeps the full key set intact, only reordered", () => {
    const prov = p({ apiKey: "k1", apiKeys: ["k2", "k3"] });
    const out = rotateKeys(prov);
    expect([out.apiKey, ...(out.apiKeys ?? [])].sort()).toEqual(["k1", "k2", "k3"]);
  });
});
