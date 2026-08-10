import type { ReactNode } from "react";
import { LogoMark } from "@harnessstation/ui-kit";

/** The brand mark on the app's dark surface. */
const Surface = ({ children }: { children: ReactNode }) => (
  <div style={{ background: "var(--bg)", borderRadius: 8, padding: 24, color: "var(--accent)" }}>
    {children}
  </div>
);

export const Default = () => (
  <Surface>
    <LogoMark size={72} />
  </Surface>
);

export const Sizes = () => (
  <Surface>
    <div style={{ display: "flex", gap: 24, alignItems: "flex-end" }}>
      <LogoMark size={24} />
      <LogoMark size={40} />
      <LogoMark size={64} />
    </div>
  </Surface>
);

export const Lockup = () => (
  <Surface>
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <LogoMark size={36} />
      <span style={{ color: "var(--text)", fontSize: 20, fontWeight: 600 }}>HarnessStation</span>
    </div>
  </Surface>
);
