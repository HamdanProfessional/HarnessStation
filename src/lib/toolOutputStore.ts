/**
 * Keeps oversized tool output reachable instead of destroying it.
 *
 * Every tool that could return a lot used to slice its result and drop the
 * remainder, so a 200 kB build log or a long API response was gone — the model
 * could not see past the cut however it was prompted, and neither could the
 * user. Item 3 gave the three read-ish tools an `offset`, but that only helps
 * tools that know how to page. `run_terminal` dumping a test run, an MCP tool
 * returning a big JSON blob, or any tool the user wrote themselves still lose
 * everything past the limit.
 *
 * So the cap moved to one place — `executeTool` — and the overflow is kept.
 * The model gets the head of the output plus a handle, and `read_tool_output`
 * fetches the rest.
 *
 * In memory rather than on disk, unlike opencode's truncation directory. Our
 * tool filesystem is home-relative, the browser build has no filesystem at all,
 * and writing to the user's home would need a retention policy and a cleanup
 * pass. A conversation does not outlive the process by enough to be worth
 * either, and nothing here is worth persisting.
 */

/** Output longer than this is stashed rather than returned whole. */
export const MAX_INLINE = 12_000;
/** How much of the head the model sees inline. */
export const PREVIEW = 8_000;
/** Most stashes kept; the oldest is dropped first. */
export const MAX_ENTRIES = 24;
/** Total characters held across all stashes. */
export const MAX_TOTAL = 4_000_000;

interface Entry {
  id: string;
  text: string;
  tool: string;
  at: number;
}

// Insertion-ordered, which makes Map.keys().next() the oldest — the eviction
// order we want without tracking anything extra.
const entries = new Map<string, Entry>();
let seq = 0;
let total = 0;

function evictWhile(overCapacity: () => boolean): void {
  while (overCapacity()) {
    const oldest = entries.keys().next();
    if (oldest.done) return;
    const e = entries.get(oldest.value);
    if (e) total -= e.text.length;
    entries.delete(oldest.value);
  }
}

/** Store `text` and return its handle. */
export function stash(text: string, tool: string): string {
  const id = `out_${++seq}`;
  entries.set(id, { id, text, tool, at: Date.now() });
  total += text.length;
  evictWhile(() => entries.size > MAX_ENTRIES || total > MAX_TOTAL);
  return id;
}

export interface StashPage {
  text: string;
  /** Offset to pass next, or null when the end has been reached. */
  next: number | null;
  length: number;
}

/** Read a window of a stash, or null when the handle is unknown or evicted. */
export function readStash(id: string, offset = 0, limit = PREVIEW): StashPage | null {
  const e = entries.get(id);
  if (!e) return null;
  const start = Math.max(0, Math.floor(offset));
  const text = e.text.slice(start, start + Math.max(1, Math.floor(limit)));
  const end = start + text.length;
  return { text, next: end < e.text.length ? end : null, length: e.text.length };
}

/**
 * Cap a tool result, stashing the remainder.
 *
 * Returns the text unchanged when it fits, so the common case is untouched and
 * nothing is stored for the overwhelming majority of calls.
 */
export function capOutput(text: string, tool: string): string {
  if (text.length <= MAX_INLINE) return text;
  const id = stash(text, tool);
  return (
    text.slice(0, PREVIEW) +
    `\n\n...[${text.length - PREVIEW} more characters. This is the first ${PREVIEW} of ${text.length}. ` +
    `Read the rest with read_tool_output({ id: "${id}", offset: ${PREVIEW} })]`
  );
}

/** Test seam. */
export function resetStashes(): void {
  entries.clear();
  total = 0;
  seq = 0;
}

/** Introspection for tests: how many stashes are held. */
export function stashCount(): number {
  return entries.size;
}
