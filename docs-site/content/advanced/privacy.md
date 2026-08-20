---
title: Privacy & security
description: What leaves your machine, what doesn't, and the things worth being careful with.
---

# Privacy & security

## What leaves your machine

**Your prompts, files and documents** go to the model provider you chose, and
nowhere else. With a local model they don't leave at all.

**Nothing routes through us.** The app has no account, no telemetry, and no
server holding your conversations. There is nothing to opt out of because there
is nothing collecting.

**One exception:** public benchmark data is fetched through a gateway so the
Benchmarks panel isn't empty. It's a read of public information about models. It
carries no key of yours and no data about you.

## Where credentials are kept

API keys and OAuth tokens go in your operating system's credential store —
Windows Credential Manager, or Secret Service on Linux. Not in settings files,
and not in exports.

An [exported chat](../guide/chats) contains the conversation, not your keys.

## Things worth being careful with

**The terminal tool** runs real commands as you. A working directory limits which
files it can reach; it doesn't stop a command using the network. Enable it when
you want that.

**Browser sessions.** A site you sign into in the [in-app browser](../guide/browser)
stays signed in, and the model can act on it. Treat that as delegated access.

**Scheduled runs** act with no one watching. Set [spend caps](../reference/settings),
and prefer schedules that report over ones that change things.

**The device mesh encrypts message bodies** but has no forward secrecy and does
not authenticate the host. See [the detail](devices) — over anything but your own
network, put it inside a VPN or tunnel.

**Passive memory** stores facts from your conversations on disk. Review it in
**Settings › Memory** occasionally; it sometimes keeps more than you'd expect.

## What each mode actually sends

| Setup | What leaves your machine |
| --- | --- |
| Local model, no tools | Nothing |
| Local model + local embeddings | Nothing |
| Cloud model | Your prompt, conversation history, and any file content the model read |
| Cloud embeddings | Every document you index, in full |
| Cloud voice | The text being spoken |
| Browser tools | Normal web requests to the sites visited |

The cloud embeddings row surprises people. Indexing a
[knowledge base](../guide/knowledge) uploads **every document**, not just the
parts later retrieved. For anything sensitive, use a local embedding model —
Ollama with `nomic-embed-text` costs nothing and never leaves the machine.

## A private-by-default setup

If privacy is the priority:

- A [local model](../models/local) through Ollama or LM Studio
- Local embeddings for knowledge bases
- Kokoro or Piper for speech, both of which run locally
- Whisper for transcription — already local, always
- Device mesh off, or confined to your own network

That configuration sends nothing anywhere. It's genuinely usable — the main
compromise is model quality on hard reasoning.

## Reviewing what an agent did

Every tool call is recorded in the conversation with its arguments and result,
and that record is complete rather than a summary.

Worth reading after anything unattended. What to look at:

- **Which files** were read and written — the arguments show exact paths
- **What commands** ran, if Terminal was enabled
- **Which sites** were visited
- **What was sent** where a tool called an external service

Conversations are plain JSON on disk, so this is greppable across your whole
history:

```bash
grep -rl "run_command" ~/.harnessx/conversations/
```

## Sharing conversations safely

An exported chat contains everything in it — including file contents the model
read, and anything you pasted. It does **not** contain your API keys.

Read an export before sharing it. The risk isn't the app leaking keys; it's that
a conversation about your codebase contains your codebase.

## Reporting a security issue

If you find a vulnerability, please report it privately rather than opening a
public issue, and allow time for a fix before disclosing.
