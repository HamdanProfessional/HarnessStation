import { describe, expect, it, vi } from "vitest";

/**
 * The in-app browser is driven by JavaScript sent into the page as strings.
 * A string that looks right in the editor can still emit broken code — `\s`
 * inside a template literal collapses to `s`, quietly turning `/\s+/` into a
 * regex that matches the letter "s". These tests run the emitted snippets for
 * real against a fake DOM, which is the only way that class of bug shows up.
 */

const evalled: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "inapp_eval") {
      evalled.push(String(args.expr));
      return runSnippet(String(args.expr));
    }
    return null;
  }),
}));

/** Run a snippet the way the webview would: as a function body over our fake DOM. */
function runSnippet(expr: string): unknown {
  const fn = new Function("document", "location", expr);
  return fn(fakeDocument(), { href: "https://example.com/page" });
}

function fakeDocument() {
  const make = (tag: string, text: string, w = 100, h = 20) => ({
    tagName: tag.toUpperCase(),
    innerText: text,
    value: "",
    title: "",
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: w, height: h }),
    scrollIntoView: () => {},
    click() {
      (this as { clicked?: boolean }).clicked = true;
    },
    querySelectorAll: () => [],
    remove: () => {},
  });

  const buttons = [
    make("button", "  Sign   in  "),
    make("a", "Docs"),
    make("button", "Hidden", 0, 0),
  ];

  const body = {
    innerText: "Welcome to the page.\n\n\n\nSign in to continue. Sign in again.",
    cloneNode: () => ({
      innerText: "Welcome to the page.\n\n\n\nSign in to continue. Sign in again.",
      querySelectorAll: () => [],
    }),
    querySelectorAll: () => [],
  };

  return {
    title: "Example Page",
    body,
    querySelectorAll: (_sel: string) => buttons,
  };
}

const { runBrowserTool, setBrowserTarget } = await import("../src/lib/browserTools");
setBrowserTarget("inapp");

describe("snippets emitted for the in-app pane", () => {
  it("collapses whitespace in button labels — the regex must really be \\s", async () => {
    // With the broken escape this returned "  Sign   in  " with the s's eaten.
    const out = await runBrowserTool("list_buttons", {});
    expect(out).toContain("Sign in");
    expect(out).not.toContain("Sign   in");
    expect(out).not.toMatch(/ign\s*in\b.*ign/); // no mangled duplicates
  });

  it("skips zero-size elements", async () => {
    const out = await runBrowserTool("list_buttons", {});
    expect(out).not.toContain("Hidden");
  });

  it("normalises runs of blank lines when reading the page", async () => {
    const out = await runBrowserTool("read_all_text", {});
    expect(out).toContain("Example Page");
    expect(out).toContain("Welcome to the page.");
    expect(out).not.toMatch(/\n{3,}/);
  });

  it("find_text collapses whitespace before searching, and finds every hit", async () => {
    const out = await runBrowserTool("find_text", { query: "sign in" });
    expect(out).toContain("2 match(es)");
  });

  it("every emitted snippet is syntactically valid JavaScript", () => {
    expect(evalled.length).toBeGreaterThan(0);
    for (const expr of evalled) {
      expect(() => new Function("document", "location", expr), expr.slice(0, 60)).not.toThrow();
    }
  });

  it("no snippet contains a collapsed escape", () => {
    // The tell-tale of the bug: a character class that lost its backslash.
    for (const expr of evalled) {
      expect(expr).not.toMatch(/replace\(\/s\+\/g/);
      expect(expr).not.toMatch(/\/\n\{3,\}\//);
    }
  });
});
