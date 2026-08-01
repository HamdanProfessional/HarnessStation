/**
 * HarnessStation browser bridge — background service worker.
 *
 * Holds a WebSocket to the desktop app and executes the actions it asks for in
 * this browser's real tabs. Because it runs inside the browser you already use,
 * everything happens with the sessions you are already signed in to — no second
 * profile, no re-login, no debug flags on startup.
 *
 * Protocol:
 *   in   {id, action, args}
 *   out  {id, ok:true, result} | {id, ok:false, error}
 */

const PORT = 8791;
const RECONNECT_MS = 3000;

let socket = null;
/** Tabs this extension opened, so close_browser only closes its own work. */
const ownedTabs = new Set();
/** The tab actions target when none is named. */
let activeTabId = null;

function connect() {
  try {
    socket = new WebSocket(`ws://127.0.0.1:${PORT}`);
  } catch {
    return setTimeout(connect, RECONNECT_MS);
  }

  socket.onopen = () => console.log("[bridge] connected to HarnessStation");

  socket.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    const { id, action, args } = msg ?? {};
    if (typeof id !== "number") return;
    try {
      const result = await run(action, args ?? {});
      reply({ id, ok: true, result });
    } catch (e) {
      reply({ id, ok: false, error: String(e?.message ?? e) });
    }
  };

  // The app may not be running yet, or may restart. Keep trying quietly.
  socket.onclose = () => {
    socket = null;
    setTimeout(connect, RECONNECT_MS);
  };
  socket.onerror = () => socket?.close();
}

function reply(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg?.type === "status") send({ connected: socket?.readyState === WebSocket.OPEN });
  return true;
});

// ---------- helpers ----------

/** Resolve the tab an action applies to, preferring an explicit id. */
async function targetTab(args) {
  if (args.tabId != null) {
    const tab = await chrome.tabs.get(Number(args.tabId)).catch(() => null);
    if (!tab) throw new Error(`no tab with id ${args.tabId}`);
    return tab;
  }
  if (activeTabId != null) {
    const tab = await chrome.tabs.get(activeTabId).catch(() => null);
    if (tab) return tab;
    activeTabId = null;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("no open tab");
  activeTabId = tab.id;
  return tab;
}

/** Run a function inside the page and return its value. */
async function inPage(tabId, func, args = []) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return result;
}

/** Wait until a tab has finished loading, so reads don't race the navigation. */
function waitForLoad(tabId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      // Give the page a beat to run its own scripts.
      setTimeout(resolve, 350);
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => t?.status === "complete" && done()).catch(done);
  });
}

const tabSummary = (t) => ({
  tabId: t.id,
  title: t.title ?? "",
  url: t.url ?? "",
  active: !!t.active,
});

// ---------- page-side functions ----------
// These are serialised into the page, so they must be self-contained.

function pageText() {
  const drop = ["script", "style", "noscript", "svg", "template"];
  const clone = document.body?.cloneNode(true);
  if (!clone) return "";
  drop.forEach((sel) => clone.querySelectorAll(sel).forEach((n) => n.remove()));
  return (clone.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
}

function pageFind(needle) {
  const text = (document.body?.innerText || "").replace(/\s+/g, " ");
  const hay = text.toLowerCase();
  const q = String(needle).toLowerCase();
  const hits = [];
  let i = hay.indexOf(q);
  while (i !== -1 && hits.length < 20) {
    hits.push(text.slice(Math.max(0, i - 90), i + q.length + 90).trim());
    i = hay.indexOf(q, i + q.length);
  }
  return { count: hits.length, matches: hits };
}

function pageClickables() {
  const sel = 'button, a[href], input[type=submit], input[type=button], [role=button], summary';
  const seen = [];
  document.querySelectorAll(sel).forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
    if (!visible) return;
    const label =
      (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "").trim();
    if (!label) return;
    seen.push({
      index: i,
      label: label.slice(0, 80).replace(/\s+/g, " "),
      tag: el.tagName.toLowerCase(),
      href: el.getAttribute("href") ?? undefined,
    });
  });
  return seen.slice(0, 120);
}

function pageClick(target) {
  const sel = 'button, a[href], input[type=submit], input[type=button], [role=button], summary';
  const els = [...document.querySelectorAll(sel)].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  });
  const labelOf = (el) =>
    (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "")
      .trim()
      .replace(/\s+/g, " ");

  let el = null;
  if (typeof target === "number") {
    el = document.querySelectorAll(sel)[target] ?? null;
  } else {
    const q = String(target).toLowerCase();
    el =
      els.find((e) => labelOf(e).toLowerCase() === q) ??
      els.find((e) => labelOf(e).toLowerCase().includes(q)) ??
      null;
  }
  if (!el) return { clicked: false, reason: "no matching clickable element" };
  el.scrollIntoView({ block: "center" });
  el.click();
  return { clicked: true, label: labelOf(el).slice(0, 80) };
}

// ---------- actions ----------

const ACTIONS = {
  async open_url({ url, newTab }) {
    if (!/^https?:\/\//i.test(String(url ?? ""))) {
      throw new Error("url must start with http:// or https://");
    }
    let tab;
    if (newTab || activeTabId == null) {
      tab = await chrome.tabs.create({ url, active: true });
      ownedTabs.add(tab.id);
    } else {
      tab = await chrome.tabs.update(activeTabId, { url });
    }
    activeTabId = tab.id;
    await waitForLoad(tab.id);
    const fresh = await chrome.tabs.get(tab.id);
    return tabSummary(fresh);
  },

  async read_all_text(args) {
    const tab = await targetTab(args);
    const text = await inPage(tab.id, pageText);
    const limit = Number(args.maxChars ?? 12000);
    const full = text ?? "";
    return {
      url: tab.url,
      title: tab.title,
      chars: full.length,
      truncated: full.length > limit,
      text: full.slice(0, limit),
    };
  },

  async find_text(args) {
    if (!args.query) throw new Error("query is required");
    const tab = await targetTab(args);
    return inPage(tab.id, pageFind, [String(args.query)]);
  },

  async list_buttons(args) {
    const tab = await targetTab(args);
    const items = await inPage(tab.id, pageClickables);
    return { count: items.length, items };
  },

  async click_button(args) {
    const target = args.index != null ? Number(args.index) : String(args.label ?? "");
    if (target === "") throw new Error("give a label or an index");
    const tab = await targetTab(args);
    const out = await inPage(tab.id, pageClick, [target]);
    if (!out?.clicked) throw new Error(out?.reason ?? "click failed");
    // A click often navigates; let it settle before the next read.
    await waitForLoad(tab.id, 8000);
    const fresh = await chrome.tabs.get(tab.id).catch(() => tab);
    return { ...out, url: fresh.url, title: fresh.title };
  },

  async take_screenshot(args) {
    const tab = await targetTab(args);
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    await chrome.tabs.update(tab.id, { active: true });
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });
    return { dataUrl, url: tab.url, title: tab.title };
  },

  async open_new_tab({ url }) {
    const tab = await chrome.tabs.create({ url: url || "about:blank", active: true });
    ownedTabs.add(tab.id);
    activeTabId = tab.id;
    if (url) await waitForLoad(tab.id);
    return tabSummary(await chrome.tabs.get(tab.id));
  },

  async list_tabs() {
    const tabs = await chrome.tabs.query({});
    return { tabs: tabs.map(tabSummary), activeTabId };
  },

  async change_tab(args) {
    const tabs = await chrome.tabs.query({});
    let tab = null;
    if (args.tabId != null) tab = tabs.find((t) => t.id === Number(args.tabId)) ?? null;
    else if (args.match) {
      const q = String(args.match).toLowerCase();
      tab =
        tabs.find((t) => (t.title ?? "").toLowerCase().includes(q)) ??
        tabs.find((t) => (t.url ?? "").toLowerCase().includes(q)) ??
        null;
    }
    if (!tab) throw new Error("no tab matches that — call list_tabs to see them");
    activeTabId = tab.id;
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    return tabSummary(tab);
  },

  async close_tab(args) {
    const tab = await targetTab(args);
    const summary = tabSummary(tab);
    await chrome.tabs.remove(tab.id);
    ownedTabs.delete(tab.id);
    if (activeTabId === tab.id) activeTabId = null;
    return { closed: true, ...summary };
  },

  /**
   * Closes only the tabs this extension opened. Closing the user's whole browser
   * — with their other work in it — is not something a model should be able to do.
   */
  async close_browser() {
    const ids = [...ownedTabs];
    if (ids.length) await chrome.tabs.remove(ids).catch(() => {});
    ownedTabs.clear();
    activeTabId = null;
    return { closed: ids.length, note: "closed the tabs opened by HarnessStation" };
  },
};

async function run(action, args) {
  const fn = ACTIONS[action];
  if (!fn) throw new Error(`unknown action "${action}"`);
  return (await fn(args)) ?? null;
}

chrome.tabs.onRemoved.addListener((id) => {
  ownedTabs.delete(id);
  if (activeTabId === id) activeTabId = null;
});

connect();
