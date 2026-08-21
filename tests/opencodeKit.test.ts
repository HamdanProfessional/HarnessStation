import { describe, expect, it } from "vitest";
import { opencodeAgentFile, opencodeKitFiles } from "../src/lib/claudeKit";
import { describeError, opencodeText, isStepFinish, type OpencodeEvent } from "../src/lib/opencode";
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

const skill = { name: "Deep Research", description: "Research a topic", body: "Do the research." };

describe("the opencode kit layout", () => {
  it("writes one markdown file per agent, named after the agent", () => {
    // opencode takes the agent name from the filename; there is no --agents
    // flag to pass JSON to, unlike Claude Code.
    const paths = opencodeKitFiles([agent({ name: "Code Reviewer" })], []).map((f) => f.path);
    expect(paths).toEqual(["agent/code-reviewer.md"]);
  });

  it("puts skills where opencode looks for them", () => {
    const paths = opencodeKitFiles([], [skill]).map((f) => f.path);
    expect(paths).toEqual(["skills/deep-research/SKILL.md"]);
  });

  it("writes no plugin manifest, which opencode does not use", () => {
    // The Claude Code kit needs .claude-plugin/plugin.json or the directory is
    // ignored. opencode reads the config dir directly — a manifest there is
    // just a stray file.
    const paths = opencodeKitFiles([agent()], [skill]).map((f) => f.path);
    expect(paths.some((p) => p.includes("plugin.json"))).toBe(false);
  });

  it("skips empty agents and skills", () => {
    expect(opencodeKitFiles([agent({ instructions: " " })], [{ ...skill, body: " " }])).toEqual([]);
  });

  it("does not let two agents collide onto one filename", () => {
    const paths = opencodeKitFiles(
      [agent({ id: "a", name: "Critic" }), agent({ id: "b", name: "critic" })],
      [],
    ).map((f) => f.path);
    expect(paths).toEqual(["agent/critic.md", "agent/critic-2.md"]);
  });

  it("reuses the shared SKILL.md, since opencode reads Claude's format verbatim", () => {
    const oc = opencodeKitFiles([], [skill])[0].content;
    expect(oc.startsWith("---\n")).toBe(true);
    expect(oc).toContain("name: deep-research");
    expect(oc).toContain("Research a topic");
  });
});

describe("an opencode agent file", () => {
  it("declares subagent mode", () => {
    // primary would put every injected agent in the rotation for driving the
    // whole session, rather than being delegated to.
    expect(opencodeAgentFile(agent())).toContain("mode: subagent");
  });

  it("quotes the description, which is YAML", () => {
    const md = opencodeAgentFile(agent({ description: 'Handles: colons and "quotes"' }));
    const line = md.split("\n").find((l) => l.startsWith("description:"))!;
    expect(JSON.parse(line.slice("description:".length).trim())).toBe('Handles: colons and "quotes"');
  });

  it("flattens a multi-line description", () => {
    const md = opencodeAgentFile(agent({ description: "one\ntwo" }));
    const lines = md.split("\n");
    const i = lines.findIndex((l) => l.startsWith("description:"));
    expect(lines[i]).toContain("one two");
    expect(lines[i + 1]).toBe("mode: subagent");
  });

  it("keeps a provider-qualified model", () => {
    expect(opencodeAgentFile(agent({ model: "minimax/MiniMax-M2.5" }))).toContain(
      "model: minimax/MiniMax-M2.5",
    );
  });

  it("drops a bare model id", () => {
    // opencode resolves models as provider/model; a bare id fails at dispatch
    // rather than falling back to the default.
    for (const m of ["claude-opus-5", "gpt-5.6", "llama-3.3-70b"]) {
      expect(opencodeAgentFile(agent({ model: m })), m).not.toContain("model:");
    }
  });

  it("ends with the instructions after the frontmatter", () => {
    const md = opencodeAgentFile(agent({ instructions: "Be terse." }));
    expect(md.split("---").length).toBe(3);
    expect(md.trimEnd().endsWith("Be terse.")).toBe(true);
  });
});

describe("reading opencode events", () => {
  it("pulls text out of a text event", () => {
    const e = {
      type: "text",
      sessionID: "s",
      timestamp: 1,
      part: { id: "p", messageID: "m", sessionID: "s", type: "text", text: "OC_OK" },
    } as OpencodeEvent;
    expect(opencodeText(e)).toBe("OC_OK");
  });

  it("returns nothing for a non-text event rather than throwing", () => {
    expect(opencodeText({ type: "step_start", sessionID: "s", timestamp: 1 } as OpencodeEvent)).toBe("");
  });

  it("recognises the step_finish that carries cost and tokens", () => {
    const e = {
      type: "step_finish",
      sessionID: "s",
      timestamp: 1,
      part: {
        id: "p",
        messageID: "m",
        sessionID: "s",
        type: "step-finish",
        reason: "stop",
        cost: 0.0028,
        tokens: { total: 7564, input: 0, output: 19, reasoning: 0, cache: { write: 7545, read: 0 } },
      },
    } as OpencodeEvent;
    expect(isStepFinish(e)).toBe(true);
    if (isStepFinish(e)) expect(e.part.cost).toBeCloseTo(0.0028);
  });
});

describe("explaining a failure", () => {
  it("names the fix for a missing credential", () => {
    // "API key is missing" and "cannot connect" both read as generic breakage,
    // and they need opposite actions from the user.
    const msg = describeError({
      name: "ProviderAuthError",
      data: { providerID: "google", message: "API key is missing." },
    });
    expect(msg).toContain("google");
    expect(msg).toContain("opencode providers");
  });

  it("says it could not reach the model for a connection failure", () => {
    const msg = describeError({
      name: "APIError",
      data: { message: "Unable to connect.", metadata: { url: "http://127.0.0.1:11434/v1" } },
    });
    expect(msg).toContain("Could not reach");
    expect(msg).toContain("Unable to connect.");
  });

  it("falls back to the error name when there is no message", () => {
    expect(describeError({ name: "WeirdError" })).toBe("WeirdError");
  });
});
