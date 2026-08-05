---
title: Providers & keys
description: Connecting models, where your keys are stored, and what the app does and doesn't send anywhere.
---

# Providers & keys

A provider is somewhere models come from. Connect as many as you like and switch
between them per chat.

## Adding one

**Settings › Providers › Add provider**:

| Field | |
| --- | --- |
| **Name** | Yours, for the model picker |
| **Base URL** | The API endpoint, usually ending `/v1` |
| **API key** | Blank for local servers |

Anything speaking the OpenAI chat-completions protocol works, which is most
things. Anthropic is supported natively.

| Provider | Base URL |
| --- | --- |
| OpenAI | `https://api.openai.com/v1` |
| Anthropic | `https://api.anthropic.com` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Together | `https://api.together.xyz/v1` |
| Ollama | `http://localhost:11434/v1` |
| LM Studio | `http://localhost:1234/v1` |

Press **Fetch models** to list what the endpoint offers, or type a model name if
it doesn't support listing.

## Where keys are stored

In your operating system's credential store — Windows Credential Manager, or
Secret Service (GNOME Keyring / KWallet) on Linux. **Not** in a settings file,
and not in the conversations folder.

A key is sent to its own provider and nowhere else.

## What the app sends anywhere

Worth stating plainly, because "AI app" usually means otherwise:

- **Your prompts and files** go to the provider you chose, and to no one else.
  With a local model they don't leave the machine at all.
- **The app ships no API keys.** There is no account, and nothing to sign into.
- **The one exception** is public benchmark data, fetched so the Benchmarks panel
  isn't empty. It needs no key of yours and carries none of your data.

→ [Privacy & security](../advanced/privacy)

## Extra parameters

Some backends take options the standard protocol has no field for — sampler
settings, routing hints, thinking switches. **Advanced › Extra body** on a
provider takes JSON merged into every request:

```json
{ "top_k": 40, "repeat_penalty": 1.1 }
```

## Switching models mid-chat

Change the model from the panel on the right and the conversation continues with
the new one. Reasonable when a follow-up doesn't need the expensive model that
answered the hard part.

Note that a model with a smaller context window may not fit the conversation so
far — [compact it](../guide/chats) first if so.

## Reliability: extra keys & failover

Each provider can carry more than one way to succeed, under **Settings ›
Providers › Resilience — extra keys & failover**:

- **Extra API keys** — one per line. If a request is rate-limited or a key is
  rejected, the app retries with the next key in the pool.
- **Backup providers** — pick other providers, in order. If none of the keys
  work (or the connection fails), the request falls through to each backup.

Failover only happens **before any reply has started streaming**, so you never
get a half-answer from one provider stitched to another. Retries cover transient
failures — rate limits (429), auth errors (401/403), server errors (5xx) and
network drops — but not a genuine bad request, which surfaces immediately.

## Prompt caching

On **Anthropic** models the app marks the system prompt as a cache breakpoint.
A tool-using turn resends the same system prompt on every round, so caching lets
Anthropic charge for it once and read it back cheaply for a few minutes — a real
saving on long agent runs. It's always on and needs no configuration. OpenAI-style
providers cache automatically on their side.
