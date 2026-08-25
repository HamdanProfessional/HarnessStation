import { describe, expect, it } from "vitest";
import { BUILTIN_TOOLS, BUILTIN_TOOLSETS, executeTool, toOpenAITools } from "../src/lib/tools";
import type { Tool } from "../src/lib/types";

const jsTool = (code: string): Tool => ({
  id: "t1",
  name: "my_tool",
  description: "d",
  parameters: { type: "object", properties: {} },
  code,
});

describe("toOpenAITools", () => {
  it("wraps each tool in the function-calling envelope", () => {
    expect(toOpenAITools([jsTool("")])).toEqual([
      {
        type: "function",
        function: { name: "my_tool", description: "d", parameters: { type: "object", properties: {} } },
      },
    ]);
  });

  it("returns an empty array for no tools", () => {
    expect(toOpenAITools([])).toEqual([]);
  });
});

describe("built-in catalogue", () => {
  it("has unique tool ids and names", () => {
    expect(new Set(BUILTIN_TOOLS.map((t) => t.id)).size).toBe(BUILTIN_TOOLS.length);
    expect(new Set(BUILTIN_TOOLS.map((t) => t.name)).size).toBe(BUILTIN_TOOLS.length);
  });

  it("gives every built-in an object schema the API will accept", () => {
    for (const t of BUILTIN_TOOLS) {
      expect(t.description, `${t.id} needs a description`).not.toBe("");
      expect((t.parameters as { type?: string }).type, `${t.id} schema`).toBe("object");
    }
  });

  it("only references real tools from the built-in tool sets", () => {
    const ids = new Set(BUILTIN_TOOLS.map((t) => t.id));
    for (const set of BUILTIN_TOOLSETS) {
      for (const id of set.toolIds) expect(ids, `${set.name} -> ${id}`).toContain(id);
    }
  });

  it("files every user-facing built-in into at least one tool set", () => {
    // Ungrouped tools are invisible: the config panel's quick-toggle sections
    // never mention them, so users can neither find nor disable them as a
    // group. ask_user and read_tool_output are exempt — they are turn
    // infrastructure, not capabilities, and are always available.
    const grouped = new Set(BUILTIN_TOOLSETS.flatMap((s) => s.toolIds));
    const infrastructure = new Set(["ask_user", "read_tool_output"]);
    const orphans = BUILTIN_TOOLS.filter((t) => !grouped.has(t.id) && !infrastructure.has(t.id));
    expect(orphans.map((t) => t.id)).toEqual([]);
  });
});

describe("executeTool (JS runtime)", () => {
  it("passes args in and returns the string result", async () => {
    const out = await executeTool(jsTool("return `hi ${args.name}`"), { name: "world" });
    expect(out).toBe("hi world");
  });

  it("JSON-stringifies a non-string result", async () => {
    expect(await executeTool(jsTool("return { a: 1 }"), {})).toBe('{"a":1}');
  });

  it("returns an empty string for null/undefined", async () => {
    expect(await executeTool(jsTool("return null"), {})).toBe("");
    expect(await executeTool(jsTool(""), {})).toBe("");
  });

  it("exposes cwd and the fs/term/fetch context", async () => {
    const code = "return [typeof ctx.fetch, typeof ctx.fs.read, typeof ctx.term, ctx.cwd].join(',')";
    expect(await executeTool(jsTool(code), {}, "C:/work")).toBe("function,function,function,C:/work");
  });

  it("propagates an error thrown by the tool body", async () => {
    await expect(executeTool(jsTool("throw new Error('boom')"), {})).rejects.toThrow("boom");
  });

  it("rejects code that does not compile", async () => {
    await expect(executeTool(jsTool("this is not javascript"), {})).rejects.toThrow();
  });

  it("awaits async work inside the tool", async () => {
    const code = "await new Promise(r => setTimeout(r, 5)); return 'done'";
    expect(await executeTool(jsTool(code), {})).toBe("done");
  });
});
