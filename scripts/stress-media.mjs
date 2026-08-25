#!/usr/bin/env node
/**
 * Stress runner for mcp-media/.
 *
 * Scenarios:
 *   1. boot     — spawn/initialize/tools-list/shutdown, repeated: cold-start cost
 *   2. load     — concurrent tools/call through a fake upstream with latency
 *   3. flood    — garbage + oversized lines between valid messages: must survive
 *   4. ping     — rapid-fire request/reply integrity at volume
 *
 * Usage: node scripts/stress-media.mjs
 * Exit code is non-zero if any scenario fails its assertions.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "mcp-media", "index.mjs");

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// ---------- tiny client ----------

function startServer(cfgPath) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, MEDIA_CONFIG: cfgPath },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const state = { buffer: "", nextId: 1, pending: new Map(), child };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    state.buffer += chunk;
    let idx;
    while ((idx = state.buffer.indexOf("\n")) !== -1) {
      const line = state.buffer.slice(0, idx).trim();
      state.buffer = state.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && state.pending.has(msg.id)) {
        const cb = state.pending.get(msg.id);
        state.pending.delete(msg.id);
        cb(msg);
      }
    }
  });
  let err = "";
  child.stderr.on("data", (c) => (err += c));

  const call = (method, params, timeoutMs = 15000) =>
    new Promise((resolve, reject) => {
      const id = state.nextId++;
      const timer = setTimeout(() => reject(new Error(`timeout id=${id} ${method}`)), timeoutMs);
      state.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  const notify = (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  const stop = () => child.kill();

  return { child, call, notify, stop, stderr: () => err };
}

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  return {
    n: s.length,
    avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
    p50: pct(s, 50),
    p95: pct(s, 95),
    max: s[s.length - 1],
  };
}

let failures = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// ---------- fixtures ----------

function makeConfig(upstreamUrl, dir) {
  const cfgPath = join(dir, `cfg-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(
    cfgPath,
    JSON.stringify({
      models: [
        { id: "img", name: "test", kind: "image", engine: "openai-image", baseUrl: upstreamUrl, model: "test" },
      ],
      defaults: { image: "img" },
    }),
  );
  return cfgPath;
}

async function startUpstream(latencyMs) {
  const hits = { n: 0 };
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      hits.n++;
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, url: `http://127.0.0.1:${srv.address().port}/v1`, hits };
}

async function handshake(h) {
  const t0 = performance.now();
  const init = await h.call("initialize", { protocolVersion: "2025-03-26" });
  if (!init.result?.serverInfo) throw new Error("bad initialize reply");
  h.notify("notifications/initialized");
  await h.call("tools/list", {});
  return performance.now() - t0;
}

// ---------- scenarios ----------

async function scenarioBoot(dir, upstreamUrl, rounds = 15) {
  console.log("\n[1] boot — spawn → initialize → tools/list → kill");
  const times = [];
  for (let i = 0; i < rounds; i++) {
    const h = startServer(makeConfig(upstreamUrl, dir));
    try {
      times.push(await handshake(h));
    } finally {
      h.stop();
    }
  }
  const s = stats(times);
  check("boot handshake completes every round", true, `${s.n} rounds`);
  check("p95 boot under 2s", s.p95 < 2000, `avg ${s.avg}ms · p95 ${s.p95}ms · max ${s.max}ms`);
  return s;
}

async function scenarioLoad(dir, workers = 8, perWorker = 20) {
  console.log(`\n[2] load — ${workers} workers x ${perWorker} image calls (upstream ~8ms)`);
  const up = await startUpstream(8);
  const h = startServer(makeConfig(up.url, dir));
  await handshake(h);

  const t0 = performance.now();
  const results = await Promise.all(
    Array.from({ length: workers }, async () => {
      const lat = [];
      for (let i = 0; i < perWorker; i++) {
        const s = performance.now();
        const r = await h.call("tools/call", {
          name: "generate_image",
          arguments: { prompt: `stress ${i}` },
        });
        lat.push(performance.now() - s);
        if (r.result?.isError || !String(r.result?.content?.[0]?.text ?? "").startsWith("data:image/png")) {
          throw new Error(`bad result: ${JSON.stringify(r.result).slice(0, 120)}`);
        }
      }
      return lat;
    }),
  );
  const wall = performance.now() - t0;
  const all = results.flat();
  const s = stats(all);

  check("zero failed calls", true, `${all.length}/${workers * perWorker}`);
  check("upstream saw every request", up.hits.n === workers * perWorker, `${up.hits.n} hits`);
  check(
    "per-call latency sane",
    s.p95 < 5000,
    `wall ${(wall / 1000).toFixed(2)}s · ${(all.length / (wall / 1000)).toFixed(1)} rps · p50 ${s.p50}ms · p95 ${s.p95}ms`,
  );

  h.stop();
  up.srv.close();
  return { ...s, rps: all.length / (wall / 1000) };
}

async function scenarioFlood(dir, upstreamUrl) {
  console.log("\n[3] flood — 2000 garbage lines + a 1 MB line, then a real ping");
  const h = startServer(makeConfig(upstreamUrl, dir));
  await handshake(h);

  const garbage = Buffer.alloc(1024 * 1024, "x").toString(); // single 1MB junk line
  childWrite(h, garbage);
  for (let i = 0; i < 2000; i++) {
    childWrite(h, i % 3 === 0 ? "{broken" : i % 3 === 1 ? "" : '{"id":"stray"}');
  }

  const t0 = performance.now();
  const pong = await h.call("ping", {}, 8000);
  check("alive after flood", pong.result !== undefined, `answered in ${Math.round(performance.now() - t0)}ms`);

  // And still fully functional afterwards.
  const img = await h.call("tools/call", { name: "generate_image", arguments: { prompt: "post-flood" } });
  check(
    "still generates after flood",
    String(img.result?.content?.[0]?.text ?? "").startsWith("data:image/png"),
  );
  h.stop();
}

function childWrite(h, text) {
  h.child.stdin.write(`${text}\n`);
}

async function scenarioPing(n = 500) {
  console.log(`\n[4] ping — ${n} rapid requests on one connection`);
  const dir = mkdtempSync(join(tmpdir(), "hs-stress-"));
  const h = startServer(makeConfig("http://127.0.0.1:1/v1", dir)); // upstream unused
  await handshake(h);

  const ids = [];
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    // Fire without awaiting: replies may interleave; ids must sort them out.
    ids.push(h.call("ping", {}));
  }
  const replies = await Promise.all(ids);
  const wall = performance.now() - t0;
  const ok = replies.every((r) => r.result !== undefined);
  check("every reply matched its id", ok, `${replies.length} replies`);
  check(
    "throughput",
    wall / n < 20,
    `${n} pings in ${Math.round(wall)}ms (${(n / (wall / 1000)).toFixed(0)}/s)`,
  );
  h.stop();
  rmSync(dir, { recursive: true, force: true });
}

// ---------- main ----------

console.log("HarnessStation media MCP server — stress");
const dir = mkdtempSync(join(tmpdir(), "hs-stress-"));
const up = await startUpstream(0);
try {
  await scenarioBoot(dir, up.url);
  await scenarioLoad(dir);
  await scenarioFlood(dir, up.url);
  await scenarioPing();
} finally {
  up.srv.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll stress checks passed." : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
