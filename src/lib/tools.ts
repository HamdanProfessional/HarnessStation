import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import type { Tool, ToolSet } from "./types";

/** Ready-made tool sets shipped with the app (always available, non-deletable). */
export const BUILTIN_TOOLSETS: ToolSet[] = [
  {
    id: "builtin-research",
    name: "Research",
    toolIds: ["web_search", "fetch_page", "wikipedia", "http_request"],
  },
  {
    id: "builtin-coding",
    name: "Coding agent",
    toolIds: [
      "grep_files",
      "edit_file",
      "read_file",
      "write_file",
      "create_folder",
      "list_folder",
      "find_files",
      "run_terminal",
    ],
  },
  {
    id: "builtin-selfservice",
    name: "Self-service tooling",
    toolIds: ["find_tools", "enable_tool", "use_skill"],
  },
  {
    id: "builtin-swarm",
    name: "Swarm (multi-agent)",
    toolIds: ["swarm_spawn", "swarm_send", "swarm_status", "side_panel"],
  },
];

export interface FsEntry {
  name: string;
  isDirectory: boolean;
}

/** Filesystem + terminal helpers bound to a working directory `base` (empty = home). */
function makeFs(base: string) {
  return {
    read: (path: string) => invoke<string>("fs_read", { base, path }),
    write: (path: string, content: string) => invoke("fs_write", { base, path, content, append: false }),
    append: (path: string, content: string) => invoke("fs_write", { base, path, content, append: true }),
    mkdir: (path: string) => invoke("fs_mkdir", { base, path }),
    remove: (path: string) => invoke("fs_remove", { base, path }),
    exists: (path: string) => invoke<boolean>("fs_exists", { base, path }),
    list: async (path: string): Promise<FsEntry[]> => {
      const rows = await invoke<{ name: string; dir: boolean }[]>("fs_list", { base, path });
      return rows.map((r) => ({ name: r.name, isDirectory: r.dir }));
    },
  };
}

async function runTerminal(base: string, command: string): Promise<string> {
  const res = await invoke<{ stdout: string; stderr: string; code: number }>("run_command", {
    command,
    cwd: base,
  });
  const parts: string[] = [];
  if (res.stdout.trim()) parts.push(res.stdout.trimEnd());
  if (res.stderr.trim()) parts.push(`[stderr]\n${res.stderr.trimEnd()}`);
  if (!res.stdout.trim() && !res.stderr.trim()) {
    parts.push(res.code === 0 ? "(command succeeded with no output)" : "(no output)");
  }
  parts.push(`[exit code ${res.code}]`);
  return parts.join("\n");
}

/** Built-in system tools. Their code is visible/copyable in the Tools tab. */
export const BUILTIN_TOOLS: Tool[] = [
  {
    id: "get_current_time",
    name: "get_current_time",
    description: "Returns the current local date and time.",
    parameters: { type: "object", properties: {}, required: [] },
    code: `return new Date().toString();`,
    builtin: true,
  },
  {
    id: "calculate",
    name: "calculate",
    description: "Evaluates a JavaScript arithmetic expression, e.g. (17*34)/2 or Math.sqrt(2).",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "The expression to evaluate" },
      },
      required: ["expression"],
    },
    code: `return String(Function('"use strict"; return (' + args.expression + ')')());`,
    builtin: true,
  },
  {
    id: "http_get",
    name: "http_get",
    description: "Fetches a URL with HTTP GET and returns the response body text (truncated to 6000 chars).",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
      },
      required: ["url"],
    },
    code: `const res = await ctx.fetch(args.url);
const text = await res.text();
return text.slice(0, 6000);`,
    builtin: true,
  },
  {
    id: "create_folder",
    name: "create_folder",
    description:
      "Creates a folder (and any missing parents). Path is relative to the user's home folder, e.g. Desktop/notes.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Folder path relative to home" } },
      required: ["path"],
    },
    code: `await ctx.fs.mkdir(args.path);
return "Created folder " + args.path;`,
    builtin: true,
  },
  {
    id: "write_file",
    name: "write_file",
    description:
      "Writes text content to a file (creates or overwrites; set append=true to append). Path is relative to the user's home folder.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to home, e.g. Desktop/todo.txt" },
        content: { type: "string", description: "Text content to write" },
        append: { type: "boolean", description: "Append instead of overwrite (default false)" },
      },
      required: ["path", "content"],
    },
    code: `if (args.append) { await ctx.fs.append(args.path, args.content); }
else { await ctx.fs.write(args.path, args.content); }
return "Wrote " + args.content.length + " chars to " + args.path;`,
    builtin: true,
  },
  {
    id: "read_file",
    name: "read_file",
    description:
      "Reads a text file and returns its content (truncated to 8000 chars). Path is relative to the user's home folder.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "File path relative to home" } },
      required: ["path"],
    },
    code: `const text = await ctx.fs.read(args.path);
return text.length > 8000 ? text.slice(0, 8000) + "\\n...[truncated]" : text;`,
    builtin: true,
  },
  {
    id: "delete_path",
    name: "delete_path",
    description:
      "Deletes a file or folder (recursively). Path is relative to the user's home folder. Use with care.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "File or folder path relative to home" } },
      required: ["path"],
    },
    code: `if (!(await ctx.fs.exists(args.path))) return "Not found: " + args.path;
await ctx.fs.remove(args.path);
return "Deleted " + args.path;`,
    builtin: true,
  },
  {
    id: "list_folder",
    name: "list_folder",
    description:
      "Lists the files and subfolders in a folder. Path is relative to the user's home folder ('' or '.' = home itself).",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Folder path relative to home" } },
      required: ["path"],
    },
    code: `const path = !args.path || args.path === "." ? "" : args.path;
const entries = await ctx.fs.list(path || ".");
return entries
  .map((e) => (e.isDirectory ? "[dir] " : "[file] ") + e.name)
  .sort()
  .join("\\n") || "(empty folder)";`,
    builtin: true,
  },
  {
    id: "run_terminal",
    name: "run_terminal",
    description:
      "Runs a PowerShell command in the chat's working directory and returns its output (stdout, stderr, exit code). Write the PowerShell command directly, e.g. 'Get-ChildItem Desktop' or 'python script.py' — do NOT wrap it in another 'powershell -command \"...\"'. Pipes and quotes work normally. 60s timeout.",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "The PowerShell command to run" } },
      required: ["command"],
    },
    code: `return await ctx.term(args.command);`,
    builtin: true,
  },
  {
    id: "find_files",
    name: "find_files",
    description:
      "Recursively searches a folder for files/folders whose name contains the given text (case-insensitive). Returns up to 100 matches. Folder path is relative to the user's home folder.",
    parameters: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Folder to search in, relative to home" },
        query: { type: "string", description: "Name text to match" },
      },
      required: ["folder", "query"],
    },
    code: `const matches = [];
const q = args.query.toLowerCase();
async function walk(dir, depth) {
  if (depth > 6 || matches.length >= 100) return;
  let entries;
  try { entries = await ctx.fs.list(dir); } catch { return; }
  for (const e of entries) {
    if (matches.length >= 100) return;
    const full = dir + "/" + e.name;
    if (e.name.toLowerCase().includes(q)) matches.push((e.isDirectory ? "[dir] " : "[file] ") + full);
    if (e.isDirectory && !e.name.startsWith(".") && e.name !== "node_modules") await walk(full, depth + 1);
  }
}
await walk(args.folder, 0);
return matches.length ? matches.join("\\n") : "No matches for '" + args.query + "' in " + args.folder;`,
    builtin: true,
  },
  {
    id: "web_search",
    name: "web_search",
    description:
      "Searches the web and returns the top results (title, URL, snippet). Use for current events, facts, docs, or anything beyond your training data. Free, no API key.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        count: { type: "integer", description: "Number of results (default 6)" },
      },
      required: ["query"],
    },
    code: `const res = await ctx.fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(args.query), { headers: { "User-Agent": "Mozilla/5.0" } });
const html = await res.text();
const out = [];
const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\\s\\S]*?)<\\/a>/g;
const sre = /class="result__snippet"[^>]*>([\\s\\S]*?)<\\/a>/g;
const snips = []; let s; while ((s = sre.exec(html))) snips.push(s[1].replace(/<[^>]+>/g, "").replace(/&amp;/g,"&").trim());
let m; const max = args.count || 6;
while ((m = re.exec(html)) && out.length < max) {
  let url = m[1]; const u = /uddg=([^&]+)/.exec(url); if (u) url = decodeURIComponent(u[1]);
  const title = m[2].replace(/<[^>]+>/g, "").replace(/&amp;/g,"&").trim();
  out.push((out.length+1) + ". " + title + "\\n   " + url + "\\n   " + (snips[out.length] || ""));
}
return out.length ? out.join("\\n\\n") : "No results found.";`,
    builtin: true,
  },
  {
    id: "fetch_page",
    name: "fetch_page",
    description:
      "Fetches a web page and returns its readable text with HTML/scripts stripped (truncated). Use to read an article or docs page found via web_search.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to read" },
        max: { type: "integer", description: "Max characters to return (default 8000)" },
      },
      required: ["url"],
    },
    code: `const res = await ctx.fetch(args.url, { headers: { "User-Agent": "Mozilla/5.0" } });
let html = await res.text();
html = html.replace(/<script[\\s\\S]*?<\\/script>/gi, " ").replace(/<style[\\s\\S]*?<\\/style>/gi, " ").replace(/<!--[\\s\\S]*?-->/g, " ");
const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\\s+/g, " ").trim();
return text.slice(0, args.max || 8000);`,
    builtin: true,
  },
  {
    id: "http_request",
    name: "http_request",
    description:
      "Makes an HTTP request with any method, headers, and body. Use to call REST APIs (returns status + response body). For plain page reading prefer fetch_page.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        method: { type: "string", description: "GET, POST, PUT, DELETE, ... (default GET)" },
        headers: { type: "object", description: "Request headers" },
        body: { type: "string", description: "Request body (string or JSON string)" },
      },
      required: ["url"],
    },
    code: `const opts = { method: args.method || "GET", headers: args.headers || {} };
if (args.body != null) opts.body = typeof args.body === "string" ? args.body : JSON.stringify(args.body);
const res = await ctx.fetch(args.url, opts);
const text = await res.text();
return "HTTP " + res.status + "\\n" + text.slice(0, 6000);`,
    builtin: true,
  },
  {
    id: "grep_files",
    name: "grep_files",
    description:
      "Searches file CONTENTS recursively for a regex pattern in the working directory and returns matching lines as file:line: text (up to 100). The code-search power tool.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex (or plain text) to search for" },
        folder: { type: "string", description: "Folder to search, relative to the working dir (default: whole dir)" },
      },
      required: ["pattern"],
    },
    code: `const matches = [];
let re; try { re = new RegExp(args.pattern, "i"); } catch { re = new RegExp(args.pattern.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&"), "i"); }
const exts = /\\.(txt|md|mdx|js|ts|tsx|jsx|py|json|html|css|scss|c|cpp|h|hpp|java|go|rs|rb|php|sh|ps1|yaml|yml|xml|toml|ini|csv|log|sql|vue|svelte)$/i;
async function walk(dir, depth) {
  if (depth > 6 || matches.length >= 100) return;
  let entries; try { entries = await ctx.fs.list(dir || "."); } catch { return; }
  for (const e of entries) {
    if (matches.length >= 100) return;
    const full = dir ? dir + "/" + e.name : e.name;
    if (e.isDirectory) { if (!e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "dist" && e.name !== "target") await walk(full, depth + 1); continue; }
    if (!exts.test(e.name)) continue;
    let content; try { content = await ctx.fs.read(full); } catch { continue; }
    const lines = content.split("\\n");
    for (let i = 0; i < lines.length; i++) { if (re.test(lines[i])) { matches.push(full + ":" + (i + 1) + ": " + lines[i].trim().slice(0, 200)); if (matches.length >= 100) break; } }
  }
}
await walk(args.folder || "", 0);
return matches.length ? matches.join("\\n") : "No matches for /" + args.pattern + "/";`,
    builtin: true,
  },
  {
    id: "edit_file",
    name: "edit_file",
    description:
      "Makes a precise edit to a text file by replacing an exact snippet. old_text must match exactly and be unique (or set all=true to replace every occurrence). Ideal for code changes. Path is relative to the working dir.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_text: { type: "string", description: "Exact text to find" },
        new_text: { type: "string", description: "Replacement text" },
        all: { type: "boolean", description: "Replace all occurrences (default false)" },
      },
      required: ["path", "old_text", "new_text"],
    },
    code: `const content = await ctx.fs.read(args.path);
const parts = content.split(args.old_text);
const count = parts.length - 1;
if (count === 0) return "Error: old_text not found in " + args.path;
if (count > 1 && !args.all) return "Error: old_text appears " + count + " times — make it unique or set all=true.";
const next = args.all ? parts.join(args.new_text) : content.replace(args.old_text, args.new_text);
await ctx.fs.write(args.path, next);
return "Edited " + args.path + " (" + count + " replacement" + (count > 1 ? "s" : "") + ")";`,
    builtin: true,
  },
  {
    id: "wikipedia",
    name: "wikipedia",
    description: "Looks up a topic on Wikipedia and returns a concise summary with a source link. Free, no key.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Topic to look up" } },
      required: ["query"],
    },
    code: `const s = await ctx.fetch("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srsearch=" + encodeURIComponent(args.query));
const sj = await s.json();
const top = sj.query && sj.query.search && sj.query.search[0];
if (!top) return "No Wikipedia article found for '" + args.query + "'.";
const r = await ctx.fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(top.title.replace(/ /g, "_")));
const j = await r.json();
return (j.title || top.title) + "\\n\\n" + (j.extract || "No summary.") + "\\n\\nSource: " + ((j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page) || "");`,
    builtin: true,
  },
  {
    id: "generate_image",
    name: "generate_image",
    description:
      "Generate an image from a text prompt using the configured image model. The image is shown to the user automatically. Return a rich, detailed prompt.",
    parameters: {
      type: "object",
      properties: { prompt: { type: "string", description: "Detailed description of the image to create." } },
      required: ["prompt"],
    },
    code: "",
    builtin: true,
    group: "Media",
  },
  {
    id: "generate_speech",
    name: "generate_speech",
    description:
      "Synthesize speech (text-to-speech) from text using the configured voice model. The audio is played for the user automatically.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "The text to speak." } },
      required: ["text"],
    },
    code: "",
    builtin: true,
    group: "Media",
  },
  {
    id: "generate_video",
    name: "generate_video",
    description:
      "Generate a short video from a text prompt using the configured video model. The video is shown to the user automatically.",
    parameters: {
      type: "object",
      properties: { prompt: { type: "string", description: "Detailed description of the video to create." } },
      required: ["prompt"],
    },
    code: "",
    builtin: true,
    group: "Media",
  },
  {
    id: "use_skill",
    name: "use_skill",
    description:
      "Load a skill's full instructions before doing the work it covers. Pass the skill id shown in the available-skills list.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "The skill id, e.g. deep-research" } },
      required: ["name"],
    },
    code: "",
    builtin: true,
    group: "Skills",
  },
  {
    id: "find_tools",
    name: "find_tools",
    description:
      "Search every tool this app can offer — switched-on tools, tools that are off, MCP servers that aren't connected, and MCP servers from the directory that aren't installed yet. Use it whenever you lack a capability you need, before telling the user you can't do something. Returns exact names plus whether each is on, off, not connected, or not installed.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What you need to do, e.g. 'send email', 'read a PDF', 'query postgres'.",
        },
      },
      required: ["query"],
    },
    code: "",
    builtin: true,
    group: "Tooling",
  },
  {
    id: "enable_tool",
    name: "enable_tool",
    description:
      "Switch on a capability you found with find_tools. Pass the exact tool name to enable a tool, 'server:<id>' to connect an MCP server the user already has, or 'install:<Name>' to add one from the directory. Credential-free tools turn on immediately; risky ones, and every directory install, ask the user first. After installing a server, call find_tools again to see the tools it brought in.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Exact tool name from find_tools, or server:<id>, or install:<Name>.",
        },
        reason: { type: "string", description: "One line on why you need it — shown to the user." },
      },
      required: ["name"],
    },
    code: "",
    builtin: true,
    group: "Tooling",
  },
  {
    id: "swarm_spawn",
    name: "swarm_spawn",
    description:
      "Spawn helper agents to work on independent subtasks at the same time, and wait for all of them. You become the coordinator. Use it when a job splits cleanly into parts that don't depend on each other; don't use it for steps that must happen in order.",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: { type: "string" },
          description: "One self-contained instruction per helper. Each must stand alone.",
        },
        agent: {
          type: "string",
          description: "Optional name of a configured agent to use for the helpers.",
        },
      },
      required: ["tasks"],
    },
    code: "",
    builtin: true,
    group: "Swarm",
  },
  {
    id: "swarm_send",
    name: "swarm_send",
    description:
      "Message another agent running right now. Use their name, or \"*\" to broadcast to all of them. Use this to hand off findings or warn others before you change something shared.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: 'Agent name, session id, or "*" for everyone.' },
        message: { type: "string" },
      },
      required: ["to", "message"],
    },
    code: "",
    builtin: true,
    group: "Swarm",
  },
  {
    id: "swarm_status",
    name: "swarm_status",
    description:
      "List the agents running alongside you and read any pending messages or notices that a file you read has since been modified.",
    parameters: { type: "object", properties: {} },
    code: "",
    builtin: true,
    group: "Swarm",
  },
  {
    id: "side_panel",
    name: "side_panel",
    description:
      "Show something to the user in the side panel next to the chat: a file (kept live as it changes), a diff, or markdown/mermaid you write. Use it for anything worth keeping on screen while you work — a plan, a diagram, the file you're editing.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Heading for the panel." },
        file: { type: "string", description: "Path to display live. Omit if passing content." },
        content: { type: "string", description: "Markdown (mermaid code fences render as diagrams)." },
        mode: {
          type: "string",
          enum: ["markdown", "code", "diff"],
          description: "How to render it. Defaults to markdown, or code when a file is given.",
        },
        clear: { type: "boolean", description: "Close the panel." },
      },
      required: [],
    },
    code: "",
    builtin: true,
    group: "UI",
  },
  {
    id: "generate_3d",
    name: "generate_3d",
    description:
      "Generate a 3D model (mesh, e.g. .glb) from a text prompt using the configured 3D model. Returns a link to the generated model file.",
    parameters: {
      type: "object",
      properties: { prompt: { type: "string", description: "Detailed description of the 3D object to create." } },
      required: ["prompt"],
    },
    code: "",
    builtin: true,
    group: "Media",
  },
];

/** Built-in media-generation tool ids, dispatched to the media engines. */
export const MEDIA_TOOL_IDS = ["generate_image", "generate_speech", "generate_video", "generate_3d"] as const;

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

export interface ToolContext {
  fetch: typeof fetch;
  fs: ReturnType<typeof makeFs>;
  term: (command: string) => Promise<string>;
  cwd: string;
}

/** Derive an OpenAI-Agents-SDK-style schema from a Python function's signature + docstring. */
export async function detectPythonSchema(code: string): Promise<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<string>("python_schema", { code });
  const parsed = JSON.parse(raw);
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

/** Execute a tool: MCP tools route to their server; Python tools run via system Python; JS tools run with (args, ctx). `cwd` = working directory for fs/terminal tools. */
export async function executeTool(
  tool: Tool,
  args: Record<string, unknown>,
  cwd = "",
  media?: import("./media").MediaConfig,
  target?: import("./toolDiscovery").ToolTarget,
  sessionId?: string,
): Promise<string> {
  // Swarm bookkeeping: note which files this session depends on so other running
  // agents can be told when one of them changes underneath them.
  if (sessionId) {
    const { trackToolFile } = await import("./swarm");
    trackToolFile(sessionId, tool.id, args);
  }

  if (tool.id === "swarm_send" || tool.id === "swarm_status") {
    const { sendMessage, takeInbox, describe } = await import("./swarm");
    if (!sessionId) return "Swarm tools only work inside a running agent session.";
    if (tool.id === "swarm_send") {
      return sendMessage(sessionId, String(args.to ?? "*"), String(args.message ?? ""));
    }
    const pending = takeInbox(sessionId);
    return `Running alongside you: ${describe(sessionId)}${pending ? `\n\n${pending}` : "\n\nNo pending messages."}`;
  }

  if (tool.id === "side_panel") {
    const { setSidePanel } = await import("./sidePanel");
    return setSidePanel(args, cwd);
  }

  if (tool.id === "find_tools" || tool.id === "enable_tool") {
    const { findTools, enableTool } = await import("./toolDiscovery");
    const where = target ?? { kind: "voice" as const };
    return tool.id === "find_tools"
      ? findTools(String(args.query ?? args.q ?? ""), where)
      : enableTool(String(args.name ?? args.tool ?? ""), String(args.reason ?? ""), where);
  }
  if (tool.id === "use_skill") {
    const { loadSkillBody } = await import("./skills");
    return loadSkillBody(String(args.name ?? args.skill ?? ""));
  }
  if (
    tool.id === "generate_image" ||
    tool.id === "generate_speech" ||
    tool.id === "generate_video" ||
    tool.id === "generate_3d"
  ) {
    const kind =
      tool.id === "generate_image"
        ? "image"
        : tool.id === "generate_speech"
          ? "audio"
          : tool.id === "generate_video"
            ? "video"
            : "3d";
    const prompt = String(args.prompt ?? args.text ?? "");
    const { runMediaTool } = await import("./media");
    return runMediaTool(kind, prompt, media ?? { models: [], defaults: {} });
  }
  const { parseMcpToolId, mcpCallTool } = await import("./mcp");
  const mcp = parseMcpToolId(tool.id);
  if (mcp) return mcpCallTool(mcp.serverId, mcp.toolName, args);
  if (tool.runtime === "python") {
    return invoke<string>("python_run", {
      code: tool.code,
      func: tool.name,
      args: JSON.stringify(args),
    });
  }
  const fn = new AsyncFunction("args", "ctx", tool.code);
  const ctx: ToolContext = { fetch, fs: makeFs(cwd), term: (c) => runTerminal(cwd, c), cwd };
  const result = await Promise.race([
    fn(args, ctx),
    new Promise((_, rej) => setTimeout(() => rej(new Error("tool timed out after 30s")), 30000)),
  ]);
  if (result === undefined || result === null) return "";
  return typeof result === "string" ? result : JSON.stringify(result);
}

/** OpenAI tools array for the request body. */
export function toOpenAITools(tools: Tool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
