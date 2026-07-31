import { useEffect, useRef, useState } from "react";
import { useDialog } from "../lib/dialog";

export function DialogHost() {
  const current = useDialog((s) => s.current);
  const close = useDialog((s) => s.close);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!current) return;
    // Move focus into the dialog. A confirm/alert has no input, so without this a
    // keyboard user is left focused on whatever was behind the backdrop.
    const t = setTimeout(() => {
      if (current.kind === "prompt") inputRef.current?.focus();
      else okRef.current?.focus();
    }, 30);
    if (current.kind === "prompt") setValue(current.defaultValue ?? "");
    return () => clearTimeout(t);
  }, [current]);

  // Escape cancels from anywhere, not just from inside the prompt input.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close(current.kind === "prompt" ? null : false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [current, close]);

  if (!current) return null;

  const confirm = () => close(current.kind === "prompt" ? value : true);
  const cancel = () => close(current.kind === "prompt" ? null : false);

  return (
    <div className="modal-backdrop" onClick={cancel}>
      <div
        className="dialog"
        role={current.kind === "alert" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="dialog-title" id="dialog-title">
          {current.title}
        </h3>
        {current.message && <p className="dialog-msg">{current.message}</p>}
        {current.kind === "prompt" && (
          <input
            ref={inputRef}
            value={value}
            placeholder={current.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm();
            }}
          />
        )}
        <div className="dialog-actions">
          {current.kind !== "alert" && (
            <button className="btn" onClick={cancel}>
              Cancel
            </button>
          )}
          <button
            ref={okRef}
            className={`btn ${current.danger ? "danger" : "primary"}`}
            onClick={confirm}
          >
            {current.kind === "alert" ? "OK" : current.danger ? "Delete" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
