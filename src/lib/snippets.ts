import type { Template } from "./types";

/**
 * The "/" prompt library.
 *
 * Typing "/" at the start of the composer (or after a space) opens a picker of
 * saved templates; picking one inserts its text at the slash. The matching and
 * insertion rules live here as pure functions so the composer stays thin and
 * the edge cases are testable without a DOM.
 *
 * The trigger deliberately requires whitespace (or nothing) before the slash:
 * that is what keeps URLs like `https://x.com/a` from opening the picker —
 * their slashes follow non-whitespace.
 */

export interface SnippetTrigger {
  /** Filter text typed after the slash — "ad" for "/ad". */
  query: string;
  /** Index of the "/" character in the draft. */
  start: number;
  /** End of the trigger token; normally the caret position. */
  end: number;
}

const TRIGGER_RE = /(?:^|\s)\/([^\s/]*)$/;

/**
 * Find an active snippet trigger in `textBeforeCaret`, or null.
 * Callers pass `draft.slice(0, caret)` — moving the caret left of the slash
 * therefore closes the picker, which reads as correct behaviour.
 */
export function findSnippetTrigger(textBeforeCaret: string): SnippetTrigger | null {
  const m = TRIGGER_RE.exec(textBeforeCaret);
  if (!m) return null;
  const query = m[1];
  return {
    query,
    start: textBeforeCaret.length - 1 - query.length,
    end: textBeforeCaret.length,
  };
}

/** Replace the trigger token with the chosen content, leaving the rest of the draft alone. */
export function applySnippet(text: string, trig: SnippetTrigger, content: string): string {
  return text.slice(0, trig.start) + content + text.slice(trig.end);
}

/**
 * Order templates for the picker: snippets first (that is what "/" is for),
 * instructions after, alphabetical within each group. With a query, names that
 * start with it come before substring matches.
 */
export function filterSnippets(templates: Template[], query: string): Template[] {
  const kind = (t: Template) => (t.kind === "snippet" ? 0 : 1);
  const byName = (a: Template, b: Template) => a.name.localeCompare(b.name);
  if (!query.trim()) return [...templates].sort((a, b) => kind(a) - kind(b) || byName(a, b));
  const q = query.trim().toLowerCase();
  return templates
    .filter((t) => t.name.toLowerCase().includes(q))
    .sort(
      (a, b) =>
        (b.name.toLowerCase().startsWith(q) ? 1 : 0) -
          (a.name.toLowerCase().startsWith(q) ? 1 : 0) ||
        kind(a) - kind(b) ||
        byName(a, b),
    );
}
