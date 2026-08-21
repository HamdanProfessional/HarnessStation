# What opencode does that we don't — 21 Aug 2026

Compared against `anomalyco/opencode` @ `dev` (199k stars, TypeScript monorepo,
30 packages). Sparse-checked `llm`, `plugin`, `protocol`, `opencode`, `desktop`,
`session-ui` — 1069 files, ~48 MB of the 471 MB repo.

**Scope caveat.** This is a targeted read of the provider/session layer, not a
full audit. I read the code; I did not run it. Everything below names the file
it came from so it can be checked.

They are a coding agent and we are a local-first chat app, so most of their
surface is irrelevant to us. The provider/session layer is not — it is the same
problem, and they have run it against far more providers than we have.

---

## Worth taking, in order

### 1. Prompt caching at three breakpoints, not one

- **Them:** `packages/llm/src/cache-policy.ts` — caching on by *default*, with
  breakpoints at the **last tool definition**, the **last system part**, and the
  **latest user message**.
- **Us:** `src/lib/providers/index.ts:449` — system prompt only, Anthropic only.
- **Why it matters:** the tool-definition breakpoint is the one we're missing
  most. Tool schemas are large, constant, and resent on every round of a tool
  loop. Their comment gives the arithmetic: a 5-minute cache write is 1.25x base
  and a read is 0.1x, so **one reuse inside five minutes already pays**.
- **Cost:** small. We already emit `cache_control`; this is placing two more
  markers.
- **Catch:** only `anthropic-messages` and `bedrock-converse` honour inline
  hints. OpenAI and Gemini cache implicitly, so the markers are inert there —
  which is what their `RESPECTS_INLINE_HINTS` set encodes.

### 2. Treat context overflow as its own failure, not a generic error

- **Them:** `packages/llm/src/provider-error.ts` — 29 regexes covering how each
  provider words "too long", plus **exclusions** so a throttle or rate-limit is
  never misread as overflow. Reacted to in
  `packages/opencode/src/provider/error.ts:175`, also keying on HTTP 413 and
  `context_length_exceeded`.
- **Us:** nothing. `isRetryableError` treats 400 as fatal, so an overflow ends
  the turn with a raw provider message.
- **Why it matters:** overflow is the one error with an obvious automatic fix —
  compact and retry. We already have `compactChat`; it just never gets called on
  this path.
- **Cost:** small-medium. The regex list is the expensive part and it is MIT.

### 3. Compaction that reacts, and that knows the real context window

- **Them:** budget derived from the model's usable context
  (`preserve_recent_tokens ?? clamp(usable * 0.25)`), plus **tool-output pruning**
  (`packages/opencode/src/session/compaction.ts:275`) — walk backwards, protect
  the most recent N tokens of tool output and a protected-tool list, erase older
  tool outputs. Cheap, and it targets what actually fills a context.
- **Us:** `src/lib/store.ts:1326` — `chars/4 > 8000`, a fixed threshold with no
  reference to the model, and **`autoCompact` defaults to `false`**
  (`src/lib/storage.ts:102`).
- **Why it matters:** three separate problems. The threshold ignores the model
  (8k is wrong for every model we ship). `chars/4` is a poor estimate. And the
  feature is off unless someone finds the switch.
- **Prune before summarise** is the good idea: summarising costs an LLM call and
  loses detail; dropping a stale `web_fetch` output costs nothing.

### 4. The model metadata is already in our app — in the wrong module

- **Them:** model facts come from **models.dev**
  (`packages/opencode/src/provider/model-status.ts`).
- **Us:** `src/lib/pricing/sources.ts:140` already parses `modalities`,
  `tool_call`, `reasoning`, `attachment` and `limit.context` from the same feed
  — and uses them **only for the Value tab's ranking**.
- **Why it matters:** this is embarrassing rather than hard. Today I wrote
  `src/lib/modality.ts`, which infers modality from **regexes on model ids**,
  while authoritative `modalities: {input, output}` for the same models was
  already being downloaded and parsed a few directories away. Same for context
  limits, which item 3 needs.
- **Fix:** layer it — models.dev when the model is known, regex fallback when it
  is not. Verified today that the fallback is still needed: Groq's
  `whisper-large-v3` is in models.dev with `input: ["audio"]`, but `playai-tts`
  and `llama-guard` are absent entirely.
- **Cost:** small. The parser exists; it needs a consumer outside pricing.

### 5. Honour `Retry-After`, and back off

- **Them:** `packages/llm/src/route/executor.ts:91-105, 345` — parses
  `retry-after-ms`, numeric `retry-after`, *and* the HTTP-date form; retries
  429/503/504/529 with exponential backoff and jitter, capped.
- **Us:** none. `streamChat` walks to the next key/provider immediately.
- **Why it matters:** this is the sharp edge on the round-robin I shipped today.
  On a 429 we burn every key in the pool within milliseconds, against a provider
  that just told us exactly how long to wait. That converts one rate-limited key
  into a whole exhausted pool.
- **Cost:** small, and it should probably land *before* anyone turns rotation on
  in anger.

### 6. Truncated tool output should be retrievable, not destroyed

- **Them:** `packages/opencode/src/tool/truncate.ts` — over 2000 lines or 50 kB,
  the full text is written to a truncation dir and the model gets a preview
  **plus the path**, so it can go and read the rest.
- **Us:** `src/lib/tools.ts` — `text.slice(0, 6000)` and the remainder is gone.
- **Why it matters:** our agent physically cannot see past 6 kB of a fetched
  page. No amount of prompting fixes it.
- **Cost:** medium — needs a scratch location and a cleanup policy (they retain
  7 days).

---

## Noted, not recommended

- **Native Gemini and OpenAI Responses protocols** (`packages/llm/src/protocols/`
  — six protocols vs our two). We route Gemini through the OpenAI-compatible
  shim, which costs us some native features. Real, but a large job for a narrow
  gain.
- **Tools we lack:** `lsp`, `apply_patch`, `task` (subagents), `question`,
  `skill`, `plan`, `todo`. These are coding-agent surface. `question` — the model
  asking the user a structured question mid-turn — is the one that would suit a
  chat app.
- **Effect-based architecture.** Their error handling is rigorous partly because
  Effect makes it so. Not a reason to rewrite.

---

## What we have that they don't

Worth stating, so this reads as a comparison and not a list of defeats:

- **Device mesh** (`src-tauri/src/mesh.rs`) — LAN discovery, pairing, encrypted
  bodies. Nothing equivalent.
- **Value / price intelligence** — we consume models.dev *pricing*, which they
  fetch but do not surface. Nobody in the category has the Value tab.
- **Local GGUF engine**, MTP, avatars, voice, media generation, the browser VM.

They are a coding agent for developers. We are a local-first chat app. The
overlap is exactly the provider/session layer above — which is why that is the
only part worth copying.

---

## Suggested order

1. **Retry-After + backoff** (5) — smallest, and it de-risks the rotation that
   just shipped.
2. **Cache breakpoints** (1) — smallest cost-per-benefit, pure win on tool loops.
3. **models.dev metadata into the chat path** (4) — unlocks 3, and retires the
   regex guessing in `modality.ts`.
4. **Overflow detection → compact and retry** (2 + 3).
5. **Retrievable tool output** (6) — largest, do last.
