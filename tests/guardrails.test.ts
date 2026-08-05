import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../src/lib/store";
import { guardTool } from "../src/lib/hooks";
import type { GuardrailRule } from "../src/lib/hooks";

function rules(...rs: GuardrailRule[]) {
  useStore.setState({ settings: { ...useStore.getState().settings, guardrails: rs, blockTools: [], confirmTools: [] } });
}

describe("guardTool — rules (deny/allow, no confirm)", () => {
  beforeEach(() => rules());

  it("allows a tool with no matching rule", async () => {
    expect(await guardTool("read_file", {})).toBe("allow");
  });

  it("denies by tool id", async () => {
    rules({ id: "r", tool: "run_terminal", action: "deny", message: "nope" });
    expect(await guardTool("run_terminal", { command: "ls" })).toMatch(/Blocked by a guardrail: nope/);
    expect(await guardTool("read_file", {})).toBe("allow");
  });

  it("denies only when the argument regex matches", async () => {
    rules({ id: "r", tool: "run_terminal", pattern: "rm\\s+-rf", action: "deny" });
    expect(await guardTool("run_terminal", { command: "rm -rf /" })).toMatch(/Blocked/);
    expect(await guardTool("run_terminal", { command: "ls -la" })).toBe("allow");
  });

  it("matches any tool with *", async () => {
    rules({ id: "r", tool: "*", pattern: "password", action: "deny" });
    expect(await guardTool("write_file", { content: "my password is x" })).toMatch(/Blocked/);
    expect(await guardTool("write_file", { content: "hello" })).toBe("allow");
  });

  it("an earlier Allow rule whitelists past a later Deny", async () => {
    rules(
      { id: "a", tool: "http_request", pattern: "api\\.mine\\.com", action: "allow" },
      { id: "b", tool: "http_request", action: "deny" },
    );
    expect(await guardTool("http_request", { url: "https://api.mine.com/x" })).toBe("allow");
    expect(await guardTool("http_request", { url: "https://evil.com" })).toMatch(/Blocked/);
  });

  it("ignores a malformed regex rather than blocking", async () => {
    rules({ id: "r", tool: "run_terminal", pattern: "(", action: "deny" });
    expect(await guardTool("run_terminal", { command: "rm -rf /" })).toBe("allow");
  });
});
