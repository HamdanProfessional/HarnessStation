export type ToastKind = "success" | "error" | "info";

export interface ToastData {
  id: number;
  kind: ToastKind;
  message: string;
}

const ICON: Record<ToastKind, string> = {
  success: "✓",
  error: "!",
  info: "i",
};

export function Toast({
  kind,
  message,
  onDismiss,
}: {
  kind: ToastKind;
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div className={`toast toast-${kind}`} onClick={onDismiss}>
      <span className="toast-icon">{ICON[kind]}</span>
      <span className="toast-msg">{message}</span>
    </div>
  );
}

export function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: ToastData[];
  onDismiss?: (id: number) => void;
}) {
  return (
    <div className="toaster">
      {toasts.map((t) => (
        <Toast key={t.id} kind={t.kind} message={t.message} onDismiss={() => onDismiss?.(t.id)} />
      ))}
    </div>
  );
}
