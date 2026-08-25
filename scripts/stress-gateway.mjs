#!/usr/bin/env node
/**
 * Stress runner for server/ (the gateway).
 *
 * Scenarios:
 *   1. load     — high-concurrency reads of the local endpoints
 *                 (/api/health, /api/mcp/directory, cached /api/benchmarks)
 *   2. limit    — a second instance with RATE_LIMIT=15 proves the limiter bites
 *
 * Offline by design: no AA_API_KEY is set, so /api/hf/* proxies and upstream
 * refreshes are not exercised here.
 *
 * Usage: node scripts/stress-gateway.mjs
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "server", "index.mjs");
const PORT = 8799;

let failures = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function startGateway(extraEnv = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(PORT),
      RATE_LIMIT: "1000000",
      PROXY_RATE_LIMIT: "1000000",
      LIBRARY_SALT: "stress-run-salt",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (c) => (err += c));
  child.stdout.on("data", () => {}); // keep the pipe drained
  const stop = () => child.kill();
  return { child, stop, stderr: () => err };
}

async function waitReady(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`gateway never became ready:\n${""}`);
}

async function get(url, path) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${url}${path}`);
    const out = { ms: performance.now() - t0, status: res.status };
    if (res.status !== 200) {
      out.body = (await res.text()).slice(0, 140);
      out.via = res.headers.get("via") ?? "";
      out.server = res.headers.get("server") ?? "";
    }
    return out;
  } catch (e) {
    return { ms: performance.now() - t0, status: 0, error: e.message };
  }
}

// ---------- scenarios ----------

async function scenarioLoad() {
  console.log("\n[1] load — 600 requests, concurrency 24, across local endpoints");
  const gw = startGateway();
  const url = `http://127.0.0.1:${PORT}`;
  try {
    await waitReady(url);
    // Warm any lazily-read files once so the measured runs see steady state.
    await get(url, "/api/mcp/directory");

    const paths = ["/api/health", "/api/mcp/directory", "/api/benchmarks"];
    const CONC = 24;
    const TOTAL = 600;
    const results = [];

    const t0 = performance.now();
    await Promise.all(
      Array.from({ length: CONC }, async (_, w) => {
        for (let i = w; i < TOTAL; i += CONC) {
          // Tag the result with its path NOW: workers complete out of order,
          // so array position can never be used to recover which path a
          // response belonged to.
          const path = paths[i % paths.length];
          const r = await get(url, path);
          results.push({ path, ...r });
        }
      }),
    );
    const wall = performance.now() - t0;

    const statuses = {};
    for (const r of results) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    const ok = results.filter((r) => r.status === 200);
    const sorted = ok.map((r) => r.ms).sort((a, b) => a - b);

    // Local endpoints are unconditional; the benchmarks feed is keyed upstream
    // (Artificial Analysis), so without AA_API_KEY it answers a designed 503.
    const byPath = new Map(paths.map((p) => [p, []]));
    for (const r of results) byPath.get(r.path).push(r);
    const statusMap = (rs) => {
      const m = {};
      for (const r of rs) m[r.status] = (m[r.status] ?? 0) + 1;
      return JSON.stringify(m);
    };
    const localRs = [...byPath.get("/api/health"), ...byPath.get("/api/mcp/directory")];
    const localOk = localRs.every((r) => r.status === 200);
    const badSample = localRs.find((r) => r.status !== 200);
    check(
      "local endpoints always 200",
      localOk,
      `${statusMap(byPath.get("/api/health"))} health · ${statusMap(byPath.get("/api/mcp/directory"))} directory` +
        (badSample ? ` · sample body: ${badSample.body ?? ""} server=${badSample.server ?? ""}` : ""),
    );
    const benchStatuses = new Set(byPath.get("/api/benchmarks").map((r) => r.status));
    check(
      "benchmarks degrade cleanly without a key",
      benchStatuses.size === 1 && (benchStatuses.has(200) || benchStatuses.has(503)),
      `statuses: ${[...benchStatuses].join(",")} · n=${byPath.get("/api/benchmarks").length}`,
    );
    check("no connection errors or 5xx beyond the designed 503", !results.some((r) => r.status === 0 || (r.status >= 500 && r.status !== 503)));
    check(
      "latency healthy under load",
      pct(sorted, 99) < 1000,
      `${(TOTAL / (wall / 1000)).toFixed(0)} rps · p50 ${Math.round(pct(sorted, 50))}ms · p95 ${Math.round(pct(sorted, 95))}ms · p99 ${Math.round(pct(sorted, 99))}ms`,
    );

    // The unkeyed benchmarks endpoint must degrade to a message, not hang or 5xx.
    const bench = await get(url, "/api/benchmarks");
    check("unkeyed /api/benchmarks responds gracefully", bench.status === 200 || bench.status === 503, `status ${bench.status}`);
  } finally {
    gw.stop();
  }
}

async function scenarioLimit() {
  console.log("\n[2] rate limit — RATE_LIMIT=15, then 40 fast requests from one IP");
  const gw = startGateway({ RATE_LIMIT: "15" });
  const url = `http://127.0.0.1:${PORT}`;
  try {
    await waitReady(url);
    const responses = await Promise.all(Array.from({ length: 40 }, () => get(url, "/api/health")));
    const counts = {};
    for (const r of responses) counts[r.status] = (counts[r.status] ?? 0) + 1;
    check("limiter engages with 429s", (counts[429] ?? 0) > 0, JSON.stringify(counts));
    check("some requests still pass", (counts[200] ?? 0) >= 10, `${counts[200] ?? 0} passed`);
  } finally {
    gw.stop();
  }
}

console.log("HarnessStation gateway — stress");
await scenarioLoad();
await scenarioLimit();

console.log(failures === 0 ? "\nAll gateway stress checks passed." : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
