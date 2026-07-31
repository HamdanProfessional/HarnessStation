import { create } from "zustand";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastLogEntry extends Toast {
  at: number;
}

interface ToastState {
  toasts: Toast[];
  history: ToastLogEntry[];
  unread: number;
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
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
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  clearUnread: () => set({ unread: 0 }),
  clearHistory: () => set({ history: [], unread: 0 }),
}));

/** Fire a toast from anywhere (including non-React modules like the store). */
export const toast = {
  success: (m: string) => useToast.getState().push("success", m),
  error: (m: string) => useToast.getState().push("error", m),
  info: (m: string) => useToast.getState().push("info", m),
};
