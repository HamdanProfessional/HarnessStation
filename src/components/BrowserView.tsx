import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  browserStatus,
  browserTarget,
  lastScreenshot,
  setBrowserTarget,
  type BrowserTarget,
} from "../lib/browserTools";
import { useStore } from "../lib/store";
import { Spinner } from "./Loading";
import { IconX } from "./icons";

/**
 * Browser view.
 *
 * The in-app pane is a real webview owned by the app window, not an iframe — a
 * cross-origin iframe can't be scripted and most sites refuse to be framed at
 * all. Because it's a native child webview it floats *above* the HTML rather
 * than flowing with it, so this component measures a placeholder div and tells
 * Rust where to put it. That's the price of having a browser the model can
 * actually drive.
 *
 * Its logins live in the app's own webview data directory, so a session you
 * start here persists across restarts and belongs to HarnessStation.
 */
export function BrowserView() {
  const setView = useStore((s) => s.setView);
  const slotRef = useRef<HTMLDivElement>(null);

  const [target, setTarget] = useState<BrowserTarget>(browserTarget());
  const [url, setUrl] = useState("https://duckduckgo.com");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [extension, setExtension] = useState<{ connected: boolean; port: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shot = lastScreenshot();

  // Keep the native pane lined up with the placeholder as the window resizes.
  useEffect(() => {
    if (target !== "inapp" || !open) return;
    const sync = () => {
      const el = slotRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      void invoke("inapp_bounds", {
        x: r.left,
        y: r.top,
        width: Math.max(1, r.width),
        height: Math.max(1, r.height),
      }).catch(() => {});
    };
    sync();
    const ro = new ResizeObserver(sync);
    if (slotRef.current) ro.observe(slotRef.current);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [target, open]);

  // The pane floats over the whole window, so it must be hidden when this view
  // isn't the one on screen — otherwise it covers the chat.
  useEffect(() => {
    return () => {
      void invoke("inapp_hide").catch(() => {});
    };
  }, []);

  useEffect(() => {
    void invoke<{ open: boolean }>("inapp_status")
      .then((s) => {
        setOpen(!!s.open);
        if (s.open) void invoke("inapp_show").catch(() => {});
      })
      .catch(() => {});
    const poll = setInterval(() => void browserStatus().then(setExtension), 2000);
    void browserStatus().then(setExtension);
    return () => clearInterval(poll);
  }, []);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const el = slotRef.current;
      const r = el?.getBoundingClientRect();
      await invoke("inapp_open", {
        url: url.startsWith("http") ? url : `https://${url}`,
        x: r?.left ?? 0,
        y: r?.top ?? 0,
        width: Math.max(1, r?.width ?? 800),
        height: Math.max(1, r?.height ?? 600),
      });
      setOpen(true);
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const closePane = async () => {
    await invoke("inapp_close").catch(() => {});
    setOpen(false);
  };

  const pickTarget = (t: BrowserTarget) => {
    setTarget(t);
    setBrowserTarget(t);
    if (t === "extension") void invoke("inapp_hide").catch(() => {});
    else if (open) void invoke("inapp_show").catch(() => {});
  };

  return (
    <main className="browser-main">
      <div className="browser-bar">
        <button className="btn" onClick={() => setView("chat")}>
          ←
        </button>
        <div className="seg">
          <button
            className={`seg-btn ${target === "inapp" ? "active" : ""}`}
            onClick={() => pickTarget("inapp")}
          >
            In-app
          </button>
          <button
            className={`seg-btn ${target === "extension" ? "active" : ""}`}
            onClick={() => pickTarget("extension")}
          >
            My browser
          </button>
        </div>
        <input
          className="grow"
          value={url}
          placeholder="https://…"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void go()}
          disabled={target !== "inapp"}
        />
        <button className="btn primary" disabled={busy || target !== "inapp"} onClick={() => void go()}>
          {busy ? <Spinner size={13} /> : "Go"}
        </button>
        {open && target === "inapp" && (
          <button className="btn" onClick={() => void closePane()}>
            Close
          </button>
        )}
      </div>

      {target === "inapp" ? (
        <>
          {/* The native webview is positioned over this box. */}
          <div className="browser-slot" ref={slotRef}>
            {!open && (
              <div className="browser-empty">
                <p>Type a URL and press Go — the page opens right here.</p>
                <p className="hint">
                  Enable the <b>Browser</b> tool set in a chat and the model can read and click this
                  page. Sites you sign into stay signed in, in the app's own session store.
                </p>
              </div>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button className="error-dismiss" aria-label="Dismiss" onClick={() => setError(null)}>
                <IconX size={12} />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="browser-ext">
          <div className="provider-row" style={{ alignItems: "center" }}>
            <span className={`conn-dot ${extension?.connected ? "on" : ""}`} aria-hidden="true" />
            <b>{extension?.connected ? "Extension connected" : "Extension not connected"}</b>
            <span className="hint">port {extension?.port ?? 8791}</span>
          </div>
          <p className="hint">
            Drives Chrome/Edge itself, so it uses the sessions you're already signed in to there —
            and it can take screenshots, which the in-app pane can't yet.
          </p>
          {!extension?.connected && (
            <ol className="hint browser-steps">
              <li>
                Open <code>chrome://extensions</code> (or <code>edge://extensions</code>).
              </li>
              <li>
                Turn on <b>Developer mode</b>.
              </li>
              <li>
                <b>Load unpacked</b> → choose the <code>extension</code> folder in HarnessStation.
              </li>
            </ol>
          )}
          {shot && (
            <>
              <p className="hint">
                Last capture: {shot.title} — {shot.url}
              </p>
              <img className="browser-shot" src={shot.dataUrl} alt="Last captured page" />
            </>
          )}
        </div>
      )}
    </main>
  );
}
