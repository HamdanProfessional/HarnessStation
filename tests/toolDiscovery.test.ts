import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, Message } from "../src/lib/types";

/**
 * enable_tool switching a tool on for a chat that isn't the one on screen used to
 * call storage.saveChat directly, bypassing the store. With transcripts loading
 * lazily that wrote an empty messages array over a real conversation.
 */

const saveChat = vi.fn(async () => {});
const saveMcpServer = vi.fn(async () => {});
const mcpConnect = vi.fn(async () => [{ name: "search_web", description: "search" }]);
let mcpServers: { id: string; name: string }[] = [];
let directory: Record<string, unknown>[] = [];
const queueSaveChat = vi.fn();
const bodies = new Map<string, Message[]>();

vi.mock("../src/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/storage")>()),
  saveChat: (...a: unknown[]) => saveChat(...(a as [])),
  queueSaveChat: (...a: unknown[]) => queueSaveChat(...(a as [])),
  loadChatBody: async (id: string) => {
    const messages = bodies.get(id);
    return messages ? ({ ...stub(id), messages } as Chat) : null;
  },
  listMcpServers: async () => mcpServers,
  saveMcpServer: (...a: unknown[]) => saveMcpServer(...(a as [])),
  flushChatSaves: vi.fn(async () => {}),
}));

vi.mock("../src/lib/providers", () => ({
  streamChat: vi.fn(),
  chatOnce: vi.fn(async () => ""),
  listModels: vi.fn(async () => []),
}));

vi.mock("../src/lib/budget", () => ({
  capExceeded: () => null,
  recordUsage: vi.fn(),
  syncTray: vi.fn(async () => {}),
  totals: () => ({ todayUsd: 0, monthUsd: 0, allUsd: 0, todayTokens: 0, unpricedCalls: 0, byModel: [] }),
  onSpendChange: () => () => {},
}));

vi.mock("../src/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../src/lib/dialog", () => ({ confirmDialog: (...a: unknown[]) => confirmDialog(...(a as [])) }));
vi.mock("../src/lib/gateway", () => ({ mcpDirectory: async () => directory }));
vi.mock("../src/lib/mcp", () => ({
  mcpConnect: (...a: unknown[]) => mcpConnect(...(a as [])),
  mcpToolToChatTool: (serverId: string, serverName: string, t: { name: string; description: string }) => ({
    id: `mcp:${serverId}:${t.name}`,
    name: t.name,
    description: t.description,
    parameters: {},
    code: "",
    group: serverName,
  }),
  parseMcpToolId: () => null,
}));

const confirmDialog = vi.fn(async () => true);

const { enableTool, findTools, serverNeedsAuth } = await import("../src/lib/toolDiscovery");
const { useStore } = await import("../src/lib/store");

function stub(id: string): Chat {
  return {
    id,
    title: `Chat ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    providerId: "p1",
    model: "m1",
    systemPrompt: "",
    styleId: "normal",
    temperature: 0.7,
    maxTokens: 0,
    enabledTools: [],
    messages: [],
  };
}

const find = (id: string) => useStore.getState().chats.find((c) => c.id === id)!;

beforeEach(() => {
  saveChat.mockClear();
  saveMcpServer.mockClear();
  mcpConnect.mockClear();
  confirmDialog.mockClear();
  confirmDialog.mockResolvedValue(true);
  mcpServers = [];
  directory = [
    {
      name: "Brave Search",
      category: "Search",
      description: "Web search via the Brave API.",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      needsAuth: true,
    },
    {
      name: "Playwright",
      category: "Dev",
      description: "Browser automation and testing.",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@playwright/mcp"],
    },
  ];
  queueSaveChat.mockClear();
  bodies.clear();
  bodies.set("background", [
    { role: "user", content: "an important question" },
    { role: "assistant", content: "an important answer" },
  ]);

  useStore.setState({
    ready: true,
    chats: [stub("onscreen"), stub("background")],
    hydratedIds: { onscreen: true },
    currentId: "onscreen",
    customTools: [],
    mcpTools: [],
    agents: [],
    workflows: [],
    settings: { ...useStore.getState().settings, autoEnableTools: true },
  });
});

describe("enableTool on a chat that is not on screen", () => {
  it("loads the transcript first instead of blanking it", async () => {
    const out = await enableTool("web_search", "need to look something up", {
      kind: "chat",
      id: "background",
    });

    expect(out).toMatch(/Enabled/);
    expect(find("background").enabledTools).toContain("web_search");
    // The transcript came in rather than being overwritten with nothing.
    expect(find("background").messages).toHaveLength(2);
    const written = queueSaveChat.mock.calls.at(-1)?.[0] as unknown as Chat;
    expect(written.messages).toHaveLength(2);
  });

  it("goes through the store rather than writing storage directly", async () => {
    await enableTool("web_search", "", { kind: "chat", id: "background" });
    expect(saveChat).not.toHaveBeenCalled();
  });

  it("enables on the current chat too", async () => {
    await enableTool("web_search", "", { kind: "chat", id: "onscreen" });
    expect(find("onscreen").enabledTools).toContain("web_search");
  });

  it("does not duplicate an id that is already on", async () => {
    await enableTool("web_search", "", { kind: "chat", id: "onscreen" });
    const again = await enableTool("web_search", "", { kind: "chat", id: "onscreen" });
    expect(again).toMatch(/already enabled/);
    expect(find("onscreen").enabledTools!.filter((t) => t === "web_search")).toHaveLength(1);
  });

  it("reports an unknown tool name", async () => {
    const out = await enableTool("nonexistent_tool", "", { kind: "chat", id: "onscreen" });
    expect(out).toMatch(/no tool named/);
  });
});

describe("findTools", () => {
  it("marks what is already on", async () => {
    await enableTool("web_search", "", { kind: "chat", id: "onscreen" });
    const out = await findTools("search the web", { kind: "chat", id: "onscreen" });
    expect(out).toMatch(/web_search \[ON\]/);
  });

  it("flags destructive tools as needing approval", async () => {
    const out = await findTools("terminal", { kind: "chat", id: "onscreen" });
    expect(out).toMatch(/run_terminal \[off, needs approval\]/);
  });

  it("says so plainly when nothing matches", async () => {
    const out = await findTools("zzzzqqqq", { kind: "chat", id: "onscreen" });
    expect(out).toMatch(/No tool matches/);
  });
});

describe("serverNeedsAuth", () => {
  const cfg = (over: Record<string, unknown>) =>
    ({ id: "s", name: "S", transport: "http", ...over }) as never;

  it("treats a remote http server with no token as needing credentials", () => {
    expect(serverNeedsAuth(cfg({ url: "https://example.com/mcp" }))).toBe(true);
    expect(serverNeedsAuth(cfg({ url: "https://example.com/mcp", token: "t" }))).toBe(false);
  });

  it("trusts loopback without a token", () => {
    expect(serverNeedsAuth(cfg({ url: "http://localhost:3000/mcp" }))).toBe(false);
    expect(serverNeedsAuth(cfg({ url: "http://127.0.0.1:3000/mcp" }))).toBe(false);
  });

  it("treats a blank stdio env value as a placeholder to fill in", () => {
    expect(serverNeedsAuth(cfg({ transport: "stdio", env: { API_KEY: "" } }))).toBe(true);
    expect(serverNeedsAuth(cfg({ transport: "stdio", env: { API_KEY: "k" } }))).toBe(false);
    expect(serverNeedsAuth(cfg({ transport: "stdio" }))).toBe(false);
  });
});

describe("finding and installing MCP servers from the directory", () => {
  const target = { kind: "chat", id: "onscreen" } as const;

  it("offers directory servers when nothing installed matches", async () => {
    const out = await findTools("browser automation", target);
    expect(out).toMatch(/install:Playwright \[not installed\]/);
  });

  it("marks directory servers that need credentials", async () => {
    const out = await findTools("web search brave", target);
    expect(out).toMatch(/install:Brave Search \[not installed, needs credentials\]/);
  });

  it("does not offer a server the user already has", async () => {
    mcpServers = [{ id: "m1", name: "Playwright" }];
    const out = await findTools("browser automation", target);
    expect(out).not.toMatch(/install:Playwright/);
  });

  it("installs, connects, and reports the tools it brought in", async () => {
    const out = await enableTool("install:Playwright", "need to click through a page", target);

    expect(confirmDialog).toHaveBeenCalled();
    expect(saveMcpServer).toHaveBeenCalledTimes(1);
    const cfg = saveMcpServer.mock.calls[0][0] as unknown as { name: string; autoConnect: boolean };
    expect(cfg.name).toBe("Playwright");
    expect(cfg.autoConnect).toBe(true); // wanted once, ready next launch
    expect(mcpConnect).toHaveBeenCalledTimes(1);
    expect(out).toMatch(/Installed and connected "Playwright"/);
    expect(out).toMatch(/search_web/);
  });

  it("always asks first, even with auto-enable switched on", async () => {
    // Installing runs a third-party package on the user's machine. That is never
    // a silent decision, whatever the auto-enable setting says.
    useStore.setState({
      settings: { ...useStore.getState().settings, autoEnableTools: true },
    });
    confirmDialog.mockResolvedValue(false);

    const out = await enableTool("install:Playwright", "", target);

    expect(confirmDialog).toHaveBeenCalled();
    expect(saveMcpServer).not.toHaveBeenCalled();
    expect(mcpConnect).not.toHaveBeenCalled();
    expect(out).toMatch(/Declined by the user/);
  });

  it("shows the exact command in the approval prompt", async () => {
    await enableTool("install:Playwright", "", target);
    const message = (confirmDialog.mock.calls[0][1] as { message: string }).message;
    expect(message).toContain("npx -y @playwright/mcp");
  });

  it("refuses to install a server that needs credentials", async () => {
    const out = await enableTool("install:Brave Search", "", target);

    expect(saveMcpServer).not.toHaveBeenCalled();
    expect(out).toMatch(/needs an API key/);
  });

  it("reports an unknown directory name", async () => {
    const out = await enableTool("install:Nonexistent", "", target);
    expect(out).toMatch(/no server named "Nonexistent"/);
  });

  it("keeps the server saved when it fails to start, and says why", async () => {
    mcpConnect.mockRejectedValueOnce(new Error("node not found"));

    const out = await enableTool("install:Playwright", "", target);

    expect(saveMcpServer).toHaveBeenCalledTimes(1);
    expect(out).toMatch(/couldn't start it: node not found/);
  });
});
