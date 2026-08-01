import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The gateway holds the keys for shared services (benchmarks) so none ship in
 * the app. What matters here is which URL a given build talks to, and that a
 * user's own provider keys never go near it.
 */

const fetchMock = vi.fn();
let settings: Record<string, unknown> = {};

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...a: unknown[]) => fetchMock(...(a as [])) }));
vi.mock("../src/lib/store", () => ({
  useStore: { getState: () => ({ settings }) },
}));

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/** Re-import the module so the build-time env is read afresh. */
async function loadGateway(builtIn?: string) {
  vi.resetModules();
  if (builtIn === undefined) vi.stubEnv("VITE_GATEWAY_URL", "");
  else vi.stubEnv("VITE_GATEWAY_URL", builtIn);
  return import("../src/lib/gateway");
}

beforeEach(() => {
  settings = {};
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("which gateway a build talks to", () => {
  it("uses the URL baked in at build time", async () => {
    const g = await loadGateway("https://gateway.example.com");
    expect(g.gatewayUrl()).toBe("https://gateway.example.com");
    expect(g.hasBuiltInGateway()).toBe(true);
  });

  it("lets a self-hoster override it from Settings", async () => {
    const g = await loadGateway("https://gateway.example.com");
    settings = { serverUrl: "http://localhost:8787" };
    expect(g.gatewayUrl()).toBe("http://localhost:8787");
  });

  it("has none when nothing is configured", async () => {
    const g = await loadGateway();
    expect(g.gatewayUrl()).toBeNull();
    expect(g.hasBuiltInGateway()).toBe(false);
  });

  it("trims trailing slashes from either source", async () => {
    const g = await loadGateway("https://gateway.example.com/");
    expect(g.gatewayUrl()).toBe("https://gateway.example.com");
    settings = { serverUrl: "  http://localhost:8787//  " };
    expect(g.gatewayUrl()).toBe("http://localhost:8787");
  });

  it("ignores a blank Settings value and falls back to the build-time URL", async () => {
    const g = await loadGateway("https://gateway.example.com");
    settings = { serverUrl: "   " };
    expect(g.gatewayUrl()).toBe("https://gateway.example.com");
  });
});

describe("fetchBenchmarks", () => {
  const payload = {
    data: [
      {
        name: "GPT-5",
        model_creator: { name: "OpenAI" },
        evaluations: { artificial_analysis_intelligence_index: 70 },
        median_output_tokens_per_second: 120,
        pricing: { price_1m_input_tokens: 2, price_1m_output_tokens: 10 },
      },
    ],
  };

  it("goes through the gateway, sending no key from the app", async () => {
    const g = await loadGateway("https://gateway.example.com");
    fetchMock.mockResolvedValue(ok(payload));

    const rows = await g.fetchBenchmarks();

    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://gateway.example.com/api/benchmarks");
    // The whole point: no API key leaves the app on this path.
    expect(Object.keys(init.headers)).not.toContain("x-api-key");
    expect(rows[0]).toMatchObject({ name: "GPT-5", creator: "OpenAI", intelligence: 70 });
  });

  it("falls back to the user's own key when there is no gateway", async () => {
    const g = await loadGateway();
    settings = { aaApiKey: "user-key" };
    fetchMock.mockResolvedValue(ok(payload));

    await g.fetchBenchmarks();

    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain("artificialanalysis.ai");
    expect(init.headers["x-api-key"]).toBe("user-key");
  });

  it("explains what to do when there's neither a gateway nor a key", async () => {
    const g = await loadGateway();
    await expect(g.fetchBenchmarks()).rejects.toThrow(/gateway|Artificial Analysis/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads a bare array as well as a { data } envelope", async () => {
    const g = await loadGateway("https://gw");
    fetchMock.mockResolvedValue(ok(payload.data));
    expect(await g.fetchBenchmarks()).toHaveLength(1);
  });

  it("leaves unknown numbers null rather than guessing zero", async () => {
    const g = await loadGateway("https://gw");
    fetchMock.mockResolvedValue(ok({ data: [{ name: "Mystery" }] }));

    const [row] = await g.fetchBenchmarks();

    expect(row).toMatchObject({ intelligence: null, speed: null, priceIn: null, priceOut: null });
  });
});

describe("Hugging Face and the MCP directory", () => {
  it("proxies through the gateway when there is one", async () => {
    const g = await loadGateway("https://gw");
    fetchMock.mockResolvedValue(ok([]));

    await g.hfSearch("llama");
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://gw/api/hf/search?q=llama");

    fetchMock.mockResolvedValue(ok([]));
    await g.hfFiles("org/repo");
    expect(String(fetchMock.mock.calls[1][0])).toContain("https://gw/api/hf/files?repo=");
  });

  it("calls Hugging Face directly when there isn't", async () => {
    const g = await loadGateway();
    fetchMock.mockResolvedValue(ok([]));
    await g.hfSearch("llama");
    expect(String(fetchMock.mock.calls[0][0])).toContain("huggingface.co");
  });

  it("falls back to the built-in MCP list when the gateway is unreachable", async () => {
    const g = await loadGateway("https://gw");
    fetchMock.mockRejectedValue(new Error("offline"));

    const dir = await g.mcpDirectory();

    expect(dir.length).toBeGreaterThan(20);
    expect(dir).toEqual(g.MCP_DIRECTORY_FALLBACK);
  });

  it("uses the built-in list directly when there is no gateway", async () => {
    const g = await loadGateway();
    expect(await g.mcpDirectory()).toEqual(g.MCP_DIRECTORY_FALLBACK);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
