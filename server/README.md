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

## Deploying

Any Node host works — Railway, Fly, Render, a VPS behind nginx. It's stateless
apart from the in-memory cache, so restarts are free and you can run more than
one instance. Set `AA_API_KEY` in the host's environment, never in the repo.

`trust proxy` is on, so the per-IP rate limit sees the real client address behind
a reverse proxy.

## Adding another shared API

Add an entry to `FEEDS` in `index.mjs` and a route that reads from `warm`. It
gets background refresh, stale-on-error and health reporting for free.
