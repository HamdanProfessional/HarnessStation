import { LogoMark } from "./icons";

/**
 * The app's loading surfaces.
 *
 * These used to be one unstyled `Loading…` div. Inside the app shell — a flex
 * row — it shrank to its content width and sat against the sidebar, which reads
 * as a broken pane rather than as work in progress. Each state now fills the
 * space it owns and says what is actually happening.
 */

/** Boot screen, shown until the store has read everything off disk. */
export function Splash({ status }: { status?: string | null }) {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash-mark">
        <LogoMark size={46} />
      </div>
      <div className="splash-name">HarnessStation</div>
      <div className="splash-bar">
        <span />
      </div>
      <div className="splash-status">{status || "Starting…"}</div>
    </div>
  );
}

/**
 * Fills the content pane while a lazily-loaded view arrives. Sized to grow so
 * it occupies the same space the view will, instead of collapsing to the left.
 */
export function ViewLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <main className="view-loading" role="status" aria-live="polite">
      <Spinner />
      <span>{label}</span>
    </main>
  );
}

/** Small inline spinner, for buttons and panels. */
export function Spinner({ size = 22 }: { size?: number }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/**
 * Shown while the app finishes writing to disk on the way out. Chat saves are
 * batched while streaming, so there can genuinely be a moment's work to flush.
 */
export function ClosingOverlay() {
  return (
    <div className="closing-overlay" role="status" aria-live="polite">
      <Spinner />
      <span>Saving your work…</span>
    </div>
  );
}
