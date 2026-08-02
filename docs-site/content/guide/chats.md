---
title: Chats
description: Organising conversations — folders, pinning, snapshots, branching, and keeping long ones from running out of context.
---

# Chats

Every conversation is a file on your disk. Nothing is in the cloud, and nothing
expires.

## Managing them

Right-click any chat in the sidebar:

- **Pin** — keep it at the top, above the date ordering.
- **Rename** — chats are titled automatically from the first exchange; this
  overrides that. (Auto-titling can be turned off in **Settings › General**.)
- **Move to folder** — folders are created by typing a new name. They're a flat
  grouping, not a tree.
- **Duplicate** — a copy, to try a different direction without losing this one.
- **Take snapshot** / **Snapshots…** — see below.
- **Export** — Markdown for reading and sharing, JSON for keeping everything
  including tool calls.
- **Delete** — immediate, and there is no undo.

## Snapshots

A snapshot saves the conversation as it is now, so you can return to it. This is
worth doing before you let a model loose on your files, or before a long
tool-using task that might go somewhere unhelpful.

Restoring a snapshot replaces the current messages with the saved ones. The chat
keeps its identity — same file, same title, same place in your history.

## Branching and editing

Hover any message for two options that change the shape of the conversation:

- **Branch from here** — copies everything up to that point into a new chat,
  leaving the original untouched. Use it when a conversation is about to fork
  into two topics.
- **Edit** — on your own messages. Rewrites what you said and regenerates from
  there, discarding what followed. Better than asking again, because the wrong
  answer stops being part of the history the model reads.

## Long conversations

Every model has a context window, and a long chat eventually fills it. When that
happens, models start forgetting the beginning, or the request is refused
outright.

**Compact** summarises the earlier part of the conversation and replaces those
messages with the summary. The banner at the top of the chat shows how many
messages were folded away, and you can expand it to read what was kept.

Turn on **auto-compact** in **Settings › General** and this happens on its own
once the chat passes a threshold you set. It's the right default for long working
sessions.

> **Tip:** Compacting loses detail — that's the point of it. If a conversation
> contains something you'll want verbatim later, either export it first or put
> the fact into [memory](memory), which survives compaction.

## Per-chat settings

The panel on the right of a conversation applies to that chat only:

- **Model** and **provider** — switch mid-conversation if you want a cheaper
  model for follow-ups, or a stronger one for a hard question.
- **Temperature** and **max tokens**.
- **System prompt** — layered *after* your global instructions rather than
  replacing them.
- **Tools** — which this chat may use.
- **Working directory** — the folder file tools are confined to.

Save a combination you use often as a preset, or as an [agent](agents) if it
should also carry tools and knowledge.

## Where they're stored

One JSON file per chat under `~/.harnessx/conversations/`, plus an index for the
sidebar. Plain text, readable, and yours to back up or grep.
→ [Where your data lives](../advanced/data)
