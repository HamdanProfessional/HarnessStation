import { memoryBudget, trimToBudget } from "./contextBudget";
import { GLOBAL_MEMORY, recall } from "./memory";
import type { Chat } from "./types";

/**
 * Three tiers of memory, narrowest first.
 *
 *   chat     only this conversation — working detail that would be noise elsewhere
 *   project  shared by every chat and call inside one project
 *   global   everything you are, everywhere: your name, how you like answers
 *
 * A chat inside a project reads all three; a chat outside one reads chat + global.
 * They are separate stores rather than one tagged store so a project can be
 * deleted, exported or shared without dragging your personal facts along.
 *
 * The write side is what makes this behave. "I'm Sam" belongs in global even when
 * said inside a project; "this project targets embedded ARM" belongs in the
 * project and would be actively wrong applied to your other work. See
 * `EXTRACT_ROUTING`, which is the instruction that decides.
 */

export type MemoryTier = "chat" | "project" | "global";

export const CHAT_SCOPE_PREFIX = "chat:";
export const PROJECT_SCOPE_PREFIX = "project:";

export function chatScope(chatId: string): string {
  return `${CHAT_SCOPE_PREFIX}${chatId}`;
}

export function projectScope(projectId: string): string {
  return `${PROJECT_SCOPE_PREFIX}${projectId}`;
}

/** The scopes a chat reads from, narrowest first. */
export function scopesFor(chat: Pick<Chat, "id" | "projectId">): { tier: MemoryTier; scope: string }[] {
  const scopes: { tier: MemoryTier; scope: string }[] = [{ tier: "chat", scope: chatScope(chat.id) }];
  if (chat.projectId) scopes.push({ tier: "project", scope: projectScope(chat.projectId) });
  scopes.push({ tier: "global", scope: GLOBAL_MEMORY });
  return scopes;
}

const TIER_LABEL: Record<MemoryTier, string> = {
  chat: "In this conversation",
  project: "About this project",
  global: "About the user",
};

/**
 * How many of the budget's tokens each tier may take, when all three have
 * something to say. Project detail is usually the most task-relevant, and global
 * facts are few but should never be squeezed out entirely.
 */
const TIER_SHARE: Record<MemoryTier, number> = { chat: 0.3, project: 0.45, global: 0.25 };

export interface RecalledMemory {
  /** Ready to drop into the system prompt. Empty when there's nothing to say. */
  block: string;
  /** Estimated tokens used. */
  tokens: number;
  /** Facts dropped because they didn't fit the budget. */
  dropped: number;
  byTier: Record<MemoryTier, number>;
}

export interface RecallOptions {
  /** Model the turn will run on — decides the budget. */
  model: string;
  /** Share of the context window memory may use. */
  share?: number;
  /** Facts to consider per tier before trimming. */
  k?: number;
}

/**
 * Pull relevant memory from every tier a chat can see, trimmed to fit the model.
 *
 * The budget is a share of the context window, so the same store behaves on a
 * 200k cloud model and an 8k local one — on the small model you simply get the
 * few most relevant facts instead of a failed request.
 */
export async function recallForChat(
  chat: Pick<Chat, "id" | "projectId">,
  task: string,
  opts: RecallOptions,
): Promise<RecalledMemory> {
  const empty: RecalledMemory = {
    block: "",
    tokens: 0,
    dropped: 0,
    byTier: { chat: 0, project: 0, global: 0 },
  };

  const budget = memoryBudget(opts.model, opts.share);
  if (budget <= 0) return empty;

  const tiers = scopesFor(chat);
  const hits = await Promise.all(
    tiers.map(async ({ tier, scope }) => {
      try {
        return { tier, facts: await recall(scope, task, opts.k ?? 8) };
      } catch {
        return { tier, facts: [] as string[] }; // memory is never fatal to a turn
      }
    }),
  );

  // Give each tier its slice, then let the earlier tiers spend what the later
  // ones didn't need — a chat with no project memory shouldn't waste that room.
  let spare = 0;
  const sections: { tier: MemoryTier; kept: string[] }[] = [];
  let tokens = 0;
  let dropped = 0;
  const byTier: Record<MemoryTier, number> = { chat: 0, project: 0, global: 0 };

  for (const { tier, facts } of hits) {
    const allowance = Math.floor(budget * TIER_SHARE[tier]) + spare;
    const r = trimToBudget(facts, allowance);
    spare = allowance - r.tokens;
    tokens += r.tokens;
    dropped += r.dropped;
    byTier[tier] = r.kept.length;
    if (r.kept.length) sections.push({ tier, kept: r.kept });
  }

  if (!sections.length) return empty;

  const body = sections
    .map((s) => `${TIER_LABEL[s.tier]}:\n${s.kept.map((f) => `- ${f}`).join("\n")}`)
    .join("\n\n");

  return {
    block: `What you already know, recalled automatically. Use it where relevant; don't mention it unless asked.\n\n${body}`,
    tokens,
    dropped,
    byTier,
  };
}

/**
 * Appended to the extraction prompt so a fact lands in the right tier.
 *
 * Without this everything drifts into global, and a month later the model
 * "knows" your unrelated project's deployment target when you ask it something
 * personal. The split the user asked for: project facts stay in the project,
 * facts about *them* still reach global from anywhere.
 */
export const EXTRACT_ROUTING = `Sort each fact into exactly one scope:
- "global": durable facts about the user themselves — their name, role, language, how they like answers, tools they always use. True no matter what they're working on.
- "project": facts true of THIS project only — its subject, stack, conventions, deadlines, the people on it. Would be wrong applied to their other work.
- "chat": detail that only matters to this one conversation. Prefer omitting it entirely unless it will still matter next time.
Reply with ONLY a JSON array of {"scope","fact"} objects, at most 8, or [] if nothing is worth keeping.`;

export interface ScopedFact {
  scope: MemoryTier;
  fact: string;
}

/** Parse the extractor's reply. Anything malformed is dropped, never guessed at. */
export function parseScopedFacts(raw: string): ScopedFact[] {
  const match = /\[[\s\S]*\]/.exec(raw);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: ScopedFact[] = [];
  for (const item of parsed) {
    if (typeof item === "string") {
      // Older prompt shape, or a model that ignored the instruction: a bare
      // string is a fact about the user, which is the safe default.
      if (item.trim()) out.push({ scope: "global", fact: item.trim() });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const fact = String(rec.fact ?? "").trim();
    if (!fact) continue;
    const scope = String(rec.scope ?? "global").toLowerCase();
    out.push({
      scope: scope === "project" || scope === "chat" ? (scope as MemoryTier) : "global",
      fact,
    });
  }
  return out.slice(0, 8);
}

/**
 * Where a fact of each tier actually gets written for this chat.
 * A "project" fact from a chat with no project falls back to global — it was
 * still a real fact, and silently discarding it is worse than filing it broadly.
 */
export function targetScope(
  tier: MemoryTier,
  chat: Pick<Chat, "id" | "projectId">,
): string {
  if (tier === "chat") return chatScope(chat.id);
  if (tier === "project") return chat.projectId ? projectScope(chat.projectId) : GLOBAL_MEMORY;
  return GLOBAL_MEMORY;
}

/**
 * Extract durable facts from a finished exchange and file each in its tier.
 *
 * The routing is what makes three tiers worth having: without it everything
 * drifts into global and the model ends up "knowing" one project's stack while
 * you're asking about another.
 */
export async function extractScoped(
  chat: Pick<Chat, "id" | "projectId">,
  transcript: string,
  provider: import("./types").Provider,
  model: string,
): Promise<ScopedFact[]> {
  const { chatOnce } = await import("./providers");
  const { remember } = await import("./memory");
  try {
    const raw = await chatOnce(
      provider,
      model,
      `You extract durable, long-term facts worth remembering from a conversation — preferences, decisions, stable context, corrections. Ignore transient chatter, tool noise and reasoning.\n\n${EXTRACT_ROUTING}`,
      transcript.slice(0, 8000),
      new AbortController().signal,
    );
    const facts = parseScopedFacts(raw);
    for (const f of facts) await remember(targetScope(f.scope, chat), f.fact);
    return facts;
  } catch {
    return []; // extraction is best-effort and must never surface as a chat failure
  }
}
