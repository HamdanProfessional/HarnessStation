import { ContextMenu } from "@harnessstation/ui-kit";

export const Default = () => (
  <ContextMenu
    x={16}
    y={16}
    items={[
      { label: "Cut", onSelect: () => {} },
      { label: "Copy", onSelect: () => {} },
      { label: "Paste", onSelect: () => {} },
      { label: "Select all", onSelect: () => {} },
    ]}
  />
);

export const WithDanger = () => (
  <ContextMenu
    x={16}
    y={16}
    items={[
      { label: "Rename", onSelect: () => {} },
      { label: "Duplicate", onSelect: () => {} },
      { label: "Delete", onSelect: () => {}, danger: true },
    ]}
  />
);
