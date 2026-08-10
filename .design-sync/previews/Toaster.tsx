import { Toaster } from "@harnessstation/ui-kit";

/** The toaster pins to the bottom-right of the app surface. */
export const Stack = () => (
  <div style={{ position: "relative", height: 260, background: "var(--bg)", borderRadius: 8, overflow: "hidden" }}>
    <Toaster
      onDismiss={() => {}}
      toasts={[
        { id: 1, kind: "success", message: "Agent saved" },
        { id: 2, kind: "info", message: "Model downloaded" },
        { id: 3, kind: "error", message: "Tool call timed out" },
      ]}
    />
  </div>
);
