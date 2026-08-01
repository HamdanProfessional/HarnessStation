/**
 * HarnessStation gateway.
 *
 * Holds the keys for the *shared* third-party services the app uses on everyone's
 * behalf — currently Artificial Analysis benchmarks — so they are never shipped
 * inside the desktop app.
 *
 * What deliberately does NOT come through here:
 *   - AI provider keys (OpenAI, Anthropic, Groq, Ollama, LM Studio, …)
 *   - Media / image / TTS provider keys
 *   - MCP server credentials and OAuth tokens
 * Those are the user's own, stay on the user's machine, and are sent only to the
 * service they belong to. Routing them through here would turn this into a
 * chokepoint for other people's secrets, which is the opposite of the point.
 *
 *   cp .env.example .env   # then set AA_API_KEY
 *   npm install && npm start
 */
import express from "express";
import fs from "node:fs";

const PORT = process.env.PORT ?? 8787;
const AA_API_KEY = process.env.AA_API_KEY ?? "";
const REFRESH_MS = Number(process.env.REFRESH_MINUTES ?? 30) * 60_000;
/** Requests per IP per minute. Generous for a desktop app, mean to a scraper. */
const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? 60);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true); // behind a reverse proxy, rate-limit the real client

/**
 * Feeds kept warm in the background: fetched on boot, then every REFRESH_MS. A
 * client request is served from memory and never waits on the upstream, which
 * also means one API key serves any number of installs without hitting rate
 * limits.
 *
 * To add another shared API, add an entry here and a route that reads `warm`.
 */
const FEEDS = {
  benchmarks: {
    url: "https://artificialanalysis.ai/api/v2/data/llms/models",
    headers: () => ({ "x-api-key": AA_API_KEY }),
    missingKey: () => (AA_API_KEY ? null : "AA_API_KEY is not set on the gateway"),
  },
};

/** feed name -> { data, at, error } */
const warm = new Map();

async function refresh(name) {
  const feed = FEEDS[name];
  const missing = feed.missingKey?.();
  if (missing) {
    const prev = warm.get(name);
    warm.set(name, { data: prev?.data, at: prev?.at ?? 0, error: missing });
    return;
  }
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "HarnessStation-Gateway", ...feed.headers?.() },
    });
    if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
    warm.set(name, { data: await res.json(), at: Date.now(), error: null });
    console.log(`[gateway] ${name} refreshed`);
  } catch (e) {
    // Keep what we already had: stale benchmarks beat no benchmarks.
    const prev = warm.get(name);
    warm.set(name, { data: prev?.data, at: prev?.at ?? 0, error: String(e) });
    console.warn(`[gateway] ${name} refresh failed: ${e}`);
  }
}

function startRefreshLoop() {
  for (const name of Object.keys(FEEDS)) {
    void refresh(name);
    setInterval(() => void refresh(name), REFRESH_MS).unref?.();
  }
}

// ---------- middleware ----------

app.use((req, res, next) => {
  // The desktop app has an opaque/tauri origin, so a wildcard is the practical
  // choice. Nothing served here is user-specific and every route is a public read.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  if (req.method !== "GET") return res.sendStatus(405);
  next();
});

const hits = new Map(); // ip -> { n, resetAt }
app.use((req, res, next) => {
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.resetAt) hits.set(ip, { n: 1, resetAt: now + 60_000 });
  else if (++rec.n > RATE_LIMIT) return res.status(429).json({ error: "too many requests" });
  if (hits.size > 10_000) for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
  next();
});

// ---------- routes ----------

app.get("/api/benchmarks", (_req, res) => {
  const hit = warm.get("benchmarks");
  if (hit?.data) {
    res.setHeader("X-Cache-Age", String(Math.round((Date.now() - hit.at) / 1000)));
    return res.json(hit.data);
  }
  res.status(503).json({ error: hit?.error ?? "benchmarks not loaded yet, try again shortly" });
});

/**
 * Hugging Face needs no key, so this is a courtesy proxy — it keeps the app on
 * one origin and lets us cache. Search results move, so the TTL is short.
 */
const proxyCache = new Map();
async function cachedProxy(url, ttlMs = 30 * 60_000) {
  const hit = proxyCache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const res = await fetch(url, { headers: { "User-Agent": "HarnessStation-Gateway" } });
  if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
  const data = await res.json();
  proxyCache.set(url, { at: Date.now(), data });
  if (proxyCache.size > 500) proxyCache.delete(proxyCache.keys().next().value);
  return data;
}

app.get("/api/hf/search", async (req, res) => {
  try {
    const q = encodeURIComponent(String(req.query.q ?? "").slice(0, 100));
    res.json(
      await cachedProxy(
        `https://huggingface.co/api/models?search=${q}&filter=gguf&sort=downloads&direction=-1&limit=25`,
      ),
    );
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get("/api/hf/files", async (req, res) => {
  try {
    const repo = String(req.query.repo ?? "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return res.status(400).json({ error: "bad repo" });
    res.json(await cachedProxy(`https://huggingface.co/api/models/${repo}/tree/main`));
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

/** Curated MCP server list. Edit mcp-directory.json to change what apps see. */
let directory = [];
function loadDirectory() {
  try {
    directory = JSON.parse(fs.readFileSync(new URL("./mcp-directory.json", import.meta.url), "utf8"));
  } catch (e) {
    console.warn(`[gateway] mcp-directory.json unreadable: ${e}`);
    directory = [];
  }
}
app.get("/api/mcp/directory", (_req, res) => res.json(directory));

app.get("/api/health", (_req, res) => {
  const feeds = {};
  for (const name of Object.keys(FEEDS)) {
    const hit = warm.get(name);
    feeds[name] = {
      ok: !!hit?.data,
      ageSeconds: hit?.at ? Math.round((Date.now() - hit.at) / 1000) : null,
      error: hit?.error ?? null,
    };
  }
  res.json({ ok: true, refreshMinutes: REFRESH_MS / 60_000, feeds });
});

// ---------- boot ----------

if (!AA_API_KEY) {
  console.warn("[gateway] AA_API_KEY is not set — /api/benchmarks will return 503.");
}
loadDirectory();
startRefreshLoop();
app.listen(PORT, () =>
  console.log(`[gateway] listening on :${PORT} (refresh every ${REFRESH_MS / 60_000}m)`),
);
