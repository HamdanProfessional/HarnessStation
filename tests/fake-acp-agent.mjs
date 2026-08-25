#!/usr/bin/env node
/**
 * A minimal fake ACP agent for tests (plan WP3): speaks enough of the
 * protocol — initialize, session/new, session/prompt with streamed chunks, a
 * permission round-trip, a client-filesystem request the client is expected
 * to refuse, and cancellation — to exercise acpConnect end-to-end.
 *
 * Prompt words drive behaviour:
 *   "perm…"    → session/request_permission, then reports the chosen option
 *   "readfile" → fs/read_text_file to the client (expected: refused), then
 *                reports the error text it got back
 *   "hang"     → streams one chunk and waits for session/cancel
 *   anything else → two ordinary chunks, end_turn
 */
import { createInterface } from "node:readline";

const write = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const respond = (id, result) => write({ jsonrpc: "2.0", id, result });
const update = (sessionId, u) =>
  write({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: u } });

let turn = null; // { id, sessionId }
const responseWaiters = new Map(); // agent request id -> fn(client msg)
// Records the outcome of any permission answer that arrives after its turn was
// cancelled — proof that the client still answered the request itself.
let lastPermissionOutcome = "none";

let sessionSeq = 0;
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }

  // A client response to one of OUR requests (permission, fs) — no method.
  if (msg.id !== undefined && msg.method === undefined) {
    const fn = responseWaiters.get(msg.id);
    if (fn) {
      responseWaiters.delete(msg.id);
      fn(msg);
    } else if (msg.result?.outcome) {
      // A late answer to a request whose turn was already cancelled � recorded
      // so the cancel test can prove the client answered it anyway.
      lastPermissionOutcome = msg.result.outcome?.optionId ?? msg.result.outcome?.outcome ?? "unknown";
    }
    return;
  }

  const { id, method, params = {} } = msg;
  switch (method) {
    case "initialize": {
      const respondInit = () =>
        respond(id, {
          protocolVersion: 1,
          agentCapabilities: { promptCapabilities: {} },
          agentInfo: { name: "fake-acp", title: "Fake ACP", version: "0.1.0" },
          authMethods: [],
        });
      const delay = Number(process.env.FAKE_DELAY_INIT_MS ?? 0);
      if (delay > 0) setTimeout(respondInit, delay);
      else respondInit();
      return;
    }
    case "session/new":
      respond(id, { sessionId: `sess_fake_${process.pid}_${++sessionSeq}` });
      return;
    case "session/prompt": {
      const sessionId = params.sessionId;
      const text = (params.prompt ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      turn = { id, sessionId };
      const chunk = (t) =>
        update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } });
      const end = (stopReason = "end_turn") => {
        respond(id, { stopReason });
        turn = null;
      };

      if (text.startsWith("permnoopts")) {
        // A request with nothing to choose — the client should auto-cancel it
        // rather than showing the user an empty question.
        write({
          jsonrpc: "2.0",
          id: 902,
          method: "session/request_permission",
          params: { sessionId, toolCall: { title: "Mystery" }, options: [] },
        });
        onceResponse(902, (resp) => {
          const outcome = resp?.result?.outcome;
          chunk(`permnoopts:${outcome?.outcome === "cancelled" ? "cancelled" : outcome?.optionId ?? "other"}`);
          end();
        });
        return;
      }
      if (text.startsWith("permhang")) {
        // Ask, then wait for the answer even if the turn is cancelled — the
        // client must still answer the request itself (spec requirement).
        write({
          jsonrpc: "2.0",
          id: 903,
          method: "session/request_permission",
          params: {
            sessionId,
            toolCall: { title: "Hanging permission" },
            options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
          },
        });
        onceResponse(903, (resp) => {
          const outcome = resp?.result?.outcome;
          lastPermissionOutcome = outcome?.optionId ?? outcome?.outcome ?? "none";
        });
        return; // never ends the turn on its own
      }
      if (text.startsWith("perm")) {
        write({
          jsonrpc: "2.0",
          id: 900,
          method: "session/request_permission",
          params: {
            sessionId,
            toolCall: { title: "Write a file" },
            options: [
              { optionId: "allow", name: "Allow", kind: "allow_once" },
              { optionId: "deny", name: "Deny", kind: "deny_once" },
            ],
          },
        });
        onceResponse(900, (resp) => {
          const outcome = resp?.result;
          chunk(`permission:${outcome?.outcome === "selected" ? outcome.optionId : "cancelled"}`);
          end();
        });
        return;
      }
      if (text.startsWith("readfile")) {
        write({
          jsonrpc: "2.0",
          id: 901,
          method: "fs/read_text_file",
          params: { sessionId, path: "/tmp/x.txt", line: 1, limit: 1 },
        });
        onceResponse(901, (resp) => {
          chunk(resp?.error ? `fs-error:${resp.error.message}` : "fs-unexpected-success");
          end();
        });        return;
      }
      if (text === "hang") {
        chunk("waiting");
        return; // stays open until session/cancel
      }
      if (text === "permreport") {
        chunk(`perm-was:${lastPermissionOutcome}`);
        end();
        return;
      }
      chunk("Hello from fake");
      chunk("!");
      end();
      return;
    }
    case "session/cancel":
      if (turn) {
        update(turn.sessionId, {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `perm-was:${lastPermissionOutcome}` },
        });
        respond(turn.id, { stopReason: "cancelled" });
        turn = null;
      }
      return;
    case "session/close":
      respond(id, {});
      process.exit(0);
      return;
    default:
      if (id !== undefined) {
        write({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
  }
});

function onceResponse(reqId, fn) {
  responseWaiters.set(reqId, fn);
}
