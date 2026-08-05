---
title: Secrets
description: Save API keys the model can use but never read, so they never end up in a transcript.
---

# Secrets

Paste an API key into a chat and it lives in that conversation forever. Providers
now scan for leaked keys and auto-revoke them — which stops you mid-task with a
"this key was leaked, rotate it" error. The **secrets vault** solves this: the
model can *use* a saved credential but never *see* its value, so the value never
enters the conversation at all.

## Saving a secret

Open **Settings › Secrets** and add one:

- **Name** — a human label, e.g. "Cloudflare API token".
- **Reference** — the placeholder the model uses, e.g. `CLOUDFLARE_API_TOKEN`
  (auto-derived from the name; uppercase with underscores).
- **Description** — what it unlocks. The model sees this, so be specific:
  "Edits DNS records and Workers for my account."
- **Value** — pasted once. It goes straight to your OS keychain (on the web
  build, your browser's local storage). It is **never** written to `settings.json`,
  a chat, or the cloud.

You can't read the value back afterwards — by design, it's the model's to use.
You can replace or delete it.

## Using one in a chat

The model has a `list_secrets` tool. When it calls it, it gets the **reference and
description only** — never the value. To use a secret, it writes the placeholder
into anything it produces:

```
# in a file it writes, a command it runs, or a request it makes:
Authorization: Bearer {{CLOUDFLARE_API_TOKEN}}
```

At execution time — *after* the model has written it — the app substitutes the
real value. So the key reaches the file, command or API it's meant for, but the
model only ever typed the placeholder.

> **Note:** `${CLOUDFLARE_API_TOKEN}` works as an alternative to `{{…}}` for a
> known secret. Just say "I've saved my Cloudflare token" and the model will look
> it up and reference it.

## It can't leak

Two things keep the value out of the transcript:

- The model references a **placeholder**, never the value — so what it types is
  safe to store.
- Any secret value that shows up in a tool's **output** (a stray `cat .env`, an
  echoed header) is **scrubbed back to its placeholder** before the model reads
  it.

So even a mistake can't put the raw key into the conversation. You (the user)
can't read a saved value back either.

## Where the value lives

| Build | Storage |
| --- | --- |
| Desktop | OS keychain (Windows Credential Manager / Linux Secret Service) |
| Web | Your browser's local storage (a weaker boundary, stated in-app) |

Only the metadata — name, reference, description, and a last-four hint — is kept
in `settings.json`. See also [Where your data lives](../advanced/data) and
[Privacy & security](../advanced/privacy).
