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

### Test suite

`npm test` runs Vitest over `tests/` — 283 specs covering the pure logic plus the store's streaming
path, tool loop, lazy-hydration invariants, the agent loop, the memory store and the voice stack. It exists because a correctness sweep on 2026-07-31
found several live bugs, including a `chunkText` infinite loop that hung any knowledge-base import
over 200 characters, and streaming writes that landed in whichever chat was on screen. Add cover
alongside new logic; `.github/workflows/ci.yml` gates every push and PR.

### Note on the chat index

`~/.harnessx/conversations/index.json` is a **cache**, never the source of truth. It is rebuilt
automatically whenever it's missing, corrupt, or disagrees with the files on disk. Deleting it is
always safe. The invariant that matters: a chat whose transcript has not been loaded is never
written back — see `hydratedIds` in `store.ts`.

---

## Tier 1 — Release readiness (needs you, not code)

Both remaining items need secrets that can't live in the repo. `.github/workflows/release.yml` is
wired and waiting for them.

### 1.1 Code-signing certificate — **S** (mostly procurement)
**What:** Sign the installer with a real Windows code-signing cert.
**Why:** The only thing between the current build and a clean install for other people — unsigned
installers hit SmartScreen.
**Approach:** Buy an OV/EV cert, then set the `WINDOWS_CERTIFICATE` (base64 `.pfx`) and
`WINDOWS_CERTIFICATE_PASSWORD` repository secrets. The workflow picks them up automatically.

### 1.2 Rotate the updater keypair — **S**
**What:** Replace the throwaway dev keypair (documented in `docs/release.md`, password `harnessdev`)
and update `plugins.updater.pubkey`.
**Why:** Anyone holding that key can push an update to every installed copy.

---

## Tier 2 — Features

### 2.1 Avatar polish — **S/M**
**What:** The VRM avatar animates from the voice state and mic level. Two things would lift it:
real viseme lip-sync (analyse the played audio with a WebAudio `AnalyserNode` instead of the
synthetic envelope — only possible on the data-URL engines, not Windows SAPI), and mouse/camera
head tracking.

### 2.2 React artifacts in the canvas — **M**
**What:** The canvas renders HTML, SVG and Mermaid. JSX/React components still fall back to a code
block.
**Why deferred:** Doing it offline and sandboxed means shipping `@babel/standalone` (~2.7 MB) plus
the React UMD builds inlined into the iframe document. Both would be lazy chunks, so startup is
unaffected, but it's a real weight increase for a narrow feature — worth deciding deliberately.
**Approach:** Detect ```jsx/```tsx blocks; inline `react`/`react-dom` UMD via `?raw` into the
existing sandboxed iframe and transpile the component with Babel before injecting it.

### 2.3 Prompt library / reusable snippets — **S/M**
**What:** Presets cover parameters; there's no quick insert for frequently reused prompt text.
**Approach:** Extend Templates with a `/`-triggered picker in the composer.

### 2.4 Conversation search across all chats — **S/M**
**What:** Sidebar search matches titles and content by substring; no ranking, no filters.
**Approach:** Reuse the embedding stack for semantic search over chat history, with the substring
match as the fast path.

---

## Cross-cutting
- Keep `docs/` current: update `PLAN.md` and this file as work lands.
- Anything with real logic gets a test in `tests/` in the same change.
