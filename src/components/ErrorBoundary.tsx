import { Component, type ErrorInfo, type ReactNode } from "react";
import { clearCrashRecord, describeCrash, shouldAutoRecover, type CrashReport } from "../lib/crashGuard";

/**
 * The app's last line of defence.
 *
 * React unmounts the entire tree when a render throws, and the app had no
 * boundary at all — so any error in any component left `<div id="root">` empty
 * and the window blank white, with no message, no way back, and nothing written
 * down. This catches that and turns it into something readable and recoverable.
 *
 * Deliberately dependency-free: no store, no Markdown, no icons, inline styles
 * rather than App.css classes. Everything it touches is something that could
 * itself be the thing that broke, and a crash screen that crashes leaves the
 * user exactly where they started.
 */

interface Props {
  children: ReactNode;
}

interface State {
  report: CrashReport | null;
  /** True while an automatic recovery is in flight, so we show why. */
  recovering: boolean;
  copied: boolean;
}

/** After this long without a crash, the session is considered healthy again. */
const HEALTHY_AFTER_MS = 30_000;

export class ErrorBoundary extends Component<Props, State> {
  state: State = { report: null, recovering: false, copied: false };
  private healthyTimer: number | undefined;

  static getDerivedStateFromError(err: unknown): Partial<State> {
    return { report: describeCrash(err) };
  }

  componentDidMount(): void {
    // Nothing has thrown for a while, so a later crash is a fresh incident and
    // is allowed its one automatic recovery.
    this.healthyTimer = window.setTimeout(clearCrashRecord, HEALTHY_AFTER_MS);
  }

  componentWillUnmount(): void {
    window.clearTimeout(this.healthyTimer);
  }

  componentDidCatch(err: unknown, info: ErrorInfo): void {
    const report = describeCrash(err, info.componentStack ?? undefined);
    // Console first, before anything else can fail — this is often the only
    // record that survives if the reload happens.
    console.error("[HarnessStation] unrecoverable render error", report.detail);
    this.setState({ report });
    void this.makeCloseMeanQuit();

    if (shouldAutoRecover(Date.now())) {
      this.setState({ recovering: true });
      // A beat so the message is actually seen rather than flashing past. The
      // user asked to be told what happened, not just to have it silently
      // papered over.
      window.setTimeout(() => window.location.reload(), 1500);
    }
  }

  /**
   * Make the window's X button actually quit while the crash screen is up.
   *
   * Rust owns the close behaviour and defaults to hide-to-tray, which the
   * frontend only corrects once the store has hydrated. A crash before that
   * point leaves the default in force, so closing the broken window hid it and
   * left the process running — still holding the browser-tools port and the
   * global shortcuts, which then made the *next* launch fail to bind them. That
   * is the "it closed but is still broken" loop.
   *
   * Best-effort: if the invoke fails there is nothing further to do, and the
   * Restart button is still there.
   */
  private makeCloseMeanQuit = async (): Promise<void> => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_background_mode", { enabled: false });
    } catch {
      /* browser build, or the backend is gone too */
    }
  };

  private restart = async (): Promise<void> => {
    try {
      // Full process restart, which also clears anything wedged on the Rust
      // side — a hung local server, a stuck child process.
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      // Browser build, or the plugin is unavailable. Reloading the webview is
      // the most we can do and it fixes the frontend-only case anyway.
      window.location.reload();
    }
  };

  private copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(this.state.report?.detail ?? "");
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      /* clipboard denied — the details are on screen and selectable anyway */
    }
  };

  render(): ReactNode {
    const { report, recovering, copied } = this.state;
    if (!report) return this.props.children;

    return (
      <div style={S.wrap} role="alert">
        <div style={S.card}>
          <div style={S.title}>HarnessStation hit an error</div>
          <p style={S.lead}>
            Your chats are saved — they are written to disk as they happen, so nothing was lost.
          </p>
          <div style={S.msg}>{report.message}</div>

          {recovering ? (
            <p style={S.note}>Restarting automatically…</p>
          ) : (
            <p style={S.note}>
              This has happened more than once just now, so it is not restarting on its own — that
              would loop. Use the buttons below.
            </p>
          )}

          <div style={S.row}>
            <button style={{ ...S.btn, ...S.primary }} onClick={() => void this.restart()}>
              Restart the app
            </button>
            <button style={S.btn} onClick={() => window.location.reload()}>
              Reload the window
            </button>
            <button style={S.btn} onClick={() => void this.copy()}>
              {copied ? "Copied" : "Copy details"}
            </button>
          </div>

          <details style={S.details}>
            <summary style={S.summary}>Technical details</summary>
            <pre style={S.pre}>{report.detail}</pre>
          </details>
        </div>
      </div>
    );
  }
}

/**
 * Inline styles, on purpose.
 *
 * A stylesheet that failed to load, or a theme variable that is undefined
 * because the store never hydrated, are both plausible causes of the crash this
 * screen exists to report. Hard-coded colours are the only ones guaranteed to
 * be legible here, and they are dark-on-dark-safe without needing the theme.
 */
const S: Record<string, React.CSSProperties> = {
  wrap: {
    position: "fixed",
    inset: 0,
    display: "grid",
    placeItems: "center",
    padding: 24,
    background: "#0b0d12",
    color: "#e6e9ef",
    font: "14px/1.55 system-ui, -apple-system, Segoe UI, sans-serif",
    overflow: "auto",
    zIndex: 99999,
  },
  card: { width: "min(680px, 100%)" },
  title: { fontSize: 20, fontWeight: 600, marginBottom: 8 },
  lead: { color: "#9aa3b2", margin: "0 0 14px" },
  msg: {
    padding: "11px 13px",
    borderRadius: 10,
    border: "1px solid rgba(240,90,90,0.4)",
    background: "rgba(240,90,90,0.10)",
    color: "#ff9b9b",
    fontFamily: "Cascadia Code, Consolas, monospace",
    fontSize: 12.5,
    wordBreak: "break-word",
  },
  note: { color: "#9aa3b2", fontSize: 12.5, margin: "12px 0 16px" },
  row: { display: "flex", gap: 8, flexWrap: "wrap" },
  btn: {
    padding: "8px 14px",
    borderRadius: 9,
    border: "1px solid #2a3040",
    background: "#161a23",
    color: "#e6e9ef",
    fontSize: 13,
    cursor: "pointer",
  },
  primary: { background: "#5e6ad2", borderColor: "transparent", color: "#fff" },
  details: { marginTop: 18 },
  summary: { cursor: "pointer", color: "#9aa3b2", fontSize: 12.5 },
  pre: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    background: "#0a0c11",
    border: "1px solid #2a3040",
    color: "#c9d1d9",
    fontFamily: "Cascadia Code, Consolas, monospace",
    fontSize: 11.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: 280,
    overflow: "auto",
  },
};
