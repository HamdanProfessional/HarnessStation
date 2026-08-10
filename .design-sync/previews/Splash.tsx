import { Splash } from "@harnessstation/ui-kit";

/** Splash fills the app's dark surface; the card provides it here. */
export const Booting = () => (
  <div style={{ position: "relative", height: 420, background: "var(--bg)", borderRadius: 8, overflow: "hidden" }}>
    <Splash status="Loading your workspace…" />
  </div>
);
