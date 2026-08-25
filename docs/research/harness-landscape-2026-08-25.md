# New harnesses & category shifts — 25 Aug 2026

A sweep for what shipped since the last landscape note (`docs/ai-landscape-2026-08-16.md`)
and the router study (`router-category-2026-08-23.md`). Web-sourced, read not run;
each claim names where it came from.

---

## The structural story: ACP won the "any agent, any editor" layer

The **Agent Client Protocol** (Zed, Aug 2025; JetBrains joined) is now the
LSP-of-coding-agents: **37–60+ registered agents** (Gemini CLI, Codex CLI,
Cursor, Copilot preview, Kimi CLI, goose…), native in **JetBrains 2026.2** and
Zed, community plugins for Neovim/Emacs/VS Code, Devin Desktop shipping it
June 2, official SDKs in five languages (Rust/TS at v1.0), a public registry,
and a v2 draft in flight. Sources: agentclientprotocol.com,
jetbrains.com/acp, danilchenko.dev (Aug 16), beri.net (Aug 7).

Don't confuse it with the *other* ACP — the Agent **Communication** Protocol
folded into A2A in 2025 (zuplo.com, Jul 3). The 2026 stack is: **MCP**
(agent→tools) + **A2A** (agent→agent) + **ACP** (editor→agent).

**Why it matters here:** our Claude Code and opencode integrations
(`claudecode.rs`, `opencode.rs`) are bespoke stdin/stdout wrappers — exactly
what ACP standardizes. Exposing HarnessStation agents over ACP would put them
in JetBrains/Zed/Devin's agent pickers for free; acting as an ACP *client*
would let us host any of the 60+ registered agents in our chat the way we
host Claude Code today. This is the strongest integration opportunity the
sweep found.

## The "harness as a product" trend

- **Cline SDK** (May 14): extracted its whole agent harness into
  `@cline/sdk` — a pluggable TypeScript runtime (providers, plugins, tools)
  — and now markets harness quality with benchmark deltas against Claude Code
  on the *same model* (74.2% vs 69.4% on tbench, their runs). The harness is
  no longer invisible plumbing; it is the measured product. (marktechpost.com)
- **amux** — terminal agent multiplexer, added Piper TTS read-aloud in
  August. Voice is reaching the terminal crowd. (amux.io)
- **OpenACP** — drive 28+ agents from Telegram/Discord/Slack over ACP, with
  multi-agent "Cowork", budgets, voice messages, session transfer. Direct
  feature overlap with our Channels panel, built on the open protocol
  instead of per-platform bots. (openacp.ai)

## Free-tier and default-model churn

- **Gemini CLI rebranded to Antigravity CLI (`agy`)** June 18; the free
  1,000 req/day tier survives. (amux.io)
- **Claude Opus 5** shipped Jul 24 and is Claude Code's new default;
  **GPT-5.6 Sol** went GA Jul 9 and is Codex's; **Claude Fable 5** returned
  to GA Jul 1 and tops model benchmarks. (neuralcoretech.com, Aug 3)
- Action for us: run `CATALOG_LIVE=1` before the next release — Discover's
  curated ids predate all three.

## Our category (local-first desktop)

- **Ollama shipped a desktop GUI** (chat, file drag-drop, context slider,
  thinking toggle) and — the sharp edge — **v0.14+ speaks the Anthropic
  Messages API**, so Claude Code already runs on local models through Ollama
  alone. Our `/v1/messages` is no longer unique *as a protocol*; what remains
  uniquely ours on that path is agents, combos, subscriptions and memory
  behind it. (aiwiki.ai Ollama entry, Jun 20)
- **Consoles.ai** — "AI Agent Desktop", "bring your own key **or
  subscription**": the closest positioning to ours we've seen. Watch.
  (consoles.ai)
- **OpenClaw Desktop** (Steinberger) — phone-messaging-driven PC automation
  with Ollama; **AnythingLLM** — agents + MCP + scheduled jobs + agent-flow
  canvas; **Jan** — local OpenAI-compatible server on 127.0.0.1:1337. All
  eating one edge of the same lunch. (openclawdesktop.com, toolradar.com)

---

## Read

1. **ACP is the move.** Agent-side ACP support (HarnessStation's agents in
   every editor's picker) is the highest-leverage integration we could add,
   and it retires bespoke wrapper maintenance. Decide deliberately — it is
   new surface.
2. **The catalog needs its pre-release canary** (`CATALOG_LIVE=1`): three
   flagship model defaults changed in July.
3. **Channels vs OpenACP**: ours is built-in and simpler; theirs rides a
   protocol with 28 agents. If Channels grows, ACP-style abstraction is the
   shape to grow into.
4. **"Claude Code on local models" is now table stakes** (Ollama does it).
   Our version still differentiates — subscriptions, combos, agents, memory
   behind the same endpoint — but the pitch should lead with those, not with
   the protocol.

---

## Canary run � 25 Aug 2026

`CATALOG_LIVE=1` passed 3/3. Six curated ids are unknown to the live price
feed, all verified as **recent releases the feed has not ingested**, not dead
ids: GLM-5.3 (Z.ai, Aug 14, API live Aug 18), glm-5.1 (coding-plan routing),
Qwen3.8-2.4T-A95B (Aug 14), MiniMax M2.7 on Groq, and Ollama Cloud's
gemini-3-flash-preview. No catalog changes needed; re-run before the next
tag as usual.
