import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { registerPane } from "../lib/browserPane";
import { useStore } from "../lib/store";
import { Spinner } from "./Loading";

/**
 * The browser, embedded in the conversation.
 *
 * It reads as a card in the message flow — the model opens a page and you watch
 * it happen in line, without the chat moving aside. It looks like an iframe and
 * isn't one: a cross-origin iframe can't be scripted, and most sites worth
 * automating refuse to be framed at all. So it's a native child webview owned by
 * the app window, positioned over the placeholder below.
 *
 * It deliberately sits *below* the scrolling message list rather than inside it,
 * and that is a correctness decision, not a layout preference.
 *
 * Moving a child webview means SetWindowPos on a window owned by another
 * process. That call blocks until the owning thread services the message — and
 * a heavy page (an ad-laden site, anything with anti-bot script) stops pumping
 * for seconds at a time. Inside the scroll container the app issued one of those
 * per scroll frame, from the UI thread, and froze twice: every thread parked in
 * EventPairLow, the wait state for exactly that cross-process message.
 *
 * Out of the scroll flow the rectangle only changes when the window or the panel
 * is resized, which takes it from hundreds of blocking calls a second to a
 * handful an hour. It also means the page stays put while you read back through
 * the conversation, which is the better behaviour anyway.
 */
export function InlineBrowser() {
  const setBrowserDock = useStore((s) => s.setBrowserDock);
  const slotRef = useRef<HTMLDivElement>(null);

  const [url, setUrl] = useState("https://duckduckgo.com");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Where the page should sit. Null while the panel has no usable size. */
  const visibleRect = useCallback(() => {
    const el = slotRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // A collapsed or off-screen panel gets nothing rather than a sliver of page.
    if (r.height < 80 || r.width < 120) return null;
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, []);

  const show = useCallback(
    async (to: string) => {
      const target = to.startsWith("http") ? to : `https://${to}`;
      setUrl(target);
      setBusy(true);
      setError(null);
      try {
        // Falling back to a fixed rectangle would drop the page at the top-left
        // of the window, over the app. If the card isn't measurable yet, open it
        // hidden and let the sync loop place it on the next frame.
        const r = visibleRect();
        await invoke("inapp_open", {
          url: target,
          ...(r ?? { x: 0, y: 0, width: 1, height: 1 }),
        });
        if (!r) await invoke("inapp_hide").catch(() => {});
        setOpen(true);
      } catch (e) {
        setError((e as Error).message || String(e));
      } finally {
        setBusy(false);
      }
    },
    [visibleRect],
  );

  // Let the browser tools drive this card while it's on screen.
  useEffect(() => {
    registerPane(async (to) => {
      await show(to);
      await new Promise((r) => setTimeout(r, 200));
    });
    return () => registerPane(null);
  }, [show]);

  // Follow the panel when the layout actually changes — a window resize, the
  // sidebar collapsing. Not on scroll: the panel doesn't scroll any more.
  useEffect(() => {
    if (!open) return;
    let last = "";
    let frame = 0;
    // Moving the webview is a blocking call into the window's message loop, and
    // scroll can ask far faster than it completes. One at a time, or they stack
    // up as concurrent blocking calls and the app stops responding.
    let inFlight = false;

    const apply = async () => {
      frame = 0;
      // Nothing to position while the window is tabbed away or minimised, and
      // driving a webview belonging to an inactive window is what wedged it.
      if (document.hidden || inFlight) return;

      const r = visibleRect();
      if (!r) {
        if (last !== "hidden") {
          last = "hidden";
          inFlight = true;
          await invoke("inapp_hide").catch(() => {});
          inFlight = false;
        }
        return;
      }
      const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
      if (key === last) return;
      const wasHidden = last === "hidden";
      last = key;
      inFlight = true;
      try {
        await invoke("inapp_bounds", r).catch(() => {});
        if (wasHidden) await invoke("inapp_show").catch(() => {});
      } finally {
        inFlight = false;
      }
    };
    // Scroll fires far faster than a webview can be moved; coalesce to a frame.
    const sync = () => {
      if (!frame) frame = requestAnimationFrame(() => void apply());
    };

    // Coming back from another window, the pane needs re-placing — the layout
    // may have moved while nothing was being applied.
    const onVisibility = () => {
      if (!document.hidden) sync();
    };

    void apply();
    window.addEventListener("resize", sync);
    document.addEventListener("visibilitychange", onVisibility);
    const ro = new ResizeObserver(sync);
    if (slotRef.current) ro.observe(slotRef.current);
    // A slow backstop for layout the observer can't see (a panel opening
    // elsewhere). Deliberately lazy — apply() is a no-op unless the rectangle
    // genuinely moved, and each real call can block on the page's own process.
    const tick = setInterval(sync, 2000);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", sync);
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      clearInterval(tick);
    };
  }, [open, visibleRect]);

  // Adopt a page that's already open, and hide it on the way out so it can't
  // float over whatever replaces this view.
  useEffect(() => {
    void invoke<{ open: boolean; url?: string }>("inapp_status")
      .then((s) => {
        if (!s.open) return;
        setOpen(true);
        if (s.url) setUrl(s.url);
      })
      .catch(() => {});
    return () => void invoke("inapp_hide").catch(() => {});
  }, []);

  const close = () => {
    void invoke("inapp_hide").catch(() => {});
    setBrowserDock(false);
  };

  return (
    <div className="inline-browser">
      <div className="inline-browser-bar">
        <span className="inline-browser-dot" aria-hidden="true" />
        <input
          className="grow"
          value={url}
          aria-label="Address"
          placeholder="https://…"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void show(url)}
        />
        <button className="btn small" disabled={busy} onClick={() => void show(url)}>
          {busy ? <Spinner size={12} /> : "Go"}
        </button>
        <button className="icon-btn" title="Close browser" aria-label="Close browser" onClick={close}>
          ×
        </button>
      </div>

      {/* The native webview is positioned over this box. */}
      <div className="inline-browser-slot" ref={slotRef}>
        {!open && (
          <div className="browser-empty">
            <p>Type a URL, or ask the model to open one — the page appears here.</p>
          </div>
        )}
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button className="error-dismiss" aria-label="Dismiss" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
