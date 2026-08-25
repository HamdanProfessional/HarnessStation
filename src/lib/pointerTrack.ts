/**
 * Pointer position as a head-tracking target, shared by every avatar without
 * each component wiring its own listeners.
 *
 * Coordinates are normalized to -1..1 from the screen centre, y inverted so
 * moving the mouse up makes the character look up. Tracking starts lazily on
 * first use — an app that never opened a voice view should never attach a
 * global mousemove listener.
 */

let pos = { x: 0, y: 0 };
let listening = false;

function clamp(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

function onMove(e: MouseEvent): void {
  const w = window.innerWidth / 2;
  const h = window.innerHeight / 2;
  pos = {
    x: clamp((e.clientX - w) / w),
    y: clamp(-(e.clientY - h) / h),
  };
}

/** Attach the (single, passive) listener; safe to call repeatedly. */
export function startPointerTracking(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("mousemove", onMove, { passive: true });
}

/** Current pointer target in -1..1 coordinates (y up). */
export function pointerPosition(): { x: number; y: number } {
  startPointerTracking();
  return pos;
}

/** Test seam: forget the listener and recentre. */
export function resetPointerTracking(): void {
  if (listening && typeof window !== "undefined" && typeof window.removeEventListener === "function") {
    window.removeEventListener("mousemove", onMove);
  }
  listening = false;
  pos = { x: 0, y: 0 };
}
