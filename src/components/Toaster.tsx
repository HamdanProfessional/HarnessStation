import { createPortal } from "react-dom";
import { useToast } from "../lib/toast";

const ICON: Record<string, string> = {
  success: "✓",
  error: "!",
  info: "i",
};

export function Toaster() {
  const toasts = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);

  return createPortal(
    <div className="toaster">
      {toasts.map((t) => (
        // The slot exists purely to animate the space away. A toast has no
        // fixed height — one line or two — so the collapse is done by
        // transitioning the slot's grid row from 1fr to 0fr, which is the only
        // way to animate to a content-derived height.
        <div key={t.id} className={`toast-slot${t.leaving ? " leaving" : ""}`}>
          <div className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
            <span className="toast-icon">{ICON[t.kind]}</span>
            <span className="toast-msg">{t.message}</span>
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
