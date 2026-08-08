import { describe, expect, it } from "vitest";
import { buildBundlePayload, buildPayload, type BundleItem } from "../src/lib/community";
import type { Agent } from "../src/lib/types";

const agent: Agent = {
  id: "local-123",
  name: "Researcher",
  description: "digs things up",
  instructions: "Be thorough.",
  providerId: "openai",
  model: "gpt-5",
  temperature: 0.4,
  maxTokens: 2048,
  toolIds: ["web_search", "read_file"],
  workflowIds: ["wf-1"],
  subAgentIds: ["a-2"],
  knowledgeBaseIds: ["kb-1"],
};

describe("bundle payloads", () => {
  it("wraps members with a version and item list", () => {
    const items: BundleItem[] = [
      { kind: "skill", name: "Summarise", payload: "---\nname: Summarise\n---\nbody" },
      { kind: "agent", name: "Researcher", payload: buildPayload("agent", agent) },
    ];
    const parsed = JSON.parse(buildBundlePayload(items));
    expect(parsed.version).toBe("1");
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].kind).toBe("skill");
  });

  it("member agent payloads are stripped of machine-local ids", () => {
    const items: BundleItem[] = [{ kind: "agent", name: "Researcher", payload: buildPayload("agent", agent) }];
    const memberAgent = JSON.parse(JSON.parse(buildBundlePayload(items)).items[0].payload) as Agent;
    expect(memberAgent.id).toBe("");
    expect(memberAgent.providerId).toBe("");
    expect(memberAgent.model).toBe("");
    expect(memberAgent.workflowIds).toEqual([]);
    expect(memberAgent.subAgentIds).toEqual([]);
    // Built-in tool ids are stable across installs, so they travel with the agent.
    expect(memberAgent.toolIds).toContain("web_search");
  });
});
