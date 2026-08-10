import { useEffect, useRef, useState } from "react";

export interface DialogProps {
  open: boolean;
  kind?: "alert" | "confirm" | "prompt";
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  danger?: boolean;
  confirmLabel?: string;
  onConfirm: (value: string | true) => void;
  onCancel: () => void;
}

export function Dialog({
  open,
  kind = "confirm",
  title,
  message,
  defaultValue,
  placeholder,
  danger,
  confirmLabel,
  onConfirm,
  onCancel,
}: DialogProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Move focus into the dialog. A confirm/alert has no input, so without this a
    // keyboard user is left focused on whatever was behind the backdrop.
    const t = setTimeout(() => {
      if (kind === "prompt") inputRef.current?.focus();
      else okRef.current?.focus();
    }, 30);
    if (kind === "prompt") setValue(defaultValue ?? "");
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape cancels from anywhere, not just from inside the prompt input.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const confirm = () => onConfirm(kind === "prompt" ? value : true);
  const cancel = () => onCancel();

  return (
    <div className="modal-backdrop" onClick={cancel}>
      <div
        className="dialog"
        role={kind === "alert" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="dialog-title" id="dialog-title">
          {title}
        </h3>
        {message && <p className="dialog-msg">{message}</p>}
        {kind === "prompt" && (
          <input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm();
            }}
          />
        )}
        <div className="dialog-actions">
          {kind !== "alert" && (
            <button className="btn" onClick={cancel}>
              Cancel
            </button>
          )}
          <button
            ref={okRef}
            className={`btn ${danger ? "danger" : "primary"}`}
            onClick={confirm}
          >
            {kind === "alert" ? "OK" : danger ? confirmLabel || "Delete" : confirmLabel || "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
