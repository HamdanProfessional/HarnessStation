# HarnessStation

**Your AI chat. Your machine. Your keys.**

Local-first. No account. No telemetry. Your keys stay in your OS keychain. Your
chats never leave your machine.

A serious AI chat app for people who'd rather their conversations weren't on
someone else's server. You bring the model — a local one through Ollama or
LM Studio, or a cloud one through your own API key — and the app gives it real
tools: your files, a terminal, the web, a browser it can drive, knowledge, memory
and a voice you can talk to.

Windows and Linux, with a browser build that needs no install at all. **Ships
with no API keys of its own.**

Built with Tauri v2, React 19 and TypeScript, with a Rust backend.

---

## What it does

**Conversations** — streaming chat with markdown, branching, editing, snapshots,
folders, and automatic compaction so long chats don't run out of context.
Projects group chats that share a brief, documents and memory.

**Tools** — files, terminal, web, browser control, media generation, and your own
scripts in JavaScript or Python. Every tool is off until you enable it, and file
access is confined to a working directory you choose.

**Knowledge** — index documents and the model searches them semantically, so it
answers from your material rather than from what it half-remembers.

**Memory** — facts persist across conversations in three scopes (chat, project,
global), capped at a fifth of the model's context window so recall never crowds
out the conversation.

**Voice** — talk to it. Whisper for speech recognition and Kokoro for synthesis,
both running locally; cloud engines (OpenAI, ElevenLabs, Cartesia, Groq) when
quality matters most. Optional 3D VRM or MMD avatar.

**Browser control** — a real browser embedded in the conversation that the model
can read and click, or an extension that drives the Chrome you already use, with
the sessions you're already signed into.

**Automation** — save a role as an agent, chain steps into a workflow, run either
on a schedule, or put several agents on one job at once.

**MCP** — connect Model Context Protocol servers over stdio or HTTP. Tools are
disclosed progressively, so connecting ten servers costs the same startup context
as connecting one.

**Device mesh** — pair the machines you own so they can share models, tools and
knowledge. Discovery over the LAN, pairing by a code that never crosses the wire.

**Models** — any OpenAI-compatible endpoint plus Anthropic. Connect a
subscription you already pay for (Claude Pro/Max, GitHub Copilot) as a backend,
chain providers into combos that fail over on their own, and see which ones
are rate-limiting you before you wonder why replies got slow. Compare models
side by side, score them against your own eval set, and check public
benchmarks before paying for one.

**Open API** — the app is also a server: an OpenAI- and Anthropic-compatible
endpoint on loopback, so Claude Code, opencode, Aider or any SDK can drive
your models, agents and combos — local ones included. `hs endpoint` prints
the configs; Settings → Devices shows them with copy buttons.

**Value** — live prices for ~6,600 AI models, plus VPS and GPU compute, read
straight from the providers' own public price lists. No key and no account: these
are published numbers, and every row links to the page it came from. Ranks on
what a workload would actually cost — cache reads, cache writes, batch discounts,
long-context tiers and rate-limit feasibility, not the sticker price.

## Documentation

Full documentation lives in [`docs-site/`](docs-site/) — 40 pages including
end-to-end walkthroughs for real jobs: working with a codebase, research,
automating a recurring report, document processing, web scraping.

```bash
npm run docs:dev       # http://localhost:5174
npm run docs:build     # static site → docs-site/dist
```

Start with [what this is](docs-site/content/index.md),
[your first chat](docs-site/content/start/first-chat.md), or the
[use cases](docs-site/content/use-cases/overview.md).

## Running it

Prerequisites: [Node.js](https://nodejs.org) 18+, [Rust](https://rustup.rs), and
a C++ toolchain — VS 2022 Build Tools with the C++ workload on Windows,
`build-essential` on Linux.

```bash
npm install
npm run tauri dev      # run the app
npm run tauri build    # produce an installer
```

The first Rust build compiles several hundred crates and takes a few minutes.
Later builds are incremental.

```bash
npm test               # 699 tests
npx tsc --noEmit       # type-check app and docs site

# Price feeds change upstream; this checks the adapters against the real APIs.
PRICING_LIVE=1 npx vitest run tests/pricing.live.test.ts
```

## Where your data lives

One folder, plain JSON, no database:

```text
~/.harnessx/
├── settings.json      # providers (no keys), instructions, preferences
├── conversations/     # one JSON file per chat, plus an index
├── presets/           # saved prompt + parameter combinations
├── snapshots/         # chat snapshots
├── agent-memory/      # per-agent memory
├── avatars/           # imported VRM / MMD characters
├── models/            # models downloaded through the app
└── engines/           # Whisper, Piper
```

**API keys are not in there.** They go in your OS credential store — Windows
Credential Manager, or Secret Service on Linux.

## What leaves your machine

Worth stating plainly, because "AI app" usually implies otherwise.

Your prompts, files and documents go to the model provider **you** chose, and
nowhere else. With a local model they don't leave at all. There is no account, no
telemetry, and no server holding your conversations.

The one exception is public benchmark data, fetched through the gateway in
[`server/`](server/) so the Benchmarks panel isn't empty. It carries no key of
yours and no data about you — it's public information about models.

Provider keys, media keys and MCP credentials are deliberately **not** routed
through that gateway. They're yours, they stay on your machine, and they go only
to the service they belong to.

## Repository layout

| | |
| --- | --- |
| `src/` | React frontend — views, state, provider clients, tool implementations |
| `src-tauri/` | Rust backend — audio capture, MCP, browser bridge, mesh, keychain, speech |
| `extension/` | Chrome MV3 extension for driving the user's own browser |
| `server/` | Gateway for shared benchmark data (optional; not needed to run the app) |
| `docs-site/` | Public documentation — markdown plus a small React renderer |
| `docs/` | Internal planning notes and release process |
| `tests/` | Vitest suite |

## Status

Early software, used daily, with rough edges — the documentation says where they
are rather than glossing over them. Two worth knowing before deploying it widely:

- **Not code-signed.** Windows shows an unsigned-application warning on first
  launch.
- **The device mesh is not encrypted yet.** The handshake protects credentials
  and blocks replay, but request bodies are plaintext. Fine on your own network;
  across the internet, put it inside a VPN or tunnel.

See [`docs/roadmap.md`](docs/roadmap.md) for what's planned.
