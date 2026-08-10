import { ClosingOverlay } from "@harnessstation/ui-kit";

/** A blurred scrim over the app while work flushes to disk on the way out. */
export const Saving = () => (
  <div style={{ position: "relative", height: 300, background: "var(--bg)", borderRadius: 8, overflow: "hidden" }}>
    <div style={{ padding: 24, color: "var(--text-dim)" }}>Workspace content…</div>
    <ClosingOverlay />
  </div>
);
