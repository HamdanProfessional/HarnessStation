/**
 * The testable half of the `hs` CLI: argument parsing, config reading, and
 * output formatting. No network, no process exit, no stdout — so every rule
 * here can be checked without a running app or a live provider.
 *
 * `hs.mjs` is the thin shell that does the IO around it.
 *
 * ## Why the CLI is a client rather than a second implementation
 *
 * HarnessStation's core — providers, streaming, tools, agents — is TypeScript
 * that imports `@tauri-apps/plugin-http` and `@tauri-apps/plugin-fs`. Those only
 * resolve inside the app. Reimplementing them for Node would fork the provider
 * layer, and the fork would drift the first time a provider changed.
 *
 * So anything that needs a model goes through the app's own OpenAI-compatible
 * server (`src-tauri/src/localapi.rs`), and anything that is just files on disk
 * — agents, skills, settings — is read directly. That split is why some
 * commands work with the app closed and some don't.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";

export const ROOT = () => join(homedir(), ".harnessx");

/** The port the app's API server uses when the user hasn't picked one. */
export const DEFAULT_PORT = 11435;

// ---------- argument parsing ----------

/**
 * Parse `argv` into a command, positionals and flags.
 *
 * Deliberately small: `--flag value`, `--flag=value`, `-m value`, and bare
 * `--flag` for booleans. Everything after `--` is positional, so a prompt that
 * starts with a dash can still be sent.
 */
export function parseArgs(argv) {
  const out = { cmd: "", args: [], flags: {} };
  const rest = [...argv];
  let literal = false;

  while (rest.length) {
    const a = rest.shift();
    if (literal) {
      out.args.push(a);
      continue;
    }
    if (a === "--") {
      literal = true;
      continue;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        out.flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const name = a.slice(2);
      // A flag followed by another flag is a boolean, not a flag with a
      // flag-shaped value.
      if (rest.length && !rest[0].startsWith("-")) out.flags[name] = rest.shift();
      else out.flags[name] = true;
      continue;
    }
    if (a.startsWith("-") && a.length > 1) {
      const name = SHORT[a.slice(1)] ?? a.slice(1);
      if (rest.length && !rest[0].startsWith("-")) out.flags[name] = rest.shift();
      else out.flags[name] = true;
      continue;
    }
    if (!out.cmd) out.cmd = a;
    else out.args.push(a);
  }
  return out;
}

const SHORT = { m: "model", a: "agent", s: "system", p: "port", h: "help", j: "json" };

// ---------- config on disk ----------

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** The app's settings, or null when it has never been run. */
export const readSettings = (root = ROOT()) => readJson(join(root, "settings.json"));

/**
 * Where the API server is, from settings.
 *
 * `enabled` matters as much as the port: the server only runs when the user has
 * switched it on, so "connection refused" has two very different causes and the
 * CLI should be able to tell them apart before it makes a request.
 */
export function apiTarget(settings, portOverride) {
  const cfg = settings?.localApi ?? {};
  const explicit = Number(portOverride) > 0;
  const port = explicit ? Number(portOverride) : cfg.port || DEFAULT_PORT;
  // `explicit` is not cosmetic: naming a port says where to go, which makes the
  // app's own on/off toggle irrelevant. Without this, pointing the CLI at any
  // other compatible server is refused because of a setting that does not
  // govern it.
  return { port, explicit, enabled: !!cfg.enabled, base: `http://127.0.0.1:${port}/v1` };
}

/** Agents defined in the app, as {name, description, model}. */
export function readAgents(root = ROOT()) {
  const s = readSettings(root);
  const list = Array.isArray(s?.agents) ? s.agents : [];
  return list.map((a) => ({
    name: a.name ?? "",
    description: a.description ?? "",
    model: a.model ?? "",
    instructions: a.instructions ?? "",
  }));
}

/**
 * Skills on disk, read from `~/.harnessx/skills/<slug>/SKILL.md`.
 *
 * Parsed rather than merely listed so `hs skills` can show descriptions, which
 * is the field that says what a skill is actually for.
 */
export function readSkills(root = ROOT()) {
  const dir = join(root, "skills");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const md = join(dir, entry.name, "SKILL.md");
    if (!existsSync(md)) continue;
    let body = "";
    try {
      body = readFileSync(md, "utf8");
    } catch {
      continue;
    }
    out.push({ slug: entry.name, ...frontmatter(body) });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Pull `name` and `description` out of YAML frontmatter.
 *
 * Not a YAML parser: only the two scalar keys that matter, and it tolerates the
 * quoted form the app writes as well as the bare form a human would.
 */
export function frontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  const out = { name: "", description: "" };
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*)$/i.exec(line.trim());
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    if (key !== "name" && key !== "description") continue;
    let v = kv[2].trim();
    if (v.startsWith('"')) {
      try {
        v = JSON.parse(v);
      } catch {
        /* leave the raw value rather than dropping the field */
      }
    }
    out[key] = v;
  }
  return out;
}

// ---------- building requests ----------

/**
 * Build the chat request body.
 *
 * An agent contributes its instructions as a system message and, when it names
 * one, its model — the same precedence the app uses, with an explicit `--model`
 * still winning because it was typed for this run.
 */
export function chatBody({ prompt, model, system, agent, stream = true }) {
  const messages = [];
  const sys = [agent?.instructions?.trim(), system?.trim()].filter(Boolean).join("\n\n");
  if (sys) messages.push({ role: "system", content: sys });
  messages.push({ role: "user", content: prompt });

  const body = { messages, stream };
  const chosen = model || agent?.model || "";
  if (chosen) body.model = chosen;
  return body;
}

/**
 * The REPL's request body: prior turns ride along so the conversation has
 * memory across lines. The system message stays first, exactly where the
 * server expects it to fold into the effective instructions.
 */
export function replBody({ history, prompt, model, system, agent }) {
  const messages = [];
  const sys = [agent?.instructions?.trim(), system?.trim()].filter(Boolean).join("\n\n");
  if (sys) messages.push({ role: "system", content: sys });
  for (const m of history) messages.push({ role: m.role, content: m.content });
  messages.push({ role: "user", content: prompt });

  const body = { messages, stream: true };
  const chosen = model || agent?.model || "";
  if (chosen) body.model = chosen;
  return body;
}

const REPL_COMMANDS = ["exit", "quit", "new", "model", "agent", "system", "history", "help"];

/**
 * A REPL input line is either a slash command or a prompt.
 * Unknown "/words" are prompts — a model may well be asked about "/etc/hosts".
 */
export function parseReplLine(line) {
  const text = String(line ?? "").trim();
  if (!text) return { type: "empty" };
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!m) return { type: "prompt", text };
  const name = m[1].toLowerCase();
  if (!REPL_COMMANDS.includes(name)) return { type: "prompt", text };
  return { type: "command", name: name === "quit" ? "exit" : name, rest: (m[2] ?? "").trim() };
}

/**
 * A ready-to-paste provider block for tools that accept OpenAI-compatible
 * endpoints (opencode, Aider, LangChain…). Emitted rather than documented so
 * it can never drift from the actual port.
 */
export function endpointSnippet(base, models, indent = "") {
  const list = models.map((m) => `${indent}      "${m}"`).join(",\n");
  return `${indent}{
${indent}  "provider": {
${indent}    "api": "openai",
${indent}    "baseUrl": "${base}",
${indent}    "models": [
${list}
${indent}    ]
${indent}  }
${indent}}`;
}

/**
 * Environment for pointing Claude Code at the app. The Anthropic SDK appends
 * /v1/messages itself, so the base URL must not include it.
 */
export function claudeEnvSnippet(base, model) {
  const root = base.replace(/\/v1\/?$/, "");
  const m = model || "provider/model — see `hs models`";
  return [
    `ANTHROPIC_BASE_URL=${root}`,
    "ANTHROPIC_AUTH_TOKEN=hs-local",
    `ANTHROPIC_MODEL=${m}`,
    `ANTHROPIC_SMALL_FAST_MODEL=${m}`,
  ].join("\n");
}

/** Find an agent by name, case- and space-insensitively. */
export function findAgent(agents, name) {
  const want = String(name ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!want) return null;
  return agents.find((a) => a.name.toLowerCase().replace(/\s+/g, "") === want) ?? null;
}

// ---------- reading the response ----------

/**
 * Pull the text delta out of one SSE `data:` payload.
 *
 * Returns "" for the frames that carry no text — role-only openers, the
 * `[DONE]` sentinel — so the caller can print unconditionally.
 */
export function deltaText(payload) {
  if (!payload || payload === "[DONE]") return "";
  try {
    const d = JSON.parse(payload);
    return d?.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}

/** Split an SSE buffer into complete events, returning the unconsumed tail. */
export function sseFrames(buffer) {
  const parts = buffer.split(/\r?\n\r?\n/);
  const tail = parts.pop() ?? "";
  const frames = [];
  for (const p of parts) {
    for (const line of p.split(/\r?\n/)) {
      if (line.startsWith("data:")) frames.push(line.slice(5).trim());
    }
  }
  return { frames, tail };
}

// ---------- diagnosis ----------

/**
 * Explain why a request would fail, before making it.
 *
 * "Connection refused" is the same string whether the app is closed, the server
 * is switched off, or the port was changed — three different fixes. Checking
 * settings first turns one unhelpful error into a specific instruction.
 */
export function diagnose({ settings, target, reachable }) {
  if (!settings) {
    return "No HarnessStation config found — run the desktop app once to create ~/.harnessx.";
  }
  if (!target.enabled && !target.explicit) {
    return "The local API server is switched off. Turn it on in the app: Settings → Local API.";
  }
  if (!reachable) {
    return `Nothing is listening on 127.0.0.1:${target.port}. Is the desktop app running?`;
  }
  return "";
}

export const HELP = `hs — HarnessStation from the command line

Usage
  hs status                     is the app reachable, and what is configured
  hs models                     list models the app can reach
  hs agents                     list agents defined in the app
  hs skills                     list skills in ~/.harnessx/skills
  hs chat <prompt>              send a prompt and stream the reply
  hs chat                       interactive session (see below)
  hs endpoint                   print the API base URL and a ready-to-paste
                                provider config for opencode / Aider / SDKs
  hs doctor                     explain why chat is not working

Interactive session
  Running \`hs chat\` with no prompt opens a multi-turn session. Slash commands:

    /new            start over (keeps model and agent)
    /model [id]     show or switch the model
    /agent [name]   show or switch the agent
    /system <text>  replace the extra system prompt
    /history        show the turns sent so far
    /exit           leave (Ctrl+D also works; Ctrl+C stops a running reply)

Options
  -m, --model <id>              model to use
  -a, --agent <name>            run as one of your agents
  -s, --system <text>           extra system prompt
  -p, --port <n>                API port (default from settings, else ${DEFAULT_PORT})
  -j, --json                    machine-readable output
      --no-stream               wait for the whole reply
  -h, --help                    this text

Tools note
  The local API passes OpenAI function-calling through to openai-compatible
  providers, so agents like opencode can drive the models configured here —
  including local GGUFs — with their own tools.

Commands that need a model go through the app's local API server, so the
desktop app must be running with that server enabled. Inventory commands
(agents, skills) read ~/.harnessx directly and work with the app closed.
`;
