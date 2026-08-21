/**
 * The rules for keeping a transcript pinned to the bottom.
 *
 * Pulled out of the effect in ChatWindow because the decisions are the whole
 * feature and none of them are obvious:
 *
 *   - Following the newest message is only wanted while the reader is *already*
 *     at the bottom. Scrolling up to re-read something and being yanked back
 *     down on the next token is the single most irritating thing a chat UI can
 *     do, and the old effect did it on every message change.
 *
 *   - A message arriving is a discrete jump, so it can animate. A reply
 *     streaming is continuous growth, and asking for a smooth scroll on every
 *     token starts an animation that the next token invalidates — the view
 *     stutters and never reaches the end. Those two need opposite behaviour.
 */

/**
 * How far from the bottom still counts as "at the bottom".
 *
 * Not zero: a partly-scrolled line, a fractional device pixel, or the last
 * token nudging the height mid-measure all leave a few pixels of slack, and at
 * a threshold of zero the view would silently stop following.
 */
export const BOTTOM_SLACK = 120;

/**
 * The OS-level "reduce motion" preference.
 *
 * The CSS honours this already, but a smooth scroll is issued from JS and never
 * passes through a stylesheet, so it would keep animating for someone who asked
 * the whole system not to.
 */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface Viewport {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Is the reader at the end of the transcript, give or take? */
export function atBottom(v: Viewport, slack = BOTTOM_SLACK): boolean {
  return v.scrollHeight - v.scrollTop - v.clientHeight <= slack;
}

export interface ScrollPlan {
  scroll: boolean;
  behavior: ScrollBehavior;
}

/**
 * Decide whether to follow, and how.
 *
 * `firstPaint` covers opening a chat: there is nothing to animate towards
 * because the reader has not seen the old position, and a smooth scroll through
 * a long history is a several-hundred-millisecond blur. Jump instead.
 */
export function planScroll(opts: {
  viewport: Viewport;
  streaming: boolean;
  firstPaint: boolean;
  reducedMotion?: boolean;
}): ScrollPlan {
  const { viewport, streaming, firstPaint, reducedMotion = false } = opts;

  if (firstPaint) return { scroll: true, behavior: "auto" };
  if (!atBottom(viewport)) return { scroll: false, behavior: "auto" };

  // Streaming grows the container continuously; a queued smooth scroll would be
  // superseded before it landed.
  const behavior: ScrollBehavior = streaming || reducedMotion ? "auto" : "smooth";
  return { scroll: true, behavior };
}
