import { describe, expect, it } from "vitest";
import { buildPayload } from "../src/lib/community";

// buildPayload("template", …) is the share-clean step for the composed kind:
// a "setup" starter-kit strips machine-local ids from anything it bundles; a
// "ui" snippet just carries its code/deps. These are pure, so unit-testable.

describe("template payloads", () => {
  it("setup: strips machine-local ids from a bundled agent and workflow", () => {
    const payload = {
      subtype: "setup",
      instructions: "Be helpful.",
      toolIds: ["calculate"],
      starters: ["say hi", ""], // blank lines dropped
      agent: {
        id: "agent-123",
        name: "A",
        instructions: "x",
        providerId: "openai",
        model: "gpt-4o",
        toolIds: ["calculate"],
        workflowIds: ["wf-1"],
        subAgentIds: ["a2"],
        knowledgeBaseIds: ["kb"],
        temperature: 0.7,
        maxTokens: 0,
      },
      workflow: { id: "wf-9", name: "W", steps: [] },
    };
    const out = JSON.parse(buildPayload("template", payload));
    expect(out.subtype).toBe("setup");
    // provider/model/local references stripped so it lands usable elsewhere
    expect(out.agent.id).toBe("");
    expect(out.agent.providerId).toBe("");
    expect(out.agent.model).toBe("");
    expect(out.agent.workflowIds).toEqual([]);
    expect(out.agent.subAgentIds).toEqual([]);
    expect(out.agent.knowledgeBaseIds).toEqual([]);
    expect(out.workflow.id).toBe("");
    // built-in tool ids are stable across installs, so they travel
    expect(out.toolIds).toEqual(["calculate"]);
    expect(out.agent.toolIds).toEqual(["calculate"]);
    expect(out.starters).toEqual(["say hi"]);
  });

  it("setup: no bundle → agent/workflow are null, tools default to []", () => {
    const out = JSON.parse(buildPayload("template", { subtype: "setup", instructions: "hi" }));
    expect(out.agent).toBeNull();
    expect(out.workflow).toBeNull();
    expect(out.toolIds).toEqual([]);
  });

  it("ui: carries code, deps and framework; an empty preview URL is dropped", () => {
    const out = JSON.parse(
      buildPayload("template", {
        subtype: "ui",
        framework: "React + Tailwind",
        code: "export const X = 1;",
        dependencies: ["framer-motion"],
        previewImage: "",
      }),
    );
    expect(out.subtype).toBe("ui");
    expect(out.code).toBe("export const X = 1;");
    expect(out.dependencies).toEqual(["framer-motion"]);
    expect(out.framework).toBe("React + Tailwind");
    expect(out.previewImage).toBeUndefined();
  });
});
