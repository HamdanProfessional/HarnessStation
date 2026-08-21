/**
 * Lets a model stop mid-turn and ask the user a question.
 *
 * Without this, a model facing a genuine fork has two bad options: guess and
 * possibly do the wrong work, or stop and write a paragraph asking — which ends
 * the turn, so the user answers and the model starts again from cold. Neither
 * keeps the thread of what it was doing.
 *
 * The tool call blocks instead. `ask` returns a promise that resolves when the
 * user picks an option, and the picked label becomes the tool result, so from
 * the model's point of view asking the user is just a slow tool.
 *
 * A tiny observable rather than part of the Zustand store: `tools.ts` is
 * imported *by* the store, so reaching back into it from a tool handler would
 * be a cycle. Nothing here needs persisting — an unanswered question is
 * meaningless once the turn it belonged to is gone.
 */

export interface PendingQuestion {
  id: string;
  /** The question itself. */
  question: string;
  /** Choices to offer. Always at least one by the time it reaches the UI. */
  options: string[];
  /** Whether to offer a free-text box alongside the options. */
  custom: boolean;
  /** Which chat asked, so a question never renders in a different conversation. */
  chatId: string;
}

type Resolver = (answer: string) => void;
type Rejecter = (reason: Error) => void;

interface Live extends PendingQuestion {
  resolve: Resolver;
  reject: Rejecter;
}

let current: Live | null = null;
/**
 * The public view of `current`, rebuilt only when `current` changes.
 *
 * `pending` is a `useSyncExternalStore` getSnapshot, and React compares
 * snapshots with `Object.is` on every render. Deriving the object inside the
 * getter returned a new reference each call, so the snapshot never compared
 * equal, every render scheduled another, and React bailed out of the tree with
 * "The result of getSnapshot should be cached" — a blank window. It only bit
 * once a question was outstanding, because a null snapshot is stable by
 * accident.
 */
let snapshot: PendingQuestion | null = null;
let seq = 0;
const listeners = new Set<() => void>();

/** Point `current` at a new question (or none) and publish it as one step. */
function setCurrent(next: Live | null): void {
  current = next;
  if (next) {
    const { resolve: _r, reject: _j, ...rest } = next;
    snapshot = rest;
  } else {
    snapshot = null;
  }
  notify();
}

function notify(): void {
  for (const l of listeners) l();
}

/** Subscribe to changes. Returns an unsubscribe function (useSyncExternalStore). */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The question awaiting an answer, or null. */
export function pending(): PendingQuestion | null {
  return snapshot;
}

export interface AskSpec {
  question: string;
  options?: string[];
  custom?: boolean;
  chatId: string;
}

/**
 * Pose a question and wait for the answer.
 *
 * Rejects rather than resolving if something else replaces or cancels it, so
 * the tool call surfaces an error instead of hanging for the rest of the
 * session.
 */
export function ask(spec: AskSpec): Promise<string> {
  // Only one at a time. A second question means the first will never be
  // answered — the turn that asked it is already past — so end it cleanly.
  if (current) current.reject(new Error("Replaced by a newer question."));

  const options = (spec.options ?? []).map((o) => String(o).trim()).filter(Boolean);
  return new Promise<string>((resolve, reject) => {
    setCurrent({
      id: `q_${++seq}`,
      question: spec.question.trim(),
      // With no options there is nothing to click, so the free-text box is the
      // only way to answer and cannot be switched off.
      options,
      custom: options.length === 0 ? true : spec.custom !== false,
      chatId: spec.chatId,
      resolve,
      reject,
    });
  });
}

/** Answer the pending question. Ignores a stale id from a re-rendered UI. */
export function answer(id: string, text: string): void {
  if (!current || current.id !== id) return;
  const done = current;
  setCurrent(null);
  done.resolve(text);
}

/** Cancel the pending question — the user stopped the turn, or the chat closed. */
export function cancel(reason = "The user dismissed the question."): void {
  if (!current) return;
  const done = current;
  setCurrent(null);
  done.reject(new Error(reason));
}

/** Test seam: drop any pending question without resolving or rejecting it. */
export function resetAsk(): void {
  current = null;
  snapshot = null;
  seq = 0;
  listeners.clear();
}
