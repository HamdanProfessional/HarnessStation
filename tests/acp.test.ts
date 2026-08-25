import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE = join(HERE, "..", "cli", "acp.mjs");

// ---------- pure helpers ----------

const { promptText, stopReasonFor, chunkFrame, finishOf } = await import("../cli/acp.mjs");

describe("acp pure helpers", () => {
  it("promptText joins text blocks and ignores unadvertised kinds", () => {
    expect(
      promptText([
        { type: "text", text: "one " },
        { type: "image", data: "..." },
        { type: "text", text: "two" },
      ]),
    ).toBe("one two");
    expect(promptText(undefined)).toBe("");
  });

  it("maps finish reasons and aborts onto ACP stop reasons", () => {
    expect(stopReasonFor("stop", false)).toBe("end_turn");
    expect(stopReasonFor("length", false)).toBe("max_tokens");
    expect(stopReasonFor("stop", true)).toBe("cancelled");
    expect(stopReasonFor("", true)).toBe("cancelled");
  });

  it("chunkFrame carries the agent_message_chunk update shape", () => {
    const f = chunkFrame("sess_1", "hello", "msg_9");
    expect(f.method).toBe("session/update");
    expect(f.params.sessionId).toBe("sess_1");
    expect(f.params.update.sessionUpdate).toBe("agent_message_chunk");
    expect(f.params.update.messageId).toBe("msg_9");
    expect(f.params.update.content).toEqual({ type: "text", text: "hello" });
  });

  it("finishOf reads the finish_reason out of an SSE payload", () => {
    expect(finishOf(JSON.stringify({ choices: [{ finish_reason: "length" }] }))).toBe("length");
    expect(finishOf("[DONE]")).toBe("");
    expect(finishOf("garbage")).toBe("");
  });
});

// ---------- integration: a fake editor drives the real bridge ----------

describe("hs-acp over stdio", () => {
  let upstream;
  let upstreamUrl;
  let child;
  let buffer;
  const pending = new Map();
  const notifications = [];
  let chatBodies = [];

  function send(msg) {
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  function waitFor(id, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for id ${id}`)), timeoutMs);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      flush();
    });
  }

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
      } else if (msg.method === "session/update") {
        notifications.push(msg);
      }
    }
  }

  afterEach(async () => {
    child?.kill();
    upstream?.close();
    pending.clear();
    notifications.length = 0;
    chatBodies = [];
    vi.restoreAllMocks();
  });

  async function startBridge(args: string[], chatHandler: (body: any) => object) {
    upstream = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url?.includes("/models")) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ data: [{ id: "groq/llama-3.3-70b" }, { id: "agent/helper" }] }));
          return;
        }
        const parsed = JSON.parse(body || "{}");
        chatBodies.push(parsed);
        res.setHeader("Content-Type", "text/event-stream");
        const frames = chatHandler(parsed);
        for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`);
        res.end("data: [DONE]\n\n");
      });
    });
    await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
    const port = (upstream.address() as { port: number }).port;

    child = spawn(process.execPath, [BRIDGE, ...args, "--port", String(port)], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.on("error", (e) => console.error("[bridge] spawn error:", e));
    buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      flush();
    });
    child.stderr.on("data", (c) => process.stderr.write(`[bridge] ${c}`));
    // Wait for the bridge to be startable — initialize doubles as the readiness probe.
    send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: 1 } });
    return waitFor(0);
  }

  it("initializes with ACP v1 and the HarnessStation agent info", async () => {
    const init = await startBridge(["--model", "groq/llama-3.3-70b"], () => []);
    expect(init.result.protocolVersion).toBe(1);
    expect(init.result.agentInfo.name).toBe("harnessstation");
    expect(init.result.agentCapabilities.loadSession).toBeFalsy();
  });

  it("runs a full prompt turn: session/new, streamed chunks, end_turn", async () => {
    await startBridge(["--model", "groq/llama-3.3-70b"], () => [
      { choices: [{ delta: { content: "Hello " } }] },
      { choices: [{ delta: { content: "world" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);

    send({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/", mcpServers: [] } });
    const created = await waitFor(1);
    expect(created.result.sessionId).toBeTruthy();

    send({
      jsonrpc: "2.0",
      id: 2,
      method: "session/prompt",
      params: { sessionId: created.result.sessionId, prompt: [{ type: "text", text: "say hi" }] },
    });
    const done = await waitFor(2);
    expect(done.result.stopReason).toBe("end_turn");

    const chunks = notifications.filter(
      (n) => n.params.update.sessionUpdate === "agent_message_chunk",
    );
    expect(chunks.map((n) => n.params.update.content.text).join("")).toBe("Hello world");
    // All chunks belong to one message and to the right session.
    expect(new Set(chunks.map((n) => n.params.update.messageId)).size).toBe(1);
    expect(chunks[0].params.sessionId).toBe(created.result.sessionId);
  });

  it("keeps per-session history across prompts", async () => {
    await startBridge(["--model", "groq/llama-3.3-70b"], () => [
      { choices: [{ delta: { content: "ok" } }, { delta: {}, finish_reason: "stop" }] },
    ]);

    send({ jsonrpc: "2.0", id: 1, method: "session/new", params: {} });
    const { result } = await waitFor(1);

    send({ jsonrpc: "2.0", id: 2, method: "session/prompt", params: { sessionId: result.sessionId, prompt: [{ type: "text", text: "one" }] } });
    await waitFor(2);
    send({ jsonrpc: "2.0", id: 3, method: "session/prompt", params: { sessionId: result.sessionId, prompt: [{ type: "text", text: "two" }] } });
    await waitFor(3);

    // Second request carries turn one plus both halves of the conversation.
    expect(chatBodies).toHaveLength(2);
    expect(chatBodies[1].messages).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "two" },
    ]);
  });

  it("falls back to the API's first model when none was given", async () => {
    await startBridge([], () => [{ choices: [{ delta: { content: "x" }, finish_reason: "stop" }] }]);
    send({ jsonrpc: "2.0", id: 1, method: "session/new", params: {} });
    const { result } = await waitFor(1);
    send({ jsonrpc: "2.0", id: 2, method: "session/prompt", params: { sessionId: result.sessionId, prompt: [{ type: "text", text: "hi" }] } });
    await waitFor(2);
    expect(chatBodies[0].model).toBe("groq/llama-3.3-70b");
  });

  it("answers a cancelled turn with the cancelled stop reason", async () => {
    await startBridge(["--model", "groq/llama-3.3-70b"], () => {
      // A stream that never finishes on its own.
      return new Proxy({}, {}) as never;
    }).catch(() => {});
    // Rebuild with a hanging upstream: override by using a slow handler instead.
    child?.kill();
    upstream.close();
    pending.clear();
    notifications.length = 0;

    upstream = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url?.includes("/models")) {
          res.end(JSON.stringify({ data: [{ id: "m" }] }));
          return;
        }
        chatBodies.push(JSON.parse(body || "{}"));
        res.setHeader("Content-Type", "text/event-stream");
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`);
        // Never ends; the bridge's cancel must abort the fetch.
      });
    });
    await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
    const port = (upstream.address() as { port: number }).port;
    child = spawn(process.execPath, [BRIDGE, "--model", "groq/llama-3.3-70b", "--port", String(port)], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      flush();
    });

    send({ jsonrpc: "2.0", id: 10, method: "session/new", params: {} });
    const { result } = await waitFor(10);
    send({
      jsonrpc: "2.0",
      id: 11,
      method: "session/prompt",
      params: { sessionId: result.sessionId, prompt: [{ type: "text", text: "go" }] },
    });
    // Give the first chunk time to arrive, then cancel.
    await new Promise((r) => setTimeout(r, 600));
    send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: result.sessionId } });
    const done = await waitFor(11);
    expect(done.result.stopReason).toBe("cancelled");
  }, 15000);

  it("answers unknown methods with a JSON-RPC error", async () => {
    await startBridge([], () => []);
    send({ jsonrpc: "2.0", id: 20, method: "session/load", params: {} });
    const resp = await waitFor(20);
    expect(resp.error).toBeTruthy();
    send({ jsonrpc: "2.0", id: 21, method: "made/up" });
    const resp2 = await waitFor(21);
    expect(resp2.error.code).toBe(-32601);
  });
});
