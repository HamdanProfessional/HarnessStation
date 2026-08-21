/**
 * Commit an edited copy of settings without discarding what changed underneath.
 *
 * The Settings view clones `settings` once at mount and saves that whole object
 * on Save. Several panels rendered *inside* it — Channels, Hooks, Devices,
 * Cloud sync — write to the store directly as you type, each doing a whole-object
 * replace. So the sequence "paste a Discord bot token, go back to General, tick
 * a checkbox, press Save" wrote a snapshot from before the token existed, and
 * the token was gone. Silently, to disk.
 *
 * The fix is not to enumerate which keys the view owns; that list would be wrong
 * the first time someone adds a setting. Instead: apply only the keys the user
 * actually changed. Anything they did not touch keeps whatever value it has now,
 * whether that came from a sibling panel, a sync, or another window.
 */

import type { Settings } from "./types";

/**
 * Structural equality, good enough for settings values.
 *
 * They are plain JSON — strings, numbers, booleans, arrays and objects of those
 * — so serialising is a fair comparison and far shorter than a hand-written
 * deep compare. Key order is stable because `draft` starts as a structuredClone
 * of the same object the baseline came from.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Merge a draft onto the live settings, keeping only what the user edited.
 *
 * @param baseline what `draft` was cloned from, at mount
 * @param draft    the edited copy
 * @param live     settings as they are right now, including sibling writes
 */
export function mergeEdits(baseline: Settings, draft: Settings, live: Settings): Settings {
  const out: Settings = { ...live };

  // Keys the user changed, including ones they added.
  for (const key of Object.keys(draft) as (keyof Settings)[]) {
    if (!same(draft[key], baseline[key])) {
      out[key] = draft[key] as never;
    }
  }

  // Keys the user removed. Without this, deleting a provider or a webhook in
  // the view would appear to work and then come back on the next render.
  for (const key of Object.keys(baseline) as (keyof Settings)[]) {
    if (key in draft) continue;
    delete out[key];
  }

  return out;
}

/**
 * Whether the draft holds unsaved edits.
 *
 * Compared against the baseline rather than against live settings, because a
 * sibling panel saving its own key is not an unsaved edit of *this* form — and
 * showing "unsaved changes" then actively invited the user to press the button
 * that used to destroy them.
 */
export function hasEdits(baseline: Settings, draft: Settings): boolean {
  return !same(baseline, draft);
}
