import { describe, expect, it } from "vitest";
import {
  MCP_GATEWAY_TOOLS,
  describeTools,
  groupByServer,
  isMcpGatewayTool,
  listServers,
  listTools,
  resolveCall,
} from "../src/lib/mcpGateway";
import type { Tool } from "../src/lib/types";

/** A registered MCP tool, shaped exactly as mcpToolToChatTool builds them. */
const mcpTool = (serverId: string, serverName: string, name: string, description = ""): Tool => ({
  id: `mcp:${serverId}:${name}`,
  name: `${serverName}_${name}`.slice(0, 60),
  description,
  parameters: { type: "object", properties: { q: { type: "string" } } },
  code: "",
  group: serverName,
});

const github = [
  mcpTool("s1", "GitHub", "create_issue", "Open an issue on a repository."),
  mcpTool("s1", "GitHub", "list_issues", "List issues on a repository."),
  mcpTool("s1", "GitHub", "search_code", "Search code across repositories."),
];
const slack = [mcpTool("s2", "Slack", "post_message", "Post a message to a channel.")];
const servers = groupByServer([...github, ...slack]);

describe("the gateway is a fixed cost", () => {
  it("is four tools no matter how many servers are connected", () => {
    expect(MCP_GATEWAY_TOOLS).toHaveLength(4);
    const huge = Array.from({ length: 400 }, (_, i) =>
      mcpTool(`s${i}`, `Server${i}`, `tool_${i}`, "x".repeat(200)),
    );
    // 400 servers still costs the model exactly these four definitions.
    expect(groupByServer(huge)).toHaveLength(400);
    expect(MCP_GATEWAY_TOOLS).toHaveLength(4);
  });

  it("recognises its own tool ids", () => {
    for (const t of MCP_GATEWAY_TOOLS) expect(isMcpGatewayTool(t.id)).toBe(true);
    expect(isMcpGatewayTool("web_search")).toBe(false);
    expect(isMcpGatewayTool("mcp:s1:create_issue")).toBe(false);
  });
});

describe("groupByServer", () => {
  it("groups by the server id in the tool id", () => {
    expect(servers.map((s) => s.name)).toEqual(["GitHub", "Slack"]);
    expect(servers[0].tools).toHaveLength(3);
  });

  it("ignores anything that isn't an MCP tool id", () => {
    expect(groupByServer([{ ...mcpTool("s1", "S", "t"), id: "web_search" }])).toEqual([]);
  });
});

describe("mcp_servers", () => {
  it("lists servers with counts but no tool detail", () => {
    const out = listServers(servers);
    expect(out).toContain("GitHub — 3 tools");
    expect(out).toContain("Slack — 1 tools");
    // The costly parts must not appear at this rung.
    expect(out).not.toContain("Open an issue");
    expect(out).not.toContain("create_issue");
  });

  it("says so plainly when nothing is connected", () => {
    expect(listServers([])).toMatch(/No MCP servers are connected/);
  });
});

describe("mcp_tools", () => {
  it("returns names only — no descriptions, no schemas", () => {
    const out = listTools(servers, "GitHub");
    expect(out).toContain("create_issue");
    expect(out).toContain("search_code");
    expect(out).not.toContain("Open an issue on a repository");
    expect(out).not.toContain("properties");
  });

  it("filters by a query", () => {
    const out = listTools(servers, "GitHub", "issue");
    expect(out).toContain("create_issue");
    expect(out).toContain("list_issues");
    expect(out).not.toContain("search_code");
  });

  it("matches a server case-insensitively and by partial name", () => {
    expect(listTools(servers, "github")).toContain("create_issue");
    expect(listTools(servers, "git")).toContain("create_issue");
  });

  it("explains itself when the server is unknown", () => {
    const out = listTools(servers, "Jira");
    expect(out).toMatch(/No MCP server matches "Jira"/);
    expect(out).toContain("GitHub, Slack");
  });

  it("suggests dropping the filter when nothing matches", () => {
    expect(listTools(servers, "GitHub", "zzzz")).toMatch(/without a query/);
  });
});

describe("mcp_describe", () => {
  it("returns descriptions and schemas only for what was asked for", () => {
    const out = describeTools(servers, "GitHub", ["create_issue"]);
    expect(out).toContain("Open an issue on a repository.");
    expect(out).toContain("properties");
    // The tools it didn't ask about stay out of context.
    expect(out).not.toContain("Search code across repositories");
  });

  it("describes several at once", () => {
    const out = describeTools(servers, "GitHub", ["create_issue", "list_issues"]);
    expect(out).toContain("create_issue");
    expect(out).toContain("list_issues");
  });

  it("names the ones that don't exist rather than failing", () => {
    const out = describeTools(servers, "GitHub", ["create_issue", "nonsense"]);
    expect(out).toContain("Open an issue");
    expect(out).toMatch(/Not on this server: nonsense/);
  });

  it("caps how much can be pulled in at once", () => {
    const many = Array.from({ length: 40 }, (_, i) => `tool_${i}`);
    const big = groupByServer(
      Array.from({ length: 40 }, (_, i) => mcpTool("s9", "Big", `tool_${i}`, "d".repeat(50))),
    );
    const out = describeTools(big, "Big", many);
    expect((out.match(/^### /gm) ?? []).length).toBeLessThanOrEqual(12);
  });

  it("asks for a tool name when given none", () => {
    expect(describeTools(servers, "GitHub", [])).toMatch(/at least one tool/);
  });
});

describe("mcp_call", () => {
  it("resolves a server and tool the model named to the registered tool", () => {
    const hit = resolveCall(servers, "GitHub", "create_issue");
    expect(typeof hit).not.toBe("string");
    expect((hit as Tool).id).toBe("mcp:s1:create_issue");
  });

  it("resolves by the prefixed name too, since that's what older flows use", () => {
    expect((resolveCall(servers, "GitHub", "GitHub_create_issue") as Tool).id).toBe(
      "mcp:s1:create_issue",
    );
  });

  it("returns a usable hint rather than throwing on a bad tool", () => {
    const out = resolveCall(servers, "GitHub", "delete_universe");
    expect(typeof out).toBe("string");
    expect(out).toMatch(/no tool called "delete_universe"/);
    expect(out).toMatch(/mcp_tools/);
  });

  it("returns a hint on a bad server", () => {
    expect(resolveCall(servers, "Nope", "x")).toMatch(/No MCP server matches/);
  });
});
