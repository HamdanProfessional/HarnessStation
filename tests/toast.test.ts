import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_EXIT_MS, useToast } from "../src/lib/toast";

/**
 * Dismissal is a two-step now: flag the toast `leaving` so its exit animation
 * can run, then drop it. That means a toast outlives its own dismiss() call,
 * and the ways that can go wrong — never removed, removed twice, removed early
 * — are all invisible in the UI until a toast sticks to the screen forever.
 */

const reset = () => useToast.setState({ toasts: [], history: [], unread: 0 });

beforeEach(() => {
  vi.useFakeTimers();
  reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dismissing a toast", () => {
  it("flags it rather than deleting it, so the exit can animate", () => {
    useToast.getState().push("info", "hello");
    const { id } = useToast.getState().toasts[0];

    useToast.getState().dismiss(id);

    // Still present — this is the frame the animation needs.
    expect(useToast.getState().toasts).toHaveLength(1);
    expect(useToast.getState().toasts[0].leaving).toBe(true);
  });

  it("removes it once the exit has had time to run", () => {
    useToast.getState().push("info", "hello");
    useToast.getState().dismiss(useToast.getState().toasts[0].id);

    vi.advanceTimersByTime(TOAST_EXIT_MS);

    expect(useToast.getState().toasts).toHaveLength(0);
  });

  it("does not restart the exit when dismissed twice", () => {
    // The auto-dismiss timer and a click can both land on the same toast. The
    // second call must not schedule a second removal, or a toast pushed later
    // that happened to reuse the slot would be cut short.
    useToast.getState().push("info", "hello");
    const { id } = useToast.getState().toasts[0];

    useToast.getState().dismiss(id);
    vi.advanceTimersByTime(TOAST_EXIT_MS / 2);
    useToast.getState().dismiss(id);
    vi.advanceTimersByTime(TOAST_EXIT_MS / 2);

    expect(useToast.getState().toasts).toHaveLength(0);
  });

  it("ignores an id that is already gone", () => {
    expect(() => useToast.getState().dismiss(999)).not.toThrow();
    expect(useToast.getState().toasts).toEqual([]);
  });

  it("leaves the other toasts alone", () => {
    useToast.getState().push("info", "one");
    useToast.getState().push("info", "two");
    const [first, second] = useToast.getState().toasts;

    useToast.getState().dismiss(first.id);
    vi.advanceTimersByTime(TOAST_EXIT_MS);

    expect(useToast.getState().toasts.map((t) => t.id)).toEqual([second.id]);
    expect(useToast.getState().toasts[0].leaving).toBeFalsy();
  });
});

describe("auto-dismiss", () => {
  it("clears an info toast on its own", () => {
    useToast.getState().push("info", "hello");
    vi.advanceTimersByTime(3500 + TOAST_EXIT_MS);
    expect(useToast.getState().toasts).toHaveLength(0);
  });

  it("keeps an error up longer than an info", () => {
    // Errors are the ones worth reading, so they get a longer hold. If this
    // ever collapsed to the info timing it would still "work" and just be
    // unreadable.
    useToast.getState().push("error", "boom");
    vi.advanceTimersByTime(3500 + TOAST_EXIT_MS);
    expect(useToast.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(6000 + TOAST_EXIT_MS);
    expect(useToast.getState().toasts).toHaveLength(0);
  });
});

describe("history", () => {
  it("keeps the entry after the toast itself is gone", () => {
    // The bell reads history, not toasts; dismissing must not erase the record.
    useToast.getState().push("error", "boom");
    useToast.getState().dismiss(useToast.getState().toasts[0].id);
    vi.advanceTimersByTime(TOAST_EXIT_MS);

    expect(useToast.getState().toasts).toHaveLength(0);
    expect(useToast.getState().history).toHaveLength(1);
    expect(useToast.getState().history[0].message).toBe("boom");
  });

  it("counts unread as they arrive", () => {
    useToast.getState().push("info", "a");
    useToast.getState().push("info", "b");
    expect(useToast.getState().unread).toBe(2);

    useToast.getState().clearUnread();
    expect(useToast.getState().unread).toBe(0);
  });
});
