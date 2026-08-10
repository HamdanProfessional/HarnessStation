import { Toast } from "@harnessstation/ui-kit";

export const Success = () => (
  <Toast kind="success" message="Agent saved" onDismiss={() => {}} />
);

export const Error = () => (
  <Toast kind="error" message="Request failed: 401 unauthorized" onDismiss={() => {}} />
);

export const Info = () => (
  <Toast kind="info" message="Compacted 8 earlier messages" onDismiss={() => {}} />
);
