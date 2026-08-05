import { describe, expect, it } from "vitest";
import { buildAttempts, isRetryableError, ProviderError } from "../src/lib/providers/index";
import type { Provider } from "../src/lib/types";

const prov = (id: string, over: Partial<Provider> = {}): Provider => ({
  id,
  name: id,
  kind: "openai-compatible",
  baseUrl: `https://${id}/v1`,
  apiKey: `key-${id}`,
  models: [`${id}-model`],
  ...over,
});

describe("buildAttempts", () => {
  it("is a single attempt with no extra keys or fallbacks", () => {
    const a = buildAttempts(prov("openai"), [prov("openai")]);
    expect(a).toHaveLength(1);
    expect(a[0].provider.apiKey).toBe("key-openai");
    expect(a[0].model).toBeNull();
  });

  it("rotates through the key pool before any fallback", () => {
    const p = prov("groq", { apiKeys: ["k2", "k3"] });
    const a = buildAttempts(p, [p]);
    expect(a.map((x) => x.provider.apiKey)).toEqual(["key-groq", "k2", "k3"]);
  });

  it("appends fallback providers with their own keys and default model", () => {
    const p = prov("groq", { fallbacks: ["openai"] });
    const openai = prov("openai", { apiKeys: ["o2"] });
    const a = buildAttempts(p, [p, openai]);
    expect(a.map((x) => `${x.provider.id}:${x.provider.apiKey}`)).toEqual([
      "groq:key-groq",
      "openai:key-openai",
      "openai:o2",
    ]);
    // Fallback attempts carry that provider's model; the primary keeps the caller's.
    expect(a[0].model).toBeNull();
    expect(a[1].model).toBe("openai-model");
  });

  it("ignores unknown or self-referential fallbacks", () => {
    const p = prov("groq", { fallbacks: ["groq", "missing"] });
    expect(buildAttempts(p, [p])).toHaveLength(1);
  });

  it("gives a keyless local provider exactly one attempt", () => {
    const local = prov("local", { apiKey: "" });
    const a = buildAttempts(local, [local]);
    expect(a).toHaveLength(1);
    expect(a[0].provider.apiKey).toBe("");
  });
});

describe("isRetryableError", () => {
  it("retries rate limits, auth and 5xx", () => {
    for (const s of [401, 403, 429, 500, 503]) expect(isRetryableError(new ProviderError("x", s))).toBe(true);
  });
  it("does not retry a bad request", () => {
    expect(isRetryableError(new ProviderError("x", 400))).toBe(false);
    expect(isRetryableError(new ProviderError("x", 404))).toBe(false);
  });
  it("retries network-level failures", () => {
    expect(isRetryableError(new Error("Failed to fetch"))).toBe(true);
    expect(isRetryableError(new Error("network timeout"))).toBe(true);
    expect(isRetryableError(new Error("something else"))).toBe(false);
  });
});
