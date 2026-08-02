# HarnessStation on the web

A browser build of the app that reuses the **entire** desktop `src/` tree. There
is no forked UI — the same React code runs in both, and a feature added to the
desktop appears here for free.

```bash
npm run web:dev        # http://localhost:5175
npm run web:build      # static site -> web/dist
npm run web:preview
```

## How it works

The desktop app talks to a Rust backend through five `@tauri-apps/*` module
imports. The web build aliases each of those to a browser shim in `web/shims/`,
so the same call that reaches Rust on the desktop reaches a browser API here:

| Import | Desktop | Web shim |
| --- | --- | --- |
| `api/core` (`invoke`) | Rust commands | `core.ts` — a dispatcher; a command is implemented or fails honestly |
| `plugin-fs` | files under `~/.harnessx` | `fs.ts` — the Origin Private File System |
| `plugin-http` | CORS-free Rust HTTP | `http.ts` — native `fetch` (so CORS applies) |
| `api/event` | Rust event bus | `event.ts` — a local no-op bus |
| `plugin-opener` | OS open | `opener.ts` — `window.open` |
| `plugin-updater/process` | installer self-update | `updater.ts` — reload the page |

## What works, and what can't

Runs in the browser: chat, all the views, settings and conversation history
(persisted to OPFS), memory, knowledge, and Kokoro voice (already WASM).

Cannot run in a browser tab, by the nature of the platform:

- **Files and terminal** — no filesystem or process access. Planned via an
  in-browser VM (WebVM/WebContainers) loaded into the user's own memory, so it
  stays client-side.
- **Local models** — an https page can't reach `http://localhost` (mixed
  content). Use a CORS-enabled or hosted endpoint.
- **stdio MCP, device mesh, native in-app browser** — need a real process.
- **Provider CORS** — a provider that doesn't send CORS headers can't be called
  directly from the browser and needs a proxy.

Those surface in the UI as ordinary "not available" errors rather than crashes.

## Adding a browser backend for a command

As subsystems land (mic, STT, the VM), register the command in `core.ts`:

```ts
registerCommand("mic_start", async (args) => { /* getUserMedia … */ });
```

No change to the app code — it keeps calling `invoke("mic_start")`.
