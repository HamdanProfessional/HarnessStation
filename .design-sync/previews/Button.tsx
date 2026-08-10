import { Button } from "@harnessstation/ui-kit";

export const Variants = () => (
  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
    <Button variant="primary" onClick={() => {}}>Save changes</Button>
    <Button onClick={() => {}}>Cancel</Button>
    <Button variant="ghost" onClick={() => {}}>Learn more</Button>
    <Button variant="danger" onClick={() => {}}>Delete agent</Button>
  </div>
);

export const Sizes = () => (
  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
    <Button variant="primary" onClick={() => {}}>Default</Button>
    <Button variant="primary" size="small" onClick={() => {}}>Small</Button>
  </div>
);

export const Disabled = () => (
  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
    <Button variant="primary" disabled>Running…</Button>
    <Button disabled>Unavailable</Button>
  </div>
);
