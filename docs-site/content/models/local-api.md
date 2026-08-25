---
title: The local API — use it from other tools
description: Point Claude Code, opencode, Aider or any OpenAI/Anthropic-speaking tool at the models running in HarnessStation — subscriptions, locals and combos included.
---

# The local API

Everything you configure in HarnessStation — providers, [agents](../guide/agents),
[combos](#combos), [subscriptions](#subscriptions) — is also a server. Turn on
**Settings → Devices → Local API server** and other apps on this machine can
call your models through it, on loopback only (`127.0.0.1`, never the network).

**Settings → Devices** shows the base URL plus paste-ready blocks for the two
most common cases, with a copy button each. The `hs` CLI prints the same thing
anywhere: `hs endpoint`.

## Two protocols

| Endpoint | Speaks | For |
| --- | --- | --- |
| `/v1/chat/completions` | OpenAI (streaming, function calling) | opencode, Aider, LangChain, any OpenAI SDK |
| `/v1/messages` | Anthropic Messages | Claude Code and anything built on anthropic-sdk |

Function calling passes through on openai-compatible providers — the tool
schemas a client sends go straight to the model, and tool calls come back for
the client to execute. That is what makes agentic CLIs work unchanged.

## Model ids

Everywhere a model is named, the same forms work — in the app's own picker,
in API requests, and in the tools you point here:

- `provider/model` — e.g. `groq/llama-3.3-70b`
- `agent/<name>` — a saved [agent](../guide/agents), with its instructions,
  model and tools
- `combo/<name>` — a [combo](#combos): a fallback chain tried step by step
- a bare model name — resolved to the provider that lists it

`GET /v1/models` lists everything, agents and combos included.

## Claude Code on any model

With the server on, set the environment and run `claude`:

```
ANTHROPIC_BASE_URL=http://127.0.0.1:11435
ANTHROPIC_AUTH_TOKEN=hs-local
ANTHROPIC_MODEL=claude-oauth/claude-sonnet-4-5
```

Any model id from the list above works — a local GGUF, a cheap API key, or a
combo. `hs endpoint` prints this block with a copy button in Settings →
Devices.

## Subscriptions as backends

**Settings → Subscriptions** connects a Claude Pro/Max subscription or GitHub
Copilot. Once connected they are ordinary providers — the subscription powers
your chats, and anything pointed at the local API draws on the same quota.
Tokens live in your OS keychain.

## Combos

A combo chains providers into one id that tries each step in order —
subscription first, cheap key second, free tier last — and moves on when one
fails before replying. Build them in **Settings → Combos**; steps the provider
recently rate-limited are tried last automatically.

## The `hs` CLI

`hs` ships with the app (`npm link` in a checkout puts it on PATH):

```
hs status        # is the API reachable
hs models        # every model, agent and combo
hs chat          # a multi-turn terminal session
hs endpoint      # the paste-ready configs
hs doctor        # why it isn't working
```

See the CLI's own [README](https://github.com/najma-lp/harnessstation) for the
full reference.
