import type { Agent } from "./types";

/**
 * Translate HarnessStation's own agents and skills into the two things Claude
 * Code accepts as session-scoped injections.
 *
 * Agents go in as one `--agents` JSON object. Skills have no flag of their own:
 * the only session-scoped route is `--plugin-dir`, pointing at a directory laid
 * out as a plugin. Both were verified against CLI 2.1.239 by reading them back
 * out of the `system/init` event — see `docs/claude-code-wrapper.md`.
 *
 * Pure string/JSON building, no filesystem and no Tauri, so the mapping is
 * testable on its own. `writeKit` in the view layer does the writing.
 */

/** An agent as `--agents` wants it. `tools` omitted = inherit the session's set. */
export interface ClaudeAgentSpec {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

/**
 * Claude Code identifies agents by the key, and uses `description` to decide
 * when to reach for one — so a blank description makes an agent effectively
 * invisible to the model, not merely undocumented.
 */
export function toClaudeAgent(a: Agent): ClaudeAgentSpec {
  const spec: ClaudeAgentSpec = {
    description: a.description.trim() || `The ${a.name} agent from HarnessStation.`,
    prompt: a.instructions.trim(),
  };
  // A HarnessStation model id is only meaningful to Claude Code when it names a
  // Claude model; anything else (a local GGUF, an OpenRouter slug) would be
  // rejected, so it is dropped rather than passed through.
  if (/^claude[-a-z0-9.]*$/i.test(a.model) || ["opus", "sonnet", "haiku", "fable"].includes(a.model)) {
    spec.model = a.model;
  }
  return spec;
}

/**
 * Keys for the `--agents` object.
 *
 * Names are lowercased and hyphenated because the model types them to invoke an
 * agent, and a key with spaces or capitals is a key it will get wrong. A
 * collision after slugging would silently drop one agent — the later one wins
 * in an object literal — so duplicates get a numeric suffix instead.
 */
export function agentKey(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Build the `--agents` argument. Returns "" when there is nothing to inject, so
 * the caller can leave the flag off entirely rather than send `{}`.
 */
export function agentsArg(agents: Agent[]): string {
  const out: Record<string, ClaudeAgentSpec> = {};
  const taken = new Set<string>();
  for (const a of agents) {
    // An agent with no instructions has no prompt to run under; Claude Code
    // would accept it and then behave as though it had no system prompt.
    if (!a.instructions.trim()) continue;
    const key = agentKey(a.name, taken);
    taken.add(key);
    out[key] = toClaudeAgent(a);
  }
  return Object.keys(out).length ? JSON.stringify(out) : "";
}

export interface SkillSource {
  /** Directory name and the name the model invokes it by. */
  name: string;
  description: string;
  /** Markdown body — the instructions the skill loads into the turn. */
  body: string;
}

/** One file to write, relative to the kit root. */
export interface KitFile {
  path: string;
  content: string;
}

export const KIT_NAME = "harnessstation";

/**
 * Lay out a plugin directory containing the given skills.
 *
 * The shape is fixed by Claude Code: a `.claude-plugin/plugin.json` manifest at
 * the root, and one `skills/<name>/SKILL.md` per skill with YAML frontmatter
 * carrying `name` and `description`. A missing manifest means the directory is
 * ignored with no error — the skills simply never appear in `system/init`.
 */
export function kitFiles(skills: SkillSource[]): KitFile[] {
  const files: KitFile[] = [
    {
      path: ".claude-plugin/plugin.json",
      content: `${JSON.stringify(
        {
          name: KIT_NAME,
          description: "Skills injected by HarnessStation for this session.",
          version: "0.1.0",
        },
        null,
        2,
      )}\n`,
    },
  ];
  const taken = new Set<string>();
  for (const s of skills) {
    if (!s.body.trim()) continue;
    const name = agentKey(s.name, taken);
    taken.add(name);
    files.push({ path: `skills/${name}/SKILL.md`, content: claudeSkillFile(name, s) });
  }
  return files;
}

/**
 * A SKILL.md with its frontmatter.
 *
 * `description` is what the model reads to decide whether a skill is relevant,
 * so it must survive intact — and it is YAML, where a colon or a leading `#`
 * in an unquoted scalar changes the parse or breaks it. Quoting and escaping is
 * cheaper than discovering that a skill silently failed to register.
 */
export function claudeSkillFile(name: string, s: SkillSource): string {
  const desc = s.description.trim().replace(/\s+/g, " ") || `The ${s.name} skill from HarnessStation.`;
  return [
    "---",
    `name: ${name}`,
    `description: ${JSON.stringify(desc)}`,
    "---",
    "",
    s.body.trim(),
    "",
  ].join("\n");
}

// ---------- writing the kit ----------

/**
 * Write the plugin directory and return an absolute path for `--plugin-dir`.
 *
 * Absolute because the CLI resolves the flag against *its* working directory,
 * which is the session's `cwd` — some project folder the user picked, not ours.
 * A relative path would resolve somewhere unpredictable and, since a missing
 * plugin dir is ignored rather than reported, would fail silently.
 *
 * Rewritten on every launch: agents and skills are edited in the app between
 * runs, and a stale kit would inject the previous set with nothing to indicate
 * it had.
 */
export async function writeKit(skills: SkillSource[]): Promise<string> {
  const { BaseDirectory, mkdir, remove, writeTextFile, exists } = await import("@tauri-apps/plugin-fs");
  const { homeDir, join } = await import("@tauri-apps/api/path");
  const rel = `.harnessx/${KIT_NAME}-kit`;
  const opts = { baseDir: BaseDirectory.Home };

  // Clear first: a skill deleted in the app must disappear from the kit, and
  // writing over the top would leave the old SKILL.md in place.
  if (await exists(rel, opts)) await remove(rel, { ...opts, recursive: true });

  for (const file of kitFiles(skills)) {
    const path = `${rel}/${file.path}`;
    const dir = path.slice(0, path.lastIndexOf("/"));
    await mkdir(dir, { ...opts, recursive: true });
    await writeTextFile(path, file.content, opts);
  }
  return join(await homeDir(), ".harnessx", `${KIT_NAME}-kit`);
}
