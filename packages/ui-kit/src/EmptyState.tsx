import type { ReactNode } from "react";

/** A consistent, centered empty-state block for list views. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  secondary,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
}) {
  return (
    <div className="empty-block">
      {icon && <div className="empty-block-ic">{icon}</div>}
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
      {(action || secondary) && (
        <div className="empty-block-actions">
          {action && (
            <button className="btn primary" onClick={action.onClick}>
              {action.label}
            </button>
          )}
          {secondary && (
            <button className="btn" onClick={secondary.onClick}>
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
