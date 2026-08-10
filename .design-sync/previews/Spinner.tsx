import { Spinner } from "@harnessstation/ui-kit";

/** Spinners appear on the app's dark surface. */
const surface = {
  display: "flex",
  gap: 28,
  alignItems: "center",
  background: "var(--bg)",
  borderRadius: 8,
  padding: 24,
} as const;

export const Sizes = () => (
  <div style={surface}>
    <Spinner size={18} />
    <Spinner size={28} />
    <Spinner size={44} />
  </div>
);

export const Inline = () => (
  <div style={surface}>
    <Spinner size={18} />
    <span style={{ color: "var(--text-dim)" }}>Generating response…</span>
  </div>
);
