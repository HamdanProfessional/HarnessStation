import type { Tool } from "./types";

/**
 * Progressive disclosure for MCP tools.
 *
 * The usual approach — register every tool of every connected server as a
 * callable function — puts the full name, description and JSON schema of all of
 * them in the system prompt on every single turn. Ten servers is a few thousand
 * tokens before the user has said anything; a hundred servers is unusable. It's
 * what makes MCP feel expensive in most clients.
 *
 * So the model gets four tools instead, no matter how many servers are connected:
 *
 *   mcp_servers                 which servers exist, one line each
 *   mcp_tools(server)           tool NAMES for one server, nothing else
 *   mcp_describe(server, tools) descriptions + schemas, only for what it asked for
 *   mcp_call(server, tool, args)invoke it
 *
 * Cost is then flat — four definitions — and the model pays for detail only on
 * the branch it actually walks down. A server's tool list is one cheap round
 * trip, and schemas arrive only for the two or three tools it settles on.
 */

export const MCP_GATEWAY_TOOL_IDS = [
  "mcp_servers",
  "mcp_tools",
  "mcp_describe",
  "mcp_call",
] as const;

/** True for the four gateway tools, which are always cheap to have switched on. */
export function isMcpGatewayTool(id: string): boolean {
  return (MCP_GATEWAY_TOOL_IDS as readonly string[]).includes(id);
}

export const MCP_GATEWAY_TOOLS: Tool[] = [
  {
    id: "mcp_servers",
    name: "mcp_servers",
    description:
      "List the connected MCP servers and what each one covers. Start here when you need a capability this app doesn't have built in — it costs almost nothing and tells you which server to look inside.",
    parameters: { type: "object", properties: {} },
    code: "",
    builtin: true,
    group: "MCP",
  },
  {
    id: "mcp_tools",
    name: "mcp_tools",
    description:
      "List the tool NAMES a given MCP server provides. Names only — call mcp_describe for the ones that look relevant. Use the server name exactly as mcp_servers reported it.",
    parameters: {
      type: "object",
      properties: {
        server: { type: "string", description: "Server name from mcp_servers." },
        query: {
          type: "string",
          description: "Optional filter, e.g. 'issue' — matches tool names.",
        },
      },
      required: ["server"],
    },
    code: "",
    builtin: true,
    group: "MCP",
  },
  {
    id: "mcp_describe",
    name: "mcp_describe",
    description:
      "Get the description and argument schema for specific MCP tools, so you can call them correctly. Ask only for the tools you actually intend to use — this is the expensive step.",
    parameters: {
      type: "object",
      properties: {
        server: { type: "string", description: "Server name from mcp_servers." },
        tools: {
          type: "array",
          items: { type: "string" },
          description: "Tool names from mcp_tools.",
        },
      },
      required: ["server", "tools"],
    },
    code: "",
    builtin: true,
    group: "MCP",
  },
  {
    id: "mcp_call",
    name: "mcp_call",
    description:
      "Run a tool on an MCP server. Check its schema with mcp_describe first — arguments must match it.",
    parameters: {
      type: "object",
      properties: {
        server: { type: "string", description: "Server name from mcp_servers." },
        tool: { type: "string", description: "Tool name from mcp_tools." },
        args: { type: "object", description: "Arguments matching the tool's schema." },
      },
      required: ["server", "tool"],
    },
    code: "",
    builtin: true,
    group: "MCP",
  },
];

/** One connected server and the tools it exposes, as the app already knows them. */
export interface McpServerTools {
  id: string;
  name: string;
  tools: Tool[];
}

/** Group the registered MCP tools by the server that serves them. */
export function groupByServer(mcpTools: Tool[]): McpServerTools[] {
  const byServer = new Map<string, McpServerTools>();
  for (const t of mcpTools) {
    const [, serverId] = t.id.split(":");
    if (!serverId) continue;
    const name = t.group ?? serverId;
    const entry = byServer.get(serverId) ?? { id: serverId, name, tools: [] };
    entry.tools.push(t);
    byServer.set(serverId, entry);
  }
  return [...byServer.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const norm = (s: string) => s.trim().toLowerCase();

function findServer(servers: McpServerTools[], wanted: string): McpServerTools | null {
  const w = norm(wanted);
  return (
    servers.find((s) => norm(s.name) === w) ??
    servers.find((s) => norm(s.id) === w) ??
    servers.find((s) => norm(s.name).includes(w)) ??
    null
  );
}

/** The bare tool name, without the "<server>_" prefix the app adds for uniqueness. */
function bareName(t: Tool): string {
  return t.id.split(":").slice(2).join(":") || t.name;
}

function findTool(server: McpServerTools, wanted: string): Tool | null {
  const w = norm(wanted);
  return (
    server.tools.find((t) => norm(bareName(t)) === w) ??
    server.tools.find((t) => norm(t.name) === w) ??
    server.tools.find((t) => norm(bareName(t)).includes(w)) ??
    null
  );
}

const notFound = (wanted: string, servers: McpServerTools[]) =>
  `No MCP server matches "${wanted}". Connected: ${
    servers.map((s) => s.name).join(", ") || "none"
  }. Call mcp_servers to see them.`;

/** `mcp_servers` — one line per server, no tool detail. */
export function listServers(servers: McpServerTools[]): string {
  if (!servers.length) {
    return "No MCP servers are connected. The user can add one under MCP Servers, or you can look for one with find_tools.";
  }
  const lines = servers.map((s) => `- ${s.name} — ${s.tools.length} tools`);
  return `Connected MCP servers:\n${lines.join(
    "\n",
  )}\n\nCall mcp_tools with a server name to see what it offers.`;
}

/** `mcp_tools` — names only. This is the step that keeps the context small. */
export function listTools(
  servers: McpServerTools[],
  serverName: string,
  query = "",
): string {
  const server = findServer(servers, serverName);
  if (!server) return notFound(serverName, servers);

  const q = norm(query);
  const names = server.tools
    .map(bareName)
    .filter((n) => !q || norm(n).includes(q))
    .sort();

  if (!names.length) {
    return q
      ? `No tool on "${server.name}" matches "${query}". It has ${server.tools.length} tools; call mcp_tools without a query to see them all.`
      : `"${server.name}" reports no tools.`;
  }
  return `Tools on ${server.name}${q ? ` matching "${query}"` : ""}:\n${names.join(
    ", ",
  )}\n\nCall mcp_describe with the ones you need before using them.`;
}

/** `mcp_describe` — the expensive detail, only for what was asked for. */
export function describeTools(
  servers: McpServerTools[],
  serverName: string,
  wanted: string[],
): string {
  const server = findServer(servers, serverName);
  if (!server) return notFound(serverName, servers);
  if (!wanted.length) return "Name at least one tool to describe.";

  const blocks: string[] = [];
  const missing: string[] = [];
  for (const w of wanted.slice(0, 12)) {
    const tool = findTool(server, w);
    if (!tool) {
      missing.push(w);
      continue;
    }
    const schema = JSON.stringify(tool.parameters ?? {});
    blocks.push(
      `### ${bareName(tool)}\n${tool.description || "(no description)"}\nArguments: ${schema}`,
    );
  }
  const out = blocks.join("\n\n");
  const note = missing.length
    ? `\n\nNot on this server: ${missing.join(", ")}. Call mcp_tools to see the real names.`
    : "";
  return (out || "None of those tools exist on this server.") + note;
}

/**
 * `mcp_call` — resolve the server+tool the model named to a registered tool.
 * Returns an explanatory string instead of throwing, so a wrong guess costs the
 * model one turn and a hint rather than an error it can't act on.
 */
export function resolveCall(
  servers: McpServerTools[],
  serverName: string,
  toolName: string,
): Tool | string {
  const server = findServer(servers, serverName);
  if (!server) return notFound(serverName, servers);
  const tool = findTool(server, toolName);
  if (!tool) {
    return `"${server.name}" has no tool called "${toolName}". Call mcp_tools on that server for the exact names.`;
  }
  return tool;
}
