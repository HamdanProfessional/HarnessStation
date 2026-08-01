import { invoke } from "@tauri-apps/api/core";
import type { Tool } from "./types";

/**
 * Browser control, driven through the extension in the user's real browser.
 *
 * The shape of this group follows the same principle as the MCP gateway: cheap
 * steps first, expensive ones only when asked for.
 *
 *   read_all_text     text of the page, truncated
 *   find_text         just the matches, not the page
 *   list_buttons      labels only
 *   take_screenshot   captures and *stores* it — costs no context
 *   read_screenshot   returns the image for a vision model to actually look at
 *
 * Splitting take/read matters: a full-page PNG as base64 is tens of thousands of
 * tokens. Capturing is nearly free, so the model can grab one whenever, and only
 * pays to look when text alone hasn't answered the question.
 */

export const BROWSER_TOOL_IDS = [
  "open_url",
  "read_all_text",
  "find_text",
  "list_buttons",
  "click_button",
  "take_screenshot",
  "read_screenshot",
  "open_new_tab",
  "list_tabs",
  "change_tab",
  "close_tab",
  "close_browser",
] as const;

export function isBrowserTool(id: string): boolean {
  return (BROWSER_TOOL_IDS as readonly string[]).includes(id);
}

/** The last capture, held here so read_screenshot needn't re-take it. */
let lastShot: { dataUrl: string; url: string; title: string; at: number } | null = null;

export function lastScreenshot() {
  return lastShot;
}

const GROUP = "Browser";

const tool = (
  id: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
): Tool => ({
  id,
  name: id,
  description,
  parameters: { type: "object", properties, ...(required.length ? { required } : {}) },
  code: "",
  builtin: true,
  group: GROUP,
});

export const BROWSER_TOOLS: Tool[] = [
  tool(
    "open_url",
    "Open a URL in the user's browser and wait for it to load. Uses their real signed-in sessions, so pages behind a login work. Returns the tab's id, title and final URL.",
    {
      url: { type: "string", description: "Full URL, including https://" },
      newTab: { type: "boolean", description: "Open in a new tab instead of reusing the current one." },
    },
    ["url"],
  ),
  tool(
    "read_all_text",
    "Read the visible text of the current page. Start here — it answers most questions far more cheaply than a screenshot.",
    {
      tabId: { type: "number", description: "Tab to read; omit for the current one." },
      maxChars: { type: "number", description: "Truncate after this many characters (default 12000)." },
    },
  ),
  tool(
    "find_text",
    "Search the current page for a phrase and return just the surrounding snippets. Much cheaper than reading the whole page when you know what you're looking for.",
    {
      query: { type: "string", description: "Phrase to look for." },
      tabId: { type: "number" },
    },
    ["query"],
  ),
  tool(
    "list_buttons",
    "List the clickable things on the page — buttons, links, submits — by label. Call this before click_button so you use a label that exists.",
    { tabId: { type: "number" } },
  ),
  tool(
    "click_button",
    "Click something on the page by its label (or the index from list_buttons), then wait for any navigation to settle.",
    {
      label: { type: "string", description: "Label from list_buttons; a partial match is fine." },
      index: { type: "number", description: "Index from list_buttons, if the label is ambiguous." },
      tabId: { type: "number" },
    },
  ),
  tool(
    "take_screenshot",
    "Capture the visible part of the page. This only stores the image — it costs you no context. Call read_screenshot afterwards if you actually need to look at it.",
    { tabId: { type: "number" } },
  ),
  tool(
    "read_screenshot",
    "Return the last screenshot as an image so you can look at it. Only worth doing when the page text hasn't answered the question — layout, charts, a visual check. Take one first if you haven't.",
    {},
  ),
  tool(
    "open_new_tab",
    "Open a new tab, optionally at a URL, and make it the tab other actions apply to.",
    { url: { type: "string" } },
  ),
  tool("list_tabs", "List the browser's open tabs with their ids, titles and URLs.", {}),
  tool(
    "change_tab",
    "Switch which tab the other browser tools act on, by tab id or by matching its title or URL.",
    {
      tabId: { type: "number" },
      match: { type: "string", description: "Part of the title or URL." },
    },
  ),
  tool("close_tab", "Close a tab.", { tabId: { type: "number", description: "Omit for the current one." } }),
  tool(
    "close_browser",
    "Close the tabs HarnessStation opened. It deliberately leaves the user's own tabs and browser alone.",
    {},
  ),
];

/**
 * Which browser the tools drive.
 *
 *   "inapp"     a webview inside the app window — the default. The user watches
 *               it, and its logins live in the app's own session store.
 *   "extension" the user's real Chrome/Edge via the bridge extension, for when a
 *               task needs a session they're already signed in to there.
 */
export type BrowserTarget = "inapp" | "extension";

let target: BrowserTarget = "inapp";

export function browserTarget(): BrowserTarget {
  return target;
}

export function setBrowserTarget(t: BrowserTarget): void {
  target = t;
}

/** Run one browser action, against whichever browser is selected. */
async function call(action: string, args: Record<string, unknown>): Promise<unknown> {
  if (target === "inapp") return callInApp(action, args);
  return invoke("browser_call", { action, args });
}

/**
 * The in-app pane is driven by evaluating JavaScript in it. These snippets
 * mirror what the extension's content scripts do, so both targets return the
 * same shapes and the tool layer above doesn't care which is in use.
 */
const PAGE_TEXT = `
  const drop = ["script","style","noscript","svg","template"];
  const clone = document.body && document.body.cloneNode(true);
  if (!clone) return { title: document.title, url: location.href, text: "", chars: 0, truncated: false };
  drop.forEach(sel => clone.querySelectorAll(sel).forEach(n => n.remove()));
  const text = (clone.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim();
  return { title: document.title, url: location.href, text, chars: text.length };
`;

const CLICKABLE_SELECTOR =
  "button, a[href], input[type=submit], input[type=button], [role=button], summary";

const LIST_BUTTONS = `
  const els = [...document.querySelectorAll(${JSON.stringify(CLICKABLE_SELECTOR)})];
  const items = [];
  els.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return;
    const label = (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "")
      .trim().replace(/\\s+/g, " ");
    if (!label) return;
    items.push({ index: i, label: label.slice(0, 80), tag: el.tagName.toLowerCase() });
  });
  return { count: items.length, items: items.slice(0, 120) };
`;

async function evalPage(expr: string): Promise<unknown> {
  return invoke("inapp_eval", { expr });
}

async function callInApp(action: string, args: Record<string, unknown>): Promise<unknown> {
  switch (action) {
    case "open_url": {
      await invoke("inapp_navigate", { url: String(args.url) });
      // Give the navigation a moment before anything reads the page.
      await new Promise((r) => setTimeout(r, 1200));
      return evalPage("return { tabId: 0, title: document.title, url: location.href, active: true };");
    }
    case "read_all_text": {
      const res = (await evalPage(PAGE_TEXT)) as {
        title: string;
        url: string;
        text: string;
        chars: number;
      };
      const limit = Number(args.maxChars ?? 12000);
      return { ...res, truncated: res.chars > limit, text: (res.text ?? "").slice(0, limit) };
    }
    case "find_text": {
      const q = JSON.stringify(String(args.query ?? ""));
      return evalPage(`
        const text = (document.body ? document.body.innerText : "").replace(/\\s+/g, " ");
        const hay = text.toLowerCase(); const q = ${q}.toLowerCase();
        const hits = []; let i = hay.indexOf(q);
        while (i !== -1 && hits.length < 20) {
          hits.push(text.slice(Math.max(0, i - 90), i + q.length + 90).trim());
          i = hay.indexOf(q, i + q.length);
        }
        return { count: hits.length, matches: hits };
      `);
    }
    case "list_buttons":
      return evalPage(LIST_BUTTONS);
    case "click_button": {
      const by =
        args.index != null
          ? `document.querySelectorAll(${JSON.stringify(CLICKABLE_SELECTOR)})[${Number(args.index)}]`
          : `els.find(e => labelOf(e).toLowerCase() === q) || els.find(e => labelOf(e).toLowerCase().includes(q))`;
      const q = JSON.stringify(String(args.label ?? "").toLowerCase());
      return evalPage(`
        const sel = ${JSON.stringify(CLICKABLE_SELECTOR)};
        const labelOf = (el) => (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "").trim().replace(/\\s+/g, " ");
        const els = [...document.querySelectorAll(sel)].filter(el => {
          const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
        });
        const q = ${q};
        const el = ${by};
        if (!el) return { clicked: false, reason: "no matching clickable element" };
        el.scrollIntoView({ block: "center" });
        el.click();
        return { clicked: true, label: labelOf(el).slice(0, 80), url: location.href, title: document.title };
      `);
    }
    case "close_browser":
    case "close_tab":
      await invoke("inapp_close");
      return { closed: true, note: "closed the in-app browser pane" };
    default:
      throw new Error(
        `"${action}" needs the browser extension — the in-app pane is a single view, so it has no tabs. Switch the target in the Browser panel.`,
      );
  }
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

/**
 * Execute a browser tool. Errors are returned as text rather than thrown so the
 * model can read what went wrong and adjust, exactly like the other tool groups.
 */
export async function runBrowserTool(
  id: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    switch (id) {
      case "read_screenshot": {
        if (!lastShot) {
          return "No screenshot yet — call take_screenshot first.";
        }
        // Returned as a data URL: the chat layer turns that into an image
        // attachment, which is how a vision model actually sees it.
        return lastShot.dataUrl;
      }

      case "take_screenshot": {
        if (target === "inapp") {
          return "The in-app pane can't be captured yet — read_all_text and list_buttons cover most of what a screenshot would show. Switch to the extension target if you need an image.";
        }
        const res = (await call("take_screenshot", args)) as {
          dataUrl: string;
          url: string;
          title: string;
        };
        lastShot = { ...res, at: Date.now() };
        const kb = Math.round((res.dataUrl.length * 0.75) / 1024);
        return `Captured "${res.title}" (${res.url}) — roughly ${kb} KB. Call read_screenshot to look at it.`;
      }

      case "read_all_text": {
        const res = (await call("read_all_text", args)) as {
          title: string;
          url: string;
          text: string;
          chars: number;
          truncated: boolean;
        };
        const note = res.truncated
          ? `\n\n[truncated — the page has ${res.chars} characters; raise maxChars or use find_text]`
          : "";
        return `# ${res.title}\n${res.url}\n\n${res.text}${note}`;
      }

      case "find_text": {
        const res = (await call("find_text", args)) as { count: number; matches: string[] };
        if (!res.count) return `No match for "${String(args.query)}" on this page.`;
        return `${res.count} match(es):\n\n${res.matches.map((m) => `…${m}…`).join("\n\n")}`;
      }

      case "list_buttons": {
        const res = (await call("list_buttons", args)) as {
          count: number;
          items: { index: number; label: string; tag: string }[];
        };
        if (!res.count) return "Nothing clickable found on this page.";
        return res.items.map((b) => `[${b.index}] ${b.label} (${b.tag})`).join("\n");
      }

      default:
        return pretty(await call(id, args));
    }
  } catch (e) {
    return `Error: ${(e as Error).message || String(e)}`;
  }
}

/** Is the extension currently connected? Used by the setup panel. */
export async function browserStatus(): Promise<{ connected: boolean; port: number }> {
  try {
    return await invoke("browser_status");
  } catch {
    return { connected: false, port: 8791 };
  }
}
