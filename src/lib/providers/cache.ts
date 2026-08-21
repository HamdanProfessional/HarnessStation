/**
 * Where to put Anthropic prompt-cache breakpoints.
 *
 * A breakpoint tells the API "everything up to here is stable — store it". The
 * next request that shares that prefix reads it back at roughly a tenth of the
 * price. A write costs 1.25x base, so a single reuse inside the five-minute
 * window already pays; in a chat, where every turn resends the entire history,
 * reuse is not a maybe.
 *
 * We already mark the system prompt. That caches a fixed block of a few hundred
 * tokens and stops there — the conversation itself, which is the part that grows
 * without limit, is re-read at full price on every single turn.
 *
 * So the second breakpoint goes on the **latest user message**. On the next turn
 * that whole prefix — system, and every exchange before the current one — is a
 * cache read. The cached region grows with the conversation, which is exactly
 * the shape of the cost problem.
 *
 * Not done here: a breakpoint on the last tool definition, which is what a tool
 * loop would benefit from most. Our Anthropic path does not send `tools` at all,
 * so there is nothing to attach it to. If tool support is added there, that
 * breakpoint should be added with it.
 */

/** An Anthropic message as we build it: content is text, or a list of parts. */
export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Record<string, unknown>[];
}

const HINT = { type: "ephemeral" } as const;

/**
 * Return a copy of `messages` with a cache breakpoint on the last user turn.
 *
 * Returns the input untouched when there is no user message, so a caller never
 * has to check first.
 */
export function withCacheBreakpoint(messages: AnthropicMessage[]): AnthropicMessage[] {
  const at = messages.findLastIndex((m) => m.role === "user");
  if (at === -1) return messages;

  return messages.map((m, i) => {
    if (i !== at) return m;

    // String content has nowhere to hang the marker, so promote it to the
    // single-text-part form the API accepts interchangeably.
    const parts: Record<string, unknown>[] =
      typeof m.content === "string" ? [{ type: "text", text: m.content }] : [...m.content];

    if (parts.length === 0) return m;

    // The marker goes on the *last* part, because it means "cache everything up
    // to and including this". On an earlier part the rest of the message would
    // fall outside the cached prefix.
    const last = parts.length - 1;
    parts[last] = { ...parts[last], cache_control: HINT };
    return { ...m, content: parts };
  });
}
