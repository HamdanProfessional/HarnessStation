#!/usr/bin/env node
/**
 * `hs-acp` — HarnessStation as an Agent Client Protocol agent.
 *
 * Speaks ACP v1 (newline-delimited JSON-RPC over stdio — the same framing as
 * the app's local API and our MCP server) and answers every prompt from the
 * app's local API, so the models, agents and combos configured in
 * HarnessStation appear as selectable agents in any ACP client — JetBrains
 * 2026.2+, Zed, Devin Desktop, and anything else on the registry.
 *
 * This is memo option A1 (docs/research/acp-decision-2026-08-25.md): honest
 * model routing, no app-side tools. The editor brings its own via MCP; our
 * agents' app-side tool loop is option A2, deliberately unbuilt.
 *
 * The agent is one model id, chosen at launch:
 *
 *     hs-acp --model combo/cheap-first
 *     hs-acp --agent research-assistant
 *     hs-acp                       # falls back to the API's first model
 *
 * Register it in an editor (JetBrains `acp.json`, Zed settings):
 *
 *     { "command": "node", "args": ["<app>/cli/acp.mjs", "--model", "agent/x"] }
 *
 * stdout carries only ACP frames; logs go to stderr.
 */
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  apiTarget,
  authHeaders,
  deltaText,
  diagnose,
  parseArgs,
  readSettings,
  sseFrames,
} from "./lib.mjs";

const PROTOCOL_VERSION = 1;
const AGENT_INFO = { name: "harnessstation", title: "HarnessStation", version: "0.3.0" };
/** Per-session history cap: an editor session can run for days, and unbounded
 *  memory in a bridge nobody restarts is a slow crash. 200 turns is far past
 *  where a model's context window stops caring anyway. */
const MAX_HISTORY = 200;

// ---------- pure helpers (exported for tests) ----------

/** Concatenate the text blocks of an ACP prompt; non-text blocks are not advertised. */
export function promptText(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

/** Map a chat-completions finish_reason + abort state onto an ACP StopReason. */
export function stopReasonFor(finish, aborted) {
  if (aborted) return "cancelled";
  if (finish === "length") return "max_tokens";
  return "end_turn";
}

/** An agent_message_chunk update notification, ready to write. */
export function chunkFrame(sessionId, text, messageId) {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        ...(messageId ? { messageId } : {}),
        content: { type: "text", text },
      },
    },
  };
}

/** Pull the finish_reason out of one SSE data payload ("" when none). */
export function finishOf(payload) {
  if (!payload || payload === "[DONE]") return "";
  try {
    return JSON.parse(payload)?.choices?.[0]?.finish_reason ?? "";
  } catch {
    return "";
  }
}

/** Trim history oldest-out once it passes the cap. */
export function capHistory(history) {
  return history.length > MAX_HISTORY ? history.slice(-MAX_HISTORY) : history;
}

// ---------- the agent ----------

export function createAgent({ target, model, system }) {
  /** sessionId -> { history: [{role, content}], controller: AbortController | null } */
  const sessions = new Map();
  let defaultModel = model || "";

  async function resolveModel() {
    if (defaultModel) return defaultModel;
    const res = await fetch(`${target.base}/models`, {
      headers: authHeaders(target),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`The app returned HTTP ${res.status} for /models.`);
    const first = (await res.json())?.data?.[0]?.id;
    if (!first) throw new Error("The app has no models configured yet.");
    defaultModel = first;
    return defaultModel;
  }

  return {
    async initialize() {
      // The app must be reachable before an editor burns a turn on us.
      const why = diagnose({
        settings: readSettings(),
        target,
        reachable: await fetch(`${target.base}/models`, {
          headers: authHeaders(target),
          signal: AbortSignal.timeout(2500),
        })
          .then((r) => r.ok)
          .catch(() => false),
      });
      if (why) throw new Error(why);
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { promptCapabilities: {} },
        agentInfo: AGENT_INFO,
        authMethods: [],
      };
    },

    async sessionNew() {
      const sessionId = `sess_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
      sessions.set(sessionId, { history: [], controller: null });
      return { sessionId };
    },

    /**
     * One prompt turn. `notify` delivers session/update frames; the resolved
     * value is the JSON-RPC result. Model-only by design: in this mode the
     * editor's own MCP servers are where tools come from.
     */
    async prompt(sessionId, blocks, notify) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`Unknown session: ${sessionId}`);
      // One turn at a time per session: a concurrent prompt would corrupt the
      // history interleaving and race the abort controller.
      if (session.controller) throw new Error("A prompt is already running in this session.");
      const text = promptText(blocks);
      if (!text.trim()) throw new Error("The prompt had no text content.");

      const modelName = await resolveModel();
      const out = [];
      if (system?.trim()) out.push({ role: "system", content: system.trim() });
      for (const m of session.history) out.push({ role: m.role, content: m.content });
      out.push({ role: "user", content: text });

      const controller = new AbortController();
      session.controller = controller;
      const messageId = `msg_${Date.now().toString(36)}`;
      let finish = "";
      let assistant = "";

      try {
        const res = await fetch(`${target.base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders(target) },
          body: JSON.stringify({ model: modelName, messages: out, stream: true }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`The app returned HTTP ${res.status}. ${detail.slice(0, 300)}`);
        }
        let buffer = "";
        for await (const chunk of res.body) {
          buffer += Buffer.from(chunk).toString("utf8");
          const { frames, tail } = sseFrames(buffer);
          buffer = tail;
          for (const f of frames) {
            const fin = finishOf(f);
            if (fin) finish = fin;
            const t = deltaText(f);
            if (t) {
              assistant += t;
              notify(chunkFrame(sessionId, t, messageId));
            }
          }
        }
      } catch (e) {
        if (controller.signal.aborted) {
          // Keep what was streamed so the conversation can continue.
          if (assistant) {
            session.history = capHistory([...out, { role: "assistant", content: assistant }]);
          }
          return { stopReason: "cancelled" };
        }
        throw e;
      } finally {
        session.controller = null;
      }

      session.history = capHistory([...out, { role: "assistant", content: assistant }]);
      return { stopReason: stopReasonFor(finish, false) };
    },

    cancel(sessionId) {
      sessions.get(sessionId)?.controller?.abort();
    },

    close(sessionId) {
      sessions.get(sessionId)?.controller?.abort();
      sessions.delete(sessionId);
    },
  };
}

// ---------- stdio shell ----------

export async function main(argv = process.argv.slice(2)) {
  const { flags } = parseArgs(argv);
  const target = apiTarget(readSettings(), flags.port);
  // `--agent <name>` is sugar for the model id form the API already speaks.
  const model =
    typeof flags.agent === "string"
      ? `agent/${flags.agent}`
      : typeof flags.model === "string"
        ? flags.model
        : "";
  const system = typeof flags.system === "string" ? flags.system : "";
  const agent = createAgent({ target, model, system });

  const write = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const err = (s) => process.stderr.write(`${s}\n`);

  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return; // a malformed line is skipped, not fatal
    }
    void handle(msg).then(
      (result) => {
        if (result !== undefined) write({ jsonrpc: "2.0", id: msg.id, result });
      },
      (e) => {
        if (msg.id !== undefined && msg.id !== null) {
          write({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: typeof e?.code === "number" ? e.code : -32000, message: e?.message || String(e) },
          });
        } else {
          err(`[hs-acp] ${e?.message || e}`);
        }
      },
    );
  });
  rl.on("close", () => process.exit(0));

  async function handle(msg) {
    const { method, params = {} } = msg;
    switch (method) {
      case "initialize":
        return agent.initialize();
      case "session/new":
        return agent.sessionNew();
      case "session/prompt":
        return agent.prompt(params.sessionId, params.prompt, (frame) => write(frame));
      case "session/cancel":
        agent.cancel(params.sessionId);
        return undefined; // notification — no response
      case "session/close":
        agent.close(params.sessionId);
        return {};
      case "session/load":
      case "session/resume":
        throw new Error("This agent does not support session persistence — start a new session.");
      case "authenticate":
        throw new Error("This agent needs no authentication.");
      default:
        throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
    }
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    process.stderr.write(`[hs-acp] ${e?.message || e}\n`);
    process.exit(1);
  });
}
