# Decision memo: the Agent Client Protocol â€” 25 Aug 2026

**Status:** proposed â€” decision requested.
**Context:** `harness-landscape-2026-08-25.md` flagged ACP as the strongest
integration opportunity found in the August sweep. This memo scopes what
adopting it would actually mean for HarnessStation and asks for a call.

---

## What ACP is

A JSON-RPC 2.0 stdio protocol between an *editor* (JetBrains 2026.2, Zed,
Devin Desktop, VS Code/Antigravity via plugins) and a *coding agent* it
launches as a subprocess. Core surface: `initialize`, `session/new`,
`session/prompt` (in), `session/update` notifications (streamed content
blocks out), `session/request_permission` (agent asks the human before a
sensitive action), session resume/list/delete. SDKs in five languages; a
public registry of 37â€“60+ agents; a v2 draft already published.
Sources: agentclientprotocol.com, infragap.com, danilchenko.dev.

Adoption is real, not press-release: Gemini CLI, Codex CLI, Cursor, Copilot
(preview), Kimi CLI, goose and dozens more are registered.

## Why it is tempting for us

1. **Distribution.** An ACP-registered HarnessStation agent appears in every
   ACP editor's agent picker â€” JetBrains, Zed, Devin â€” with zero per-editor
   work, forever.
2. **Wrapper retirement.** Our `claudecode.rs` and `opencode.rs` are bespoke
   stdin/stdout wrappers. ACP is the standardized version of exactly that
   shape; the registry already carries agents we currently wrap by hand.
3. **The mesh analogy.** We already believe in "speak the open protocol, be
   the local hub" (MCP client, OpenAI + Anthropic endpoints). ACP is the
   same sentence one layer up.

## The honest complication

ACP agents are **subprocess programs that own their tool loop**. Our agents
are **in-app**: they live in the Zustand store, run the app's 33 tools, and
breathe through the UI. An editor cannot spawn our store. Bridging that gap
is the whole cost of this decision, and it splits by direction:

### Option A â€” agent-side: expose HarnessStation as ACP agents

A small stdio bridge (`hs acp`, Node) speaks ACP and forwards prompts to the
running app. Two tiers:

- **A1 â€” model-only (S).** The bridge maps `session/prompt` â†’ local API
  `/v1/chat/completions` with `agent/<name>` or `combo/<name>` as the model.
  Editors get our model routing â€” subscriptions, combos, local GGUFs â€” with
  the *editor* bringing its own tools (MCP). No app changes beyond what
  ships today. Limited: our agents' app-side tools don't run.
- **A2 â€” full agents (L).** The local API gains an agent-loop mode: the app
  runs its tool loop, streams text, and surfaces each tool call as an ACP
  `session/request_permission` round-trip. Real work â€” a new request method,
  permission round-tripping, tool-result mapping â€” and the first place the
  app's agent loop is driven from outside its UI.

### Option B â€” client-side: host registry agents in HarnessStation

Replace/augment the bespoke wrappers with an ACP *client*: any registered
agent (60+ today) launches as a subprocess and appears in our chat, its
content blocks mapped to our transcript, its permission requests to our
existing approval dialogs. Medium-large: an ACP client (Rust or TS), block
mapping, session management. Retires per-agent wrapper maintenance forever
and turns "Claude Code & opencode support" into "every registered agent."

### Option C â€” not now

Watch the v2 draft land (migration guide already public), revisit when
someone asks. Costs nothing; forfeits the distribution window while the
registry is still small enough to be visible in.

## Risks (both directions)

- **v2 churn** â€” a migration is already published; early adoption accepts one
  protocol upgrade.
- **Shape mismatch** â€” ACP is coding-agent-shaped (diffs, file edits,
  permissions). Our general chat agents fit the protocol but not its
  assumptions; A1 sidesteps this by being honestly model-only.
- **Subprocess vs app** â€” the bridge needs the app running (like `hs` does).
  Documented limitation, consistent with the CLI.

## Recommendation

**A1 now, B next, A2 when asked.** A1 is a small, honest step with immediate
distribution (our routing â€” including subscription and combo chains â€” in
every ACP editor) and zero app-surface change. B is the strategic one but
deserves its own sizing pass once A1 teaches us the protocol hands-on. A2
builds only if editors actually show up and ask for app-side tools. Register
in the ACP registry at that point.

**Decision requested:** proceed with A1?

---

## Addendum: what this means for Channels

OpenACP (see the landscape note) drives 28+ agents from Telegram/Discord/Slack
by bridging them over ACP, and adds multi-agent sessions on top. Our
Channels panel does the same job for our own agents with per-platform bots —
simpler, built-in, but per-platform by construction.

No action now: Channels at its current size is fine as bots. The note for the
future is directional — **if Channels grows, grow it ACP-shaped**: an internal
agent-bridge abstraction (message in ? session ? streamed blocks ? permission
asks) that platform bots and an eventual ACP client both sit on. That is the
same shape Option B needs, which is another reason B is the strategic half of
this decision.

---

## Update — A1 shipped (25 Aug 2026)

`cli/acp.mjs` (`hs-acp`, also in the desktop bundle's `cli/` resources) is a
complete ACP v1 agent: initialize/session-new/session-prompt/session-cancel/
session-close, per-session in-memory history, streamed `agent_message_chunk`
frames with stable message ids, cancellation mapped to stream abort and the
`cancelled` stop reason, `max_tokens` mapped from `finish_reason`, unknown
methods answered with -32601. Model selection at launch (`--model`,
`--agent`, `--system`, `--port`) with first-listed-model fallback. Ten tests
drive the real subprocess against a fake local API — framing, chunk order,
history carry-over, cancellation, error codes.

Registration in the ACP registry is a PR adding the command to
`agentclientprotocol/registry` — do that after one live editor test.

## Option B, sized — the queued build

**Goal:** any registry agent hosts inside HarnessStation's chat, replacing
per-agent wrappers over time.

1. **`src-tauri/src/acp.rs`** (M) — long-lived child-process manager in the
   `claudecode.rs` mold: spawn command+args, newline-delimited JSON-RPC relay,
   request-id correlation, events to the frontend (`acp-event`), a cancel
   command. The framing code in `localapi.rs` and the relay pattern in
   `claudecode.rs` cover most of it.
2. **`src/lib/acp.ts`** (M) — typed client: connect(config), session lifecycle,
   prompt with onDelta/onToolCall callbacks, permission round-trips surfaced
   through the existing `askUser` dialog (the `session/request_permission`
   mapping is the one genuinely new UX).
3. **UI** (M) — an "ACP agents" section beside the Claude Code / opencode
   wrappers: add agent (command, args, env), run panel with transcript,
   permission prompts, cancel. Reuse `ClaudeCodeView` structure.
4. **Config** (S) — `acpAgents` in settings (like mcp servers), plus a
   Discover-style "install from registry" later.

Sequence: Rust relay ? TS client ? one known agent (Claude Code via its ACP
adapter) end-to-end ? UI polish. Estimate: 2–3 focused sessions. Prereq: none
beyond what ships today; v2 migration is the known follow-up cost.
