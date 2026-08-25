# Changelog

All notable changes are recorded here. Versions follow [semantic versioning](https://semver.org).

## [Unreleased]

### Security
- **SVG code blocks can no longer execute.** A ```svg fence was injected into
  the DOM raw, and SVG carries `<script>`, event attributes and
  `<foreignObject>` — in a Tauri webview an XSS reaches every app command.
  Previews are now sealed into an `<img>` (data URL), which cannot run
  scripts, fire handlers, load external references or render foreignObject.
  Same picture, no attack surface, no sanitizer allowlist to maintain.
- **The browser-extension bridge authenticates both ways.** The WebSocket on
  127.0.0.1:8791 used to accept any connection and let it replace the real
  extension — and since WebSockets ignore CORS, any webpage could do it and
  feed the agent fabricated page contents. Connections are now refused unless
  the WebSocket Origin is a real extension origin *and* the client presents
  the bridge token (shown with a copy button in the Browser panel, pasted once
  into the extension's new options page).
- **The cloud-sync session token lives in the OS keychain**, not
  settings.json — same rule as provider keys. Existing sessions migrate on
  first use and the plaintext copy is scrubbed. (Blob confidentiality was
  never affected; the AES-GCM key was always vaulted.)
- **Community imports show what they'll run before installing.** Agents and
  setup templates now open a review dialog with their instruction text and
  tool grants — a published "agent" is arbitrary instructions plus tool
  permissions, and that deserves a look before it lands.
- **The loopback API now requires a bearer token, and wildcard CORS is gone.**
  Any webpage in any browser could previously POST to `127.0.0.1` and drive the
  app's models — spend tokens, read the model list, use it as a free proxy.
  The server now answers 401 to everything that doesn't present the token
  (`Authorization: Bearer` or `x-api-key`), which is minted once on first
  start, lives in settings.json, and is printed by `hs endpoint` and the
  Devices panel's paste-ready configs. **Existing external clients need the
  new token after updating.** CORS headers were removed entirely: real
  clients aren't browsers, and their absence is what stops a page from
  *reading* responses.
- **The fs tools' sandbox is real.** `resolve()` passed absolute paths
  straight through and never normalized `..`, so `read_file("C:/anywhere")`
  walked out of the working directory the README promised would confine it.
  Paths are now lexically normalized, canonicalized through their deepest
  existing ancestor (symlinks and `\\?\` prefixes included), and prefix-checked
  against the base; escapes are refused with the resolved path in the error.
- **MCP stdio spawn no longer chains shell commands.** Non-.exe commands went
  through `cmd /C` with raw arguments, so an imported config with an argument
  like `&calc` executed a second program. Arguments are now pre-quoted for
  cmd's parser (metacharacters stay literal), and commands containing quotes
  are refused.
- **Concurrent python tool calls no longer clobber each other.** The fixed
  temp filenames (`hs_pytool_run.py`) meant a swarm's parallel calls wrote
  over the same file mid-run; names are now unique per invocation.
- Stale comment in mesh.ts claimed mesh traffic "isn't encrypted yet" — it
  has been sealed with ChaCha20-Poly1305 since protocol v2; the comment now
  describes the actual residual exposure (metadata, no forward secrecy).
- **Deep links confirm before they change anything that matters.** A crafted
  `?system=…&key=…` link used to rewrite the chat's system prompt and install
  an attacker's API key on load, no questions asked — prompt injection by URL.
  Links now show every consequential change (system prompt, keys, new
  providers, trial redemptions) in a confirm dialog first; plain
  provider/model/style selection still applies silently.
- **The shared ui-kit package got the same SVG fix** as the app (its copy of
  the raw-DOM render survived the first patch).
- **Importing a custom tool asks first** — pasted JSON is untrusted, and a
  tool is arbitrary code running with the app's permissions once enabled.
- **Guardrail regexes run against a length-capped subject**, so a
  catastrophic-backtracking pattern pasted into Settings can stall a tool call
  but can't hang the app on huge tool arguments.

### Fixed
- Per-message cost in Battle/Collaborate chats was priced against the chat's
  model; participant messages now record the model that produced them and are
  priced accordingly.
- Toasts dismiss with Escape (clicking worked; keyboards didn't).
- Dead code removed in ContextMenu.

### Noted
- Cloud-sync PBKDF2 stays at 200k iterations for now: raising it invalidates
  every existing login AND decryption key simultaneously. Doing it safely
  means versioned KDF params server-side plus a re-encryption migration —
  documented in cloud.ts, scheduled, not forgotten.

### Added
- **CI exists.** The repo had no test workflow at all — only the release
  pipeline ran checks. New `ci.yml`: web tests + tsc on Ubuntu *and* Windows
  (the Windows leg would have caught the PowerShell/cmd-only bugs in this
  codebase's history), cargo tests + clippy `-D warnings` on Windows.
- **"Server default" temperature — the request can now carry no sampling at
  all.** New chats send no temperature field: a local llama.cpp/vLLM server's
  own sampler settings stand, instead of being silently overridden by a client
  constant. The config panel's temperature control gains a "Server default
  (send nothing)" checkbox; picking any number re-enables the slider. Existing
  chats keep their current value. Temperature 0 remains a real, sent choice.
- **ACP agents hosted in the chat (Option B).** Any agent from the ACP
  registry — Claude Code, Gemini CLI, Codex, 60+ more — runs inside
  HarnessStation: configure the command in Settings → ACP agents, run it in
  the new **ACP agents** view, and its streamed replies, tool-call status and
  permission requests surface in the transcript (permissions via the usual
  ask-first dialog). A Rust relay (`acp.rs`) shuttles newline-delimited
  JSON-RPC between the subprocess and the app; the protocol client
  (`lib/acp.ts`) owns id correlation and permission round-trips. Over time
  this retires the per-CLI wrappers — one protocol, every agent.
- **`hs-acp` — HarnessStation as an Agent Client Protocol agent.** The app's
  models, agents and combos appear in the agent picker of any ACP client
  (JetBrains 2026.2+, Zed, Devin Desktop). ACP launches `cli/acp.mjs` as a
  subprocess; prompts forward to the local API and replies stream back as
  `agent_message_chunk` frames, with cancellation, `max_tokens`, per-session
  history, and model selection at launch (`--model`/`--agent`/`--system`).
  Model-only by design — the editor's MCP servers are where tools come from.
- **The endpoint is now discoverable without the terminal.** Settings →
  Devices → Local API shows paste-ready, copy-button blocks for Claude Code
  and OpenAI-compatible tools (opencode, Aider, SDKs) while the server runs —
  the same output as `hs endpoint`, which previously was the only place it
  existed.
- **The first-run screen offers the subscription path.** "Already have Claude
  Pro or Copilot?" deep-links to Settings → Subscriptions, next to the
  existing key / provider / local-model options.
- **Connecting a subscription lands on a working model** — the current chat
  switches to the subscription provider and the toast says to send a message,
  instead of stranding you in Settings.
- **Smaller wayfinding**: My Models names subscription providers as
  subscriptions rather than "Key set"; the chat composer mentions the "/"
  prompt library; the sidebar search hints that meaning-based search needs an
  embeddings model.
- **Quota tracking from the provider's own 429s.** Every rate-limit response is
  recorded with its Retry-After; a success clears the record. My Models shows
  a "Limited · 3m" countdown badge on the affected provider, and combos try
  measured-exhausted steps last (reordered, never removed — when everything is
  limited your original order stands).
- **Subscription backends (Settings → Subscriptions).** Connect a Claude
  Pro/Max subscription (OAuth PKCE — approve in the browser, paste the code
  back) or GitHub Copilot (device flow) and it becomes a provider like any
  other: chat, voice, agents, combos, and anything pointed at the local API
  all use your existing subscription quota. Access and refresh tokens live in
  the OS keychain, never settings.json; refreshes are single-flight so a tool
  loop at token-expiry can't race the rotation. Claude speaks the Anthropic
  protocol with Bearer + OAuth beta headers; Copilot rides the
  OpenAI-compatible path with editor-identity headers. Codex/ChatGPT is not
  included — its endpoint speaks the Responses protocol. These flows identify
  as the official clients; providers tolerate that today and can change their
  terms — the panel says so where you connect.
- **Combos — fallback chains as one model.** Settings → Combos chains
  provider+model pairs into a named id (`combo/cheap-first`) that tries each
  step in order and moves on when one fails before replying — subscription,
  then cheap key, then free tier. Combos appear in every model picker, on the
  local API (both OpenAI and Anthropic protocols), and in Claude Code via
  `ANTHROPIC_MODEL=combo/cheap-first`. A chain never advances once text has
  started streaming, so a reply can't be duplicated or truncated.
- **Anthropic Messages endpoint on the local API** (`/v1/messages`) — Claude
  Code (or anything speaking anthropic-sdk) can now point `ANTHROPIC_BASE_URL`
  at HarnessStation and run any configured model, local GGUFs included.
  Streaming uses proper named-event frames; `count_tokens` is answered with a
  documented estimate; errors arrive in Anthropic's shape. `hs endpoint`
  prints the environment ready to paste.
- **Function calling on the local API** — OpenAI `tools` on
  `/v1/chat/completions` now pass through to the provider, and tool calls come
  back as `tool_calls` with `finish_reason` on both the streaming and
  non-streaming paths. Agents like opencode can drive HarnessStation's models
  with their own tools.
- **`hs chat` REPL** — a multi-turn interactive session with streaming replies
  and slash commands (`/new`, `/model`, `/agent`, `/system`, `/history`,
  `/exit`); Ctrl+C stops a reply without leaving. `hs endpoint` prints the
  base URL plus paste-ready configs for opencode-style tools and Claude Code.
- **Free tier surfaced** — Discover now leads with a "Free tier" section, and
  the Value tab gained a "Free only" filter over the feed's explicit free
  classifications.
- **Media generation as an MCP server** (`mcp-media/`) — a standalone,
  zero-dependency stdio server exposing `generate_image`, `generate_speech`,
  `generate_video` and `generate_3d` through the same four engines the app
  ships (OpenAI-compatible, A1111, Replicate). Point `MEDIA_CONFIG` at your
  `settings.json` and it reuses the models you already configured. Additive:
  the built-in tools stay until you switch. See `mcp-media/README.md`.
- **React artifacts in the canvas** — a ```jsx/```tsx block now compiles and
  runs in the sandboxed canvas instead of falling back to a code block.
  React ships from the app's own versions as a 189 kB IIFE inside the iframe;
  Babel transforms in the app (lazy ~2.7 MB chunk, loaded on first preview).
  Default-export a component (or name it Component/App/Demo) and it mounts;
  imports are limited to react/react-dom by design.
- **Avatar lip-sync and head tracking** — the VRM/MMD mouth now follows the
  measured loudness of the voice actually playing (WebAudio AnalyserNode on
  data-URL engines: Kokoro, Piper, WinRT data-URL, cloud), with the synthetic
  envelope kept for native SAPI where nothing is audible to analyse. The head
  eases toward the pointer, over the idle sway, on both rigs.
- **Prompt library** — type "/" at the start of the composer to insert a saved
  template or snippet; arrow keys navigate, Enter inserts, and "Save draft as
  snippet…" files the current draft away for reuse. Snippets and instruction
  templates share one store (`Template.kind`); ConfigPanel still applies
  instructions to the system prompt.
- **Semantic chat search** — behind the sidebar's substring fast path, chats
  that mean what you typed but don't say it now surface under "Semantic
  matches", ranked by embedding similarity. Uses the app's embeddings
  provider (Settings → Models); without one, search is substring-only exactly
  as before. Vectors cache per transcript in `conversations/vectors.json` so
  the embed cost is paid once per changed chat.
- **Value tab / price intelligence** — live prices for ~6,700 models plus VPS and
  GPU compute, read from providers' own published price lists. No key, no
  account; every row links to its source.
- **Multi-token prediction** for the local engine (`--spec-type draft-mtp`) —
  roughly 1.5-2x tokens/sec with no second model in memory. Off by default in
  Models -> Advanced; needs llama.cpp build 9200+ and a GGUF built with MTP
  heads, and is silently inert without them. Ships with
  `unsloth/Qwen3.6-27B-MTP-GGUF` in the staff picks.
- **Inline first-run key prompt** — a new user lands in the conversation instead
  of a chooser in front of a chooser.
- **Community library** — publish and import Skills, Agents, Workflows and
  Schedules; sort by trending / recommended / most-downloaded / newest; search,
  tag filters, and IP-based likes. Moderation: report → auto-hide, admin
  hide/restore/remove, per-IP publish limits, payload validation.
- **In-browser models (WebGPU / WebLLM)** on both web and desktop, with per-model
  download + progress.
- **Shareable setup links** (`?provider=&model=&style=&mode=`) and gateway
  **trial keys** (`?trial=CODE`) for zero-setup demos.
- **Secrets vault** — save API keys the model can use but never read.
- **Web voice** via the browser's built-in speech recognition (no model download).

### Changed
- **The transcript renders a window, not the whole history.** Opening a
  5,000-message chat used to build 5,000+ DOM subtrees; the page now renders
  the newest 200 with a "Show earlier messages" ramp at the top (scrolling to
  the top grows it automatically, and the reader stays anchored on the message
  they were reading). The autoscroll contract is untouched — the window only
  grows when the reader is at the top, where the follower already refuses to
  yank them down.
- **`npm run stress` now measures memory, not just throughput.** A new soak
  (`scripts/stress-memory.mjs`, STRESS-gated) prints the store layer's real
  footprint — 5,000 closed chats cost ~0.3 MB as stubs; hydrating one
  20,000-message transcript is per-chat and bounded — and samples the running
  app's own RSS, the `ps -o rss=` discipline: measure, don't assume.
- **Tool registry pruned to proper tools, in proper sections.** Removed three
  dumb tools: `calculate` (a one-line JS eval that taught models to outsource
  arithmetic and added an arbitrary-expression execution surface), `wikipedia`
  (a single-site wrapper over web_search + fetch_page), and `http_get` (its raw
  fetch role merged into `http_request`, which now also carries the
  offset-paging resume protocol http_get had). Sections fixed: `delete_path`
  joined the Coding agent set, `get_current_time` the Research set, media
  generation got its own set, and the MCP gateway tools are grouped under a new
  "MCP servers" section. A new meta-test files every user-facing built-in into
  at least one section, so orphans can't silently accumulate again.
- **House prompt sharpened against the leaked-prompt corpus** (asgeirtj/system_prompts_leaks):
  bans performative honesty ("Honestly?", "my blunt take") per ChatGPT's shipped
  rules; ambiguous requests now get a stated assumption and an answer instead of
  a clarifying question; tool-using models are told to find out with tools
  before asking; recalled memory now ships with guardrails — apply silently,
  never suppress honest feedback to honour a stored preference, never volunteer
  sensitive facts uninvited.
- New chats start with the built-in tools enabled.
- Flattened, professional UI (real icons, solid accent, no gradients).
- **Discover model catalog refreshed** against each provider's live docs. Several
  entries had gone past stale into broken: Groq's Llama 3.x / Qwen3-32B /
  Kimi-K2 endpoints and DeepSeek's `deepseek-chat` / `deepseek-reasoner` are
  retired and those ids now 404. Adds Qwen 3.8 27B to the local staff picks.
- **The catalog now checks itself.** `tests/catalog.live.test.ts` joins Discover's
  model ids to the live price feed and reports ids the feed has never heard of
  (`CATALOG_LIVE=1`). It found eight stale providers on its first run.

### Fixed
- **The Anthropic path no longer hides a 4096-token output cap.** With
  `max_tokens` unset it used to truncate long answers silently at 4096; it now
  derives the limit from the model's published maximum (models.dev /
  OpenRouter), falling back to 8192 for models without published facts. Your
  explicit max-tokens setting still wins.
- The release workflow decoded the Windows Authenticode certificate and then
  used nothing — signing silently never happened even with the secrets set. It
  now imports the .pfx into the runner's cert store and passes its thumbprint
  to the bundler via a `--config` override.
- `docs/freeze.md` claimed the entry chunk was ~6 MB (2.1 MB gzipped) and used
  that to justify freezing features. **The entry is 774 kB (241 kB gzipped)**;
  the 6 MB chunk is `web-llm`, which is lazy and was only named `index-*.js` by
  Rollup. The build now names it, so the log can't be misread the same way.

### Security
- **The device mesh now encrypts message bodies.** Both ends derive a
  per-connection key from the paired secret and the server's nonce, and seal the
  request and reply with ChaCha20-Poly1305. Previously the handshake was sound —
  the secret never crossed the wire — but bodies travelled as readable JSON, so
  anyone on the LAN could see which tools ran, with what arguments, and what came
  back. The token minted during pairing also went back in the clear; it is now
  sealed with everything else.

  Not a replacement for a tunnel, and the docs still say so: there is no forward
  secrecy (the key derives from a long-lived token), nothing authenticates the
  host, and call sizes and timings remain visible. Mesh protocol version is 2;
  a v1 peer gets "update both" rather than a silent plaintext downgrade.
- Replaced the compromised dev updater public key in `tauri.conf.json` with a
  placeholder so a build can't ship signed by the leaked key (see `SECURITY.md`).

## Project docs
- Licensed under **Apache-2.0** (`LICENSE`, `NOTICE`).
- Added `PRIVACY.md`, `TERMS.md`, `THIRD_PARTY.md`, `SECURITY.md`, and the
  `docs/launch-plan.md`.

---

*Release entries begin at v1.0.0. Until then, changes accumulate under
"Unreleased".*
