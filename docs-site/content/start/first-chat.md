---
title: Your first chat
description: Connecting a model and sending a message — the five minutes between installing and having something that works.
---

# Your first chat

HarnessStation ships with no model and no key, so the first thing to do is
connect one. There are two routes, and which you pick depends on whether you'd
rather pay nothing or have the strongest model.

## Option A — a local model, free

Nothing leaves your machine and there's no bill. You need one of these running:

- **[Ollama](https://ollama.com)** — simplest. Install it, then `ollama pull qwen3`.
- **[LM Studio](https://lmstudio.ai)** — a GUI. Load a model, then start its
  local server from the **Developer** tab.

With one of those running, open **Settings › Providers** in HarnessStation. Local
servers on the usual ports are detected for you — if yours appears, it's already
connected. If not, add it by hand:

| Field | Ollama | LM Studio |
| --- | --- | --- |
| Base URL | `http://localhost:11434/v1` | `http://localhost:1234/v1` |
| API key | *(leave empty)* | *(leave empty)* |

Press **Save**. See [running models locally](../models/local) for choosing a
model your hardware can actually handle.

## Option B — a cloud model, your key

Better results, and you pay the provider directly. Get a key from whoever you
want to use — [OpenAI](https://platform.openai.com/api-keys),
[Anthropic](https://console.anthropic.com), [OpenRouter](https://openrouter.ai/keys),
Groq, or anything else with an OpenAI-compatible endpoint.

In **Settings › Providers**, choose **Add provider**, then fill in:

| Field | Example |
| --- | --- |
| Name | `OpenAI` |
| Base URL | `https://api.openai.com/v1` |
| API key | `sk-…` |

Press **Save**.

> **Note:** Your key is stored in your operating system's credential store —
> Windows Credential Manager, or the GNOME/KDE keyring on Linux — not in a
> settings file. It's sent to that provider and nowhere else.

## Send something

Back on the main screen, pick your model from the selector at the top of the
chat, type a message, and press Enter.

If it answers, you're done — everything else in these docs builds on this.

## Then try a tool

The interesting part isn't chatting; it's letting the model *do* something. Open
the tools panel from the right-hand side of the chat and switch on **Files**,
then ask it something concrete:

```text
Read the README in this folder and tell me what the project does.
```

You'll be asked for a working directory first. The model can only see inside the
folder you choose — this is the boundary, and it's worth setting deliberately
rather than pointing it at your whole home directory.

Watch what happens: it calls a tool, you see the call and its result in the
conversation, and then it answers using what it read. That loop — call, read,
respond — is the whole idea of the app.

Next: [a tour of the app](tour), or jump straight to [tools](../guide/tools).

## If it didn't work

**"No provider configured"** — nothing is set up yet, or the last save didn't
take. Return to **Settings › Providers** and check the entry is there and saved.

**Connection refused** — for a local model, the server isn't running. Start
Ollama or LM Studio's server and try again.

**401 or 403** — the key is wrong, or has no credit on it. Check it at the
provider's own console.

**It answers but ignores the tools** — some models, particularly small local
ones, can't call tools at all. Try a larger model, or one whose card explicitly
mentions tool or function calling.

More in [troubleshooting](../reference/troubleshooting).
