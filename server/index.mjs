/**
 * HarnessStation gateway server.
 *
 * Holds keys for GENERAL third-party APIs (benchmarks, Hugging Face) so they are
 * never shipped inside the app. User AI-provider keys (OpenAI/Anthropic/...) are
 * intentionally NOT handled here — those stay on the user's machine.
 *
 * Run:  AA_API_KEY=... node index.mjs   (or set env vars in your host)
 * Then set the server URL in HarnessStation Settings, e.g. http://localhost:8787
 */
import express from "express";
import fs from "node:fs";

const app = express();
const PORT = process.env.PORT ?? 8787;
const AA_API_KEY = process.env.AA_API_KEY ?? "";

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  next();
});

const cache = new Map(); // url -> { at, data }
async function cached(url, headers = {}, ttlMs = 6 * 60 * 60 * 1000) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const res = await fetch(url, { headers: { "User-Agent": "HarnessStation-Server", ...headers } });
  if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
  const data = await res.json();
  cache.set(url, { at: Date.now(), data });
  return data;
}

app.get("/api/benchmarks", async (_req, res) => {
  try {
    if (!AA_API_KEY) return res.status(500).json({ error: "AA_API_KEY not set on server" });
    const data = await cached("https://artificialanalysis.ai/api/v2/data/llms/models", {
      "x-api-key": AA_API_KEY,
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get("/api/hf/search", async (req, res) => {
  try {
    const q = encodeURIComponent(req.query.q ?? "");
    const data = await cached(
      `https://huggingface.co/api/models?search=${q}&filter=gguf&sort=downloads&direction=-1&limit=25`,
      {},
      30 * 60 * 1000,
    );
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get("/api/hf/files", async (req, res) => {
  try {
    const repo = String(req.query.repo ?? "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return res.status(400).json({ error: "bad repo" });
    const data = await cached(`https://huggingface.co/api/models/${repo}/tree/main`, {}, 30 * 60 * 1000);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.get("/api/mcp/directory", (_req, res) => {
  // Edit mcp-directory.json to curate the list served to apps.
  try {
    res.json(JSON.parse(fs.readFileSync(new URL("./mcp-directory.json", import.meta.url), "utf8")));
  } catch {
    res.json([]);
  }
});

app.listen(PORT, () => console.log(`HarnessStation gateway listening on :${PORT}`));
