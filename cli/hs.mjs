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

import {
  HELP,
  apiTarget,
  chatBody,
  deltaText,
  diagnose,
  findAgent,
  parseArgs,
  readAgents,
  readSettings,
  readSkills,
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
      const res = await fetch(`${target.base}/models`);
      const body = await res.json();
      const ids = (body.data ?? []).map((m) => m.id);
      out(asJson ? JSON.stringify(ids, null, 2) : ids.join("\n"));
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
        err("Nothing to send. Try: hs chat \"summarise this repo\"");
        process.exit(2);
      }
      await requireApi();

      const agent = flags.agent ? findAgent(readAgents(), flags.agent) : null;
      if (flags.agent && !agent) {
        err(`No agent called "${flags.agent}". Run \`hs agents\` to see them.`);
        process.exit(2);
      }

      // --no-stream arrives as flags.stream === "false" or flags["no-stream"].
      const stream = !(flags["no-stream"] || flags.stream === "false");
      const body = chatBody({
        prompt,
        model: typeof flags.model === "string" ? flags.model : "",
        system: typeof flags.system === "string" ? flags.system : "",
        agent,
        stream,
      });

      const res = await fetch(`${target.base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        err(`The app returned HTTP ${res.status}. ${text.slice(0, 400)}`);
        process.exit(1);
      }

      if (!stream) {
        const json = await res.json();
        out(asJson ? JSON.stringify(json, null, 2) : (json.choices?.[0]?.message?.content ?? ""));
        return;
      }

      // Stream straight to stdout so a long reply is readable as it arrives and
      // can be piped into something else.
      let buffer = "";
      let wrote = false;
      for await (const chunk of res.body) {
        buffer += Buffer.from(chunk).toString("utf8");
        const { frames, tail } = sseFrames(buffer);
        buffer = tail;
        for (const f of frames) {
          const text = deltaText(f);
          if (text) {
            process.stdout.write(text);
            wrote = true;
          }
        }
      }
      if (wrote) process.stdout.write("\n");
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
