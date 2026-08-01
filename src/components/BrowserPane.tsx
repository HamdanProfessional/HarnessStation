import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { registerPane } from "../lib/browserPane";
import { useStore } from "../lib/store";
import { Spinner } from "./Loading";

/**
 * The browser, docked beside the chat or the call.
 *
 * It looks like an iframe in the conversation, but it can't be one: a
 * cross-origin iframe can't be scripted, and most real sites refuse to be framed
 * at all — which is exactly the set of pages worth automating. So this is a
 * native child webview owned by the app window, positioned over the placeholder
 * below. The trade-off is that it floats above the HTML rather than flowing with
 * it, so the placeholder's rectangle has to be pushed to Rust whenever the
 * layout moves.
 *
 * Its logins live in the app's own webview data directory: sign in once here and
 * you stay signed in across restarts, without touching the user's Chrome.
 */
export function BrowserPane() {
  const setBrowserDock = useStore((s) => s.setBrowserDock);
  const setView = useStore((s) => s.setView);
  const slotRef = useRef<HTMLDivElement>(null);

  const [url, setUrl] = useState("https://duckduckgo.com");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rect = () => {
    const r = slotRef.current?.getBoundingClientRect();
    return {
      x: r?.left ?? 0,
      y: r?.top ?? 0,
      width: Math.max(1, r?.width ?? 640),
      height: Math.max(1, r?.height ?? 480),
    };
  };

  const show = useCallback(async (to: string) => {
    const target = to.startsWith("http") ? to : `https://${to}`;
    setUrl(target);
    setBusy(true);
    setError(null);
    try {
      // inapp_open both creates and navigates, so it covers either case.
      await invoke("inapp_open", { url: target, ...rect() });
      setOpen(true);
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // Let the browser tools drive this pane while it's on screen.
  useEffect(() => {
    registerPane(async (to) => {
      await show(to);
      // The webview needs a beat to exist before anything evaluates in it.
      await new Promise((r) => setTimeout(r, 200));
    });
    return () => registerPane(null);
  }, [show]);

  // Keep the native pane glued to the placeholder as the layout moves. The
  // sidebar collapsing or the panel resizing both change our rectangle without
  // any window resize firing, hence the ResizeObserver.
  useEffect(() => {
    if (!open) return;
    const sync = () => void invoke("inapp_bounds", rect()).catch(() => {});
    sync();
    const ro = new ResizeObserver(sync);
    if (slotRef.current) ro.observe(slotRef.current);
    window.addEventListener("resize", sync);
    const tick = setInterval(sync, 500);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      clearInterval(tick);
    };
  }, [open]);

  // Adopt a pane that's already open (the user came back to this view), and hide
  // it again on the way out so it doesn't float over whatever comes next.
  useEffect(() => {
    void invoke<{ open: boolean; url?: string }>("inapp_status")
      .then((s) => {
        if (!s.open) return;
        setOpen(true);
        if (s.url) setUrl(s.url);
        void invoke("inapp_show").catch(() => {});
      })
      .catch(() => {});
    return () => void invoke("inapp_hide").catch(() => {});
  }, []);

  const dock = () => {
    void invoke("inapp_hide").catch(() => {});
    setBrowserDock(false);
  };

  return (
    <aside className="browser-pane">
      <div className="browser-pane-bar">
        <input
          className="grow"
          value={url}
          placeholder="https://…"
          aria-label="Address"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void show(url)}
        />
        <button className="btn primary" disabled={busy} onClick={() => void show(url)}>
          {busy ? <Spinner size={13} /> : "Go"}
        </button>
        <button className="icon-btn" title="Close browser" aria-label="Close browser" onClick={dock}>
          ×
        </button>
      </div>

      {/* The native webview sits over this box. */}
      <div className="browser-slot" ref={slotRef}>
        {!open && (
          <div className="browser-empty">
            <p>Type a URL and press Go — the page opens right here.</p>
            <p className="hint">
              Turn on the <b>Browser</b> tool set and the model can read and click this page while
              you watch. Sites you sign into stay signed in.
            </p>
            <button className="link-btn" onClick={() => setView("browser")}>
              Use my own Chrome instead
            </button>
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
    </aside>
  );
}
