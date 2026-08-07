import type { Message } from "./types";

/**
 * A rough token estimate. Real tokenisation is model-specific and only known
 * after a request, but ~4 characters per token is a good enough approximation
 * for showing how much context an item costs and how much deleting it frees —
 * the "reduces context tokens" feedback, not billing.
 */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

/**
 * Estimated tokens a set of messages contributes to the model's context.
 *
 * Counts only what's actually sent to the model on later turns — message
 * content, tool call name+arguments, and inlined text attachments. Reasoning
 * (thinking) is deliberately excluded: it's captured for display only and is
 * never resent, so it costs no prompt tokens. Counting it here would make the
 * "freed ~N tokens" feedback promise a saving that deleting it can't deliver.
 */
export function estimateContextTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content?.length ?? 0;
    for (const c of m.toolCalls ?? []) {
      chars += (c.name?.length ?? 0) + (c.arguments?.length ?? 0);
    }
    for (const a of m.attachments ?? []) {
      // Text attachments are inlined into the prompt; media is referenced, not
      // counted here (its token cost is model-specific and usually large).
      if (a.kind === "text") chars += a.data?.length ?? 0;
    }
  }
  return Math.ceil(chars / 4);
}
