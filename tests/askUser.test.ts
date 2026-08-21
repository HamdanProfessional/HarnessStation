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
