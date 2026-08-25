import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "mcp-media", "index.mjs");

// ---------- pure handler tests (no process) ----------

const { handleRequest, loadConfig, resolveModel, toolDefinitions } = await import(
  "../mcp-media/lib.mjs"
);

const SETTINGS_SHAPED = JSON.stringify({
  providers: [{ id: "x" }],
  mediaModels: [
    {
      id: "dalle",
      name: "DALL·E",
      kind: "image",
      engine: "openai-image",
      baseUrl: "http://upstream.test/v1",
      apiKey: "k-test",
      model: "gpt-image-1",
    },
  ],
  defaultMediaIds: { image: "dalle" },
});

const DEDICATED_SHAPED = JSON.stringify({
  models: [
    {
      id: "sd",
      kind: "image",
      engine: "a1111",
      baseUrl: "http://localhost:7860",
    },
    {
      id: "tts",
      kind: "audio",
      engine: "openai-speech",
      baseUrl: "http://localhost:8000/v1",
      options: "alloy",
    },
  ],
  defaults: {},
});

describe("loadConfig", () => {
  it("reads the dedicated shape and the settings.json shape alike", () => {
    expect(loadConfig(SETTINGS_SHAPED).models).toHaveLength(1);
    expect(loadConfig(DEDICATED_SHAPED).defaults).toEqual({});
  });

  it("drops malformed model entries instead of failing the server", () => {
    const cfg = loadConfig(
      JSON.stringify({ models: [null, { baseUrl: "http://x", engine: "openai-image" }, "junk"] }),
    );
    expect(cfg.models).toHaveLength(1);
  });

  it("rejects non-JSON with a clear error", () => {
    expect(() => loadConfig("not json")).toThrow(/not valid JSON/);
  });
});

describe("resolveModel", () => {
  const cfg = loadConfig(DEDICATED_SHAPED);
  it("prefers the configured default", () => {
    cfg.defaults = { image: "sd" };
    expect(resolveModel(cfg, "image")?.id).toBe("sd");
  });
  it("falls back to the first model of that kind", () => {
    expect(resolveModel(loadConfig(SETTINGS_SHAPED), "image")?.id).toBe("dalle");
    expect(resolveModel(cfg, "video")).toBeUndefined();
  });
});

describe("handleRequest", () => {
  const ctx = { config: loadConfig(SETTINGS_SHAPED), fetchImpl: async () => { throw new Error("no network"); } };

  it("answers initialize with its protocol version and tool capability", async () => {
    const r = await handleRequest(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      ctx,
    );
    expect(r.result.protocolVersion).toBe("2025-03-26");
    expect(r.result.capabilities.tools).toBeDefined();
    expect(r.result.serverInfo.name).toContain("media");
  });

  it("lists four generation tools with schemas", async () => {
    const r = await handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx);
    expect(r.result.tools.map((t) => t.name)).toEqual([
      "generate_image",
      "generate_speech",
      "generate_video",
      "generate_3d",
    ]);
    for (const t of r.result.tools) expect(t.inputSchema.required.length).toBeGreaterThan(0);
  });

  it("guides to configuration as plain text when no model of a kind exists", async () => {
    const r = await handleRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "generate_video", arguments: { prompt: "x" } } },
      ctx,
    );
    expect(r.result.isError).toBeUndefined();
    expect(r.result.content[0].text).toContain("No video generation model is configured");
  });

  it("returns engine failures as isError results", async () => {
    const r = await handleRequest(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "generate_image", arguments: { prompt: "cat" } } },
      ctx,
    );
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toContain("no network");
  });

  it("refuses empty prompts and unknown tools", async () => {
    const empty = await handleRequest(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "generate_image", arguments: { prompt: "  " } } },
      ctx,
    );
    expect(empty.result.isError).toBe(true);
    const unknown = await handleRequest(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "generate_smell", arguments: {} } },
      ctx,
    );
    expect(unknown.result.isError).toBe(true);
  });

  it("notifications produce no reply; unknown methods are ignored", async () => {
    expect(await handleRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx)).toBeNull();
    expect(await handleRequest({ jsonrpc: "2.0", id: 9, method: "some/future/method" }, ctx)).toBeNull();
  });
});

// ---------- integration over a real stdio pipe ----------

describe("mcp-media over stdio", () => {
  let upstream;
  let upstreamUrl;
  let child;
  let pending;
  let buffer;
  let tmpDir;

  const PNG_1PX =
    "data:image/png;base64," +
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ).toString("base64");

  function send(msg) {
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  /** Wait for the response with the given rpc id (skips notifications). */
  function waitFor(id, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for id ${id}`)), timeoutMs);
      pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      flush();
    });
  }

  /** Parse everything buffered so far and dispatch to whoever is waiting. */
  function flush() {
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && pending.has(msg.id)) {
        const cb = pending.get(msg.id)!;
        pending.delete(msg.id);
        cb(msg);
      }
    }
  }

  beforeAll(async () => {
    // Fake OpenAI-compatible upstream: serves /images/generations with a 1px png.
    upstream = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ data: [{ b64_json: PNG_1PX.split(",")[1] }] }));
      });
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    upstreamUrl = `http://127.0.0.1:${upstream.address().port}/v1`;

    tmpDir = mkdtempSync(join(tmpdir(), "hs-media-"));
    const cfgPath = join(tmpDir, "settings.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({
        mediaModels: [
          { id: "img", name: "Test image", kind: "image", engine: "openai-image", baseUrl: upstreamUrl, model: "test" },
        ],
        defaultMediaIds: { image: "img" },
      }),
    );

    child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, MEDIA_CONFIG: cfgPath },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.on("error", (e) => console.error("[media-server] spawn error:", e));
    buffer = "";
    pending = new Map();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      flush();
    });
  });

  afterAll(() => {
    child?.kill();
    upstream?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("handshakes, lists tools and generates an image end-to-end", async () => {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    const init = await waitFor(1);
    expect(init.result.serverInfo.name).toContain("media");

    send({ jsonrpc: "2.0", method: "notifications/initialized" });

    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const tools = await waitFor(2);
    expect(tools.result.tools.some((t) => t.name === "generate_image")).toBe(true);

    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "generate_image", arguments: { prompt: "a tiny test square" } },
    });
    const call = await waitFor(3);
    expect(call.result.isError).toBeUndefined();
    expect(call.result.content[0].text.startsWith("data:image/png;base64,")).toBe(true);
  }, 15000);

  it("keeps running when the client sends garbage between messages", async () => {
    child.stdin.write("this is not json\n\n");
    send({ jsonrpc: "2.0", id: 4, method: "ping" });
    const pong = await waitFor(4);
    expect(pong.result).toEqual({});
  }, 10000);
});
