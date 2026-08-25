# HarnessStation — Roadmap

> Rewritten 2026-07-31. The original Phases 4+ roadmap (planned 2026-07-19) is essentially
> **complete** — every tier had shipped except auto chat titles, which landed with this revision.
> What follows is the current state and the work that's actually left.
>
> Effort key: **S** ≈ half day · **M** ≈ 1–2 days · **L** ≈ 3–5 days.

## Guiding principles
- Keep the single-root data model (`%USERPROFILE%\.harnessx\`) and plain-JSON storage.
- Frontend features hot-reload; anything touching `src-tauri` needs a rebuild.
- Every feature stays opt-in and discoverable from the existing views — no new top-level clutter
  unless it earns a sidebar slot.

---

## Shipped

Everything below is in the tree and working.

| Item | Where |
| --- | --- |
| Installer + self-update | `tauri.conf.json`, `lib/updater.ts`, `docs/release.md` |
| API keys in the OS keychain | `src-tauri/src/secret.rs` |
| MCP auto-reconnect on startup | `store.autoConnectMcp`, `App.tsx` |
| MCP OAuth (PKCE + dynamic registration) | `src-tauri/src/oauth.rs` |
| Cost & token tracking, spend caps | `lib/budget.ts`, `lib/cost.ts` |
| Reasoning / thinking channel | `providers/index.ts`, inline `<think>` splitter |
| Auto chat titles | `store.maybeAutoTitle`, Settings → Conversation |
| Chat organization (pins, folders, search) | `Sidebar.tsx`, `Chat.pinned` / `Chat.folder` |
| Text-to-speech (Windows SAPI + Piper) | `lib/tts.ts`, `lib/piper.ts`, `lib/sysvoice.ts` |
| Evals with LLM judge | `EvalsView.tsx`, `lib/evals.ts` |
| Native mic capture (cpal) | `src-tauri/src/audio.rs` |
| Media generation (image/audio/video/3d) | `lib/media.ts` |
| Agent memory + passive memory | `lib/memory.ts` |
| Global hotkey / quick entry | `tauri-plugin-global-shortcut`, `App.tsx` |
| Command palette (Ctrl+K) | `CommandPalette.tsx` |
| Notification history | `NotificationBell.tsx` |
| Mermaid + HTML canvas | `Mermaid.tsx`, `Canvas.tsx` |
| Long-chat compaction | `store.compactChat` |
| Lazy transcripts (metadata index + hydrate on open) | `storage.loadChatIndex`, `store.hydrateChat` |
| SVG artifacts in the canvas | `lib/attach.ts` `extractArtifact`, `Canvas.tsx` |
| CI + tagged release pipeline | `.github/workflows/` |
| Projects + three-tier memory | `lib/memoryScopes.ts`, `Project` in types |
| Memory budgeted to the context window | `lib/contextBudget.ts` |
| Progressive MCP disclosure (4 tools, any number of servers) | `lib/mcpGateway.ts` |
| Browser control via a real-browser extension | `extension/`, `src-tauri/src/browser.rs`, `lib/browserTools.ts` |
| Voice chats: save, resume, compact | `voice.ts` (`openChat`/`persist`), `Chat.kind = "voice"` |
| Neural voice preferred on "auto" | `lib/tts.ts`, `lib/piper.ts` |
| VRM avatar (VTuber models) | `VrmAvatar.tsx`, `storage.listAvatars` |
| Skills (progressive disclosure) | `lib/skills.ts` |
| Swarm coordination between agents | `lib/swarm.ts` |
| Value / price intelligence (~6,700 models, VPS, GPU) | `lib/pricing/`, `ValueTab.tsx` |
| Inline first-run key prompt (replaces the onboarding modal) | `FirstRunKey.tsx`, `ChatWindow` empty state |
| Multi-token prediction for the local engine (`--spec-type draft-mtp`) | `src-tauri/src/local.rs` `LaunchOpts`, Models → Advanced |
| Discover catalog checked against the live price feed | `catalog.PRICE_SLUG`, `tests/catalog.live.test.ts` |
| Prompt library — "/" in the composer inserts a saved template/snippet | `lib/snippets.ts`, `SnippetPicker.tsx`, `Template.kind = "snippet"` |
| Semantic search across chats behind the sidebar's substring fast path | `lib/chatSearch.ts`, `Sidebar.tsx`, vector cache in `conversations/vectors.json` |
| Avatar lip-sync from measured speech loudness + pointer head tracking | `lib/loudness.ts`, `lib/pointerTrack.ts`, `avatarMotion.update` inputs, both avatar rigs |
| React artifacts in the canvas (JSX/TSX compile + run sandboxed) | `lib/reactArtifact.ts`, `Canvas.tsx`, runtime bundle via `scripts/build-react-runtime.mjs` |
| Media generation as an MCP satellite (`mcp-media/`, additive — built-ins unchanged) | `mcp-media/lib.mjs` + `index.mjs`, tests in `tests/mediaServer.test.ts` |
| Production builds verified (entry 809 kB / 254 kB gzip; Babel + React runtime lazy) | `npm run build`, `npm run web:build` |
| Stress suites for the headless services | `scripts/stress-media.mjs`, `scripts/stress-gateway.mjs`, `tests/searchScale.test.ts` (`STRESS=1`) |
| Function calling on the local API — OpenAI `tools` pass through to the provider | `localApi.ts` `toolsFromOpenai`, tool_calls on both completion paths |
| Anthropic Messages endpoint (`/v1/messages`, stream + count_tokens) — Claude Code can point `ANTHROPIC_BASE_URL` at any model here | `localapi.rs` `SseStyle` framing, `localApi.ts` anthropic translation |
| `hs chat` REPL (multi-turn, slash commands) and `hs endpoint` (paste-ready OpenAI + Claude Code configs) | `cli/hs.mjs`, `cli/lib.mjs` |
| Free tier first in Discover, and a "Free only" filter in the Value tab | `DiscoverView.tsx`, `catalog.ts` `requireFree` |
| Combos — named provider+model chains usable as `combo/<slug>` model ids everywhere (chat picker, local API, Claude Code) | `types.ts` `Combo`, `providers/index.ts` `streamChain`, `localApi.ts` `comboStepsFor`, Settings → Combos |
| Subscription backends — Claude Pro/Max (PKCE) and GitHub Copilot (device flow) as providers, tokens in the OS keychain, brokered at call time | `lib/oauthProviders.ts`, `Provider.auth`, Settings → Subscriptions |
| Quota tracking from the provider's own 429s — "Limited · 3m" badge on My Models, combos try measured-exhausted steps last | `lib/quota.ts`, `streamChain` reorder, `ModelsView` badge |

### Test suite

`npm test` runs Vitest over `tests/` — ~1,200 specs covering the pure logic plus the store's streaming
path, tool loop, lazy-hydration invariants, the agent loop, the memory store, the pricing stack and
the voice stack. It exists because a correctness sweep on 2026-07-31
found several live bugs, including a `chunkText` infinite loop that hung any knowledge-base import
over 200 characters, and streaming writes that landed in whichever chat was on screen. Add cover
alongside new logic; `.github/workflows/ci.yml` gates every push and PR.

Two suites are opt-in because they call third parties, and a build shouldn't break when someone
else has a bad afternoon:

```bash
PRICING_LIVE=1 npx vitest run tests/pricing.live.test.ts   # upstream price schemas still parse
CATALOG_LIVE=1 npx vitest run tests/catalog.live.test.ts   # Discover's model ids still exist
```

The second is worth running before any release. Provider model ids are retired without notice, and
a dead id in `CLOUD_PROVIDERS` doesn't look stale to a user — it 404s the first time they pick it.

The Rust side has its own: `cd src-tauri && cargo test --lib launch_tests` covers the llama-server
flag translation, where a wrong flag name silently changes nothing rather than erroring.

Two more opt-in suites exist for load, not correctness:

```bash
npm run stress                                   # mcp-media + gateway under concurrency, floods, rate limits
STRESS=1 npx vitest run tests/searchScale.test.ts  # semantic search over 3,000 synthetic chats
```

### Note on the chat index

`~/.harnessx/conversations/index.json` is a **cache**, never the source of truth. It is rebuilt
automatically whenever it's missing, corrupt, or disagrees with the files on disk. Deleting it is
always safe. The invariant that matters: a chat whose transcript has not been loaded is never
written back — see `hydratedIds` in `store.ts`.

---

## Tier 1 — Release readiness

### 1.1 Code-signing certificate — **S** (mostly procurement)
**What:** Sign the installer with a real Windows code-signing cert.
**Why:** The only thing between the current build and a clean install for other people — unsigned
installers hit SmartScreen.
**State:** the pipeline is complete as of 2026-08-23 — `release.yml` imports the `.pfx` secret into
the runner's cert store and passes its thumbprint to the bundler (`--config win-sign.json`);
previously it decoded the certificate and then used nothing. What remains is procurement only:
buy an OV/EV cert, set the `WINDOWS_CERTIFICATE` (base64 `.pfx`) and
`WINDOWS_CERTIFICATE_PASSWORD` repository secrets, and the workflow signs without further changes.

### 1.2 Rotate the updater keypair — **DONE** (commit `1ccaf4e`)
A fresh minisign keypair replaced the compromised dev key; its public key is in
`tauri.conf.json → plugins.updater.pubkey`, the private key lives outside the repo, and the
`TAURI_SIGNING_PRIVATE_KEY*` secrets sign releases. See `docs/release.md`.

---

## Cross-cutting
- Keep `docs/` current: update `PLAN.md` and this file as work lands.
- Anything with real logic gets a test in `tests/` in the same change.
