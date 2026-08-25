/**
 * A bound on how much transcript is in the DOM at once.
 *
 * The store already keeps unopened chats as stubs and compaction folds old
 * turns into a summary, but one opened 5,000-message chat still meant 5,000+
 * rendered subtrees in the webview — memory and layout cost that grows the
 * whole time the window stays open. The fix is the same one chat apps from IRC
 * to Slack ship: render the newest slice, keep the rest one click away.
 *
 * This is deliberately not virtualisation (measuring variable-height rows,
 * tracking scroll offset through streaming growth). It is a window with a
 * "show earlier" ramp: the DOM holds at most WINDOW messages until the reader
 * asks for more, and asking for more is cheap because the store already has
 * every message hydrated.
 *
 * The autoscroll contract in lib/autoscroll.ts is untouched by design: growing
 * the window only ever happens when the reader is at the *top*, where
 * planScroll already refuses to yank them to the bottom.
 */

/** Messages rendered by default — the newest ones. */
export const TRANSCRIPT_WINDOW = 200;
/** How many more come back with each "show earlier" step. */
export const TRANSCRIPT_CHUNK = 200;

/**
 * First message index to render for a transcript of `total` messages.
 * `null` from the caller means "auto": hug the tail.
 */
export function initialFrom(total: number): number {
  return Math.max(0, total - TRANSCRIPT_WINDOW);
}

/** Move the window start up by one chunk, clamped at the transcript's head. */
export function expandFrom(from: number, chunk = TRANSCRIPT_CHUNK): number {
  return Math.max(0, from - chunk);
}

/**
 * New scrollTop after content was inserted above the viewport.
 *
 * Prepending messages grows scrollHeight by `nextHeight - prev.height`; adding
 * the same delta to scrollTop keeps the reader anchored on the message they
 * were reading instead of being thrown to a different one. Callers measure
 * before the change and apply after paint (useLayoutEffect).
 */
export function anchorScroll(
  prev: { height: number; top: number },
  nextHeight: number,
): number {
  return prev.top + Math.max(0, nextHeight - prev.height);
}
