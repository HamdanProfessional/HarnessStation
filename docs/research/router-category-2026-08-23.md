# The local-router category (qrouter / 9Router / OpenProxy) — 23 Aug 2026

Trigger: a screenshot of qrouter's provider grid — OAuth Providers (Claude Code,
OpenAI Codex, GitHub Copilot, Cursor IDE, Antigravity, Kilo Code, Cline), Free
Providers (Gemini, NVIDIA NIM, Groq, Together, Fireworks, Vertex, Pollinations,
OpenRouter-free…), API Key Providers (OpenAI, Anthropic, DeepSeek, Mistral,
xAI, Kimi, GLM, MiniMax, Qwen…), and a sidebar of Endpoints / Proxy Pools /
Routes / Usage / Logs / Quota / MITM.

Sources: 9Router site + docs, quangdang46/openproxy README (Rust, one binary on
127.0.0.1:4623), ypollak2/llm-router, claude-code-llm-router. Read, not run.

**What the category is.** A loopback proxy that exposes one OpenAI-compatible
endpoint and fans requests out to many backends, so any CLI/IDE (Claude Code,
Codex, Cursor, Cline…) can use any provider. The pitch that sells it is not
"routing" — it is **turning subscriptions into APIs**: your Claude Max,
Copilot, or Codex subscription becomes a backend any tool can call, with
auto-refreshed OAuth tokens, multi-account round-robin, and a 3-tier fallback
chain (subscription → cheap key → free tier) so quota walls stop ending
sessions.

---

## Why this matters to us specifically

We already ship the inverse half of this product and don't name it:
`localapi.rs` + `src/lib/localApi.ts` is a loopback OpenAI-compatible endpoint
backed by the providers the user configured — and as of this week it passes
function calling through. A router is *that, plus upstreams we don't offer.*
Every item below is an increment on plumbing we own, not a new product.

The positioning consequence is direct. In the opencode comparison the honest
loss was "terminal developers stay in their CLIs." The router category shows
the cheapest reversal: don't replace their CLI — **become the backend under
it.** Claude Code pointed at HarnessStation with a local GGUF or a Groq key is
"Claude Code, any model," and it needs protocol translation we already write
in the outbound direction.

---

## Worth taking, in order

### 1. Anthropic-format inbound endpoint (`/v1/messages`) — the Claude Code adapter

- **Them:** format translation between OpenAI / Anthropic / Gemini so any tool
  speaks to any provider ("Translator" in 9Router's feature list).
- **Us:** `localApi.ts` speaks OpenAI only. Claude Code cannot point at us
  because it speaks the Anthropic Messages protocol.
- **Why first:** one protocol, one consumer with perfect intent (set
  `ANTHROPIC_BASE_URL`), and we already implement Anthropic *outbound*
  (`streamAnthropic`) — system blocks, cache breakpoints, tool_use blocks are
  all understood shapes. Inbound translation is the mirror: parse
  `messages[]/system/tools/tool_result`, emit `content_block_delta` SSE frames.
- **Cost:** M. Lives in `localApi.ts` (+ a `localapi.rs` route passthrough,
  which is generic already — it forwards method strings to JS).
- **Payoff:** the terminal gap closes from underneath. Claude Code, the most
  entrenched CLI in the world, can run on Ollama, Groq, or a $0.20/1M MiniMax
  key through us.

### 2. Subscription OAuth providers — subscriptions become backends

- **Them:** 6-7 OAuth providers (Claude Code, Codex, Copilot, Cursor,
  Antigravity, Kilo, Cline) with PKCE, token auto-refresh, multi-account
  round-robin. OpenProxy keeps an OAuth registry of ~18 configs and spoofs
  client version strings (`app_constants.rs`: Copilot Chat 0.38.0, Gemini CLI
  0.34.0).
- **Us:** nothing — but the machinery half-exists: `src-tauri/src/oauth.rs`
  already does OAuth 2.0 PKCE with dynamic client registration and a loopback
  redirect capture, for MCP. A `provider.kind = "oauth"` with per-provider
  token refresh would reuse it.
- **Cost:** M-L per provider (each is its own flow + quirks + ToS reading).
  Claude (PKCE, well-documented by the community clients) first; Copilot is
  the second-most-documented.
- **Honest risk:** this is the category's grey zone. It works by impersonating
  the official client. Anthropic/OpenAI tolerate it today; they can kill it
  any quarter. Ship it as clearly-labelled "use your subscription where your
  tools' policy allows", never as the headline.
- **Payoff:** the single highest-demand feature in this category, and it makes
  our local API the endpoint under *everyone's* CLIs.

### 3. Cross-provider combos — a virtual provider built from a chain

- **Them:** "Combos": chain providers into one virtual provider, sticky
  round-robin, automatic fallback on 429/quota/error. 3 tiers by default
  (subscription → cheap → free).
- **Us:** `buildAttempts` (`providers/index.ts:107`) already produces an
  ordered attempt list, but only within a provider + its static `fallbacks`.
  A "combo" is the same shape with cross-provider members and quota-aware
  reordering.
- **Cost:** S-M. A `Combo` entity (ordered provider/model list) that `resolve()`
  can return; the attempt loop needs no redesign.
- **Payoff:** turns our per-provider resilience into the product feature the
  category is named for, and the Value tab can *price* the chain.

### 4. Free-tier catalog in Discover

- **Them:** a curated "Free Providers" section (Gemini free, NVIDIA NIM, Groq,
  OpenRouter :free, Pollinations, Kiro, iFlow…).
- **Us:** Discover already catalogs providers with live price checks
  (`catalog.PRICE_SLUG`); it just has no $0 tier or one-click free setup.
- **Cost:** S. A curated free tier in the catalog + preset provider entries
  with empty keys where the provider allows keyless/free use.
- **Payoff:** the zero-friction story ("working model in 60 seconds, no card")
  currently belongs to the routers' onboarding, not ours.

### 5. Quota & reset tracking per provider

- **Them:** live token counters, reset countdowns, per-provider cost
  estimation, "quota wall" warnings that trigger fallback.
- **Us:** `budget.ts` tracks *spend*; `providerStatus.ts` shows badges; the
  Value tab knows prices. Missing: subscription-shaped quota (X messages / 5h
  window) and 429-signal history that could drive combo reordering.
- **Cost:** M. Record 429/Retry-After observations per provider (we now parse
  Retry-After already), expose windows in the UI next to the status badges.
- **Payoff:** makes combos honest — fallback triggered by measured exhaustion,
  not guesswork.

### 6. Tool-output compression (RTK-style) — noted, deferred

- **Them:** RTK/Caveman compress tool-call results before they hit the model,
  claiming −20–40% input tokens on tool-heavy turns.
- **Us:** the adjacent problem is already on the opencode-comparison list as
  "retrievable tool output" (`toolOutputStore`). Compression is a different
  tactic for the same cost problem.
- **Cost:** M and quality-sensitive (lossy rewrites can break tool results).
  Revisit after retrievable-output lands; they compose.

---

## Not recommended

- **MITM bridge** — intercepting IDE traffic (Copilot/Antigravity/Kiro) to
  reroute their subscriptions. ToS-hostile, brittle, and brand poison for an
  app whose entire pitch is trust.
- **Proxy pools / IP rotation** for region-restricted providers — same
  category of grey, plus an operational surface we don't want.
- **Cloud tunnel / hosted dashboard sync** — directly against the
  local-first sentence. The device mesh already covers the legitimate version
  (your machines, your network).
- **Being a router product.** The category is crowded (9Router, OpenProxy,
  llm-router, llmairouter…), free, and commoditising. The durable version of
  these features is *inside* a full local-first app — chat, voice, agents,
  memory, mesh — not as another npm router.

---

## What we have that none of them do

- An actual application around the endpoint: conversations, projects,
  knowledge, memory, agents, workflows, schedules, voice, avatars, media.
- The Value tab — nobody in the router category can tell you what a combo
  *costs*, let alone rank one.
- The device mesh — a router feature (share providers across machines) done
  locally and encrypted, no cloud.
- A local engine (llama.cpp, MTP) — the true free tier that can't rate-limit.
- The privacy sentence, which the MITM/proxy corner of this category quietly
  forfeits.

---

## Suggested order

1. **Anthropic inbound endpoint** (1) — unlocks Claude Code on any model; no
   ToS ambiguity; reuses outbound Anthropic knowledge.
2. **Free tier in Discover** (4) — smallest, immediate onboarding win.
3. **Combos** (3) — our fallback machinery, productised.
4. **Quota tracking** (5) — feeds combos; pairs with Value pricing.
5. **Subscription OAuth** (2) — biggest payoff, biggest maintenance and ToS
   risk; do it once 1–4 make the endpoint worth pointing things at.

Items 1 and 4 are safe, high-certainty wins. Item 2 is the strategic one and
should be a deliberate, eyes-open decision — the freeze discipline applies.

> **Status, same day.** Item 1 shipped: `/v1/messages` (streaming via
> preformatted named-event frames, non-streaming, `count_tokens` estimate,
> Anthropic-shaped errors) with unknown-Claude-name fallback to the default
> provider's first model. Item 4 turned out to be mostly already built —
> `catalog.ts` has long flagged `free: true` providers and the price feed
> classifies `:free` models — so what shipped is the missing presentation:
> a "Free tier" section first in Discover and a "Free only" filter in the
> Value tab. `hs endpoint` now prints the Claude Code environment alongside
> the OpenAI provider block. Item 3 shipped the same week: Settings → Combos
> manages named chains, `combo/<slug>` works in every model picker and on
> both local API protocols (`streamChain` walks steps, never advancing once
> text has streamed).
>
> **Item 2 shipped (scoped).** Settings → Subscriptions connects a Claude
> Pro/Max subscription (PKCE, paste-back code, tokens in the OS keychain,
> Bearer + OAuth beta header on the Anthropic path) and GitHub Copilot
> (device flow, GitHub token exchanged for the short-lived Copilot bearer,
> editor-identity headers on the OpenAI-compatible path). The broker
> (`lib/oauthProviders.ts`) single-flights refreshes and lives behind
> `Provider.auth`, so every consumer — chat, voice, agents, combos, the
> local API — gets subscriptions for free. **Codex/ChatGPT is deliberately
> not built**: its endpoint speaks the Responses protocol, a translation
> project of its own. The ToS caveat stands as written above and ships in
> the panel itself.
>
> **Item 5 shipped.** `lib/quota.ts` records the provider's own 429s (with
> Retry-After when sent) in localStorage, decays on success, and exposes a
> "limited until". Combos use it to try measured-exhausted steps *last*
> (reorder, never remove — if everything is limited the user's order stands),
> and My Models shows a "Limited · 3m" countdown badge. Subscription-shaped
> windows (X messages / 5h) remain unmodelled — they are unpublished and
> mobile; the 429 signal is the honest version. Item 6 stays deferred as
> written. With that, every item in this study is either shipped or
> deliberately not.
