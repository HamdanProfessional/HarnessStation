---
title: The web version
description: Run HarnessStation in a browser tab — the same app, no install — and what changes there.
---

# The web version

HarnessStation also runs as a **web app in a browser tab** — the same interface
as the desktop build, with no install. Try it at
[hsapp.retris.io](https://hsapp.retris.io).

It's the exact same `src/` codebase; only the seam to the operating system
differs. On desktop that seam talks to a Rust backend; on the web it's replaced
by browser implementations, so a feature built for the desktop UI appears here
for free.

## What works in the tab

- **Chat** with any cloud provider using your own key, and **share links** that
  open the app already configured (`?provider=…&model=…`). A few providers that
  block direct browser calls (e.g. Ollama Cloud) are relayed through the gateway —
  see [Keys and privacy](#keys-and-privacy).
- **[In-browser models](../models/in-browser)** on WebGPU — no key, no server.
- **Voice** — speech-to-text uses the browser's built-in recognition (Chrome/Edge)
  so there's no model to download; replies use local neural voices or the
  browser's speech synthesis.
- **A sandboxed workspace** in the browser's private file system, a **coreutils
  shell**, **Python** (via Pyodide), and even a **real Linux VM** booted in the
  tab (v86) — all client-side.

## What needs the desktop app

Some things depend on the operating system and aren't available in a tab. When
you hit one, the app says so and points you to the desktop download rather than
failing silently:

- **Full local models** (llama.cpp / any GGUF) — a hosted page can't reach a
  local server, and browsers cap in-tab models to small ones.
- **The device mesh** — it links machines over your network.
- **stdio MCP servers** and the **native in-app browser**.

## Keys and privacy

Your keys are kept in the browser's local storage (a weaker boundary than the
desktop keychain — the app says so in the UI) and are sent only to the provider
they belong to.

**One exception, on the web build only:** some providers' APIs don't send the
CORS headers a browser requires (Ollama Cloud, notably), so a tab can't reach
them directly. For those, the request is relayed through the HarnessStation
gateway, which adds the headers and streams the reply back — so your key and
prompt transit the gateway for that one provider (never stored or logged, and
forwarded only to an allowlist of real provider hosts). Providers that do send
CORS (OpenAI, Groq, OpenRouter, Gemini, …) are always called directly, and the
**desktop app never relays** — it calls every provider natively. See
[Privacy & security](privacy).

## Running it yourself

The web build is static. For development, `npm run web:dev`; to build, `npm run
web:build`. See the repository for details.
