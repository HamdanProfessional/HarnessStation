import { useEffect, useState } from "react";
import { MCP_CATEGORIES, mcpDirectory, type McpDirEntry } from "../lib/gateway";
import { EmptyState } from "./EmptyState";
import { IconPlug, IconSearch, IconX } from "./icons";
import {
  mcpConnect,
  mcpDisconnect,
  mcpToolToChatTool,
  type McpServerConfig,
  type McpToolInfo,
} from "../lib/mcp";
import { confirmDialog } from "../lib/dialog";
import { useStore } from "../lib/store";
import * as storage from "../lib/storage";

interface ConnState {
  tools: McpToolInfo[];
}

export function McpView() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [directory, setDirectory] = useState<McpDirEntry[]>([]);
  const [connected, setConnected] = useState<Record<string, ConnState>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dirQuery, setDirQuery] = useState("");
  const [dirCat, setDirCat] = useState("All");
  const [draft, setDraft] = useState<McpServerConfig>({
    id: "",
    name: "",
    transport: "stdio",
    command: "npx",
    args: [],
  });

  useEffect(() => {
    void storage.listMcpServers().then(setServers);
    void mcpDirectory().then(setDirectory);
  }, []);

  const syncStoreTools = (conns: Record<string, ConnState>, list: McpServerConfig[]) => {
    const tools = Object.entries(conns).flatMap(([serverId, c]) => {
      const cfg = list.find((s) => s.id === serverId);
      return c.tools.map((t) => mcpToolToChatTool(serverId, cfg?.name ?? serverId, t));
    });
    useStore.setState({ mcpTools: tools });
  };

  const connect = async (cfg: McpServerConfig) => {
    setBusy(cfg.id);
    setError(null);
    try {
      const tools = await mcpConnect(cfg);
      const next = { ...connected, [cfg.id]: { tools } };
      setConnected(next);
      syncStoreTools(next, servers);
    } catch (e) {
      setError(`${cfg.name}: ${(e as Error).message || String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (id: string) => {
    await mcpDisconnect(id);
    const next = { ...connected };
    delete next[id];
    setConnected(next);
    syncStoreTools(next, servers);
  };

  const saveServer = async (cfg: McpServerConfig) => {
    await storage.saveMcpServer(cfg);
    const list = [...servers.filter((s) => s.id !== cfg.id), cfg].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    setServers(list);
  };

  const addFromDirectory = async (e: McpDirEntry) => {
    const cfg: McpServerConfig = {
      id: `mcp-${Date.now()}`,
      name: e.name,
      transport: e.transport,
      command: e.command,
      args: e.args,
      url: e.url,
      token: "",
    };
    await saveServer(cfg);
  };

  const patchToken = async (cfg: McpServerConfig, token: string) => {
    const next = { ...cfg, token };
    await saveServer(next);
  };

  const signIn = async (cfg: McpServerConfig) => {
    if (!cfg.url) return;
    setBusy(`oauth-${cfg.id}`);
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const token = await invoke<string>("mcp_oauth", { serverUrl: cfg.url });
      await saveServer({ ...cfg, token });
    } catch (e) {
      setError(`OAuth failed: ${(e as Error).message || String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const q = dirQuery.toLowerCase();
  const filteredDir = directory.filter(
    (e) =>
      (dirCat === "All" || e.category === dirCat) &&
      (!q || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)),
  );

  return (
    <main className="settings-main">
      <div className="settings-header">
        <h1>MCP Servers</h1>
        <button className="btn primary" onClick={() => setAdding(!adding)}>
          {adding ? "Cancel" : "Add custom server"}
        </button>
      </div>
      <p className="hint">
        Model Context Protocol servers give the model extra tools (files, web, APIs). Connect a
        server, then enable its tools per-chat in the chat panel. Remote servers that require
        OAuth accept a pasted access token for now; the in-app sign-in flow comes later.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {adding && (
        <section className="provider-card">
          <div className="provider-row">
            <input
              className="grow"
              placeholder="Name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <select
              value={draft.transport}
              onChange={(e) =>
                setDraft({ ...draft, transport: e.target.value as "stdio" | "http" })
              }
            >
              <option value="stdio">stdio (local command)</option>
              <option value="http">http (remote URL)</option>
            </select>
          </div>
          {draft.transport === "stdio" ? (
            <div className="provider-row">
              <input
                value={draft.command ?? ""}
                placeholder="command, e.g. npx"
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
              />
              <input
                className="grow"
                value={(draft.args ?? []).join(" ")}
                placeholder="args, e.g. -y @modelcontextprotocol/server-fetch"
                onChange={(e) =>
                  setDraft({ ...draft, args: e.target.value.split(/\s+/).filter(Boolean) })
                }
              />
            </div>
          ) : (
            <div className="provider-row">
              <input
                className="grow"
                value={draft.url ?? ""}
                placeholder="https://example.com/mcp"
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              />
              <input
                className="grow"
                type="password"
                value={draft.token ?? ""}
                placeholder="Bearer token (optional)"
                onChange={(e) => setDraft({ ...draft, token: e.target.value })}
              />
            </div>
          )}
          <button
            className="btn primary"
            disabled={!draft.name.trim()}
            onClick={() => {
              void saveServer({ ...draft, id: `mcp-${Date.now()}` });
              setAdding(false);
              setDraft({ id: "", name: "", transport: "stdio", command: "npx", args: [] });
            }}
          >
            Save server
          </button>
        </section>
      )}

      <section>
        <h2>Installed</h2>
        {servers.length === 0 && (
          <EmptyState
            icon={<IconPlug size={22} />}
            title="No MCP servers yet"
            hint="Connect Model Context Protocol servers to give models new tools and data."
          />
        )}
        {servers.map((s) => {
          const conn = connected[s.id];
          return (
            <div key={s.id} className="provider-card">
              <div className="provider-row">
                <div className="grow">
                  <b>{s.name}</b>{" "}
                  <span className="hint">
                    {s.transport === "stdio"
                      ? `${s.command} ${(s.args ?? []).join(" ")}`
                      : s.url}
                  </span>
                </div>
                {conn ? (
                  <>
                    <span className="fit-cpu">{conn.tools.length} tool(s)</span>
                    <button className="btn small" onClick={() => void disconnect(s.id)}>
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    className="btn primary small"
                    disabled={busy === s.id}
                    onClick={() => void connect(s)}
                  >
                    {busy === s.id ? "Connecting..." : "Connect"}
                  </button>
                )}
                <button
                  className="icon-btn"
                  title={`Remove ${s.name}`}
                  aria-label={`Remove ${s.name}`}
                  onClick={async () => {
                    if (await confirmDialog(`Remove server ${s.name}?`, { danger: true })) {
                      void disconnect(s.id);
                      void storage.deleteMcpServer(s.id).then(() =>
                        setServers(servers.filter((x) => x.id !== s.id)),
                      );
                    }
                  }}
                >
                  <IconX size={14} />
                </button>
              </div>
              {s.transport === "http" && (
                <div className="provider-row">
                  <input
                    className="grow"
                    type="password"
                    value={s.token ?? ""}
                    placeholder="Bearer / OAuth access token"
                    onChange={(e) => void patchToken(s, e.target.value)}
                  />
                  <button
                    className="btn small"
                    disabled={busy === `oauth-${s.id}`}
                    title="Sign in with OAuth in your browser"
                    onClick={() => void signIn(s)}
                  >
                    {busy === `oauth-${s.id}` ? "Waiting..." : "Sign in"}
                  </button>
                </div>
              )}
              <label className="hint" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <input
                  type="checkbox"
                  checked={s.autoConnect ?? false}
                  onChange={(e) => void saveServer({ ...s, autoConnect: e.target.checked })}
                />
                Connect automatically on startup
              </label>
              {conn && (
                <div className="hint">
                  {conn.tools.map((t) => t.name).join(", ") || "no tools exposed"}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section>
        <div className="settings-header">
          <h2 style={{ margin: 0 }}>Directory</h2>
          <span className="hint">{filteredDir.length} servers</span>
        </div>
        <div className="search-wrap" style={{ margin: "8px 0" }}>
          <span className="search-icon">
            <IconSearch size={14} />
          </span>
          <input
            className="search"
            placeholder="Search MCP servers..."
            value={dirQuery}
            onChange={(e) => setDirQuery(e.target.value)}
          />
        </div>
        <div className="seg" style={{ flexWrap: "wrap" }}>
          {["All", ...MCP_CATEGORIES].map((c) => (
            <button key={c} className={`seg-btn ${dirCat === c ? "active" : ""}`} onClick={() => setDirCat(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="card-grid">
          {filteredDir.map((e) => {
            const isAdded = servers.some(
              (s) => s.name === e.name && (s.url === e.url || (s.command === e.command && (s.args ?? []).join() === (e.args ?? []).join())),
            );
            return (
              <div key={e.name} className="provider-card" style={{ margin: 0 }}>
                <div className="provider-row">
                  <div className="grow">
                    <b>{e.name}</b>{" "}
                    <span className="tool-tag">{e.transport}</span>
                    {e.needsAuth && (
                      <span className="tool-tag tag-auth" title="Requires signing in with OAuth before use">
                        sign-in
                      </span>
                    )}
                  </div>
                  <button
                    className="btn small"
                    disabled={isAdded}
                    onClick={() => void addFromDirectory(e)}
                  >
                    {isAdded ? "Added" : "Add"}
                  </button>
                </div>
                <div className="hint">{e.description}</div>
              </div>
            );
          })}
        </div>
        {filteredDir.length === 0 && <p className="hint">No servers match "{dirQuery}".</p>}
        <p className="hint" style={{ marginTop: 12 }}>
          Hundreds more at mcpservers.org — add any via "Add custom server". stdio servers need
          Node.js (npx) unless they ship a binary.
        </p>
      </section>
    </main>
  );
}
