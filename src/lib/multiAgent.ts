/**
 * Multi-agent chats: building each participant's view of the conversation.
 *
 * Two modes:
 *   • battle   — the same prompts go to every participant independently. Each
 *                sees only the user's turns and its *own* prior answers, never a
 *                rival's, so the columns stay honest side-by-side comparisons.
 *   • collab   — one shared transcript. A participant sees the user's turns and
 *                every participant's *written output*, tagged with who wrote it,
 *                so they can build on each other. It never sees anyone's private
 *                reasoning (thinking) — that's stripped here, matching the fact
 *                that reasoning is never sent to a model anyway.
 *
 * Pure functions only, so the sharing rules can be unit-tested without a store.
 */
import type { Message, Participant } from "./types";

export type MultiMode = "battle" | "collab";

export interface BuiltContext {
  /** The message list to send to this participant's model. */
  messages: Message[];
  /** Text appended to the base system prompt (role brief + collaboration note). */
  systemAddition: string;
}

/**
 * A send-ready copy of a message: only the fields a provider request uses, and
 * never `reasoning` (display-only) or the multi-agent bookkeeping (`author`/`id`).
 * In collaborate mode a peer's assistant output is prefixed with its author tag.
 */
function forSend(m: Message, tagAuthor?: string): Message {
  const content =
    tagAuthor && m.role === "assistant" && m.content ? `[${tagAuthor}] ${m.content}` : m.content;
  const out: Message = { role: m.role, content };
  if (m.toolCalls) out.toolCalls = m.toolCalls;
  if (m.toolCallId) out.toolCallId = m.toolCallId;
  if (m.attachments) out.attachments = m.attachments;
  return out;
}

/**
 * Build the messages + system addition for one participant on this turn.
 * `others` is every participant except this one (used for the collaborate note).
 */
export function buildParticipantContext(
  messages: Message[],
  p: Participant,
  mode: MultiMode,
  others: Participant[],
): BuiltContext {
  if (mode === "battle") {
    // Only the user's turns and this participant's own replies (author-tagged, or
    // legacy untagged assistant turns from before the chat became multi-agent).
    const msgs = messages
      .filter(
        (m) =>
          m.role === "user" ||
          (m.role === "assistant" && (m.author === p.label || m.author == null)),
      )
      .map((m) => forSend(m));
    return { messages: msgs, systemAddition: p.instructions?.trim() || "" };
  }

  // collab: the whole shared transcript. Peers' assistant output is tagged with
  // its author; this participant's own output stays untagged (reads naturally);
  // reasoning is dropped for everyone.
  const msgs = messages.map((m) =>
    forSend(m, m.role === "assistant" && m.author && m.author !== p.label ? m.author : undefined),
  );

  const peers = others.map((o) => o.label).filter(Boolean);
  const collabLine = peers.length
    ? `You are "${p.label}", collaborating with ${peers
        .map((x) => `"${x}"`)
        .join(", ")} on the same task. Each participant works its own part in parallel. ` +
      `Messages from other participants are tagged with their name in [brackets]; your own are untagged. ` +
      `Build on their written output, don't redo their part, and note that you cannot see their private reasoning — only what they wrote.`
    : "";
  const roleLine = p.instructions?.trim() ? `Your role: ${p.instructions.trim()}` : "";
  return { messages: msgs, systemAddition: [collabLine, roleLine].filter(Boolean).join("\n\n") };
}
