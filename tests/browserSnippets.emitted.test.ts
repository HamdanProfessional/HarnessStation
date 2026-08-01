import { describe, expect, it, vi } from "vitest";

/**
 * Asserts the *emitted* JavaScript, not the source that produced it.
 *
 * `\s` inside a template literal collapses to `s`, so a snippet that reads
 * correctly in the editor can ship `/s+/` — a regex matching the letter s. The
 * only reliable check is to look at the string that actually reaches the page.
 */

const expressions: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "inapp_eval") {
      expressions.push(String(args.expr));
      // Shapes the tool layer expects; the values don't matter here.
      return { title: "t", url: "u", text: "", chars: 0, count: 0, matches: [], items: [] };
    }
    return null;
  }),
}));

const { runBrowserTool, setBrowserTarget } = await import("../src/lib/browserTools");
setBrowserTarget("inapp");

const all = () => expressions.join("\n");

describe("emitted page snippets", () => {
  it("send a real whitespace class, not a bare letter", async () => {
    await runBrowserTool("list_buttons", {});
    await runBrowserTool("find_text", { query: "x" });
    await runBrowserTool("click_button", { label: "Go" });

    expect(all()).toMatch(/\\s\+/); // the two characters backslash-s reached the page
    expect(all()).not.toMatch(/replace\(\/s\+\/g/);
  });

  it("send a real newline class in the page-text reader", async () => {
    await runBrowserTool("read_all_text", {});
    const text = expressions.find((e) => e.includes("cloneNode")) ?? "";
    expect(text).toMatch(/\\n\{3,\}/);
    // A literal newline inside the regex would be a syntax error in the page.
    expect(text).not.toMatch(/\/\n\{3,\}\//);
  });

  it("are all parseable as JavaScript", () => {
    for (const expr of expressions) {
      expect(() => new Function(expr), expr.slice(0, 50)).not.toThrow();
    }
  });
});
