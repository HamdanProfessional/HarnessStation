import { useEffect, useRef } from "react";

/**
 * Shared modal behaviour: Escape closes, and focus moves into the panel so a
 * keyboard user isn't left on whatever was behind the backdrop.
 *
 * Returns a ref to put on the panel element. Pair it with
 * `role="dialog" aria-modal="true"` and an `aria-label`.
 */
export function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  // Kept in a ref so a caller passing an inline arrow doesn't re-bind every render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Prefer the first focusable control; fall back to the panel itself.
    const t = setTimeout(() => {
      const panel = ref.current;
      if (!panel) return;
      const focusable = panel.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      (focusable ?? panel).focus();
    }, 30);
    return () => clearTimeout(t);
  }, [open]);

  return ref;
}
