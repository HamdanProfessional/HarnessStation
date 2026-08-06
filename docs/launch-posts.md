# Launch posts

*Drafts for the launch. Written 2026-08-06. Adjust the links once the domain and
the first GitHub release exist. Post in a staggered order — be present to answer
each thread. Lead with the honest, concrete pitch; this audience smells hype.*

Placeholders to fill before posting:
- `LANDING` → the marketing site (temporary preview: `https://hsdocs.retris.io/preview/`)
- `WEBAPP` → `https://hsapp.retris.io`
- `DOCS` → `https://hsdocs.retris.io`
- `RELEASE` → the GitHub releases page (once v0.x is cut)

---

## Show HN

**Title:** Show HN: HarnessStation – run any AI model as a private, local agent

Hi HN. HarnessStation is a desktop app (Windows/Linux, plus a browser build) for
running AI models as agents — with real tools, your files, a terminal, a browser,
voice, knowledge and memory. You bring the model: a local one via Ollama/LM Studio
or in-browser WebGPU, or a cloud model with your own key. No account, no telemetry,
no cloud sync — keys live in your OS keychain, data in `~/.harnessx`.

A few things that might interest this crowd:

- **One React tree, desktop and web.** The desktop app talks to a Rust backend
  through five `@tauri-apps/*` imports; the web build aliases each to a browser
  shim (`web/shims/*`). Same `src/` tree, no forked UI — a feature added once
  appears in both.
- **A real Linux VM in a browser tab.** The web build boots a Buildroot/BusyBox
  kernel client-side via v86 (x86→WASM), with a 9p bridge so files the model's
  tools create and files a Linux command creates are literally the same files.
- **Local models, tuned.** Download a GGUF and run it through a supervised
  llama-server with the flags that matter (`--n-cpu-moe`, `--flash-attn`,
  `--fit-target`…), or run a small model on WebGPU in the tab.
- **Agents, workflows, schedules, MCP, a device mesh, a community library**, and
  guardrails that can deny a tool call by matching its arguments (e.g. block
  `rm -rf`). You can even reach the agent from Telegram/Discord.

It's early software and says so; there's no code-signing cert yet, so Windows will
show a SmartScreen prompt. Apache-2.0. Try it in the browser (no install):
`WEBAPP`. Docs: `DOCS`. Download: `RELEASE`.

Happy to answer anything about the architecture or the trade-offs.

---

## r/LocalLLaMA

**Title:** I built a local-first agent harness — bring your own model (Ollama /
llama.cpp / WebGPU / any cloud key), private by default [Apache-2.0]

HarnessStation runs AI models as agents on your own machine. The whole point is
that *you* bring the model and nothing phones home:

- **Local models**: point it at Ollama or LM Studio, or download a GGUF and run it
  through a supervised llama.cpp with real flag tuning (`--n-cpu-moe` to keep a
  big MoE's experts in RAM while attention stays on the GPU, `--flash-attn`,
  `--mlock`, `--fit-target`, …). There's a "will it fit" readout tied to your
  detected RAM/VRAM.
- **In-browser models**: run a small model on WebGPU right in the tab — no key, no
  server, cached after the first download.
- **Cloud, your key**: OpenAI/Anthropic/Groq/OpenRouter/… with automatic failover
  across backup providers and key rotation.

On top of the model it gives you tools (files, terminal, web, a real browser),
knowledge/RAG with **local** embeddings, memory, agents, workflows, schedules,
MCP servers, and a device mesh to pool your own machines. Privacy is the design:
no account, no telemetry, keys in the OS keychain, data in a plain `~/.harnessx`
folder you can read.

Desktop (Windows/Linux) and a browser build you can try with zero install:
`WEBAPP`. Source is Apache-2.0. Feedback very welcome — especially on the local
model UX.

---

## Product Hunt (tagline + first comment)

**Tagline:** Run any AI model as a private, local agent — bring your own key.

**First comment:** HarnessStation turns a model — local or your own cloud key —
into an agent that can actually do things: read your files, run commands, browse
the web, talk to you, remember, and run on a schedule. No account, no telemetry,
private by default. It's the same app on the desktop and in a browser tab (which
even boots a real Linux VM client-side). Open source, Apache-2.0. Try it: `WEBAPP`.

---

## X / short

Run any AI model as a private, local agent.

Bring your own model — Ollama, llama.cpp, in-browser WebGPU, or your own cloud
key. Tools, files, a terminal, a browser, voice, memory, agents, schedules. No
account, no telemetry. Open source.

Try it in the browser (no install): `WEBAPP`
