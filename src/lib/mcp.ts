import { invoke } from "@tauri-apps/api/core";
import type { Tool } from "./types";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  token?: string;
  autoConnect?: boolean;
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export async function mcpConnect(cfg: McpServerConfig): Promise<McpToolInfo[]> {
  await invoke("mcp_connect", {
    id: cfg.id,
    transport: cfg.transport,
    command: cfg.command ?? null,
    args: cfg.args ?? [],
    env: cfg.env ?? {},
    url: cfg.url ?? null,
    token: cfg.token || null,
  });
  const result = (await invoke("mcp_request", {
    id: cfg.id,
    method: "tools/list",
    params: {},
  })) as { tools?: McpToolInfo[] };
  return (result.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema ?? { type: "object", properties: {} },
  }));
}

export async function mcpDisconnect(id: string): Promise<void> {
  await invoke("mcp_disconnect", { id });
}

export async function mcpCallTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = (await invoke("mcp_request", {
    id: serverId,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  })) as { content?: { type: string; text?: string }[]; isError?: boolean };
  const text = (result.content ?? [])
    .map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`))
    .join("\n");
  if (result.isError) throw new Error(text || "MCP tool returned an error");
  return text;
}

/** Represent a connected MCP tool as a chat Tool. id format: mcp:<serverId>:<toolName> */
export function mcpToolToChatTool(serverId: string, serverName: string, t: McpToolInfo): Tool {
  const safe = (s: string) => s.replace(/[^\w-]/g, "_");
  return {
    id: `mcp:${serverId}:${t.name}`,
    name: `${safe(serverName)}_${safe(t.name)}`.slice(0, 60),
    description: t.description,
    parameters: t.inputSchema,
    code: `// MCP tool "${t.name}" served by ${serverName}`,
    builtin: false,
    group: serverName,
  };
}

export function parseMcpToolId(id: string): { serverId: string; toolName: string } | null {
  if (!id.startsWith("mcp:")) return null;
  const rest = id.slice(4);
  const sep = rest.indexOf(":");
  if (sep === -1) return null;
  return { serverId: rest.slice(0, sep), toolName: rest.slice(sep + 1) };
}
