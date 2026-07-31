import { describe, expect, it } from "vitest";
import { agentToolId, parseSyntheticToolId, resolveAgentTools, syntheticTools, workflowToolId } from "../src/lib/agents";
import type { Agent, Tool } from "../src/lib/types";

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: "a1",
  name: "Research Bot",
  description: "Finds things.",
  instructions: "",
  providerId: "",
  model: "",
  temperature: 0.7,
  maxTokens: 0,
  toolIds: [],
  workflowIds: [],
  subAgentIds: [],
  ...over,
});

const tool = (id: string): Tool => ({ id, name: id, description: "", parameters: {}, code: "" });

describe("synthetic tool ids", () => {
  it("round-trips agent and workflow ids", () => {
    expect(parseSyntheticToolId(agentToolId("a1"))).toEqual({ kind: "agent", id: "a1" });
    expect(parseSyntheticToolId(workflowToolId("w1"))).toEqual({ kind: "workflow", id: "w1" });
  });

  it("returns null for a plain tool id", () => {
    expect(parseSyntheticToolId("web_search")).toBeNull();
    expect(parseSyntheticToolId("mcp:server:tool")).toBeNull();
  });

  it("keeps ids containing colons intact", () => {
    expect(parseSyntheticToolId(agentToolId("mcp:x"))).toEqual({ kind: "agent", id: "mcp:x" });
  });
});

describe("syntheticTools", () => {
  it("builds a callable function name from the agent name", () => {
    const [t] = syntheticTools([agent()], []);
    expect(t.id).toBe("agent:a1");
    expect(t.name).toBe("call_research_bot");
    expect(t.group).toBe("Agents");
    expect(t.description).toContain("Research Bot");
  });

  it("caps generated names at 60 chars (OpenAI's limit is 64)", () => {
    const [t] = syntheticTools([agent({ name: "x".repeat(120) })], []);
    expect(t.name.length).toBeLessThanOrEqual(60);
  });

  it("builds workflow tools with an input parameter", () => {
    const [t] = syntheticTools([], [{ id: "w1", name: "Daily Digest", description: "d" }]);
    expect(t.id).toBe("workflow:w1");
    expect(t.name).toBe("run_daily_digest");
    expect(t.group).toBe("Workflows");
    expect((t.parameters as { required: string[] }).required).toEqual(["input"]);
  });

  it("returns agents before workflows and nothing for empty input", () => {
    expect(syntheticTools([], [])).toEqual([]);
    const out = syntheticTools([agent()], [{ id: "w1", name: "W", description: "" }]);
    expect(out.map((t) => t.group)).toEqual(["Agents", "Workflows"]);
  });
});

describe("resolveAgentTools", () => {
  it("selects real tools plus sub-agent and workflow tools", () => {
    const all = [tool("web_search"), tool("agent:a2"), tool("workflow:w1"), tool("unrelated")];
    const out = resolveAgentTools(agent({ toolIds: ["web_search"], subAgentIds: ["a2"], workflowIds: ["w1"] }), all);
    expect(out.map((t) => t.id)).toEqual(["web_search", "agent:a2", "workflow:w1"]);
  });

  it("silently drops ids that no longer exist", () => {
    expect(resolveAgentTools(agent({ toolIds: ["deleted"] }), [tool("web_search")])).toEqual([]);
  });

  it("preserves the order of the tool list, not the id list", () => {
    const all = [tool("b"), tool("a")];
    expect(resolveAgentTools(agent({ toolIds: ["a", "b"] }), all).map((t) => t.id)).toEqual(["b", "a"]);
  });
});
