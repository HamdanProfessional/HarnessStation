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
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const HERE = path.dirname(fileURLToPath(import.meta.url));

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
  // choice. GET/POST cover the public library; PUT/DELETE are for a signed-in
  // account's own encrypted sync blob (Authorization: Bearer …).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Upstream-Url");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  if (!["GET", "POST", "PUT", "DELETE"].includes(req.method)) return res.sendStatus(405);
  next();
});

// Parse JSON bodies. Most routes are tiny, so the default cap is small — but a
// sync blob (a whole account's encrypted data) can be large, so the PUT /api/sync
// route gets its own big parser instead.
app.use((req, res, next) => {
  if (req.method === "PUT" && req.path === "/api/sync") return next();
  // The LLM proxy streams a raw request/response through untouched — don't buffer
  // or size-cap it (a chat with images easily exceeds 300kb).
  if (req.path === "/api/llm-proxy") return next();
  return express.json({ limit: "300kb" })(req, res, next);
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

// LLM proxy (for the web build). Some providers' HTTPS APIs send no CORS headers,
// so a browser can't call them directly — Ollama Cloud, notably. The web app
// routes those here: we forward the request to the upstream named in the
// X-Upstream-Url header and stream the reply back with the permissive CORS this
// middleware already sets. The client's own Authorization is passed straight
// through — never read, stored, or logged. Restricted to a fixed allowlist of
// real provider hosts so this can't be turned into a general-purpose web proxy.
const LLM_PROXY_HOSTS = new Set([
  "ollama.com",
  "api.openai.com",
  "api.groq.com",
  "openrouter.ai",
  "api.minimax.io",
  "api.mistral.ai",
  "api.deepseek.com",
  "api.x.ai",
  "api.together.xyz",
  "api.fireworks.ai",
  "api.deepinfra.com",
  "api.studio.nebius.com",
  "api.cerebras.ai",
  "api.z.ai",
  "api.moonshot.ai",
  "dashscope-intl.aliyuncs.com",
  "generativelanguage.googleapis.com",
]);

app.all("/api/llm-proxy", async (req, res) => {
  let url;
  try {
    url = new URL(req.get("x-upstream-url") || "");
  } catch {
    return res.status(400).json({ error: "missing or invalid X-Upstream-Url" });
  }
  if (url.protocol !== "https:" || !LLM_PROXY_HOSTS.has(url.hostname.toLowerCase())) {
    return res.status(403).json({ error: `upstream host not allowed: ${url.hostname}` });
  }

  // Forward only what the upstream needs — never Host, Origin, cookies, etc.
  const headers = { "Content-Type": req.get("content-type") || "application/json" };
  const auth = req.get("authorization");
  if (auth) headers.Authorization = auth;

  const ac = new AbortController();
  res.on("close", () => ac.abort());
  let upstream;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : Readable.toWeb(req),
      duplex: "half",
      signal: ac.signal,
    });
  } catch (e) {
    if (ac.signal.aborted) return; // client hung up
    return res.status(502).json({ error: `upstream fetch failed: ${String(e?.message || e)}` });
  }

  res.status(upstream.status);
  const ct = upstream.headers.get("content-type");
  if (ct) res.setHeader("Content-Type", ct);
  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
});

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

/**
 * Trial links: a code -> provider bundle, so a shared link can carry a working
 * key without the key ever appearing in the URL. The recipient's app fetches
 * /api/trial/:code, gets a provider (base URL, key, models) and adds it.
 *
 * Entries live in trials.json on the box (like .env, never in git). Shape:
 *   [{ "code": "demo", "name": "HarnessStation Demo",
 *      "kind": "openai-compatible", "baseUrl": "https://api.example.com/v1",
 *      "apiKey": "sk-...", "models": ["gpt-4o-mini"],
 *      "note": "rate-limited demo key", "expires": "2026-12-31" }]
 *
 * Read fresh per request so you can add or revoke a trial by editing the file —
 * no restart. It's a tiny file hit rarely, and the rate limiter caps abuse.
 */
const TRIALS_FILE = process.env.TRIALS_FILE
  ? new URL(process.env.TRIALS_FILE, `file://${process.cwd()}/`)
  : new URL("./trials.json", import.meta.url);

function loadTrials() {
  try {
    const rows = JSON.parse(fs.readFileSync(TRIALS_FILE, "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return []; // no file / bad JSON -> no trials, which is a valid state
  }
}

app.get("/api/trial/:code", (req, res) => {
  const code = String(req.params.code ?? "").toLowerCase();
  const entry = loadTrials().find((t) => String(t.code ?? "").toLowerCase() === code);
  if (!entry) return res.status(404).json({ error: "unknown trial code" });
  if (entry.expires && Date.now() > Date.parse(entry.expires)) {
    return res.status(410).json({ error: "trial expired" });
  }
  // Hand back only what the client needs to build a provider — never the code
  // or the expiry bookkeeping.
  res.json({
    id: entry.id ?? `trial-${code}`,
    name: entry.name ?? "Trial provider",
    kind: entry.kind ?? "openai-compatible",
    baseUrl: entry.baseUrl,
    apiKey: entry.apiKey ?? "",
    models: Array.isArray(entry.models) ? entry.models : [],
    note: entry.note ?? "",
  });
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

/**
 * Community library: a public marketplace for user-made Skills, Agents,
 * Workflows and Schedules. No accounts — publishing is anonymous with a chosen
 * author name, and a "like" is keyed to a hashed IP so one visitor counts once.
 *
 * Persisted to library.json on the box (like .env, kept out of git). Held in
 * memory and written back debounced, since traffic is low and each item is small.
 */
const LIBRARY_FILE = process.env.LIBRARY_FILE
  ? new URL(process.env.LIBRARY_FILE, `file://${process.cwd()}/`)
  : new URL("./library.json", import.meta.url);
// Salt so stored like/report keys aren't reversible to raw IPs. MUST be set to a
// private value in production; the default is only for local dev.
const LIBRARY_SALT = process.env.LIBRARY_SALT ?? "hs-library-dev-only";
if (!process.env.LIBRARY_SALT) {
  console.warn("[gateway] LIBRARY_SALT is not set — using the dev default. Set a private value in production.");
}
// Bearer token for the admin moderation routes. If unset, those routes are off.
const LIBRARY_ADMIN_TOKEN = process.env.LIBRARY_ADMIN_TOKEN ?? "";
// Publishes allowed per IP per hour, and reports that auto-hide an item pending review.
const PUBLISH_LIMIT = Number(process.env.LIBRARY_PUBLISH_LIMIT ?? 10);
const REPORT_THRESHOLD = Number(process.env.LIBRARY_REPORT_THRESHOLD ?? 4);
const KINDS = new Set(["skill", "agent", "workflow", "schedule", "template"]);

// ---------- cloud sync (opt-in, zero-knowledge accounts) ----------
// Accounts exist only to back up an encrypted blob of a user's own data. The
// server NEVER sees plaintext or the encryption key — it stores a password
// *verifier* hash and ciphertext, nothing more. Disabled unless SYNC_PEPPER is set.
const USERS_FILE = process.env.USERS_FILE ? path.resolve(process.env.USERS_FILE) : path.join(HERE, "users.json");
const SYNC_DIR = process.env.SYNC_DIR ? path.resolve(process.env.SYNC_DIR) : path.join(HERE, "sync");
const SYNC_PEPPER = process.env.SYNC_PEPPER ?? "";
const TOKEN_TTL = Number(process.env.SYNC_TOKEN_DAYS ?? 60) * 86_400_000;
const cloudReady = () => !!SYNC_PEPPER;
if (!cloudReady()) console.warn("[gateway] SYNC_PEPPER not set — cloud sync accounts are disabled.");
try {
  fs.mkdirSync(SYNC_DIR, { recursive: true });
} catch { /* dir exists / not writable — handled per request */ }

let users = [];
try {
  const rows = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  if (Array.isArray(rows)) users = rows;
} catch { /* no file yet */ }
let usersTimer = null;
function persistUsers() {
  clearTimeout(usersTimer);
  usersTimer = setTimeout(() => {
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(users));
    } catch (e) {
      console.warn(`[gateway] could not write users.json: ${e}`);
    }
  }, 500);
  usersTimer.unref?.();
}

const blobPath = (email) =>
  path.join(SYNC_DIR, `${crypto.createHash("sha256").update(email).digest("hex")}.blob`);
const newToken = () => crypto.randomBytes(32).toString("hex");
// scrypt(verifier, per-user-salt + server pepper) — the pepper means a stolen
// users.json alone can't be attacked offline without the server's secret too.
const hashVerifier = (verifier, vsalt) =>
  crypto.scryptSync(verifier, vsalt + SYNC_PEPPER, 32).toString("hex");
function verifierOk(u, verifier) {
  const a = Buffer.from(hashVerifier(verifier, u.vsalt), "hex");
  const b = Buffer.from(u.vhash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
/** The user for a Bearer token, or null. */
function sessionUser(req) {
  const auth = req.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const tok = auth.slice(7);
  const u = users.find((x) => x.token && x.token === tok);
  if (!u || (u.tokenExp && Date.now() > u.tokenExp)) return null;
  return u;
}
// A stricter per-IP throttle for auth, to slow password guessing.
const authHits = new Map();
function authAllowed(ip) {
  const now = Date.now();
  const r = authHits.get(ip);
  if (!r || now > r.resetAt) {
    authHits.set(ip, { n: 1, resetAt: now + 600_000 });
    return true;
  }
  if (r.n >= 25) return false;
  r.n += 1;
  return true;
}

let library = [];
try {
  const rows = JSON.parse(fs.readFileSync(LIBRARY_FILE, "utf8"));
  if (Array.isArray(rows)) library = rows;
} catch {
  /* no file yet — start empty */
}

let saveTimer = null;
function persistLibrary() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(LIBRARY_FILE, JSON.stringify(library));
    } catch (e) {
      console.warn(`[gateway] could not write library.json: ${e}`);
    }
  }, 500);
  saveTimer.unref?.();
}

function ipKey(req) {
  return crypto.createHash("sha256").update(`${LIBRARY_SALT}:${req.ip ?? ""}`).digest("hex").slice(0, 16);
}

/** Public shape of an item (no payload, no raw like-keys). */
function publicItem(item, requester) {
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    description: item.description,
    author: item.author,
    tags: item.tags,
    createdAt: item.createdAt,
    downloads: item.downloads,
    likes: item.likes,
    liked: requester ? !!item.likedBy[requester] : false,
    // Only present on templates; JSON drops it as undefined for other kinds.
    subtype: item.subtype,
  };
}

/** Trending favours things that are both liked and recent. */
function trendingScore(item, now) {
  const ageDays = (now - item.createdAt) / 86_400_000;
  return (item.likes * 3 + item.downloads) * Math.exp(-ageDays / 14);
}

/** Strip control characters (keeps newlines) so listings can't inject junk. */
function clean(s) {
  // eslint-disable-next-line no-control-regex
  return String(s ?? "").replace(/[ --]/g, "").trim();
}

/** A visible item is one an ordinary visitor may see (not hidden by moderation). */
const visible = (i) => !i.hidden;

/** Non-skill payloads must be a JSON object; skills are free-form markdown. */
function payloadValid(type, payload) {
  if (type === "skill") return true;
  let v;
  try {
    v = JSON.parse(payload);
  } catch {
    return false;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  // Templates carry a subtype that decides their shape: "ui" is a code snippet,
  // "setup" is a starter-kit (instructions / tools / a bundled agent or workflow).
  if (type === "template") {
    if (v.subtype === "ui") return typeof v.code === "string" && v.code.trim().length > 0;
    if (v.subtype === "setup") {
      return (
        (typeof v.instructions === "string" && v.instructions.trim().length > 0) ||
        (!!v.agent && typeof v.agent === "object") ||
        (!!v.workflow && typeof v.workflow === "object") ||
        (Array.isArray(v.toolIds) && v.toolIds.length > 0)
      );
    }
    return false; // unknown/absent subtype
  }
  return true;
}

/** Bearer-token gate for moderation routes. Off entirely when no token is set. */
function isAdmin(req) {
  return !!LIBRARY_ADMIN_TOKEN && req.get("authorization") === `Bearer ${LIBRARY_ADMIN_TOKEN}`;
}

// Per-IP publish throttle, on top of the global rate limiter.
const publishHits = new Map(); // ipHash -> { n, resetAt }
function publishAllowed(key) {
  const now = Date.now();
  const rec = publishHits.get(key);
  if (!rec || now > rec.resetAt) {
    publishHits.set(key, { n: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (rec.n >= PUBLISH_LIMIT) return false;
  rec.n += 1;
  return true;
}

app.get("/api/library", (req, res) => {
  const requester = ipKey(req);
  const type = String(req.query.type ?? "all");
  const tag = String(req.query.tag ?? "").toLowerCase();
  const q = String(req.query.q ?? "").toLowerCase().trim();
  const sort = String(req.query.sort ?? "trending");
  const limit = Math.min(Number(req.query.limit) || 60, 100);
  const now = Date.now();

  let items = library.filter((i) => visible(i) && (type === "all" || i.type === type));
  if (tag) items = items.filter((i) => (i.tags ?? []).some((t) => t.toLowerCase() === tag));
  if (q) {
    items = items.filter((i) =>
      `${i.name} ${i.description} ${i.author} ${(i.tags ?? []).join(" ")}`.toLowerCase().includes(q),
    );
  }
  const by = {
    newest: (a, b) => b.createdAt - a.createdAt,
    downloaded: (a, b) => b.downloads - a.downloads || b.likes - a.likes,
    recommended: (a, b) => b.likes - a.likes || b.downloads - a.downloads,
    trending: (a, b) => trendingScore(b, now) - trendingScore(a, now),
  };
  items = items.slice().sort(by[sort] ?? by.trending).slice(0, limit);

  // A small tag cloud so the client can offer filters without a second request.
  const tagCount = {};
  for (const i of library) if (visible(i)) for (const t of i.tags ?? []) tagCount[t] = (tagCount[t] ?? 0) + 1;
  const tags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([t]) => t);

  res.json({ items: items.map((i) => publicItem(i, requester)), total: library.filter(visible).length, tags });
});

app.get("/api/library/:id", (req, res) => {
  const item = library.find((i) => i.id === req.params.id);
  if (!item || !visible(item)) return res.status(404).json({ error: "not found" });
  res.json({ ...publicItem(item, ipKey(req)), payload: item.payload });
});

app.post("/api/library/publish", (req, res) => {
  const b = req.body ?? {};
  const type = String(b.type ?? "");
  const name = clean(b.name);
  const description = clean(b.description);
  const author = (clean(b.author) || "Anonymous").slice(0, 40);
  const payload = String(b.payload ?? "");
  const tags = Array.isArray(b.tags)
    ? [...new Set(b.tags.map((t) => clean(t).toLowerCase()).filter(Boolean))].slice(0, 8)
    : [];
  if (!KINDS.has(type)) return res.status(400).json({ error: "bad type" });
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "name must be 2–80 chars" });
  if (description.length > 600) return res.status(400).json({ error: "description too long" });
  if (!payload || payload.length > 280_000) return res.status(400).json({ error: "payload missing or too large" });
  if (!payloadValid(type, payload)) return res.status(400).json({ error: `payload is not a valid ${type}` });
  const subtype =
    type === "template" ? (b.subtype === "ui" ? "ui" : b.subtype === "setup" ? "setup" : "") : undefined;
  if (type === "template" && !subtype) {
    return res.status(400).json({ error: "a template needs subtype 'setup' or 'ui'" });
  }
  if (!publishAllowed(ipKey(req))) {
    return res.status(429).json({ error: `publish limit reached (${PUBLISH_LIMIT}/hour) — try again later` });
  }

  const item = {
    id: crypto.randomUUID(),
    type, name, description, author, tags, payload, subtype,
    createdAt: Date.now(),
    downloads: 0,
    likes: 0,
    likedBy: {},
    reports: {}, // ipHash -> reason
    hidden: false,
  };
  library.push(item);
  persistLibrary();
  res.json(publicItem(item, ipKey(req)));
});

app.post("/api/library/:id/like", (req, res) => {
  const item = library.find((i) => i.id === req.params.id);
  if (!item || !visible(item)) return res.status(404).json({ error: "not found" });
  const key = ipKey(req);
  if (item.likedBy[key]) {
    delete item.likedBy[key];
    item.likes = Math.max(0, item.likes - 1);
  } else {
    item.likedBy[key] = 1;
    item.likes += 1;
  }
  persistLibrary();
  res.json({ likes: item.likes, liked: !!item.likedBy[key] });
});

app.post("/api/library/:id/download", (req, res) => {
  const item = library.find((i) => i.id === req.params.id);
  if (!item || !visible(item)) return res.status(404).json({ error: "not found" });
  item.downloads += 1;
  persistLibrary();
  res.json({ payload: item.payload, downloads: item.downloads });
});

/** Anyone can report an item; enough distinct reports auto-hides it for review. */
app.post("/api/library/:id/report", (req, res) => {
  const item = library.find((i) => i.id === req.params.id);
  if (!item || !visible(item)) return res.status(404).json({ error: "not found" });
  const key = ipKey(req);
  item.reports ??= {};
  if (!item.reports[key]) item.reports[key] = clean(req.body?.reason).slice(0, 200) || "unspecified";
  if (Object.keys(item.reports).length >= REPORT_THRESHOLD) item.hidden = true; // pending admin review
  persistLibrary();
  res.json({ reported: true });
});

// ---------- admin moderation (Bearer LIBRARY_ADMIN_TOKEN) ----------

/** Full listing incl. hidden items and report reasons, for a moderator. */
app.get("/api/admin/library", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "forbidden" });
  res.json(
    library
      .map((i) => ({
        id: i.id,
        type: i.type,
        name: i.name,
        author: i.author,
        createdAt: i.createdAt,
        downloads: i.downloads,
        likes: i.likes,
        hidden: !!i.hidden,
        reportCount: Object.keys(i.reports ?? {}).length,
        reasons: Object.values(i.reports ?? {}),
      }))
      .sort((a, b) => b.reportCount - a.reportCount || b.createdAt - a.createdAt),
  );
});

/** Hide, restore, or permanently remove an item. body: { action: "hide"|"restore"|"remove" }. */
app.post("/api/admin/library/:id", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "forbidden" });
  const idx = library.findIndex((i) => i.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "not found" });
  const action = String(req.body?.action ?? "hide");
  if (action === "remove") library.splice(idx, 1);
  else if (action === "restore") { library[idx].hidden = false; library[idx].reports = {}; }
  else library[idx].hidden = true;
  persistLibrary();
  res.json({ ok: true, action });
});

// ---------- cloud sync routes ----------

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

app.post("/api/account/signup", (req, res) => {
  if (!cloudReady()) return res.status(503).json({ error: "cloud sync isn't enabled on this server" });
  if (!authAllowed(req.ip)) return res.status(429).json({ error: "too many attempts, try again later" });
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const verifier = String(req.body?.authVerifier ?? "");
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "enter a valid email" });
  if (verifier.length < 32) return res.status(400).json({ error: "bad verifier" });
  if (users.some((u) => u.email === email)) return res.status(409).json({ error: "an account with that email already exists" });
  const vsalt = crypto.randomBytes(16).toString("hex");
  const token = newToken();
  users.push({ email, vsalt, vhash: hashVerifier(verifier, vsalt), token, tokenExp: Date.now() + TOKEN_TTL, updatedAt: 0, version: 0 });
  persistUsers();
  res.json({ token });
});

app.post("/api/account/login", (req, res) => {
  if (!cloudReady()) return res.status(503).json({ error: "cloud sync isn't enabled on this server" });
  if (!authAllowed(req.ip)) return res.status(429).json({ error: "too many attempts, try again later" });
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const verifier = String(req.body?.authVerifier ?? "");
  const u = users.find((x) => x.email === email);
  if (!u || !verifierOk(u, verifier)) return res.status(401).json({ error: "wrong email or password" });
  u.token = newToken();
  u.tokenExp = Date.now() + TOKEN_TTL;
  persistUsers();
  res.json({ token: u.token, hasBlob: u.updatedAt > 0, updatedAt: u.updatedAt });
});

app.post("/api/account/logout", (req, res) => {
  const u = sessionUser(req);
  if (u) {
    u.token = undefined;
    u.tokenExp = 0;
    persistUsers();
  }
  res.json({ ok: true });
});

app.get("/api/sync", (req, res) => {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: "unauthorized" });
  if (!u.updatedAt) return res.sendStatus(204);
  let blob;
  try {
    blob = fs.readFileSync(blobPath(u.email), "utf8");
  } catch {
    return res.sendStatus(204);
  }
  res.json({ blob, updatedAt: u.updatedAt, version: u.version });
});

app.put("/api/sync", express.json({ limit: "25mb" }), (req, res) => {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: "unauthorized" });
  const blob = String(req.body?.blob ?? "");
  if (!blob || blob.length > 30_000_000) return res.status(400).json({ error: "blob missing or too large" });
  try {
    fs.mkdirSync(SYNC_DIR, { recursive: true }); // self-heal if the dir is missing
    fs.writeFileSync(blobPath(u.email), blob);
  } catch (e) {
    return res.status(500).json({ error: `could not store blob: ${e}` });
  }
  u.updatedAt = Date.now();
  u.version = (u.version ?? 0) + 1;
  persistUsers();
  res.json({ updatedAt: u.updatedAt, version: u.version });
});

app.delete("/api/account", (req, res) => {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: "unauthorized" });
  try {
    fs.unlinkSync(blobPath(u.email));
  } catch { /* no blob */ }
  users = users.filter((x) => x !== u);
  persistUsers();
  res.json({ ok: true });
});

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
  res.json({
    ok: true,
    refreshMinutes: REFRESH_MS / 60_000,
    feeds,
    trials: loadTrials().length,
    library: library.filter((i) => !i.hidden).length,
    hidden: library.filter((i) => i.hidden).length,
    moderation: LIBRARY_ADMIN_TOKEN ? "on" : "off",
    cloud: cloudReady() ? "on" : "off",
    accounts: users.length,
  });
});

// ---------- boot ----------

if (!AA_API_KEY) {
  console.warn("[gateway] AA_API_KEY is not set — /api/benchmarks will return 503.");
}
loadDirectory();
startRefreshLoop();
// Bind to loopback by default: in production the gateway sits behind a reverse
// proxy, and there's no reason for the Node process itself to be reachable from
// the network. Set HOST=0.0.0.0 to expose it directly (e.g. local development
// against another machine).
const HOST = process.env.HOST ?? "127.0.0.1";
app.listen(PORT, HOST, () =>
  console.log(`[gateway] listening on ${HOST}:${PORT} (refresh every ${REFRESH_MS / 60_000}m)`),
);
