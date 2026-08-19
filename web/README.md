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

Runs in the browser, and verified end-to-end:

- **Chat** — streamed replies render token-by-token (native fetch + the app's
  SSE parser), against any CORS-enabled provider. Proven with a mock provider.
- **Voice input** — getUserMedia capture (`mic.ts`) → 16 kHz WAV in OPFS →
  transformers.js Whisper (`whisper.ts`), reusing the desktop's record-then-
  transcribe-a-file flow.
- **Voice output** — Kokoro (already WASM), cloud engines, or the browser's own
  SpeechSynthesis voices (`speak.ts`) as the system-voice equivalent.
- **Storage** — settings, conversations and presets persist to OPFS; keys go in
  a browser secret store (`secret.ts`).
- Plus all the views, memory and knowledge.

Runs client-side via an in-browser VM — no server, loaded into the user's own
memory, over one sandboxed OPFS workspace:

- **Files** — the file tools operate on a persistent workspace in OPFS
  (`vfs.ts`), sandboxed so a path can't escape into the app's own data.
- **Python** — real CPython via Pyodide (`pyodide.ts`), loaded from CDN on first
  use.
- **Terminal** — a coreutils subset (`shell.ts`): ls, cat, echo, grep, pipes,
  redirection, `&&`/`;`, cd — over the same workspace. Fast to start, and enough
  for most file work.
- **Full Linux** — a real kernel boots client-side in WebAssembly via v86
  (`vm.ts`, kernel and BIOS images in `public/vm/`), behind the same seam as the
  coreutils shell. Nothing is uploaded and no server is involved: the VM runs in
  the user's own tab.

Still genuinely can't run in a browser tab:

- **Local models** — an https page can't reach `http://localhost` (mixed
  content). Use a CORS-enabled or hosted endpoint.
- **stdio MCP, device mesh, native in-app browser** — need a real OS process.
- **Provider CORS** — a provider that doesn't send CORS headers needs a proxy.

Those surface in the UI as ordinary "not available" errors rather than crashes.

## Adding a browser backend for a command

As subsystems land (mic, STT, the VM), register the command in `core.ts`:

```ts
registerCommand("mic_start", async (args) => { /* getUserMedia … */ });
```

No change to the app code — it keeps calling `invoke("mic_start")`.
