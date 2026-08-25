#!/usr/bin/env node
/**
 * `hs` — HarnessStation from the command line.
 *
 * Ships alongside the desktop app so an agent (or a person in a terminal) can
 * drive the same harness the UI drives, rather than a parallel one. The logic
 * worth testing lives in `lib.mjs`; this file is the IO shell around it.
 *
 * Exit codes matter here because the caller is often a script: 0 success,
 * 1 a real failure, 2 misuse (unknown command, missing argument). A wrapper
 * that always exits 0 cannot be used in a pipeline.
 */

import readline from "node:readline";
import {
  HELP,
  apiTarget,
  chatBody,
  authHeaders,
  claudeEnvSnippet,
  deltaText,
  diagnose,
  endpointSnippet,
  findAgent,
  parseArgs,
  parseReplLine,
  readAgents,
  readSettings,
  readSkills,
  replBody,
  sseFrames,
} from "./lib.mjs";

const { cmd, args, flags } = parseArgs(process.argv.slice(2));
const out = (s) => process.stdout.write(`${s}\n`);
const err = (s) => process.stderr.write(`${s}\n`);
const asJson = !!flags.json;

const settings = readSettings();
const target = apiTarget(settings, flags.port);

/** Is anything listening? Cheap, and it separates "closed" from "misconfigured". */
async function reachable() {
  try {
    const res = await fetch(`${target.base}/models`, {
      headers: authHeaders(target),
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function requireApi() {
  const why = diagnose({ settings, target, reachable: await reachable() });
  if (why) {
    err(why);
    process.exit(1);
  }
}

/** Resolve -m/-a/-s flags into the request-shaping triple. */
function requestConfig() {
  const agent = flags.agent ? findAgent(readAgents(), flags.agent) : null;
  if (flags.agent && !agent) {
    err(`No agent called "${flags.agent}". Run \`hs agents\` to see them.`);
    process.exit(2);
  }
  return {
    model: typeof flags.model === "string" ? flags.model : "",
    system: typeof flags.system === "string" ? flags.system : "",
    agent,
  };
}

/**
 * One streamed turn: POST, print deltas as they arrive, return the full text.
 * `signal` lets a REPL abort a running reply without killing the session.
 */
async function streamTurn({ body, signal }) {
  const res = await fetch(`${target.base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(target) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`The app returned HTTP ${res.status}. ${text.slice(0, 400)}`);
  }

  let buffer = "";
  let full = "";
  for await (const chunk of res.body) {
    buffer += Buffer.from(chunk).toString("utf8");
    const { frames, tail } = sseFrames(buffer);
    buffer = tail;
    for (const f of frames) {
      const text = deltaText(f);
      if (text) {
        process.stdout.write(text);
        full += text;
      }
    }
  }
  return full;
}

/** Interactive multi-turn session. `hs chat` with no prompt lands here. */
async function repl(cfg) {
  out(`HarnessStation session — ${cfg.agent ? `agent ${cfg.agent.name}` : cfg.model || "default model"}`);
  out("Type a prompt; /help for commands, /exit or Ctrl+D to leave.\n");

  const rl = readline.createInterface({ input: process.stdin, terminal: true });
  const history = [];
  let interrupted = false;
  // Set while a line is being awaited, so EOF (Ctrl+D) can settle it — without
  // this the REPL hangs forever on EOF: readline closes, nobody resolves.
  let pendingLine = null;
  rl.on("close", () => {
    if (pendingLine) {
      pendingLine(null);
      pendingLine = null;
    }
  });
  rl.on("line", (line) => {
    if (pendingLine) {
      const resolve = pendingLine;
      pendingLine = null;
      resolve(line);
    }
  });

  // Ctrl+C while a reply streams aborts just that reply; while idle it leaves.
  process.on("SIGINT", () => {
    if (currentAbort) currentAbort.abort();
    else interrupted = true;
    rl.write("");
  });
  let currentAbort = null;

  const ask = () =>
    new Promise((resolve) => {
      pendingLine = resolve;
      if (interrupted) {
        pendingLine = null;
        resolve(null);
      }
    });

  try {
    for (;;) {
      const line = await ask();
      if (interrupted || line === null) break;
      const parsed = parseReplLine(line);
      if (parsed.type === "empty") continue;

      if (parsed.type === "command") {
        if (parsed.name === "exit") break;
        if (parsed.name === "new") {
          history.length = 0;
          out("(started a new conversation)");
          continue;
        }
        if (parsed.name === "model") {
          cfg.model = parsed.rest || cfg.model;
          out(`model: ${cfg.model || "(server default)"}`);
          continue;
        }
        if (parsed.name === "agent") {
          if (!parsed.rest) {
            out(`agent: ${cfg.agent ? cfg.agent.name : "(none)"}`);
            continue;
          }
          const a = findAgent(readAgents(), parsed.rest);
          if (!a) {
            err(`No agent called "${parsed.rest}". Run \`hs agents\` to see them.`);
            continue;
          }
          cfg.agent = a;
          out(`agent: ${a.name}${a.model ? ` [${a.model}]` : ""}`);
          continue;
        }
        if (parsed.name === "system") {
          cfg.system = parsed.rest;
          out(parsed.rest ? "(system prompt updated)" : "(system prompt cleared)");
          continue;
        }
        if (parsed.name === "history") {
          if (!history.length) out("(no turns yet)");
          for (const m of history)
            out(`${m.role === "user" ? "you" : "hs"}: ${m.content.slice(0, 200)}${m.content.length > 200 ? "…" : ""}`);
          continue;
        }
        if (parsed.name === "help") {
          out("/new /model [id] /agent [name] /system <text> /history /exit");
          continue;
        }
      }

      try {
        currentAbort = new AbortController();
        const body = replBody({ history, prompt: parsed.text ?? "", ...cfg });
        const reply = await streamTurn({ body, signal: currentAbort.signal });
        process.stdout.write("\n\n");
        history.push({ role: "user", content: parsed.text ?? "" });
        history.push({ role: "assistant", content: reply });
      } catch (e) {
        if (currentAbort.signal.aborted) {
          out("\n(stopped — history keeps what you sent; say it differently or /new)");
        } else {
          err(e?.message || String(e));
        }
      } finally {
        currentAbort = null;
      }
    }
  } finally {
    rl.close();
    out("");
  }
}

async function main() {
  if (flags.help || cmd === "help" || (!cmd && !args.length)) {
    out(HELP);
    return;
  }

  switch (cmd) {
    case "status": {
      const up = await reachable();
      if (asJson) {
        out(JSON.stringify({ ...target, reachable: up, agents: readAgents().length, skills: readSkills().length }, null, 2));
        return;
      }
      out(`config      ${settings ? "found" : "missing — run the desktop app once"}`);
      out(`api server  ${target.enabled ? "enabled" : "disabled in settings"} on port ${target.port}`);
      out(`reachable   ${up ? "yes" : "no"}`);
      out(`agents      ${readAgents().length}`);
      out(`skills      ${readSkills().length}`);
      if (!up) out(`\n${diagnose({ settings, target, reachable: up })}`);
      return;
    }

    case "doctor": {
      const why = diagnose({ settings, target, reachable: await reachable() });
      out(why || "Everything the CLI needs is in place.");
      process.exit(why ? 1 : 0);
      return;
    }

    case "models": {
      await requireApi();
      const res = await fetch(`${target.base}/models`, { headers: authHeaders(target) });
      const body = await res.json();
      const ids = (body.data ?? []).map((m) => m.id);
      out(asJson ? JSON.stringify(ids, null, 2) : ids.join("\n"));
      return;
    }

    case "endpoint": {
      await requireApi();
      const res = await fetch(`${target.base}/models`, { headers: authHeaders(target) });
      const body = await res.json();
      const models = (body.data ?? []).map((m) => m.id).slice(0, 12);
      out(asJson
        ? JSON.stringify({ baseUrl: target.base, anthropicBaseUrl: target.base.replace(/\/v1$/, ""), models }, null, 2)
        : [
            `Base URL: ${target.base}`,
            "",
            "Point any OpenAI-compatible tool at it — e.g. opencode's config:",
            "",
            endpointSnippet(target.base, models, "", target.token),
            "",
            "Claude Code (Anthropic protocol — any model, incl. local):",
            "",
            claudeEnvSnippet(target.base, "", target.token),
            "",
            "Function calling passes through on openai-compatible providers.",
          ].join("\n"));
      return;
    }

    case "agents": {
      const list = readAgents();
      if (asJson) return out(JSON.stringify(list, null, 2));
      if (!list.length) return out("No agents defined yet.");
      for (const a of list) out(`${a.name}${a.model ? `  [${a.model}]` : ""}\n  ${a.description || "(no description)"}`);
      return;
    }

    case "skills": {
      const list = readSkills();
      if (asJson) return out(JSON.stringify(list, null, 2));
      if (!list.length) return out("No skills yet.");
      for (const s of list) out(`${s.slug}\n  ${s.description || "(no description)"}`);
      return;
    }

    case "chat": {
      const prompt = args.join(" ").trim();

      if (!prompt) {
        await requireApi();
        await repl(requestConfig());
        return;
      }

      await requireApi();
      const stream = !(flags["no-stream"] || flags.stream === "false");
      const body = chatBody({ prompt, ...requestConfig(), stream });

      if (!stream) {
        const res = await fetch(`${target.base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders(target) },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          err(`The app returned HTTP ${res.status}. ${text.slice(0, 400)}`);
          process.exit(1);
        }
        const json = await res.json();
        out(asJson ? JSON.stringify(json, null, 2) : (json.choices?.[0]?.message?.content ?? ""));
        return;
      }

      // Stream straight to stdout so a long reply is readable as it arrives and
      // can be piped into something else.
      try {
        const full = await streamTurn({ body });
        if (full) process.stdout.write("\n");
      } catch (e) {
        err(e?.message || String(e));
        process.exit(1);
      }
      return;
    }

    default:
      err(`Unknown command: ${cmd}\n`);
      err(HELP);
      process.exit(2);
  }
}

main().catch((e) => {
  err(e?.message || String(e));
  process.exit(1);
});
