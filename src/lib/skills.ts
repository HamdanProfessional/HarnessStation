import { invoke } from "@tauri-apps/api/core";

/**
 * Skills — folders of instructions the model loads on demand.
 *
 * Only each skill's name + one-line description sits in the system prompt (cheap);
 * the full playbook is pulled in with the `use_skill` tool when it's actually relevant.
 * That keeps context small while giving the model deep, reusable know-how.
 *
 * Layout:  ~/.harnessx/skills/<slug>/SKILL.md
 *   ---
 *   name: Weekly report
 *   description: Use when the user asks for a weekly status report.
 *   ---
 *   <markdown instructions; may reference sibling files in the same folder>
 */

const ROOT = ".harnessx/skills";

export interface Skill {
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  /** Extra files bundled next to SKILL.md (templates, scripts, references). */
  files: string[];
}

const fsRead = (path: string) => invoke<string>("fs_read", { base: "", path });
const fsWrite = (path: string, content: string) =>
  invoke("fs_write", { base: "", path, content, append: false });
const fsMkdir = (path: string) => invoke("fs_mkdir", { base: "", path });
const fsRemove = (path: string) => invoke("fs_remove", { base: "", path });
const fsExists = (path: string) => invoke<boolean>("fs_exists", { base: "", path });
const fsList = (path: string) => invoke<{ name: string; dir: boolean }[]>("fs_list", { base: "", path });

/** Split `---` frontmatter from the markdown body. */
export function parseSkill(md: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { meta, body: md.slice(m[0].length).trim() };
}

export function skillMarkdown(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body.trim()}\n`;
}

export async function ensureSkillsDir(): Promise<void> {
  if (!(await fsExists(ROOT))) await fsMkdir(ROOT);
}

/** Scan the skills folder. Never throws — a malformed skill is skipped. */
export async function listSkills(): Promise<Skill[]> {
  try {
    if (!(await fsExists(ROOT))) return [];
    const entries = await fsList(ROOT);
    const out: Skill[] = [];
    for (const e of entries.filter((x) => x.dir)) {
      const dir = `${ROOT}/${e.name}`;
      try {
        const md = await fsRead(`${dir}/SKILL.md`);
        const { meta } = parseSkill(md);
        const files = (await fsList(dir))
          .filter((f) => !f.dir && f.name.toLowerCase() !== "skill.md")
          .map((f) => f.name);
        out.push({
          slug: e.name,
          name: meta.name || e.name,
          description: meta.description || "",
          enabled: (meta.enabled ?? "true").toLowerCase() !== "false",
          files,
        });
      } catch {
        /* not a skill folder */
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function readSkillRaw(slug: string): Promise<string> {
  return fsRead(`${ROOT}/${slug}/SKILL.md`);
}

export async function saveSkill(slug: string, markdown: string): Promise<void> {
  await ensureSkillsDir();
  const dir = `${ROOT}/${slug}`;
  if (!(await fsExists(dir))) await fsMkdir(dir);
  await fsWrite(`${dir}/SKILL.md`, markdown);
}

export async function deleteSkill(slug: string): Promise<void> {
  await fsRemove(`${ROOT}/${slug}`);
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || `skill-${Date.now()}`
  );
}

/** The cheap part that goes into every system prompt. */
export function skillIndexPrompt(skills: Skill[]): string {
  const usable = skills.filter((s) => s.enabled && s.description);
  if (!usable.length) return "";
  const lines = usable.map((s) => `- ${s.slug}: ${s.name} — ${s.description}`).join("\n");
  return `Available skills (detailed playbooks you can load on demand):\n${lines}\n\nWhen a request matches one of these, call the use_skill tool with its id FIRST, then follow the instructions it returns. Don't guess at a skill's contents without loading it.`;
}

/** The expensive part, pulled in only when the model asks for it. */
export async function loadSkillBody(slug: string): Promise<string> {
  const clean = slug.trim().replace(/[^\w-]/g, "");
  if (!clean) return "Error: no skill id given.";
  try {
    const md = await readSkillRaw(clean);
    const { meta, body } = parseSkill(md);
    let out = `# Skill: ${meta.name || clean}\n\n${body}`;
    const files = (await fsList(`${ROOT}/${clean}`))
      .filter((f) => !f.dir && f.name.toLowerCase() !== "skill.md")
      .map((f) => f.name);
    if (files.length) {
      out += `\n\nBundled files in this skill's folder (~/.harnessx/skills/${clean}/), read them with read_file if needed:\n${files
        .map((f) => `- ${f}`)
        .join("\n")}`;
    }
    return out;
  } catch {
    return `Error: skill "${clean}" not found.`;
  }
}

/** Ready-made skills installed on demand from the Skills view. */
export const STARTER_SKILLS: { name: string; description: string; body: string }[] = [
  {
    name: "Deep research",
    description:
      "Use when the user asks to research a topic thoroughly, compare options, or wants a sourced report.",
    body: `## Process
1. Restate the question and break it into 3–5 sub-questions.
2. For each: run web_search, then fetch_page on the 2 best results. Never cite a snippet you haven't opened.
3. Cross-check any number, date, or claim across at least two independent sources.
4. Note publication dates; prefer recent sources and say "as of <date>" for anything volatile.

## Output
- **Answer first** — 3–5 sentences that directly answer the question.
- **Key findings** — short bullets, each with the source name.
- **Caveats** — what's uncertain or disputed.
- **Sources** — markdown links you actually opened.

## Rules
- Separate what sources say from your own inference.
- If you can't verify something, say so instead of filling the gap.`,
  },
  {
    name: "Code review",
    description: "Use when asked to review, audit, or critique code for bugs and quality.",
    body: `## Process
1. Map the change: list_folder / grep_files to find the relevant files, then read_file them fully.
2. Run the project's tests or typecheck with run_terminal when one exists.
3. Review in this order: correctness → security → error handling → performance → readability.

## Output
For each finding: **severity** · \`path:line\` · what breaks · a concrete fix.
Rank most severe first. If the code is clean, say so — don't invent nits.

## Rules
- Only report issues you can point to in code you actually read.
- Describe fixes; don't rewrite the user's files unless asked.`,
  },
  {
    name: "Meeting notes",
    description: "Use when the user pastes or dictates a meeting, call, or long discussion to summarize.",
    body: `## Output format
**TL;DR** — 2 sentences.

**Decisions** — what was actually decided (not discussed).

**Action items** — \`- [ ] Owner — task — due date\`. If an owner or date is missing, write "unassigned"/"no date" rather than guessing.

**Open questions** — unresolved items.

## Rules
- Preserve names and numbers exactly.
- Leave out small talk and repetition.
- If something was ambiguous, list it under Open questions instead of inventing a resolution.`,
  },
];
