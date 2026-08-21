import { describe, expect, it } from "vitest";
import { basePrompt, type BasePromptContext } from "../src/lib/basePrompt";

const ctx = (over: Partial<BasePromptContext> = {}): BasePromptContext => ({
  toolCount: 12,
  hasShell: true,
  hasFiles: true,
  ...over,
});

describe("what every chat is told", () => {
  it("always says what the app is and how replies are rendered", () => {
    const out = basePrompt(ctx());
    expect(out).toContain("HarnessStation");
    expect(out).toContain("markdown");
  });

  it("always carries tone and objectivity, tools or not", () => {
    for (const c of [ctx(), ctx({ toolCount: 0, hasShell: false, hasFiles: false })]) {
      expect(c.toolCount + "").toBeDefined();
      const out = basePrompt(c);
      expect(out).toContain("# Tone");
      expect(out).toContain("# Objectivity");
    }
  });

  it("tells the model not to invent URLs in every configuration", () => {
    expect(basePrompt(ctx({ toolCount: 0, hasShell: false, hasFiles: false }))).toContain(
      "Never invent a URL",
    );
  });

  it("is never empty — an empty system prompt is the state this replaces", () => {
    expect(basePrompt(ctx({ toolCount: 0, hasShell: false, hasFiles: false })).length).toBeGreaterThan(200);
  });
});

describe("sections that depend on what the chat actually has", () => {
  it("says nothing about calling tools when there are none", () => {
    // Advice a chat cannot take is wasted tokens, and describing tools to a
    // model that has none makes it likelier to invent one.
    const out = basePrompt(ctx({ toolCount: 0, hasShell: false, hasFiles: false }));
    expect(out).not.toContain("# Using tools");
    expect(out).not.toContain("parallel");
  });

  it("explains parallel calls as soon as there is at least one tool", () => {
    const out = basePrompt(ctx({ toolCount: 1, hasShell: false, hasFiles: false }));
    expect(out).toContain("# Using tools");
    expect(out).toContain("call several tools in one response");
    expect(out).toContain("Never guess a required argument");
  });

  it("only argues for the specific tool over the shell when both exist", () => {
    // With no filesystem tools there is no choice to make, and naming
    // read_file would be describing a tool the model does not have.
    expect(basePrompt(ctx({ hasShell: true, hasFiles: false }))).not.toContain("read_file");
    expect(basePrompt(ctx({ hasShell: false, hasFiles: true }))).not.toContain("run_terminal");
    expect(basePrompt(ctx({ hasShell: true, hasFiles: true }))).toContain("run_terminal");
  });

  it("asks for file:line references only when there are files to point at", () => {
    expect(basePrompt(ctx({ hasFiles: true }))).toContain(":42");
    expect(basePrompt(ctx({ hasFiles: false }))).not.toContain(":42");
  });
});

describe("staying out of the way", () => {
  it("says nothing about a domain, so agent instructions are not contradicted", () => {
    // agentPresets.ts carries the detailed coding/research instructions. If this
    // prompt also had opinions about editing code they would conflict, and the
    // model would follow whichever came last.
    const out = basePrompt(ctx());
    for (const word of ["refactor", "test suite", "commit", "typecheck", "research"]) {
      expect(out.toLowerCase()).not.toContain(word);
    }
  });

  it("stays short enough to be worth prepending to every single turn", () => {
    // It is resent on every request, so it is paid for repeatedly. opencode's
    // equivalents run 79-155 lines; a chat app needs far less than a coding CLI.
    expect(basePrompt(ctx()).split("\n").length).toBeLessThan(30);
  });
});
