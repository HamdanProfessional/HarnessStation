import { create } from "zustand";

interface DialogRequest {
  kind: "alert" | "confirm" | "prompt";
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  danger?: boolean;
  resolve: (value: string | boolean | null) => void;
}

interface DialogState {
  current: DialogRequest | null;
  _open: (r: Omit<DialogRequest, "resolve">) => Promise<string | boolean | null>;
  close: (value: string | boolean | null) => void;
}

export const useDialog = create<DialogState>((set, get) => ({
  current: null,
  _open: (r) =>
    new Promise((resolve) => {
      set({ current: { ...r, resolve } });
    }),
  close: (value) => {
    const cur = get().current;
    if (cur) cur.resolve(value);
    set({ current: null });
  },
}));

const open = useDialog.getState()._open;

/** Info popup with an OK button. */
export function alertDialog(title: string, message?: string): Promise<void> {
  return open({ kind: "alert", title, message }).then(() => undefined);
}

/** Yes/No popup. Resolves true if confirmed. */
export function confirmDialog(
  title: string,
  opts?: { message?: string; danger?: boolean; confirmLabel?: string },
): Promise<boolean> {
  return open({ kind: "confirm", title, message: opts?.message, danger: opts?.danger }).then(
    (v) => v === true,
  );
}

/** Text-input popup. Resolves the string, or null if cancelled. */
export function promptDialog(
  title: string,
  opts?: { message?: string; defaultValue?: string; placeholder?: string },
): Promise<string | null> {
  return open({
    kind: "prompt",
    title,
    message: opts?.message,
    defaultValue: opts?.defaultValue,
    placeholder: opts?.placeholder,
  }).then((v) => (typeof v === "string" ? v : null));
}
