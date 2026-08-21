import { useState, useSyncExternalStore } from "react";
import { answer, cancel, pending, subscribe } from "../lib/askUser";

/**
 * The question a model asked mid-turn, rendered between the thread and the
 * composer.
 *
 * Sits there rather than in the message list on purpose: the turn is paused
 * waiting on it, so it belongs next to the thing the user is about to type
 * into, and it must not scroll out of view while it is blocking.
 */
export function AskUserPrompt({ chatId }: { chatId: string }) {
  const q = useSyncExternalStore(subscribe, pending, () => null);
  const [text, setText] = useState("");

  // A question from another conversation must never render here — the user
  // would be answering something they cannot see the context for.
  if (!q || (q.chatId && q.chatId !== chatId)) return null;

  const send = (value: string) => {
    const v = value.trim();
    if (!v) return;
    setText("");
    answer(q.id, v);
  };

  return (
    <div className="ask-user" role="group" aria-label="The assistant is asking a question">
      <p className="ask-user-q">{q.question}</p>
      {q.options.length > 0 && (
        <div className="ask-user-options">
          {q.options.map((o) => (
            <button key={o} className="btn small" onClick={() => send(o)}>
              {o}
            </button>
          ))}
        </div>
      )}
      <div className="ask-user-row">
        {q.custom && (
          <input
            className="grow"
            autoFocus={q.options.length === 0}
            value={text}
            placeholder={q.options.length ? "Or type your own answer..." : "Type your answer..."}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send(text);
              // Escape dismisses rather than answering, so a stuck question is
              // never a dead end — the tool call fails and the turn moves on.
              if (e.key === "Escape") cancel();
            }}
          />
        )}
        {q.custom && (
          <button className="btn primary small" disabled={!text.trim()} onClick={() => send(text)}>
            Send
          </button>
        )}
        <button className="link-btn" onClick={() => cancel()}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
