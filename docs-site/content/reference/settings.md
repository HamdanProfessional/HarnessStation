---
title: Settings reference
description: What every settings panel holds, and which options are worth changing.
---

# Settings reference

Eight panels. There's a search box at the top of the rail that matches on what a
setting *does* — typing "interrupt" finds barge-in under Voice.

Settings are edited as a draft and applied on **Save**. An unsaved marker appears
beside the title, `Ctrl+S` works, and leaving with changes pending asks first.

## General

| | |
| --- | --- |
| **System instructions** | Prepended to every chat, before style and per-chat prompts |
| **Auto-compact** | Summarise old turns when a chat passes a token threshold |
| **Auto-continue** | Keep working across tool rounds without a manual "continue" |
| **Auto-enable tools** | Let the model switch on tools needing no credentials |
| **Auto-title** | Name new chats from the first exchange |
| **Background mode** | Closing the window leaves it in the tray rather than quitting |
| **Theme** | Dark, light, or follow the system |

Background mode must be on for [schedules](../guide/schedules) to fire while the
window is closed.

## Providers

Model connections and keys → [Providers & keys](../models/providers).

Also **Embeddings**, the model used to index [knowledge](../guide/knowledge), and
the optional gateway for benchmark data.

## Media models

Image, speech, video and 3D generation → [Images & media](../guide/media).

## Voice

The largest panel → [Talking to it](../voice/talking) and
[Voice engines](../voice/engines).

The ones that matter most: **voice engine**, **speech rewrite**, **barge-in**,
and the **microphone** with its level meter.

## Memory

What's remembered, in which scope, with the ability to delete or tidy.
**Memory share** caps how much of the context window recall may occupy —
20% by default, 25% maximum. → [Memory](../guide/memory)

## Devices

Pairing and sharing across machines → [Device mesh](../advanced/devices).

## Usage

Estimated spend by day and month, and **caps**. When a cap is reached, new
requests stop rather than continuing quietly.

Set these before running anything unattended.

## Data & updates

Where your data lives, export and import, the version you're on, and checking for
updates. → [Where your data lives](../advanced/data)

## The settings most worth changing

Most defaults are fine. These are the ones that repay attention:

| Setting | Where | Why |
| --- | --- | --- |
| **Spend caps** | Usage | The one protection against an unattended loop |
| **Voice engine** | Voice | The default system voice is much worse than Kokoro |
| **Speech rewrite** | Voice | Largest single improvement to how replies sound |
| **Auto-compact** | General | Stops long chats degrading and getting expensive |
| **Embedding model** | Providers | Knowledge bases don't work without one |
| **Background mode** | General | Required for schedules to fire |
| **Memory share** | Memory | Lower it if recall is crowding out your conversation |

## Global instructions, and what to put there

They're sent with every message, so they should be things that apply to
everything:

```text
Answer in British English.
Be direct — skip preamble and get to the point.
When you're unsure, say so rather than guessing.
I'm an experienced developer; don't explain basics unless I ask.
```

What *not* to put there: anything project-specific (use
[projects](../guide/projects)), anything task-specific (use the chat prompt), and
anything long. Every word is paid for on every message, including trivial ones.

## Things people expect to find and won't

**A model default per tool.** Models are set per chat, per agent, or per workflow
step — not globally per capability.

**A global "enable all tools".** Deliberately absent. Tools are enabled per
conversation, and there's no switch to grant everything at once.

**Cloud sync.** There isn't any. Everything is local, and moving between machines
means copying `~/.harnessx` or using the [device mesh](../advanced/devices).

**A way to raise the memory share past 25%.** Capped on purpose — beyond that,
recall costs more context than it returns.
