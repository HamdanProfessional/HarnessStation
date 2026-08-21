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


---

# Part 2 — system prompts and tool descriptions

The first pass looked at plumbing. This is the prompt layer, which is where the
larger gap actually is.

## The headline: we ship no base system prompt

- **Them:** `session/system.ts` always sends a base prompt, picked by model
  family — `anthropic.txt` (105 lines), `gpt.txt` (107), `gemini.txt` (155),
  `kimi.txt` (95), `codex.txt` (79), `beast.txt` (147 for gpt-4/o1/o3),
  `default.txt` (95) as the fallback. Selection is a chain of `model.api.id`
  checks.
- **Us:** `styles.ts:26` — `composeSystemPrompt` is `globalInstructions` +
  a style snippet + the per-chat prompt. **All three default to empty.** Out of
  the box our model receives no system prompt at all, only the appended notes
  (project / AGENTS.md / skills / memory / RAG / summary).
- **Consequence:** every behaviour opencode states explicitly — tone, when to
  use which tool, parallel tool calls, not inventing URLs, `file:line`
  references — we are leaving to whatever the model happens to do.

Their per-family split exists because the same instructions do not work on
every model; the Gemini prompt is 60% longer than the Anthropic one and far more
prescriptive. We do not need eight variants. We need one.

## No environment block

- **Them:** an `<env>` section on every request — working directory, workspace
  root, whether it is a git repo, platform, **today's date**, and
  `You are powered by the model named X`.
- **Us:** nothing. Grep for "Today's date" or "Platform:" across `src/lib`
  returns only unrelated hits.
- **Three live consequences:**
  - The model does not know today's date and will answer from its cutoff.
  - The model does not know the platform. `run_terminal` runs **PowerShell**,
    and nothing in the prompt says so — the description carries a hint, but the
    model has no general knowledge that it is on Windows.
  - We ship a `get_current_time` **tool**, which is a whole round-trip to learn
    something that costs one line of system prompt. That tool exists because the
    env block does not.

## Tool descriptions: one sentence vs. a usage contract

Compare `read`:

- **Them** (`tool/read.txt`, 14 lines): absolute paths, 2000-line default,
  `offset` for paging, "use grep for large files", "use glob if unsure of the
  path", the exact `<line>: <content>` return format, long-line truncation,
  **"call this tool in parallel when you know there are multiple files"**, and an
  explicit anti-pattern — *"avoid tiny repeated slices (30 line chunks); if you
  need more context, read a larger window."*
- **Us** (`tools.ts:224`): *"Reads a text file and returns its content
  (truncated to 8000 chars). Path is relative to the user's home folder."* No
  paging — so a file over 8000 chars is simply unreadable past that point, and
  nothing tells the model to narrow with grep instead.

We have 36 tools. Their descriptions are held in `.txt` files beside the code,
which is why they can afford to be long; ours are string literals inside
`tools.ts`, which is why they are short.

## No tool-usage policy at all

Their `# Tool usage policy` section, none of which we have an equivalent of:

- Call independent tools **in parallel** in one response; call dependent ones
  sequentially; never guess a missing parameter. (We say nothing about
  parallelism anywhere — grep confirms zero hits.)
- Prefer the specialised tool over the shell — `read` not `cat`, `edit` not
  `sed`, `write` not a heredoc. We have both `read_file` and `run_terminal` and
  never say which to reach for.
- Never use a shell command to talk to the user.
- Delegate broad exploration to a subagent to save context. We have
  `swarm_spawn`; nothing tells the model when to use it.

Also worth stealing, both a single line each:

- **`file_path:line_number` for code references**, so the UI can make them
  clickable.
- **Professional objectivity** — a paragraph instructing the model to disagree
  when warranted rather than validate. Applies to a chat app more than to a
  coding agent.

## Tools they have that change behaviour

- **`question`** (`tool/question.txt`) — the model asks the user a structured
  multiple-choice question mid-turn. The one tool here that most suits a chat
  app, and we have no equivalent.
- **`todowrite`** — the largest tool prompt they have (44 lines), and the base
  prompt pushes it hard. Visible progress on long tasks.
- **`plan`** — an explicit read-only mode with its own prompt and a reminder
  injected per turn.

## Suggested order

1. **Env block** — one function, four facts, fixes the date and platform
   problems immediately and makes `get_current_time` redundant.
2. **A real base prompt** — one file, not eight. Tone, objectivity, tool-usage
   policy, `file:line` references.
3. **Rewrite the top ~8 tool descriptions** as usage contracts, starting with
   `read_file` (add paging), `run_terminal` and `web_search`.
4. **Parallel tool-call instruction** — one paragraph, applies to all 36 tools.
5. **`question` tool** — new capability, worth its own decision.

Nothing above is a port. Their prompts are MIT and written for a coding CLI;
the content that transfers is the *structure*, not the text.
