import type { ReactNode } from "react";

export function Button({
  variant = "default",
  size,
  disabled,
  onClick,
  children,
  type = "button",
}: {
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "small";
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  type?: "button" | "submit";
}) {
  return (
    <button
      className={["btn", variant !== "default" && variant, size].filter(Boolean).join(" ")}
      type={type}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
