import { beforeEach, describe, expect, it, vi } from "vitest";
import { answer, ask, cancel, pending, resetAsk, subscribe } from "../src/lib/askUser";

beforeEach(() => resetAsk());

describe("asking and answering", () => {
  it("exposes the question while it waits", () => {
    void ask({ question: "Which one?", options: ["A", "B"], chatId: "c1" }).catch(() => {});
    expect(pending()).toMatchObject({ question: "Which one?", options: ["A", "B"], chatId: "c1" });
  });

  it("resolves the tool call with the chosen label", async () => {
    const p = ask({ question: "Which?", options: ["Left", "Right"], chatId: "c1" });
    answer(pending()!.id, "Right");
    await expect(p).resolves.toBe("Right");
  });

  it("clears the question once answered", async () => {
    const p = ask({ question: "Q", options: ["A"], chatId: "c1" });
    answer(pending()!.id, "A");
    await p;
    expect(pending()).toBeNull();
  });

  it("accepts free text that was not one of the options", async () => {
    // The whole point of the custom box: the model's options are its guesses
    // at the answer space, and it is often wrong about them.
    const p = ask({ question: "Which?", options: ["A", "B"], chatId: "c1" });
    answer(pending()!.id, "actually something else");
    await expect(p).resolves.toBe("actually something else");
  });

  it("does not leak the resolver to the UI", () => {
    void ask({ question: "Q", chatId: "c1" }).catch(() => {});
    expect(pending()).not.toHaveProperty("resolve");
    expect(pending()).not.toHaveProperty("reject");
  });
});

describe("the shape of what gets asked", () => {
  it("always offers free text when there are no options to click", () => {
    // Otherwise the question would be unanswerable and the turn would hang.
    void ask({ question: "Anything?", chatId: "c1", custom: false }).catch(() => {});
    expect(pending()!.custom).toBe(true);
  });

  it("keeps the free-text box alongside options by default", () => {
    void ask({ question: "Q", options: ["A", "B"], chatId: "c1" }).catch(() => {});
    expect(pending()!.custom).toBe(true);
  });

  it("drops blank options rather than rendering empty buttons", () => {
    void ask({ question: "Q", options: ["A", "  ", ""], chatId: "c1" }).catch(() => {});
    expect(pending()!.options).toEqual(["A"]);
  });
});

describe("questions that will never be answered", () => {
  it("rejects when cancelled, so the tool call fails instead of hanging", async () => {
    // A promise that neither resolves nor rejects would wedge the turn for the
    // rest of the session.
    const p = ask({ question: "Q", chatId: "c1" });
    cancel();
    await expect(p).rejects.toThrow(/dismissed/i);
  });

  it("rejects the previous question when a new one replaces it", async () => {
    const first = ask({ question: "First", chatId: "c1" });
    const second = ask({ question: "Second", chatId: "c1" });
    await expect(first).rejects.toThrow(/newer question/i);
    expect(pending()!.question).toBe("Second");
    answer(pending()!.id, "ok");
    await expect(second).resolves.toBe("ok");
  });

  it("ignores an answer aimed at a question that has already gone", async () => {
    // A stale click from a re-rendered UI must not resolve the wrong question.
    const p = ask({ question: "Q", chatId: "c1" });
    const staleId = pending()!.id;
    answer(staleId, "real");
    await p;
    expect(() => answer(staleId, "late")).not.toThrow();
    expect(pending()).toBeNull();
  });

  it("cancelling with nothing pending is a no-op", () => {
    expect(() => cancel()).not.toThrow();
  });
});

describe("notifying the UI", () => {
  it("fires on ask, on answer and on cancel", async () => {
    const seen = vi.fn();
    subscribe(seen);
    const p = ask({ question: "Q", chatId: "c1" });
    expect(seen).toHaveBeenCalledTimes(1);
    answer(pending()!.id, "x");
    await p;
    expect(seen).toHaveBeenCalledTimes(2);
    const p2 = ask({ question: "Q2", chatId: "c1" });
    cancel();
    await expect(p2).rejects.toThrow();
    expect(seen).toHaveBeenCalledTimes(4);
  });

  it("stops notifying after unsubscribe", () => {
    const seen = vi.fn();
    const off = subscribe(seen);
    off();
    void ask({ question: "Q", chatId: "c1" }).catch(() => {});
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("the getSnapshot contract useSyncExternalStore relies on", () => {
  /**
   * These are not style points. `pending` is passed straight to
   * useSyncExternalStore, which re-reads it on every render and compares with
   * Object.is. A getter that derives a fresh object each call never compares
   * equal, so every render schedules another; React gives up with "The result
   * of getSnapshot should be cached to avoid an infinite loop" and unmounts the
   * tree — the window goes white.
   *
   * It only reproduces while a question is outstanding, which is why the app
   * looked fine until the first time a model called ask_user. The existing
   * tests above all use toMatchObject, which compares structurally and is blind
   * to the reference changing.
   */
  it("returns the identical object across repeated reads", () => {
    void ask({ question: "Which one?", options: ["A", "B"], chatId: "c1" }).catch(() => {});
    const first = pending();
    expect(pending()).toBe(first);
    expect(pending()).toBe(first);
  });

  it("returns a stable null when nothing is pending", () => {
    expect(pending()).toBe(pending());
  });

  it("hands out a new reference only when the question actually changes", () => {
    void ask({ question: "First?", chatId: "c1" }).catch(() => {});
    const first = pending();
    void ask({ question: "Second?", chatId: "c1" }).catch(() => {});
    const second = pending();
    expect(second).not.toBe(first);
    expect(second?.question).toBe("Second?");
    // ...and is stable again once settled.
    expect(pending()).toBe(second);
  });

  it("settles back to the stable null after an answer", async () => {
    const p = ask({ question: "Q", options: ["A"], chatId: "c1" });
    answer(pending()!.id, "A");
    await expect(p).resolves.toBe("A");
    expect(pending()).toBe(null);
    expect(pending()).toBe(pending());
  });

  it("notifies subscribers exactly once per change", () => {
    // A snapshot that changed without a notify (or vice versa) would show a
    // stale question until some other render happened to flush it.
    const seen: (string | null)[] = [];
    subscribe(() => seen.push(pending()?.question ?? null));
    void ask({ question: "Q1", chatId: "c1" }).catch(() => {});
    cancel();
    expect(seen).toEqual(["Q1", null]);
  });
});
