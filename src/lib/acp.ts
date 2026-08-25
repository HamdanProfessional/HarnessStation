import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AcpAgentConfig } from "./types";

/**
 * The client half of ACP hosting (plan WP3, docs/research/acp-b-plan.md):
 * spawn a configured registry agent, speak ACP v1 to it over its stdio, and
 * surface the conversation to the app.
 *
 * The protocol work — id correlation, notification routing, permission
 * round-trips — lives here so the UI only deals with callbacks. The Rust side
 * (acp.rs) is a dumb relay: it emits every child stdout line raw via
 * "acp-event" and takes fully-formed lines back via acp_write.
 *
 * The bridge is injectable: the default talks to Tauri; tests inject one
 * backed by a real subprocess (tests/fake-acp-agent.mjs), which exercises the
 * actual protocol handling end-to-end without the app.
 */

// ---------- shapes ----------

export interface AcpUpdate {
  sessionUpdate: string;
  sessionId?: string;
  messageId?: string;
  content?: { type: string; text?: string };
  /** tool_call updates */
  toolCallId?: string;
  title?: string;
  status?: string;
  [k: string]: unknown;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall?: { title?: string };
  options: { optionId: string; name: string; kind?: string }[];
}

export interface AcpBridge {
  spawn(id: string, command: string, args: string[], env: Record<string, string>): Promise<void>;
  write(id: string, line: string): Promise<void>;
  kill(id: string): Promise<void>;
  onEvent(cb: (id: string, line: string) => void): Promise<() => void>;
  onExit(cb: (id: string) => void): Promise<() => void>;
}

export interface AcpHooks {
  /** Every session/update notification from the agent (already parsed). */
  onUpdate(update: AcpUpdate): void;
  /**
   * The agent asked before doing something sensitive. Resolve with the chosen
   * optionId, or null to cancel the request. The UI backs this with the
   * askUser dialog; the default (no handler) denies.
   */
  onRequestPermission?(req: AcpPermissionRequest): Promise<string | null>;
  onExit?(error?: string): void;
}

export interface AcpSession {
  sessionId: string;
  /** Send one user turn; resolves with the ACP stop reason. */
  prompt(text: string): Promise<{ stopReason: string }>;
  cancel(): void;
  dispose(): Promise<void>;
}

// ---------- default (Tauri) bridge ----------

export const tauriBridge: AcpBridge = {
  spawn: (id, command, args, env) => invoke("acp_spawn", { id, command, args, env }),
  write: (id, line) => invoke("acp_write", { id, line }),
  kill: (id) => invoke("acp_kill", { id }),
  onEvent: (cb) =>
    listen<{ id: string; line: string }>("acp-event", (e) => cb(e.payload.id, e.payload.line)),
  onExit: (cb) => listen<{ id: string }>("acp-exit", (e) => cb(e.payload.id)),
};

// ---------- client ----------

/** Disambiguates concurrent connectors over the same configured agent. */
let connectSeq = 0;

/** ACP home for a session: the spec REQUIRES an absolute cwd; the app has no
 *  per-session cwd concept, so the user's home is the honest neutral answer. */
function homeDir(): string {
  try {
    // navigator is unavailable in some test contexts; home is a hint anyway.
    return (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.USERPROFILE
      ?? (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.HOME
      ?? "/";
  } catch {
    return "/";
  }
}

export async function acpConnect(
  cfg: AcpAgentConfig,
  hooks: AcpHooks,
  bridge: AcpBridge = tauriBridge,
  opts: { initTimeoutMs?: number } = {},
): Promise<AcpSession> {
  const initTimeoutMs = opts.initTimeoutMs ?? 30_000;
  // A unique key per connection: two connectors for the same configured agent
  // must never share the Rust relay slot or each other's events (their JSON-RPC
  // ids would collide). The UI runs one per agent; this makes it a guarantee
  // rather than an assumption.
  const rid = `${cfg.id}#${++connectSeq}`;
  const unlisteners: UnlistenFn[] = [];
  let nextId = 1;
  let sessionId: string | null = null;
  let exited: string | undefined;
  let disposed = false;
  // Requests we sent that are waiting for the agent's response, correlated by
  // JSON-RPC id — the same pattern localApi uses over its event bridge.
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  // The in-flight prompt turn, so session/cancel and exit can settle it.
  let turn: { reject: (e: Error) => void; aborted: boolean } | null = null;
  // Open permission requests: id -> a function that settles the request with
  // the cancelled outcome (writes the response, resolves the hook's promise),
  // so cancel/exit can answer requests the user never did.
  const openPermissions = new Map<number, () => void>();

  const wire = (fn: () => Promise<UnlistenFn>) => {
    const p = fn().then((u) => {
      unlisteners.push(u);
      return u;
    });
    unlisteners.push(() => {
      void p.catch(() => {});
    });
    return p;
  };

  const refuse = (id: number, method: string) => {
    void bridge
      .write(
        rid,
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `HarnessStation does not provide ${method}` },
        }),
      )
      .catch(() => {});
  };

  const failAll = (message: string) => {
    for (const [, p] of pending) p.reject(new Error(message));
    pending.clear();
    if (turn && !turn.aborted) {
      turn.aborted = true;
      turn.reject(new Error(message));
    }
    turn = null;
    for (const [, settle] of openPermissions) settle();
    openPermissions.clear();
    hooks.onExit?.(message);
  };

  await wire(() =>
    bridge.onEvent((id, line) => {
      if (id !== rid) return;
      let msg: {
        id?: number;
        method?: string;
        params?: { sessionId?: string; update?: AcpUpdate; options?: AcpPermissionRequest["options"]; toolCall?: { title?: string } };
        result?: unknown;
        error?: { message?: string };
      };
      try {
        msg = JSON.parse(line);
      } catch {
        return; // a malformed line from the agent is skipped, not fatal
      }

      // Agent → client requests.
      if (msg.method === "session/request_permission") {
        const reqId = msg.id;
        if (reqId == null) return;
        const options = msg.params?.options ?? [];
        // The hook's answer races a settle function owned by openPermissions —
        // that is what lets cancel() answer a request the user never did,
        // which the spec requires ("MUST respond ... with the cancelled
        // outcome") and what keeps a dismissed dialog from stranding the agent.
        let hookSettle: (v: string | null) => void = () => {};
        const decide = new Promise<string | null>((res) => {
          hookSettle = res;
        });
        // The settle function bundles both halves: write the cancelled outcome
        // to the agent, and resolve the hook's promise (which the UI awaits).
        openPermissions.set(reqId, () => {
          hookSettle(null);
          void bridge
            .write(rid, JSON.stringify({ jsonrpc: "2.0", id: reqId, result: { outcome: { outcome: "cancelled" } } }))
            .catch(() => {});
        });
        // An empty options array has nothing for a user to choose — the only
        // honest answer is the cancelled outcome, and asking would be noise.
        const source: Promise<string | null> =
          options.length === 0
            ? Promise.resolve(null)
            : hooks.onRequestPermission
              ? hooks.onRequestPermission({
                  sessionId: msg.params?.sessionId ?? sessionId ?? "",
                  toolCall: msg.params?.toolCall,
                  options,
                })
              : Promise.resolve(null);
        void source.then(hookSettle, () => hookSettle(null));
        void decide
          .then((optionId) => {
            // cancel() and exit() also settle via openPermissions — only write
            // when this is still the live entry (cancel deletes before calling).
            if (!openPermissions.has(reqId)) return;
            openPermissions.delete(reqId);
            if (exited) return; // the agent is gone; a response would be noise
            const outcome =
              optionId != null ? { outcome: "selected", optionId } : { outcome: "cancelled" };
            void bridge
              .write(rid, JSON.stringify({ jsonrpc: "2.0", id: reqId, result: { outcome } }))
              .catch(() => {});
          })
          .catch(() => {
            openPermissions.delete(reqId);
          });
        return;
      }
      if (msg.method?.startsWith("fs/") || msg.method?.startsWith("terminal/")) {
        if (msg.id != null) refuse(msg.id, msg.method);
        return;
      }

      // Responses to our requests.
      if (msg.id != null && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || "the agent returned an error"));
        else p.resolve(msg.result);
        return;
      }

      // Notifications.
      if (msg.method === "session/update" && msg.params?.update) {
        hooks.onUpdate(msg.params.update as AcpUpdate);
      }
    }),
  );

  await wire(() =>
    bridge.onExit((id) => {
      if (id !== rid) return;
      exited = "the agent process exited";
      failAll(exited);
    }),
  );

  const call = <T>(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      const entry = {
        resolve: (v: unknown) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      const timer =
        timeoutMs != null
          ? setTimeout(() => {
              pending.delete(id);
              entry.reject(new Error(`${method} timed out after ${timeoutMs}ms — the agent never answered.`));
            }, timeoutMs)
          : undefined;
      pending.set(id, entry);
      void bridge
        .write(rid, JSON.stringify({ jsonrpc: "2.0", id, method, params }))
        .catch((e: Error) => {
          clearTimeout(timer);
          pending.delete(id);
          reject(e);
        });
    });

  try {
    await bridge.spawn(rid, cfg.command, cfg.args ?? [], cfg.env ?? {});
    await call(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "harnessstation", version: "0.3.0" },
      },
      initTimeoutMs,
    );
    const created = await call<{ sessionId: string }>(
      "session/new",
      { cwd: homeDir(), mcpServers: [] },
      initTimeoutMs,
    );
    sessionId = created.sessionId;
  } catch (e) {
    failAll((e as Error).message || String(e));
    for (const u of unlisteners.splice(0)) u();
    void bridge.kill(rid).catch(() => {});
    throw e;
  }

  return {
    sessionId,

    async prompt(text: string) {
      if (!sessionId || exited) throw new Error("The ACP session is closed.");
      if (disposed) throw new Error("The ACP session was disposed.");
      if (turn) throw new Error("A prompt is already running — cancel it first.");
      return new Promise<{ stopReason: string }>((resolve, reject) => {
        turn = { reject, aborted: false };
        const reqId = nextId++;
        pending.set(reqId, {
          resolve: (v) => {
            turn = null;
            resolve(v as { stopReason: string });
          },
          reject: (e) => {
            turn = null;
            reject(e);
          },
        });
        void bridge
          .write(
            rid,
            JSON.stringify({
              jsonrpc: "2.0",
              id: reqId,
              method: "session/prompt",
              params: { sessionId, prompt: [{ type: "text", text }] },
            }),
          )
          .catch((e: Error) => {
            pending.delete(reqId);
            turn = null;
            reject(e);
          });
      });
    },

    cancel() {
      if (exited || !sessionId) return;
      // Spec: on session/cancel the client MUST answer every pending
      // session/request_permission with the cancelled outcome. The stored
      // settle function does both halves (write + hook resolve).
      for (const [reqId, settle] of [...openPermissions]) {
        openPermissions.delete(reqId);
        settle();
      }
      void bridge
        .write(rid, JSON.stringify({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } }))
        .catch(() => {});
    },

    async dispose() {
      if (disposed) return; // idempotent: exit + dispose + view teardown overlap
      disposed = true;
      if (sessionId && !exited) {
        await bridge
          .write(rid, JSON.stringify({ jsonrpc: "2.0", method: "session/close", params: { sessionId } }))
          .catch(() => {});
      }
      for (const u of unlisteners.splice(0)) u();
      failAll("the ACP session was disposed");
      await bridge.kill(rid).catch(() => {});
    },
  };
}
