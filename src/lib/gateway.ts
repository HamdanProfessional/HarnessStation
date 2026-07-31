/**
 * API gateway: all "general" third-party APIs (benchmarks, Hugging Face search,
 * MCP directory) go through here. If Settings has a server URL, calls are proxied
 * through that self-hosted server (which holds the general API keys); otherwise
 * they fall back to calling the services directly from the app.
 *
 * User AI-provider keys (OpenAI/Anthropic/etc.) intentionally do NOT go through
 * the gateway — they stay local and are sent only to their own provider.
 */
import { fetch } from "@tauri-apps/plugin-http";
import { useStore } from "./store";

function serverUrl(): string | null {
  const url = useStore.getState().settings.serverUrl?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": "HarnessStation", ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

// ---------- model benchmarks (Artificial Analysis) ----------

export interface BenchmarkModel {
  name: string;
  creator: string;
  intelligence: number | null;
  speed: number | null; // output tokens/s
  priceIn: number | null; // USD per 1M input tokens
  priceOut: number | null;
}

export async function fetchBenchmarks(): Promise<BenchmarkModel[]> {
  const server = serverUrl();
  let data: unknown;
  if (server) {
    data = await getJson(`${server}/api/benchmarks`);
  } else {
    const key = useStore.getState().settings.aaApiKey?.trim();
    if (!key) {
      throw new Error(
        "No Artificial Analysis API key. Add one in Settings (free at artificialanalysis.ai/api) or configure a server URL.",
      );
    }
    data = await getJson("https://artificialanalysis.ai/api/v2/data/llms/models", {
      "x-api-key": key,
    });
  }
  const rows = (data as { data?: unknown[] }).data ?? (Array.isArray(data) ? data : []);
  return (rows as Record<string, unknown>[]).map((m) => {
    const evals = (m.evaluations ?? {}) as Record<string, unknown>;
    const pricing = (m.pricing ?? {}) as Record<string, unknown>;
    return {
      name: String(m.name ?? m.model_name ?? m.slug ?? "unknown"),
      creator: String(
        (m.model_creator as Record<string, unknown> | undefined)?.name ?? m.creator ?? "",
      ),
      intelligence: num(evals.artificial_analysis_intelligence_index ?? m.intelligence_index),
      speed: num(m.median_output_tokens_per_second ?? m.output_speed),
      priceIn: num(pricing.price_1m_input_tokens ?? m.price_input),
      priceOut: num(pricing.price_1m_output_tokens ?? m.price_output),
    };
  });
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------- Hugging Face ----------

export interface HfRepo {
  id: string; // "bartowski/Llama-3.2-3B-Instruct-GGUF"
  downloads: number;
  likes: number;
}

export interface HfFile {
  path: string;
  sizeMB: number;
}

export async function hfSearch(query: string): Promise<HfRepo[]> {
  const server = serverUrl();
  const url = server
    ? `${server}/api/hf/search?q=${encodeURIComponent(query)}`
    : `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=gguf&sort=downloads&direction=-1&limit=25`;
  const data = (await getJson(url)) as Record<string, unknown>[];
  return data.map((m) => ({
    id: String(m.id ?? m.modelId),
    downloads: Number(m.downloads ?? 0),
    likes: Number(m.likes ?? 0),
  }));
}

export async function hfFiles(repoId: string): Promise<HfFile[]> {
  const server = serverUrl();
  const url = server
    ? `${server}/api/hf/files?repo=${encodeURIComponent(repoId)}`
    : `https://huggingface.co/api/models/${repoId}/tree/main`;
  const data = (await getJson(url)) as { path: string; size?: number }[];
  return data
    .filter((f) => f.path.toLowerCase().endsWith(".gguf"))
    .map((f) => ({ path: f.path, sizeMB: Math.round((f.size ?? 0) / (1024 * 1024)) }))
    .sort((a, b) => a.sizeMB - b.sizeMB);
}

export function hfDownloadUrl(repoId: string, path: string): string {
  return `https://huggingface.co/${repoId}/resolve/main/${path}`;
}

// ---------- MCP directory ----------

export interface McpDirEntry {
  name: string;
  description: string;
  category: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  needsAuth?: boolean;
}

const npx = (pkg: string, extra: string[] = []): { transport: "stdio"; command: string; args: string[] } => ({
  transport: "stdio",
  command: "npx",
  args: ["-y", pkg, ...extra],
});

/** Curated directory (mcpservers.org style). The gateway server can override this list. */
export const MCP_DIRECTORY_FALLBACK: McpDirEntry[] = [
  // ---- Reference (official) ----
  { name: "Filesystem", category: "Reference", description: "Read/write files in allowed directories.", ...npx("@modelcontextprotocol/server-filesystem", ["C:\\Users"]) },
  { name: "Fetch", category: "Reference", description: "Fetch web pages and convert to markdown.", ...npx("@modelcontextprotocol/server-fetch") },
  { name: "Memory", category: "Reference", description: "Knowledge-graph memory the model can read/write.", ...npx("@modelcontextprotocol/server-memory") },
  { name: "Sequential Thinking", category: "Reference", description: "Structured step-by-step reasoning tool.", ...npx("@modelcontextprotocol/server-sequential-thinking") },
  { name: "Everything", category: "Reference", description: "Reference server exercising all MCP features (prompts, tools, resources).", ...npx("@modelcontextprotocol/server-everything") },
  { name: "Time", category: "Reference", description: "Time and timezone conversion utilities.", ...npx("@modelcontextprotocol/server-time") },

  // ---- Dev & code ----
  { name: "Git", category: "Dev", description: "Read, search, and manipulate local Git repositories.", ...npx("@modelcontextprotocol/server-git") },
  { name: "GitHub", category: "Dev", description: "GitHub official remote MCP — repos, issues, PRs, code search.", transport: "http", url: "https://api.githubcopilot.com/mcp/", needsAuth: true },
  { name: "GitLab", category: "Dev", description: "Manage GitLab projects, MRs, and issues.", ...npx("@modelcontextprotocol/server-gitlab"), needsAuth: true },
  { name: "Sentry", category: "Dev", description: "Retrieve and analyze Sentry error reports.", transport: "http", url: "https://mcp.sentry.dev/mcp", needsAuth: true },
  { name: "Playwright", category: "Dev", description: "Browser automation and testing with Playwright.", ...npx("@playwright/mcp") },
  { name: "Puppeteer", category: "Dev", description: "Headless-Chrome browser automation.", ...npx("@modelcontextprotocol/server-puppeteer") },
  { name: "E2B", category: "Dev", description: "Run code in a secure cloud sandbox.", ...npx("@e2b/mcp-server"), needsAuth: true },
  { name: "Context7", category: "Dev", description: "Up-to-date library and framework documentation.", transport: "http", url: "https://mcp.context7.com/mcp" },

  // ---- Search & web ----
  { name: "Brave Search", category: "Search", description: "Web and local search via the Brave Search API.", ...npx("@modelcontextprotocol/server-brave-search"), needsAuth: true },
  { name: "Tavily", category: "Search", description: "AI-optimized web search and extraction.", ...npx("tavily-mcp"), needsAuth: true },
  { name: "Exa", category: "Search", description: "Neural web search built for AI agents.", ...npx("exa-mcp-server"), needsAuth: true },
  { name: "Perplexity", category: "Search", description: "Ask Perplexity's Sonar models for cited answers.", ...npx("server-perplexity-ask"), needsAuth: true },
  { name: "Firecrawl", category: "Search", description: "Scrape, crawl, and extract structured data from websites.", ...npx("firecrawl-mcp"), needsAuth: true },
  { name: "Hugging Face", category: "Search", description: "Search HF models, datasets, and Spaces.", transport: "http", url: "https://huggingface.co/mcp" },

  // ---- Data & knowledge ----
  { name: "PostgreSQL", category: "Data", description: "Query PostgreSQL databases (read-only schema inspection).", ...npx("@modelcontextprotocol/server-postgres", ["postgresql://localhost/mydb"]) },
  { name: "SQLite", category: "Data", description: "Query and explore a local SQLite database.", ...npx("mcp-server-sqlite-npx", ["./data.db"]) },
  { name: "Redis", category: "Data", description: "Interact with a Redis key-value store.", ...npx("@modelcontextprotocol/server-redis") },
  { name: "Chroma", category: "Data", description: "Vector database for embeddings and retrieval.", ...npx("chroma-mcp") },
  { name: "Notion", category: "Data", description: "Read and update Notion pages and databases.", transport: "http", url: "https://mcp.notion.com/mcp", needsAuth: true },
  { name: "Airtable", category: "Data", description: "Read/write Airtable bases and records.", ...npx("airtable-mcp-server"), needsAuth: true },
  { name: "Google Drive", category: "Data", description: "Search and read files in Google Drive.", ...npx("@modelcontextprotocol/server-gdrive"), needsAuth: true },

  // ---- Productivity & business ----
  { name: "Slack", category: "Productivity", description: "Read and post to Slack channels.", ...npx("@modelcontextprotocol/server-slack"), needsAuth: true },
  { name: "Linear", category: "Productivity", description: "Manage Linear issues, projects, and cycles.", transport: "http", url: "https://mcp.linear.app/mcp", needsAuth: true },
  { name: "Atlassian", category: "Productivity", description: "Jira and Confluence — issues, pages, search.", transport: "http", url: "https://mcp.atlassian.com/v1/sse", needsAuth: true },
  { name: "Stripe", category: "Productivity", description: "Query Stripe payments, customers, and invoices.", transport: "http", url: "https://mcp.stripe.com", needsAuth: true },
  { name: "Google Maps", category: "Productivity", description: "Geocoding, directions, and place search.", ...npx("@modelcontextprotocol/server-google-maps"), needsAuth: true },
  { name: "Cloudflare", category: "Productivity", description: "Manage Cloudflare Workers, KV, R2, and D1.", transport: "http", url: "https://observability.mcp.cloudflare.com/sse", needsAuth: true },
];

export const MCP_CATEGORIES = ["Reference", "Dev", "Search", "Data", "Productivity"];

export async function mcpDirectory(): Promise<McpDirEntry[]> {
  const server = serverUrl();
  if (!server) return MCP_DIRECTORY_FALLBACK;
  try {
    return (await getJson(`${server}/api/mcp/directory`)) as McpDirEntry[];
  } catch {
    return MCP_DIRECTORY_FALLBACK;
  }
}
