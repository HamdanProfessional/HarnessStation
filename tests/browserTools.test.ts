import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...(a as [])) }));

const { BROWSER_TOOLS, BROWSER_TOOL_IDS, isBrowserTool, lastScreenshot, runBrowserTool } =
  await import("../src/lib/browserTools");

/** The bridge call arguments, for asserting what was sent to the extension. */
const sent = () => invoke.mock.calls.map((c) => c[1] as { action: string; args: unknown });

beforeEach(() => {
  invoke.mockReset();
});

describe("the tool group", () => {
  it("covers every action, each with an object schema", () => {
    expect(BROWSER_TOOLS.map((t) => t.id).sort()).toEqual([...BROWSER_TOOL_IDS].sort());
    for (const t of BROWSER_TOOLS) {
      expect(t.description, t.id).not.toBe("");
      expect((t.parameters as { type?: string }).type, t.id).toBe("object");
      expect(t.group).toBe("Browser");
    }
  });

  it("recognises its own ids", () => {
    expect(isBrowserTool("open_url")).toBe(true);
    expect(isBrowserTool("web_search")).toBe(false);
  });
});

describe("reading a page", () => {
  it("returns the text with the title and URL for context", async () => {
    invoke.mockResolvedValue({
      title: "Example",
      url: "https://example.com",
      text: "hello world",
      chars: 11,
      truncated: false,
    });

    const out = await runBrowserTool("read_all_text", {});

    expect(out).toContain("# Example");
    expect(out).toContain("https://example.com");
    expect(out).toContain("hello world");
    expect(out).not.toMatch(/truncated/);
  });

  it("says when the page was cut short, and how to get more", async () => {
    invoke.mockResolvedValue({
      title: "Long",
      url: "u",
      text: "abc",
      chars: 90_000,
      truncated: true,
    });

    const out = await runBrowserTool("read_all_text", {});

    expect(out).toMatch(/truncated/);
    expect(out).toMatch(/90000 characters/);
    expect(out).toMatch(/find_text/);
  });

  it("find_text returns only the snippets, not the page", async () => {
    invoke.mockResolvedValue({ count: 2, matches: ["one hit here", "another hit"] });

    const out = await runBrowserTool("find_text", { query: "hit" });

    expect(out).toContain("2 match(es)");
    expect(out).toContain("one hit here");
  });

  it("find_text says so plainly when there is no match", async () => {
    invoke.mockResolvedValue({ count: 0, matches: [] });
    expect(await runBrowserTool("find_text", { query: "nope" })).toMatch(/No match for "nope"/);
  });
});

describe("clicking", () => {
  it("lists clickables as label + index so a click can name one", async () => {
    invoke.mockResolvedValue({
      count: 2,
      items: [
        { index: 0, label: "Sign in", tag: "button" },
        { index: 4, label: "Docs", tag: "a" },
      ],
    });

    const out = await runBrowserTool("list_buttons", {});

    expect(out).toBe("[0] Sign in (button)\n[4] Docs (a)");
  });

  it("reports an empty page rather than an error", async () => {
    invoke.mockResolvedValue({ count: 0, items: [] });
    expect(await runBrowserTool("list_buttons", {})).toMatch(/Nothing clickable/);
  });

  it("passes the label straight through to the extension", async () => {
    invoke.mockResolvedValue({ clicked: true, label: "Sign in", url: "u", title: "t" });
    await runBrowserTool("click_button", { label: "Sign in" });
    expect(sent()[0]).toEqual({ action: "click_button", args: { label: "Sign in" } });
  });
});

describe("screenshots are split so looking is opt-in", () => {
  const shot = {
    dataUrl: `data:image/png;base64,${"A".repeat(4000)}`,
    url: "https://example.com",
    title: "Example",
  };

  it("take_screenshot stores the image and returns only a summary", async () => {
    invoke.mockResolvedValue(shot);

    const out = await runBrowserTool("take_screenshot", {});

    // A base64 PNG in context is tens of thousands of tokens; capturing must not
    // cost that. The model pays only when it decides to look.
    expect(out).not.toContain("data:image");
    expect(out).toContain("Example");
    expect(out).toMatch(/KB/);
    expect(lastScreenshot()?.dataUrl).toBe(shot.dataUrl);
  });

  it("read_screenshot returns the image itself", async () => {
    invoke.mockResolvedValue(shot);
    await runBrowserTool("take_screenshot", {});

    const out = await runBrowserTool("read_screenshot", {});

    expect(out).toBe(shot.dataUrl);
  });

  it("tells the model to capture one first if there is none", async () => {
    // The stored capture is module state, so this needs a fresh instance.
    vi.resetModules();
    const fresh = await import("../src/lib/browserTools");
    expect(await fresh.runBrowserTool("read_screenshot", {})).toMatch(/take_screenshot first/);
  });
});

describe("failures come back as text the model can act on", () => {
  it("reports a disconnected extension instead of throwing", async () => {
    invoke.mockRejectedValue(new Error("The browser extension isn't connected."));

    const out = await runBrowserTool("open_url", { url: "https://example.com" });

    expect(out).toMatch(/^Error: /);
    expect(out).toMatch(/isn't connected/);
  });

  it("reports a timeout without losing the reason", async () => {
    invoke.mockRejectedValue(new Error("the browser didn't respond within 45s"));
    expect(await runBrowserTool("read_all_text", {})).toMatch(/didn't respond within 45s/);
  });
});

describe("tab actions pass through unchanged", () => {
  it("forwards the action name and arguments verbatim", async () => {
    invoke.mockResolvedValue({ tabs: [] });
    await runBrowserTool("change_tab", { match: "github" });
    expect(sent()[0]).toEqual({ action: "change_tab", args: { match: "github" } });
  });

  it("close_browser takes no arguments", async () => {
    invoke.mockResolvedValue({ closed: 2 });
    const out = await runBrowserTool("close_browser", {});
    expect(sent()[0].action).toBe("close_browser");
    expect(out).toContain("closed");
  });
});
