# HarnessStation gateway

Holds the keys for the **shared** services the app uses on everyone's behalf, so
they are never shipped inside the desktop binary.

| Route | Serves | Needs a key |
| --- | --- | --- |
| `GET /api/benchmarks` | Artificial Analysis model benchmarks | yes — `AA_API_KEY` |
| `GET /api/hf/search?q=` | Hugging Face GGUF search | no |
| `GET /api/hf/files?repo=` | files in a HF repo | no |
| `GET /api/mcp/directory` | curated MCP server list | no |
| `GET /api/health` | cache ages and last errors | no |

## What does *not* belong here

Never route these through the gateway:

- **AI provider keys** — OpenAI, Anthropic, Groq, Ollama, LM Studio, OpenRouter…
- **Media generation keys** — image, TTS, video
- **MCP credentials** and OAuth tokens

Those are the user's own. They stay on the user's machine and are sent only to
the service they belong to. Putting them here would turn this into a chokepoint
for other people's secrets, which is the opposite of why it exists.

## Run it

```bash
cd server
cp .env.example .env      # then set AA_API_KEY
npm install
npm start                 # http://localhost:8787
```

Node 20+ (uses the built-in `fetch`). To load `.env` without extra deps:

```bash
node --env-file=.env index.mjs
```

Check it: `curl localhost:8787/api/health`

## How the app finds it

Resolved in this order:

1. **Settings → Providers → gateway URL** — for anyone self-hosting
2. **`VITE_GATEWAY_URL`**, baked in at build time — what a release ships with
3. **Nothing** — the app falls back to calling the service directly with the
   user's own key, which is what a dev build with no gateway does

So a release build is:

```bash
VITE_GATEWAY_URL=https://gateway.example.com npm run tauri build
```

## Caching

Keyed feeds are refreshed in the background every `REFRESH_MINUTES` (default 30)
and served from memory, so:

- a client request never waits on the upstream
- one API key serves any number of installs without tripping rate limits
- if the upstream goes down, the last good data keeps being served rather than
  the app showing an error

## State &amp; files

The shared feeds are just an in-memory cache. But three things **persist to disk**
in the working directory and are the only copy of that data:

- `library.json` — everything published to the community library
- `users.json` — cloud-sync accounts (verifier hashes + session tokens)
- `sync/` — one end-to-end-encrypted blob per account (ciphertext only; the
  server can't read it)

So, when self-hosting:

- The process **must be able to write its working directory.** Under `systemd`
  with `ProtectSystem=strict` that means `ReadWritePaths=` — omit it and every
  write fails with `EROFS` and the data is silently lost on the next restart. The
  checked-in unit [`../deploy/hs-gateway.service`](../deploy/hs-gateway.service)
  sets it; the full story is in [`../deploy/gateway.md`](../deploy/gateway.md).
- **Back these files up** — `deploy/library-backup.sh` snapshots all three; run it
  from cron.
- Because of this state, run a **single instance** against the files (or move them
  to a shared store first).

## Deploying

A VPS behind nginx with **systemd** — see [`../deploy/gateway.md`](../deploy/gateway.md)
for the runbook and [`../deploy/hs-gateway.service`](../deploy/hs-gateway.service)
for the unit. From the repo, `./deploy/gateway.sh` uploads the code, installs
production deps and restarts the service; the `.env` on the box is never touched.

Set every key in the host's environment (`.env`), never in the repo: `AA_API_KEY`,
and — if you run the community library and cloud sync — `LIBRARY_SALT`,
`LIBRARY_ADMIN_TOKEN`, `SYNC_PEPPER`. See `.env.example`.

`trust proxy` is on, so the per-IP rate limit sees the real client address behind
a reverse proxy.

## Adding another shared API

Add an entry to `FEEDS` in `index.mjs` and a route that reads from `warm`. It
gets background refresh, stale-on-error and health reporting for free.
