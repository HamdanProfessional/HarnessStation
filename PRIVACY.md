# Privacy Policy

*Last updated 2026-08-04. Plain-English summary of what HarnessStation does and
doesn't collect. This is a starting draft — have it reviewed by counsel before a
public launch.*

## The short version

HarnessStation is a local-first desktop app. **It has no account, no telemetry,
and no cloud sync.** We — the makers of the app — do not receive your
conversations, your files, or your API keys.

## What stays on your device

- **Conversations, projects, agents, workflows, schedules, knowledge bases,
  memory** — stored as plain files under `~/.harnessx` (`%USERPROFILE%\.harnessx`
  on Windows). They never leave your machine unless you send them somewhere.
- **API keys** — stored in your operating system's credential store (Windows
  Credential Manager / Linux Secret Service), never in a config file and never
  transmitted to us. In the **browser build**, keys are kept in that browser's
  local storage (a weaker boundary, stated in-app).

## What goes to your AI provider

When you use a model, the assembled prompt is sent to **the provider you
configured** (OpenAI, Anthropic, a local server, etc.) using **your** key. That
exchange is governed by **that provider's** privacy policy, not ours. A fully
local model (Ollama, LM Studio, the in-app llama.cpp, or the in-browser WebGPU
model) sends nothing off your machine at all.

## What the optional gateway sees

Some *shared* features are served by the HarnessStation gateway
(`hsapi.retris.io`) so no third-party key ships inside the app. Your prompts and
provider keys **never** pass through it. The gateway handles:

- **Benchmarks / Hugging Face search / MCP directory** — public data it fetches
  and caches on everyone's behalf. Your requests aren't tied to an identity.
- **Community library** — when you publish, browse, like, download, or report an
  item. A "like"/"report" is de-duplicated using a **salted one-way hash of your
  IP address**; we do not store your raw IP for this, and the hash can't be
  reversed to it. Published content is public and carries the author name you
  choose (or "Anonymous").
- **Trial links** — resolve a shared demo key server-side.

Standard web-server request logs (IP, timestamp, path) may exist transiently for
security and rate-limiting, and are not used to profile you.

## Cookies / tracking

None. The web app uses your browser's local storage to keep your own settings and
data on your device; it sets no tracking cookies and runs no analytics.

## Children

Not directed at children under 13 (or the age of digital consent in your region).

## Changes

We'll update this document here and note the date above when things change.

## Contact

See the repository's contact for privacy questions.
