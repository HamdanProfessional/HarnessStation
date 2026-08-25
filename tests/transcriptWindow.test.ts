import { describe, expect, it } from "vitest";
import { TRANSCRIPT_WINDOW, initialFrom, expandFrom, anchorScroll } from "../src/lib/transcriptWindow";

/**
 * The transcript window is the DOM-bound twin of lazy hydration: the store may
 * hold every message, but the page renders only the newest slice until the
 * reader asks for more. These pin the arithmetic — a window that ever rendered
 * a negative index or lost a reader's scroll anchor would be worse than none.
 */
describe("initialFrom", () => {
  it("hugs the tail: last WINDOW messages", () => {
    expect(initialFrom(10_000)).toBe(10_000 - TRANSCRIPT_WINDOW);
    expect(initialFrom(TRANSCRIPT_WINDOW)).toBe(0);
  });

  it("short transcripts render whole, never a negative start", () => {
    expect(initialFrom(5)).toBe(0);
    expect(initialFrom(0)).toBe(0);
  });
});

describe("expandFrom", () => {
  it("steps back one chunk at a time", () => {
    expect(expandFrom(8_000)).toBe(8_000 - 200);
  });

  it("clamps at the head instead of overshooting it", () => {
    expect(expandFrom(120)).toBe(0);
    expect(expandFrom(0)).toBe(0);
  });
});

describe("anchorScroll", () => {
  it("keeps the reader on the same message when content is prepended", () => {
    // 3,000px of new history appeared above; the reader was 5,000px down.
    expect(anchorScroll({ height: 20_000, top: 5_000 }, 23_000)).toBe(8_000);
  });

  it("never scrolls upwards, even if the measurement was stale", () => {
    expect(anchorScroll({ height: 20_000, top: 5_000 }, 19_000)).toBe(5_000);
    expect(anchorScroll({ height: 20_000, top: 5_000 }, 20_000)).toBe(5_000);
  });
});
