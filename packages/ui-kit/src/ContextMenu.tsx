import { useEffect } from "react";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose?: () => void;
}) {
  useEffect(() => {
    const onDismiss = () => onClose?.();
    window.addEventListener("click", onDismiss);
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("click", onDismiss);
      window.removeEventListener("blur", onDismiss);
    };
  }, [onClose]);

  return (
    <div className="ctx-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      {items.map((it, i) => (
        <button
          key={i}
          className={it.danger ? "danger-item" : ""}
          onClick={() => {
            it.onSelect();
            onClose?.();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
