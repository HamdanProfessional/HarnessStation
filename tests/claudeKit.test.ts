import { describe, expect, it } from "vitest";
import {
  KIT_NAME,
  agentKey,
  agentsArg,
  kitFiles,
  claudeSkillFile,
  toClaudeAgent,
} from "../src/lib/claudeKit";
import type { Agent } from "../src/lib/types";

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: "a1",
  name: "Critic",
  description: "Reviews code",
  instructions: "You are a critic.",
  providerId: "",
  model: "",
  temperature: 0.7,
  maxTokens: 4096,
  toolIds: [],
  workflowIds: [],
  subAgentIds: [],
  ...over,
});

describe("agent keys", () => {
  it("slugs a name into something the model can type", () => {
    // The key is the invocation handle, so spaces and capitals are typos
    // waiting to happen.
    expect(agentKey("Code Reviewer", new Set())).toBe("code-reviewer");
    expect(agentKey("  Deep   Research  ", new Set())).toBe("deep-research");
    expect(agentKey("API/Docs", new Set())).toBe("api-docs");
  });

  it("never returns an empty key", () => {
    // JSON.stringify would happily produce {"": {...}}, which is unreachable.
    expect(agentKey("!!!", new Set())).toBe("agent");
    expect(agentKey("", new Set())).toBe("agent");
  });

  it("suffixes a collision rather than letting one agent vanish", () => {
    // Two agents slugging to the same key means the second overwrites the
    // first in the object literal — silently, with no error anywhere.
    const taken = new Set<string>();
    expect(agentKey("Code Reviewer", taken)).toBe("code-reviewer");
    taken.add("code-reviewer");
    expect(agentKey("code reviewer", taken)).toBe("code-reviewer-2");
    taken.add("code-reviewer-2");
    expect(agentKey("CODE-REVIEWER", taken)).toBe("code-reviewer-3");
  });
});

describe("translating an agent", () => {
  it("carries the description across, because that is the selection signal", () => {
    const spec = toClaudeAgent(agent());
    expect(spec.description).toBe("Reviews code");
    expect(spec.prompt).toBe("You are a critic.");
  });

  it("substitutes a description when one is missing", () => {
    // Claude Code picks agents by description; a blank one makes the agent
    // effectively invisible rather than merely undocumented.
    expect(toClaudeAgent(agent({ description: "  " })).description).toContain("Critic");
  });

  it("passes a Claude model through", () => {
    expect(toClaudeAgent(agent({ model: "claude-opus-5" })).model).toBe("claude-opus-5");
    expect(toClaudeAgent(agent({ model: "opus" })).model).toBe("opus");
  });

  it("drops a model Claude Code could not resolve", () => {
    // A HarnessStation agent may point at a local GGUF or an OpenRouter slug.
    // Passing that through is a launch the CLI rejects.
    for (const m of ["llama-3.3-70b", "openai/gpt-5.6", "stealth/ox-alpha", "qwen2.5-coder"]) {
      expect(toClaudeAgent(agent({ model: m })).model, m).toBeUndefined();
    }
  });
});

describe("the --agents argument", () => {
  it("is valid JSON keyed by slug", () => {
    const parsed = JSON.parse(agentsArg([agent({ name: "Code Reviewer" })]));
    expect(Object.keys(parsed)).toEqual(["code-reviewer"]);
    expect(parsed["code-reviewer"].prompt).toBe("You are a critic.");
  });

  it("is empty when there is nothing to inject", () => {
    // "" lets the caller omit the flag; "{}" would be a flag that means nothing
    // and still has to be parsed by the CLI.
    expect(agentsArg([])).toBe("");
  });

  it("skips an agent with no instructions", () => {
    // Claude Code accepts a blank prompt and then runs the agent with no system
    // prompt at all, which is worse than not offering it.
    expect(agentsArg([agent({ instructions: "   " })])).toBe("");
  });

  it("keeps both agents when their names collide", () => {
    const parsed = JSON.parse(
      agentsArg([agent({ id: "a", name: "Critic" }), agent({ id: "b", name: "critic" })]),
    );
    expect(Object.keys(parsed).sort()).toEqual(["critic", "critic-2"]);
  });

  it("survives a prompt containing quotes and newlines", () => {
    // This string is passed as a single argv entry; if the encoding were naive
    // it would break the command line rather than the JSON.
    const instructions = 'Say "hi".\nThen stop.\tDone \\ ok';
    const parsed = JSON.parse(agentsArg([agent({ instructions })]));
    expect(parsed.critic.prompt).toBe(instructions);
  });
});

describe("the injected skill plugin", () => {
  const skill = { name: "Deep Research", description: "Research a topic", body: "Do the research." };

  it("writes the manifest, without which the directory is ignored", () => {
    // A --plugin-dir with no .claude-plugin/plugin.json does not error — the
    // skills simply never appear in system/init.
    const files = kitFiles([skill]);
    const manifest = files.find((f) => f.path === ".claude-plugin/plugin.json");
    expect(manifest).toBeDefined();
    expect(JSON.parse(manifest!.content).name).toBe(KIT_NAME);
  });

  it("puts each skill at the path Claude Code looks in", () => {
    const files = kitFiles([skill]);
    expect(files.map((f) => f.path)).toContain("skills/deep-research/SKILL.md");
  });

  it("skips a skill with no body", () => {
    expect(kitFiles([{ ...skill, body: "  " }]).map((f) => f.path)).toEqual([
      ".claude-plugin/plugin.json",
    ]);
  });

  it("does not let two skills collide onto one path", () => {
    const paths = kitFiles([skill, { ...skill, name: "deep research" }]).map((f) => f.path);
    expect(paths).toContain("skills/deep-research/SKILL.md");
    expect(paths).toContain("skills/deep-research-2/SKILL.md");
  });
});

describe("SKILL.md frontmatter", () => {
  it("has frontmatter first, with name and description", () => {
    const md = claudeSkillFile("demo", { name: "Demo", description: "Does a thing", body: "Body." });
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("name: demo");
    expect(md).toContain("Does a thing");
    expect(md.trimEnd().endsWith("Body.")).toBe(true);
  });

  it("quotes a description containing YAML punctuation", () => {
    // An unquoted scalar with ": " is a mapping, and one starting with # is a
    // comment. Either way the description is lost or the file fails to parse —
    // and a skill that fails to parse is absent, not reported.
    const md = claudeSkillFile("x", {
      name: "X",
      description: 'Handles: colons, "quotes" and # hashes',
      body: "b",
    });
    const line = md.split("\n").find((l) => l.startsWith("description:"))!;
    const value = line.slice("description:".length).trim();
    expect(value.startsWith('"') && value.endsWith('"')).toBe(true);
    expect(JSON.parse(value)).toBe('Handles: colons, "quotes" and # hashes');
  });

  it("flattens a multi-line description onto one line", () => {
    // Frontmatter is line-oriented; a raw newline in the value ends the entry
    // and turns the rest into an unknown key.
    const md = claudeSkillFile("x", { name: "X", description: "one\ntwo\n\nthree", body: "b" });
    const lines = md.split("\n");
    const i = lines.findIndex((l) => l.startsWith("description:"));
    expect(lines[i]).toContain("one two three");
    expect(lines[i + 1]).toBe("---");
  });

  it("substitutes a description when one is missing", () => {
    expect(claudeSkillFile("x", { name: "Thing", description: "", body: "b" })).toContain("Thing");
  });
});
