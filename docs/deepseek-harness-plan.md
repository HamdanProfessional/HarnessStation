# DeepSeek-Harness-inspired features for HarnessStation

Source: NeuralNine, *"DeepSeek Harness: The End of Claude Code?"* (Aug 2026) — video + transcript in `downloads/`.
Three ideas worth borrowing, ordered by value-to-effort. All file:line refs verified against the
current tree.

The DeepSeek Harness sells two things: **everything is a plug-in** (activate/deactivate any feature via
a `cordis.patch.yaml` profile) and **everything is traceable** (a "trajectory" view graphs every step —
system prompt, context, thinking, each tool call + result, timing — and exports the session). It also has
**creator mode**: describe a capability in a prompt and it builds + loads it live.

---

## Feature 1 — Trajectory / full-traceability view  ·  *moderate, do first*

A read-only, step-by-step view of a run: system prompt → user prompt → loaded context/RAG → thinking →
each tool call (name + args) + result → timing/tokens per step, with the whole session exportable as a log.

**This is the standout feature and the cheapest — ~70% of the data is already captured.**

### Already captured (no work)
- Per message (`Message`, `src/lib/types.ts:266-279`): `role`, `content`, `reasoning` (thinking),
  `toolCalls` (`{id,name,arguments}`, `types.ts:148-152`), token usage (`promptTokens`/`completionTokens`),
  `attachments`, multi-agent `author`.
- Tool results are separate `role:"tool"` messages linked by `toolCallId` (`store.ts:1544`).
- Per chat (`Chat`, `types.ts:318-350`): `systemPrompt` template, `providerId`/`model`, `temperature`,
  `knowledgeBaseIds`, `enabledTools`, `createdAt`/`updatedAt`, rolling `summary`.
- Export plumbing: `exportChat(chat,"json"|"md")` (`storage.ts:886-895`), already in the sidebar menu
  (`Sidebar.tsx:197-199,412-413`). JSON export already includes reasoning/toolCalls/results/tokens.

### Missing (the actual work)
1. **Per-step timestamps + duration.** `Message` has no time field; the stream loop (`store.ts:1408-1442`)
   never measures elapsed time. → Add `startedAt?`, `durationMs?`, `tps?` to `Message`; wrap the turn in
   `performance.now()`.
2. **Persist the loaded context per turn.** `ragContext` (`store.ts:1306-1322`), the injected memory block
   (`1371-1382`), project note, and AGENTS.md note are computed, folded into the system-prompt string
   (`1417`), then **discarded**. → Store a `context?: { rag?: RetrievedChunk[]; memory?: string; composedSystemPrompt?: string }`
   on the assistant message (or a sibling record) so "what was retrieved for this step" is recoverable.
3. **Turn/round stats.** The tool-loop `round` counter (`store.ts:1393`) is runtime-only. → Persist round #
   per assistant message.

### Plan
- **P1a — data model:** add the fields above to `Message`; capture timing + context at `store.ts:1408-1442`.
  Backward-compatible (all optional; old convos just show blanks).
- **P1b — Trajectory view:** new component (e.g. `TrajectoryView.tsx`) rendering a vertical step graph for
  the current chat — one node per step (system / user / assistant-thinking / tool-call / tool-result), each
  expandable to raw payload (args JSON, result, retrieved chunks), with a timeline rail showing durations.
  It joins `role:"tool"` messages back to their call by `toolCallId`. Reachable from a "Trace" button in the
  chat header / sidebar menu.
- **P1c — Session-log export:** extend `exportChat` with a `"jsonl"` mode + a zip (mirrors DeepSeek's
  `session.jsonl`): one JSON object per step, plus a manifest (model, provider, totals). Reuse the existing
  export menu wiring.

---

## Feature 2 — Toggle profiles ("everything is a plug-in")  ·  *moderate, do second*

A named **profile** that activates/deactivates features — tools, skills, and UI panels — analogous to
DeepSeek's `cordis.patch.yaml`.

### Already modular (reuse)
- **Tools:** `Chat.enabledTools` (`types.ts:337`), `Agent.toolIds` (`types.ts:526`), global gating
  (`Settings.blockTools`/`confirmTools`/`toolSandbox`/`guardrails`, enforced in `executeTool`, `tools.ts:700-712`).
- **Tool sets:** `ToolSet` + `BUILTIN_TOOLSETS` (`tools.ts:8-61`) — named tool-id bundles, already the shape
  a profile would toggle.
- **Skills:** real `enabled: boolean` flag (`skills.ts:20-27`), already filtered in `skillIndexPrompt`
  (`skills.ts:115-116`).
- **Schedules:** `Schedule.enabled` (`types.ts:475`). **Settings:** many booleans already
  (`autoCompact`, `autoEnableTools`, `passiveMemory`, `localApi.enabled`, `voice`, …, `types.ts:43-126`).

### Missing (the work)
1. **Views/nav are hardcoded** — an `if/else` ladder in `App.tsx:261-310` and hardcoded `navBtn(...)` calls
   in `Sidebar.tsx:436-464`. → Refactor into a **view registry** (a list of `{id, label, icon, section, component}`)
   that both `App` and `Sidebar` map over. This is the prerequisite for toggling panels.
2. **No unified profile model** — enablement is scattered. → Add one `Profile` config object
   (`{ views: string[]; toolSets: string[]; skills: string[]; settings: Partial<Settings> }`) persisted like
   settings (`storage.ts:182-193`), with an active-profile selector. A profile is just an overlay that filters
   the view registry + enabled tools/skills.
3. **No plugin manifest/lifecycle** (needed only for true third-party plugins — defer; the profile model above
   covers the "toggle what already exists" 90% case).

### Plan
- **P2a:** view registry refactor (unlocks toggling panels, low-risk, valuable on its own).
- **P2b:** `Profile` model + a Settings section to create/switch profiles; apply as a filter over the registry
  and tool/skill enablement. Ship 2-3 built-in profiles (e.g. "Minimal", "Coding", "Full").

---

## Feature 3 — Creator mode  ·  *large, plan only*

Describe a capability in a prompt → the app builds and loads it as a live plugin.

### Foundation that already exists
- `find_tools` + `enable_tool` (`tools.ts:513-550`, dispatched via `toolDiscovery.ts`) already let the model
  **discover and switch on** capabilities from a prompt at runtime — `enable_tool` can even `install:<Name>`
  an MCP server. This is a genuine partial creator-mode loop.
- Tools can be authored as JS/Python (`Tool.code`, `types.ts:378-383`; executed at `tools.ts:807-821`) — so
  "generate a new tool from a prompt" is a short step from what exists.

### Missing / hard
- Generating + persisting a **new tool** from a natural-language brief (LLM writes `Tool.code`, validated,
  saved via `storage.ts`), then enabling it — feasible as a first slice.
- Extending "creator" to **skills** (write a SKILL.md) and **UI panels** — panels require Feature 2's view
  registry first, and dynamically-loaded UI is the sandboxing-heavy part (untrusted generated React).
- **Sandboxing / safety:** generated code must run under the existing `toolSandbox`/`guardrails` gates
  (`tools.ts:700-712`); auto-approval must stay off by default.

### Plan (staged, later)
1. **Creator-lite:** a "Create a tool" flow — prompt → LLM drafts `Tool.code` + schema → user reviews → save +
   enable. Reuses tool execution + sandbox already in place.
2. **Creator for skills:** prompt → SKILL.md → dropped into the skills dir, `enabled:true`.
3. **Creator for panels:** only after the P2a view registry; needs a sandbox for generated UI. Biggest risk;
   defer until 1-2 prove out.

---

## Recommended sequence
1. **Feature 1** (trajectory view + export) — highest value, mostly UI over existing data. Ship first.
2. **Feature 2a** (view registry) — small refactor that unlocks panel toggles *and* Feature 3's panels.
3. **Feature 2b** (toggle profiles).
4. **Feature 3** (creator-lite for tools first), then reassess.

Nothing here needs a new backend — all state lives in the existing `~/.harnessx` JSON model.
Related plans: `docs/self-improving-memory-plan.md`, `docs/okf-wiki-plan.md`.
