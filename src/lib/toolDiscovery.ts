/**
 * Tool discovery: lets a running model look through every tool the app knows
 * about — built-ins, custom tools, agents/workflows, tools on connected MCP
 * servers, and MCP servers that are configured but not connected yet — and turn
 * one on for itself mid-conversation.
 *
 * Policy: anything that needs no credentials is enabled silently. Anything that
 * needs a secret (or is destructive, or the user has turned auto-enable off)
 * pops an approval dialog instead.
 */
import { confirmDialog } from "./dialog";
import { toast } from "./toast";
import type { McpServerConfig } from "./mcp";
import type { Tool } from "./types";

/** Where a newly enabled tool should be switched on. */
export type ToolTarget =
  | { kind: "chat"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "voice" };

/** Tools that can destroy data — always ask before turning one on. */
const RISKY = new Set(["run_terminal", "delete_path"]);

function isLocal(url?: string) {
  return !!url && /localhost|127\.0\.0\.1|\[::1\]/.test(url);
}

/** True when we can't reach this server without a secret the user hasn't given us. */
export function serverNeedsAuth(cfg: McpServerConfig): boolean {
  if (cfg.transport === "http") return !cfg.token && !isLocal(cfg.url);
  // stdio servers usually take keys through env; blank values mean "fill me in"
  return Object.values(cfg.env ?? {}).some((v) => !v.trim());
}

function terms(query: string) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

function score(hay: string, ts: string[]): number {
  const h = hay.toLowerCase();
  let n = 0;
  for (const t of ts) if (h.includes(t)) n += h.split(/[^a-z0-9]+/).includes(t) ? 3 : 1;
  return n;
}

/** Ids currently switched on for this target. */
async function currentIds(target: ToolTarget): Promise<string[]> {
  const { useStore } = await import("./store");
  const st = useStore.getState();
  if (target.kind === "chat") return st.chats.find((c) => c.id === target.id)?.enabledTools ?? [];
  if (target.kind === "agent") {
    const a = st.agents.find((x) => x.id === target.id);
    return a ? [...a.toolIds, ...a.subAgentIds.map((i) => `agent:${i}`), ...a.workflowIds.map((i) => `workflow:${i}`)] : [];
  }
  return st.settings.voice?.toolIds ?? [];
}

/** Switch a tool id on for this target and persist it. */
async function addId(target: ToolTarget, tool: Tool): Promise<void> {
  const { useStore } = await import("./store");
  const st = useStore.getState();
  if (target.kind === "chat") {
    // Go through the store, never straight to storage: transcripts load lazily and
    // writing a chat whose messages aren't in memory would blank its file.
    await st.hydrateChat(target.id);
    const chat = useStore.getState().chats.find((c) => c.id === target.id);
    if (!chat) throw new Error("chat not found");
    const next = [...new Set([...(chat.enabledTools ?? []), tool.id])];
    useStore.getState().updateChatById(target.id, { enabledTools: next });
    return;
  }
  if (target.kind === "agent") {
    const agent = st.agents.find((a) => a.id === target.id);
    if (!agent) throw new Error("agent not found");
    if (tool.id.startsWith("agent:")) {
      await st.saveAgent({ ...agent, subAgentIds: [...new Set([...agent.subAgentIds, tool.id.slice(6)])] });
    } else if (tool.id.startsWith("workflow:")) {
      await st.saveAgent({ ...agent, workflowIds: [...new Set([...agent.workflowIds, tool.id.slice(9)])] });
    } else {
      await st.saveAgent({ ...agent, toolIds: [...new Set([...agent.toolIds, tool.id])] });
    }
    return;
  }
  const voice = st.settings.voice ?? {};
  await st.saveSettings({
    ...st.settings,
    voice: { ...voice, toolIds: [...new Set([...(voice.toolIds ?? []), tool.id])] },
  });
}

/**
 * Servers from the curated directory that the user hasn't added yet.
 *
 * This is the difference between "the model can use what you set up" and "the
 * model can go and find the capability it needs". Installing one runs a
 * third-party package, so it always asks first — see `installFromDirectory`.
 */
async function directoryCandidates(): Promise<import("./gateway").McpDirEntry[]> {
  const [{ mcpDirectory }, storage] = await Promise.all([import("./gateway"), import("./storage")]);
  const [dir, installed] = await Promise.all([mcpDirectory(), storage.listMcpServers()]);
  const have = new Set(installed.map((s) => s.name.toLowerCase()));
  return dir.filter((e) => !have.has(e.name.toLowerCase()));
}

/** MCP servers the user has configured but that aren't connected right now. */
async function offlineServers(): Promise<McpServerConfig[]> {
  const storage = await import("./storage");
  const { useStore } = await import("./store");
  const connected = new Set(
    useStore
      .getState()
      .mcpTools.map((t) => t.id.split(":")[1])
      .filter(Boolean),
  );
  return (await storage.listMcpServers()).filter((s) => !connected.has(s.id));
}

/**
 * Search everything callable. Returns a compact listing for the model, marking
 * what's already on, what can be switched on freely, and what needs credentials.
 */
export async function findTools(query: string, target: ToolTarget): Promise<string> {
  const { useStore } = await import("./store");
  const all = useStore.getState().allTools();
  const on = new Set(await currentIds(target));
  const ts = terms(query);

  const ranked = all
    .map((t) => ({
      t,
      s: ts.length ? score(`${t.name} ${t.description} ${t.group ?? ""}`, ts) : 1,
    }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 25);

  const lines = ranked.map(({ t }) => {
    const state = on.has(t.id) ? "ON" : RISKY.has(t.id) ? "off, needs approval" : "off";
    return `- ${t.name} [${state}]${t.group ? ` (${t.group})` : ""} — ${t.description.slice(0, 180)}`;
  });

  const servers = (await offlineServers()).filter(
    (s) => !ts.length || score(`${s.name} ${s.command ?? ""} ${s.url ?? ""}`, ts) > 0,
  );
  const serverLines = servers.map(
    (s) =>
      `- server:${s.id} [not connected${serverNeedsAuth(s) ? ", needs credentials" : ""}] — MCP server "${s.name}". Enable it to connect and load its tools.`,
  );

  // Nothing installed fits? Look through the directory of servers that could be
  // added, so "I don't have a tool for that" becomes "I can go and get one".
  const dirLines = (await directoryCandidates())
    .filter((e) => !ts.length || score(`${e.name} ${e.description} ${e.category}`, ts) > 0)
    .slice(0, 12)
    .map(
      (e) =>
        `- install:${e.name} [not installed${e.needsAuth ? ", needs credentials" : ""}] — ${e.description}`,
    );

  if (!lines.length && !serverLines.length && !dirLines.length) {
    return `No tool matches "${query}". Nothing available for that — solve it another way or tell the user what's missing.`;
  }
  return [
    lines.length ? `Tools matching "${query}":\n${lines.join("\n")}` : "",
    serverLines.length ? `MCP servers you could connect:\n${serverLines.join("\n")}` : "",
    dirLines.length
      ? `MCP servers you could install (the user is asked to approve each one):\n${dirLines.join("\n")}`
      : "",
    `Call enable_tool with the exact tool name, or server:<id> to connect a configured server, or install:<Name> to add one from the directory. Then call find_tools again to see what it brought in.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Connect an MCP server and register its tools. */
async function connectServer(cfg: McpServerConfig): Promise<Tool[]> {
  const { mcpConnect, mcpToolToChatTool } = await import("./mcp");
  const { useStore } = await import("./store");
  const infos = await mcpConnect(cfg);
  const tools = infos.map((t) => mcpToolToChatTool(cfg.id, cfg.name, t));
  useStore.setState({ mcpTools: [...useStore.getState().mcpTools, ...tools] });
  return tools;
}

async function approve(title: string, message: string): Promise<boolean> {
  const ok = await confirmDialog(title, { message, confirmLabel: "Enable" });
  if (!ok) toast.error("Tool request declined");
  return ok;
}

/**
 * Turn a tool on for the running conversation. Auto-approves credential-free
 * tools; asks the user for risky ones, for MCP servers that need secrets, and
 * whenever "auto-enable tools" is switched off in Settings.
 */
/**
 * Add a directory server to the user's config, connect it, and report its tools.
 *
 * This is the one action in tool discovery that always prompts, no matter what
 * "auto-enable tools" is set to: a stdio entry runs `npx -y <package>`, which is
 * third-party code executing on the user's machine with their permissions. That
 * is not a decision a model gets to make silently.
 */
async function installFromDirectory(name: string, why: string): Promise<string> {
  const entry = (await directoryCandidates()).find(
    (e) => e.name.toLowerCase() === name.trim().toLowerCase(),
  );
  if (!entry) return `Error: no server named "${name}" in the directory, or it's already installed.`;

  if (entry.needsAuth) {
    toast.error(`${entry.name} needs credentials — add it in MCP Servers`);
    return `Blocked: "${entry.name}" needs an API key or sign-in that the app doesn't have. Ask the user to add it under MCP Servers, then carry on without it for now.`;
  }

  const what =
    entry.transport === "stdio"
      ? `This runs \`${entry.command} ${(entry.args ?? []).join(" ")}\` on your machine.`
      : `This connects to ${entry.url}.`;
  const ok = await approve(
    `Install MCP server "${entry.name}"?`,
    `${entry.description}\n\n${what}${why}`,
  );
  if (!ok) return `Declined by the user. Do not retry; finish without "${entry.name}".`;

  const storage = await import("./storage");
  const cfg: McpServerConfig = {
    id: `mcp-${Date.now()}`,
    name: entry.name,
    transport: entry.transport,
    command: entry.command,
    args: entry.args,
    url: entry.url,
    token: "",
    autoConnect: true, // it was wanted once; have it ready next launch
  };
  await storage.saveMcpServer(cfg);

  try {
    const tools = await connectServer(cfg);
    toast.success(`${entry.name} installed — ${tools.length} tools`);
    return `Installed and connected "${entry.name}". Now available (call enable_tool on the one you need): ${tools
      .map((t) => t.name)
      .join(", ")}`;
  } catch (e) {
    return `Installed "${entry.name}" but couldn't start it: ${(e as Error).message || String(e)}. It may need Node.js on PATH, or credentials. Carry on without it.`;
  }
}

export async function enableTool(ref: string, reason: string, target: ToolTarget): Promise<string> {
  const { useStore } = await import("./store");
  const st = useStore.getState();
  const auto = st.settings.autoEnableTools ?? true;
  const why = reason.trim() ? ` Reason given: ${reason.trim()}` : "";

  // --- Directory reference: add a server the user doesn't have yet.
  if (ref.startsWith("install:")) return installFromDirectory(ref.slice(8), why);

  // --- MCP server reference: connect it, then report the tools it brought in.
  const serverRef = ref.startsWith("server:") ? ref.slice(7) : null;
  if (serverRef) {
    const cfg = (await offlineServers()).find((s) => s.id === serverRef || s.name === serverRef);
    if (!cfg) return `Error: no disconnected MCP server "${serverRef}".`;
    if (serverNeedsAuth(cfg)) {
      toast.error(`${cfg.name} needs credentials — add them in MCP Servers`);
      return `Blocked: "${cfg.name}" needs credentials the app doesn't have. Ask the user to open MCP Servers, add the token/key for "${cfg.name}", and connect it. Continue without this tool for now.`;
    }
    if (!auto && !(await approve(`Connect MCP server "${cfg.name}"?`, `The model wants to connect it and use its tools.${why}`))) {
      return `Declined by the user. Do not retry; carry on without it.`;
    }
    try {
      const tools = await connectServer(cfg);
      toast.success(`${cfg.name} connected — ${tools.length} tools`);
      return `Connected "${cfg.name}". Now available (call enable_tool on the one you need): ${tools
        .map((t) => t.name)
        .join(", ")}`;
    } catch (e) {
      return `Failed to connect "${cfg.name}": ${(e as Error).message || String(e)}. Ask the user to check it in MCP Servers.`;
    }
  }

  // --- Plain tool reference: match by name or id.
  const key = ref.trim().toLowerCase();
  let tool = st.allTools().find((t) => t.name.toLowerCase() === key || t.id.toLowerCase() === key);

  // Not loaded yet? A disconnected server may provide it — connect and look again.
  if (!tool) {
    for (const cfg of await offlineServers()) {
      if (serverNeedsAuth(cfg)) continue;
      try {
        const tools = await connectServer(cfg);
        const hit = tools.find((t) => t.name.toLowerCase() === key || t.id.toLowerCase() === key);
        if (hit) {
          tool = hit;
          toast.success(`${cfg.name} connected`);
          break;
        }
      } catch {
        /* server unavailable — keep looking */
      }
    }
  }
  if (!tool) return `Error: no tool named "${ref}". Run find_tools first to see the exact names.`;

  if ((await currentIds(target)).includes(tool.id)) return `"${tool.name}" is already enabled — just call it.`;

  const risky = RISKY.has(tool.id);
  if ((risky || !auto) && !(await approve(`Enable "${tool.name}"?`, `${tool.description.slice(0, 200)}${why}`))) {
    return `Declined by the user. Do not retry; finish without "${tool.name}".`;
  }

  await addId(target, tool);
  toast.success(`Enabled ${tool.name}`);
  return `Enabled "${tool.name}". It is live now — call it in your next step.`;
}
