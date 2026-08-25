import { loadAgentMemory, saveAgentMemory } from "./storage";
import { tryEmbed } from "./embeddings";
import { chatOnce } from "./providers";
import type { MemoryEntry, Provider } from "./types";

const MAX = 400;
const RECALL_K = 8;
const RECONCILE_SIM = 0.82; // similarity above which a new fact updates an existing one

function cosine(a: number[], b: number[]): number {
  let d = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

function tokens(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** READ PATH — return only the top-K most relevant memories for the current task. */
export async function recall(agentId: string, task: string, k = RECALL_K): Promise<string[]> {
  const mem = await loadAgentMemory(agentId);
  if (mem.length <= k) return mem.map((m) => m.text);

  const haveVectors = mem.every((m) => m.vector && m.vector.length);
  if (haveVectors) {
    const q = await tryEmbed([task]);
    if (q) {
      return mem
        .map((m) => ({ m, s: cosine(m.vector!, q[0]) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, k)
        .map((x) => x.m.text);
    }
  }
  // keyword-overlap + slight recency bias
  const qt = tokens(task);
  const maxTs = Math.max(1, ...mem.map((m) => m.ts));
  return mem
    .map((m) => ({ m, s: jaccard(tokens(m.text), qt) + (m.ts / maxTs) * 0.15 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.m.text);
}

/** WRITE PATH — store a fact, reconciling against a near-duplicate (new overrides old). */
export async function remember(agentId: string, fact: string): Promise<string> {
  const clean = fact.trim();
  if (!clean) return "Nothing to remember.";
  const mem = await loadAgentMemory(agentId);
  const [vec] = (await tryEmbed([clean])) ?? [undefined];

  let bestIdx = -1;
  let bestSim = 0;
  const ft = tokens(clean);
  for (let i = 0; i < mem.length; i++) {
    const sim =
      vec && mem[i].vector ? cosine(vec, mem[i].vector!) : jaccard(ft, tokens(mem[i].text));
    if (sim > bestSim) {
      bestSim = sim;
      bestIdx = i;
    }
  }

  const entry: MemoryEntry = { text: clean, ts: Date.now(), vector: vec };
  let verb: string;
  if (bestIdx >= 0 && bestSim >= RECONCILE_SIM) {
    mem[bestIdx] = entry; // supersede the near-duplicate
    verb = "Updated memory";
  } else {
    mem.push(entry);
    verb = "Remembered";
  }
  await saveAgentMemory(agentId, mem.slice(-MAX));
  return `${verb}: ${clean}`;
}

/** Tool-facing recall search (returns a formatted list). */
export async function recallSearch(agentId: string, query: string): Promise<string> {
  const hits = await recall(agentId, query || "", 10);
  return hits.length ? hits.map((h) => `- ${h}`).join("\n") : "No matching memories.";
}

// ---------- passive memory ----------
//
// Memory that works without the model asking for it: every turn is matched against
// the store and the hits are injected straight into the system prompt, and facts are
// harvested in the background. No tool call, no token burned deciding to remember.

/** Scope shared by every chat — this is "what the app knows about you", not per-thread. */
export const GLOBAL_MEMORY = "__global__";

/** Anchor embedding of the last turn we extracted from, for drift detection. */
const anchors = new Map<string, number[]>();
/** Turns seen since the last extraction, per scope. */
const sinceExtract = new Map<string, number>();

const DRIFT_SIM = 0.6; // below this the conversation has moved on to a new topic
const EXTRACT_EVERY = 6; // ...or just every N turns, whichever comes first

/**
 * Should we harvest facts now? True on topic drift or every N turns — the same
 * trigger pair jcode uses, so long single-topic sessions still get captured and
 * a sharp subject change gets captured immediately.
 */
export async function shouldExtract(scope: string, latestTurn: string): Promise<boolean> {
  const n = (sinceExtract.get(scope) ?? 0) + 1;
  sinceExtract.set(scope, n);
  if (n >= EXTRACT_EVERY) return true;
  const vec = (await tryEmbed([latestTurn]))?.[0];
  if (!vec) return false; // no embeddings — fall back to the turn counter alone
  const prev = anchors.get(scope);
  anchors.set(scope, vec);
  return !!prev && cosine(prev, vec) < DRIFT_SIM;
}

/** Reset the drift/turn counters after a successful extraction. */
export function markExtracted(scope: string): void {
  sinceExtract.set(scope, 0);
}

/** Formatted memory block for a system prompt, or "" when there's nothing relevant. */
export async function recallBlock(scope: string, task: string, k = 6): Promise<string> {
  const hits = await recall(scope, task, k);
  if (!hits.length) return "";
  // Three framing rules, borrowed from what ships at scale (Claude's consumer
  // prompt is the most worked-out version): memory applies silently, it never
  // buys flattery at the price of honest feedback, and sensitive facts stay
  // unsaid until the user raises them. Kept to one sentence each because this
  // rides along on every turn passive memory is on.
  return `Context you already know about this user and their work (recalled automatically — apply silently, never narrate the recall). It never overrides honest assessment, and sensitive recalled facts stay unmentioned until the user raises the topic:\n${hits
    .map((h) => `- ${h}`)
    .join("\n")}`;
}

/** Every stored memory in a scope, newest first (for the Settings viewer). */
export async function listMemories(scope: string): Promise<MemoryEntry[]> {
  return (await loadAgentMemory(scope)).slice().sort((a, b) => b.ts - a.ts);
}

/** Drop one memory by its exact text. */
export async function forget(scope: string, text: string): Promise<void> {
  const mem = await loadAgentMemory(scope);
  await saveAgentMemory(
    scope,
    mem.filter((m) => m.text !== text),
  );
}

export async function forgetAll(scope: string): Promise<void> {
  await saveAgentMemory(scope, []);
}

// ---------- ambient consolidation ----------
//
// Extraction alone makes the store grow: near-duplicates that fall under the
// reconcile threshold, facts that contradict a later correction, things that were
// true last month. Consolidation is the maintenance pass — merge, resolve, retire —
// so recall quality doesn't decay as the store fills up.

const CONSOLIDATE_KEY = "hs-consolidated-at";
const CONSOLIDATE_EVERY_MS = 6 * 60 * 60 * 1000; // at most once every 6 hours
const CONSOLIDATE_MIN = 25; // pointless on a small store
const DUP_SIM = 0.9; // merge candidates found locally before spending a model call

const CONSOLIDATE_PROMPT = `You maintain a long-term memory store. You are given numbered facts.
Return a cleaned-up store as a JSON array of strings:
- MERGE facts that say the same thing, keeping the most specific wording.
- When two facts CONTRADICT, keep only the one that reads as more recent or more specific, and drop the other.
- DROP anything transient, trivially obvious, or that only made sense in one conversation.
- REWRITE nothing else. Keep the surviving facts' meaning exactly as-is.
Return ONLY the JSON array. Fewer, sharper facts is the goal — never invent new ones.`;

/**
 * Cheap local pass: drop exact and near-exact duplicates without a model call.
 *
 * Scanned newest-first so the freshest wording of a repeated fact wins, but the
 * result is returned in chronological order — every caller trims with
 * `slice(-MAX)`, which keeps the *end* of the array, so a newest-first result
 * would silently discard the newest facts instead of the oldest.
 */
function dedupeLocal(mem: MemoryEntry[]): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  for (const m of mem.slice().sort((a, b) => b.ts - a.ts)) {
    const dup = out.some((k) => {
      if (k.text === m.text) return true;
      if (m.vector && k.vector) return cosine(m.vector, k.vector) >= DUP_SIM;
      return jaccard(tokens(k.text), tokens(m.text)) >= DUP_SIM;
    });
    if (!dup) out.push(m);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/**
 * Merge duplicates, resolve contradictions and retire stale facts. Rate-limited and
 * best-effort: on any failure the store is left exactly as it was.
 *
 * Returns how many facts were removed, or null if it didn't run.
 */
export async function consolidate(
  scope: string,
  provider: Provider,
  model: string,
  force = false,
): Promise<number | null> {
  const last = Number(localStorage.getItem(`${CONSOLIDATE_KEY}:${scope}`) ?? 0);
  if (!force && Date.now() - last < CONSOLIDATE_EVERY_MS) return null;

  const mem = await loadAgentMemory(scope);
  if (mem.length < CONSOLIDATE_MIN && !force) return null;

  // Local dedupe first — often enough on its own, and it shrinks the model's input.
  const deduped = dedupeLocal(mem);
  let kept = deduped;

  try {
    const raw = await chatOnce(
      provider,
      model,
      CONSOLIDATE_PROMPT,
      deduped.map((m, i) => `${i + 1}. ${m.text}`).join("\n"),
      new AbortController().signal,
    );
    const match = raw.match(/\[[\s\S]*\]/);
    const arr: unknown = match ? JSON.parse(match[0]) : null;
    if (Array.isArray(arr) && arr.length) {
      const texts = arr.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
      // Refuse a result that throws away most of the store — that's a bad response,
      // not a clean-up, and memory loss is worse than a bloated store.
      if (texts.length >= Math.ceil(deduped.length * 0.4)) {
        // Reuse the original vector when the text survived verbatim; otherwise the
        // entry is re-embedded lazily on next write.
        kept = texts.map((text) => {
          const prior = deduped.find((m) => m.text === text);
          return prior ?? { text, ts: Date.now() };
        });
      }
    }
  } catch {
    /* model unavailable — keep the locally-deduped store */
  }

  localStorage.setItem(`${CONSOLIDATE_KEY}:${scope}`, String(Date.now()));
  // Save whenever anything actually changed, not just when the count shrank — a
  // pass that merges two facts into one rewording keeps the same length, and
  // discarding that work would make consolidation a no-op on a settled store.
  const removed = mem.length - kept.length;
  const changed =
    removed !== 0 || kept.some((k, i) => k.text !== mem[i]?.text);
  if (changed) await saveAgentMemory(scope, kept.slice(-MAX));
  return removed;
}

/** Auto-extract durable facts from a finished conversation and store them (reconciled). */
export async function extractAndStore(
  agentId: string,
  transcript: string,
  provider: Provider,
  model: string,
): Promise<void> {
  try {
    const raw = await chatOnce(
      provider,
      model,
      "You extract durable, long-term facts worth remembering about the user or project from a conversation — preferences, decisions, stable context, corrections. Ignore transient chatter, tool noise, and reasoning. Reply with ONLY a JSON array of short factual strings (max 8), or [] if nothing is worth keeping.",
      transcript.slice(0, 8000),
      new AbortController().signal,
    );
    const match = raw.match(/\[[\s\S]*\]/);
    const arr = match ? JSON.parse(match[0]) : [];
    for (const f of arr) if (typeof f === "string" && f.trim()) await remember(agentId, f.trim());
  } catch {
    /* auto-extract is best-effort */
  }
}
