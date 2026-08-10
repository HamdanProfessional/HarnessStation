import type { ReactNode } from "react";
import { Dialog } from "@harnessstation/ui-kit";

/** Dialogs sit on a scrim over the app's dark surface; the card provides it. */
const Surface = ({ children }: { children: ReactNode }) => (
  <div style={{ position: "relative", height: 360, background: "var(--bg)", borderRadius: 8, overflow: "hidden" }}>
    {children}
  </div>
);

export const Confirm = () => (
  <Surface>
    <Dialog
      open
      kind="confirm"
      title="Discard changes?"
      message="You have unsaved edits to this agent. Discarding will lose them."
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  </Surface>
);

export const Prompt = () => (
  <Surface>
    <Dialog
      open
      kind="prompt"
      title="Rename conversation"
      message="Give this chat a name you'll recognize later."
      defaultValue="Model comparison"
      placeholder="Conversation name"
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  </Surface>
);

export const Danger = () => (
  <Surface>
    <Dialog
      open
      kind="confirm"
      title="Delete this agent?"
      message="This permanently removes the agent and its saved configuration."
      danger
      confirmLabel="Delete"
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  </Surface>
);

export const Alert = () => (
  <Surface>
    <Dialog
      open
      kind="alert"
      title="Export complete"
      message="Your bundle was written to the shared folder."
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  </Surface>
);
