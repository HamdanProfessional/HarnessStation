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
 * That's also the hard part. A native webview is an OS-level overlay: it floats
 * above the page and the scroll container cannot clip it. So as the card scrolls
 * this measures the intersection of the card and the message list and resizes the
 * webview to match — otherwise the page would slide up over the header on its way
 * out of view.
 */
export function InlineBrowser() {
  const setBrowserDock = useStore((s) => s.setBrowserDock);
  const slotRef = useRef<HTMLDivElement>(null);

  const [url, setUrl] = useState("https://duckduckgo.com");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Card rect clipped to the visible part of the message list. */
  const visibleRect = useCallback(() => {
    const el = slotRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const scroller = el.closest(".messages");
    const s = scroller?.getBoundingClientRect();
    const top = Math.max(r.top, s?.top ?? 0);
    const bottom = Math.min(r.bottom, s?.bottom ?? window.innerHeight);
    const height = bottom - top;
    // Too little showing to be worth a page — a sliver of browser peeking out
    // above the composer looks like a rendering fault.
    if (height < 80 || r.width < 80) return null;
    return { x: r.left, y: top, width: r.width, height };
  }, []);

  const show = useCallback(
    async (to: string) => {
      const target = to.startsWith("http") ? to : `https://${to}`;
      setUrl(target);
      setBusy(true);
      setError(null);
      try {
        const r = visibleRect() ?? { x: 0, y: 0, width: 640, height: 360 };
        await invoke("inapp_open", { url: target, ...r });
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

  // Follow the card as the conversation scrolls, streams and reflows.
  useEffect(() => {
    if (!open) return;
    let last = "";
    let frame = 0;
    const apply = () => {
      frame = 0;
      const r = visibleRect();
      if (!r) {
        if (last !== "hidden") {
          last = "hidden";
          void invoke("inapp_hide").catch(() => {});
        }
        return;
      }
      const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
      if (key === last) return;
      const wasHidden = last === "hidden";
      last = key;
      void invoke("inapp_bounds", r).catch(() => {});
      if (wasHidden) void invoke("inapp_show").catch(() => {});
    };
    // Scroll fires far faster than a webview can be moved; coalesce to a frame.
    const sync = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    const scroller = slotRef.current?.closest(".messages");
    scroller?.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    const ro = new ResizeObserver(sync);
    if (slotRef.current) ro.observe(slotRef.current);
    if (scroller) ro.observe(scroller);
    // Streaming text reflows the list without either event firing.
    const tick = setInterval(sync, 400);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
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
