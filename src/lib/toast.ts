import { create } from "zustand";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Set while the exit animation plays, just before the toast is removed. */
  leaving?: boolean;
}

/**
 * How long the exit animation runs before the toast is actually dropped.
 *
 * Mirrors `--t-base` in App.css. A toast removed the instant it is dismissed
 * vanishes mid-sentence and yanks the rest of the stack with it; holding the
 * element for the length of its animation is what makes the removal readable.
 */
export const TOAST_EXIT_MS = 180;

export interface ToastLogEntry extends Toast {
  at: number;
}

interface ToastState {
  toasts: Toast[];
  history: ToastLogEntry[];
  unread: number;
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
  /** Drop a toast immediately, once its exit animation has finished. */
  remove: (id: number) => void;
  clearUnread: () => void;
  clearHistory: () => void;
}

let seq = 1;

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  history: [],
  unread: 0,
  push: (kind, message) => {
    const id = seq++;
    const at = Date.now();
    set({
      toasts: [...get().toasts, { id, kind, message }],
      history: [{ id, kind, message, at }, ...get().history].slice(0, 100),
      unread: get().unread + 1,
    });
    setTimeout(() => get().dismiss(id), kind === "error" ? 6000 : 3500);
  },
  dismiss: (id) => {
    const t = get().toasts.find((x) => x.id === id);
    // Guard re-entry: the auto-dismiss timer and a click can both land on the
    // same toast, and without this the second one restarts the exit animation
    // on an element that is already halfway out.
    if (!t || t.leaving) return;
    set({ toasts: get().toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x)) });
    setTimeout(() => get().remove(id), TOAST_EXIT_MS);
  },
  remove: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  clearUnread: () => set({ unread: 0 }),
  clearHistory: () => set({ history: [], unread: 0 }),
}));

/** Fire a toast from anywhere (including non-React modules like the store). */
export const toast = {
  success: (m: string) => useToast.getState().push("success", m),
  error: (m: string) => useToast.getState().push("error", m),
  info: (m: string) => useToast.getState().push("info", m),
};
