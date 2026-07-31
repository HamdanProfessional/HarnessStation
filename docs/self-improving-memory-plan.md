# Self-Improving Memory — Feature Plan

> Borrowing the ideas behind **Cognee 1.0** (remember / recall / **improve** / forget + entity graph)
> onto our existing agent-memory system — no Postgres, no external service, pure JSON at our scale.
> Planned 2026-07-20.

## Goal
Turn the current flat, static fact list (`src/lib/memory.ts`) into a memory that **gets sharper with
use**: memories that actually help get reinforced, unused/stale ones decay and are forgotten first,
and entity **relationships** (not just text matches) can be recalled. This is the "self-improving"
headline from the video, done cheaply on top of what we already have.

## What we have today (baseline)
- `MemoryEntry { text, ts, vector? }`, capped at 400, stored per agent at `~/.harnessx/memory/<id>.json`.
- `recall(agentId, task, k)` — semantic (if embeddings configured) else keyword+recency, returns top-K.
- `remember(agentId, fact)` — reconciles against a near-duplicate (sim ≥ 0.82) instead of piling up.
- `extractAndStore(...)` — LLM pulls durable facts from a finished transcript → `remember` each.
- Pruning is naive: `mem.slice(-MAX)` drops the **oldest**, regardless of usefulness.

## The three gaps Cognee highlights
1. **No improve loop** — a memory that led to a great answer is treated the same as noise.
2. **No usefulness-aware forgetting** — we drop by age, not by value.
3. **No relationships** — we match text/vectors, never "X works-at Y", "A depends-on B".

---

## Phase 1 — Improve / forget feedback loop  (effort: **S**, highest value)
Make memory value-weighted.

**Data model** — `MemoryEntry` gains:
```ts
id: string;            // stable id so feedback can target it
weight: number;        // usefulness score, default 1
uses: number;          // times surfaced, default 0
lastUsed?: number;     // ms; for recency + decay
```
**Recall ranking** — blend usefulness into the existing score:
`score = relevance * (0.6 + 0.4 * normalize(weight)) + recencyBias`. On return, bump each surfaced
entry's `uses++` / `lastUsed = now` (a mild "was considered" signal).

**Improve** — new `reinforce(agentId, ids, delta)`:
- 👍 on an answer → `weight += 1` for the memories that were recalled for that turn.
- 👎 / user correction → `weight -= 1` (floored at 0).
The turn must remember **which** memory ids it recalled — `recall()` gains a sibling
`recallDetailed()` that returns `{id, text}[]`; the caller stashes those ids on the message/run so
feedback can find them.

**Forget** — replace `slice(-MAX)` with **value-aware pruning**: when over MAX, drop the lowest
`weight * timeDecay(lastUsed ?? ts)` first. Optional hard-forget of weight-0 entries idle > N days.

**Feedback sources**
- Agent-applied chats & standalone agent runs: 👍/👎 on the assistant message / run result.
- (Optional, later) implicit: an uncorrected continuation = weak +, an explicit correction = weak −.

## Phase 2 — Entity-graph memory  (effort: **M**)
Add lightweight relationships alongside facts (the graph half of Cognee's ECL).

**Data model** — a sibling store `~/.harnessx/memory/<id>.graph.json`:
```ts
interface MemoryEdge {
  id: string;
  subject: string; relation: string; object: string;
  weight: number; uses: number; ts: number;
  sourceMemoryId?: string;   // provenance link back to the fact it came from
}
```
`loadAgentGraph / saveAgentGraph` added to storage.ts (mirrors the entries store; absence = empty).

**Extract** — `extractAndStore` gets a second LLM ask (or one combined call) that returns
`[{subject, relation, object}]` triples; store as edges, reconciling exact `subject+relation+object`
duplicates (bump weight instead of duplicating — same spirit as fact reconciliation).

**Recall (graph hop)** — pull entities from the task (match against known subjects/objects; cheap
string/lowercase match, no extra LLM call needed for v1), gather edges 1–2 hops out, render as
`Known relationships:\n- X —relation→ Y`. Merge with the fact block, cap total lines.

**Improve on edges** — `reinforce` also bumps edge weights (this is exactly Cognee's "edge weights
update from feedback"). Low-weight edges prune first.

## Phase 3 — Auto-routing recall  (effort: **S**)
`recall()` decides what to blend per query instead of always doing the same thing:
- Always: semantic/keyword fact recall (Phase 1).
- If the task names known entities: add graph hops (Phase 2).
- Dedupe overlapping content, weight-sort, cap to K. Return one combined context block.

---

## UI
- **Chat**: 👍/👎 on assistant messages (extend the existing `msg-act` button row). Wire to
  `reinforce` using the ids stashed for that turn. Silent no-op when the chat has no agent/memory.
- **Agent run panel**: 👍/👎 on the result.
- **Memory inspector** (optional, nice-to-have): a small view per agent listing facts with
  `weight`/`uses`, plus the edge list — so the "improving" is visible and editable (pin/delete).
- **Settings** (optional): toggle graph memory, and decay half-life / MAX knobs.

## Storage & migration
- `loadAgentMemory` already migrates legacy shapes — extend it to backfill `id` (generate),
  `weight = 1`, `uses = 0` on old entries. No data loss.
- Graph store is new and optional; missing file → `[]`.

## Addressing the honest caveats
- **Feedback sparsity** — most turns get no 👍/👎. Mitigate with the mild "surfaced" signal + optional
  implicit correction detection, so memory still evolves without constant rating.
- **Graph quality at scale** — constrain triple extraction to a strict shape + reconcile duplicates +
  cap edges per agent; skip unparseable triples rather than trusting the model blindly.
- **Not Postgres/Cognee** — we deliberately don't adopt the graph-DB stack; a JSON adjacency list is
  fine for per-agent memory sizes. A future "connect an external memory engine (Cognee) by URL"
  (like Colibri/Ollama) stays an optional power-user path, not the default.

## Implementation steps
1. Types + storage: extend `MemoryEntry` (id/weight/uses/lastUsed), migration backfill.
2. `memory.ts`: weight-aware `recall`, `recallDetailed`, `reinforce`, value-aware pruning.
3. Wire recalled-ids tracking through `runAgent` and the agent-applied chat path.
4. UI: 👍/👎 on messages + agent results → `reinforce`.
5. Graph: `MemoryEdge` store, triple extraction in `extractAndStore`, graph-hop recall.
6. Auto-routing recall + optional memory inspector.

## Effort
Phase 1 ≈ half a day (S) and delivers the "self-improving" headline on its own. Phases 2–3 ≈ ~1 day
(M). Recommend shipping Phase 1 first, then deciding on the graph based on how it feels.

## Out of scope (v1)
- Postgres / dedicated graph DB; running the real Cognee service inline.
- Cross-agent shared memory graph (single-agent scope for now).
- Temporal "as-of" version history of edges (Cognee has bitemporal; we keep last-write + weight).
