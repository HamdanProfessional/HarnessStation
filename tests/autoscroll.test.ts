import { describe, expect, it } from "vitest";
import { BOTTOM_SLACK, atBottom, planScroll } from "../src/lib/autoscroll";

/**
 * The transcript follows the newest message, and every rule about *when* it
 * does is a decision that is invisible until it is wrong: scrolling someone
 * away from what they were reading, or quietly failing to follow at all.
 */

const view = (scrollTop: number, scrollHeight = 2000, clientHeight = 800) => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});

describe("being at the bottom", () => {
  it("counts an exact bottom", () => {
    expect(atBottom(view(1200))).toBe(true);
  });

  it("tolerates a few pixels of slack", () => {
    // Fractional device pixels and a part-rendered last line both leave a small
    // gap; at a threshold of zero the view would stop following for good.
    expect(atBottom(view(1200 - BOTTOM_SLACK + 1))).toBe(true);
  });

  it("does not count a reader who has scrolled up", () => {
    expect(atBottom(view(200))).toBe(false);
  });

  it("treats a transcript shorter than the viewport as at the bottom", () => {
    expect(atBottom(view(0, 300, 800))).toBe(true);
  });
});

describe("planning a scroll", () => {
  it("glides when a new message lands and the reader is at the end", () => {
    const p = planScroll({ viewport: view(1200), streaming: false, firstPaint: false });
    expect(p).toEqual({ scroll: true, behavior: "smooth" });
  });

  it("jumps rather than glides while streaming", () => {
    // A smooth scroll issued per token is superseded before it lands, so the
    // view stutters and never reaches the end.
    const p = planScroll({ viewport: view(1200), streaming: true, firstPaint: false });
    expect(p.behavior).toBe("auto");
  });

  it("leaves a reader who has scrolled up alone", () => {
    const p = planScroll({ viewport: view(100), streaming: true, firstPaint: false });
    expect(p.scroll).toBe(false);
  });

  it("still jumps to the end when a chat is first painted", () => {
    // Opening a chat should start at the newest message even though the
    // viewport reports the top, and there is no previous position to glide
    // from, so it must not animate.
    const p = planScroll({ viewport: view(0), streaming: false, firstPaint: true });
    expect(p).toEqual({ scroll: true, behavior: "auto" });
  });

  it("does not animate for someone who asked for reduced motion", () => {
    // The CSS block cannot help here — this scroll is issued from JS.
    const p = planScroll({
      viewport: view(1200),
      streaming: false,
      firstPaint: false,
      reducedMotion: true,
    });
    expect(p).toEqual({ scroll: true, behavior: "auto" });
  });
});
