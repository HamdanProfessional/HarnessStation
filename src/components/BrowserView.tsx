import { useEffect, useState } from "react";
import { browserStatus, lastScreenshot } from "../lib/browserTools";
import { useStore } from "../lib/store";
import { Spinner } from "./Loading";

/**
 * Setup and viewer for browser control.
 *
 * There is deliberately no live iframe of the page here. A cross-origin iframe
 * can't be read or clicked by script, and most real sites refuse to be framed at
 * all (`X-Frame-Options`, CSP `frame-ancestors`) — so an embedded frame could
 * neither drive the page nor reliably display it. The browser you already use is
 * the real surface; this panel shows its connection state and the last thing the
 * model looked at.
 */
export function BrowserView() {
  const setView = useStore((s) => s.setView);
  const [status, setStatus] = useState<{ connected: boolean; port: number } | null>(null);
  const [shot, setShot] = useState(lastScreenshot());

  useEffect(() => {
    const poll = () => {
      void browserStatus().then(setStatus);
      setShot(lastScreenshot());
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, []);

  const connected = status?.connected ?? false;

  return (
    <main className="settings-main">
      <div className="settings-header">
        <h1>Browser</h1>
        <button className="btn" onClick={() => setView("chat")}>
          ← Back
        </button>
      </div>

      <section>
        <div className="provider-row" style={{ alignItems: "center" }}>
          {status === null ? (
            <Spinner size={14} />
          ) : (
            <span className={`conn-dot ${connected ? "on" : ""}`} aria-hidden="true" />
          )}
          <b>{status === null ? "Checking…" : connected ? "Extension connected" : "Not connected"}</b>
          <span className="hint">port {status?.port ?? 8791}</span>
        </div>
        <p className="hint">
          The model drives <b>the browser you already use</b>, through a small extension. That means
          it works with the sites you're signed in to — nothing about your browser has to change: no
          debug flags, no separate profile, no relaunch.
        </p>
      </section>

      {!connected && (
        <section>
          <h2>Install the extension</h2>
          <ol className="hint browser-steps">
            <li>
              Open <code>chrome://extensions</code> (or <code>edge://extensions</code>).
            </li>
            <li>
              Turn on <b>Developer mode</b>.
            </li>
            <li>
              Click <b>Load unpacked</b> and choose the <code>extension</code> folder inside
              HarnessStation.
            </li>
            <li>It connects on its own — this page will say so within a couple of seconds.</li>
          </ol>
        </section>
      )}

      <section>
        <h2>What it can do</h2>
        <p className="hint">
          Enable the <b>Browser</b> tool set in a chat, then ask for something on the web. The model
          reads the page as text first and only looks at a screenshot when it has to, which keeps the
          context small.
        </p>
        <p className="hint">
          Two limits on purpose: <b>close_browser only closes the tabs it opened</b>, never your own
          work, and there is <b>no typing or form filling</b> — reading and clicking is a much
          smaller blast radius on sites you're logged into.
        </p>
      </section>

      <section>
        <h2>Last screenshot</h2>
        {shot ? (
          <>
            <p className="hint">
              {shot.title} — {shot.url}
            </p>
            <img className="browser-shot" src={shot.dataUrl} alt="Last captured page" />
          </>
        ) : (
          <p className="hint">Nothing captured yet. It appears here when the model takes one.</p>
        )}
      </section>
    </main>
  );
}
