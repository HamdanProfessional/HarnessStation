import { ViewLoading } from "@harnessstation/ui-kit";

/** Fills a content pane while a lazily-loaded view arrives. */
export const Default = () => (
  <div style={{ display: "flex", height: 300, background: "var(--bg)", borderRadius: 8, overflow: "hidden" }}>
    <ViewLoading label="Loading conversations…" />
  </div>
);
