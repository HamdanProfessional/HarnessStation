---
title: A tour of the app
description: What every panel in the sidebar is for, so you know where to look before you need it.
---

# A tour of the app

The sidebar has a lot in it. This is a map, not a manual — each section links to
the page that explains it properly.

## The top: starting something

Two buttons, because there are two ways to talk to the app.

- **New chat** — a normal typed conversation.
- **New call** — a spoken one, with the voice avatar. A call is saved like any
  other conversation and reopens as a call, so you can pick a spoken thread back
  up where you left it.

Below them, search filters your history by title and content.

## Projects

A **project** groups chats and calls that share a brief and a memory. A project
for a piece of client work can carry its own instructions, its own knowledge
bases, and facts that every chat inside it recalls but no chat outside it does.

If you only ever have one kind of conversation, ignore this. If you switch
between unrelated contexts, it's the feature that stops them bleeding into each
other. → [Projects](../guide/projects)

## Chats

Your conversation history, newest first. Chats can be pinned, renamed, filed
into folders, duplicated, snapshotted before a risky change, and exported to
Markdown or JSON. → [Chats](../guide/chats)

## Library

Everything about **models**, as opposed to conversations.

| Panel | What it's for |
| --- | --- |
| **Discover** | Browse models available to you and add them |
| **My Models** | Models you've connected, and local ones you've downloaded |
| **Compare** | Send one prompt to several models side by side |
| **Evals** | Score models against a set of test cases you define |
| **Benchmarks** | Public benchmark data, so you can see how models rank before paying for one |

Benchmarks is the one thing the app fetches on your behalf, and it needs no key
of yours. → [Comparing & evaluating](../models/comparing)

## Automation

Everything that gives a model **abilities**, and everything that runs without
you.

| Panel | What it's for |
| --- | --- |
| **Agents** | A saved role: instructions, tools, knowledge and memory as one reusable thing |
| **Skills** | Reference material a model loads only when a task needs it |
| **Knowledge** | Documents it can search |
| **Tools** | What it's allowed to do — files, terminal, web, and your own scripts |
| **Workflows** | Multi-step sequences with the output of one step feeding the next |
| **Schedules** | Run an agent or workflow on a timer |
| **MCP Servers** | Connect external tool servers |
| **Browser** | Open a browser inside the conversation that the model can drive |

→ [Tools](../guide/tools), [Agents](../guide/agents), [Workflows](../guide/workflows)

## The chat itself

The composer sits at the bottom. **Attach** adds files or images, **Dictate**
types by voice. **Compact** summarises the earlier part of a long conversation
to free up context, and **Regen** re-runs the last reply.

Along the right of a conversation you'll find per-chat settings: the model,
temperature, the system prompt for this chat alone, and which tools it may use.
Those override the global defaults, so one chat can have file access while the
rest don't.

## Settings

Eight panels down the left of the settings screen: General, Providers, Media
models, Voice, Memory, Devices, Usage, and Data & updates. There's a search box —
it matches on what a setting *does*, so typing "interrupt" finds the barge-in
option under Voice.

Settings are edited as a draft and applied on **Save**; an unsaved marker appears
next to the title, and Ctrl+S works. → [Settings reference](../reference/settings)

## What to read next

Depending on what you came for:

- A worked example end to end → [Use cases](../use-cases/overview)
- Understanding what actually happens on a turn → [How it works](../concepts/how-it-works)
- Making it useful on your own files → [Tools](../guide/tools)
- Getting better answers → [Getting better results](../concepts/prompting)
- Stopping it forget things → [Memory](../guide/memory)
- Talking instead of typing → [Voice](../voice/talking)
- Not paying per token → [Running models locally](../models/local)
- Keeping the bill down → [Controlling cost](../concepts/cost)
