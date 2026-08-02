---
title: Projects
description: Grouping chats that share a brief, a set of documents and a memory.
---

# Projects

A project is a container for conversations that belong together. Everything
inside it shares instructions, knowledge and memory; nothing leaks to
conversations outside it.

## Creating one

Press **+** beside *Projects* in the sidebar. Give it a name, then set:

- **Instructions** — a brief every chat in the project inherits, layered under
  your global instructions and above any per-chat prompt.
- **Knowledge bases** — [documents](knowledge) these chats can search.
- **Tools** — what chats here start with enabled.

New chats started from within a project inherit all of it. Use the **+** on the
project row to start one directly inside it.

## Project memory

Facts learned in a project chat are filed in the **project scope** — recalled by
every conversation in that project, and by nothing outside it.

This is the main reason to use projects. Working on two clients with different
conventions, you want each set of habits recalled in its own context and nowhere
else. Global memory can't do that, and per-chat memory forgets between
conversations.

→ [Memory](memory)

## Moving chats

Drag a chat onto a project, or use **Move to project** from its menu. It picks up
the project's instructions and memory from that point on.

## Deleting

Deleting a project does **not** delete its chats by default — they return to the
ungrouped list. Losing a month of conversations because a folder was tidied away
isn't a recoverable mistake, so it takes an explicit choice.

The project's own memory *is* deleted with it. Global and per-chat memory are
untouched.

## When not to bother

If your conversations are all the same kind of work, a project adds ceremony for
nothing — global memory and a good set of global instructions do the job. Reach
for projects when you're switching between contexts that shouldn't know about
each other.

## A worked example

You do freelance work for two clients whose conventions differ. Without projects,
memory learns both and recalls them together — and at some point applies one
client's rules to the other's code.

**Project: Acme**

Instructions:

```text
Acme's codebase is Python 3.11 with FastAPI. They use tabs, not spaces,
and their test suite runs with `make test` rather than pytest directly.
Never suggest changes to anything under vendor/.
```

Knowledge: their API documentation and internal runbook.

**Project: Brightside**

Instructions:

```text
Brightside is TypeScript with a strict lint config. Prefer named exports.
All database access goes through the repository layer — never query
directly from a route handler.
```

Now a chat inside Acme recalls Acme's conventions and knows nothing about
Brightside's repository rule, which is exactly right.

## What layers where

Instructions accumulate rather than replace:

1. Global instructions (**Settings › General**)
2. Project instructions
3. Chat instructions

The model sees all three. So keep global ones general — how you like answers
written — and put anything project-specific in the project. Contradictions
between the layers are the usual cause of a chat ignoring something you told it.

## Where it goes wrong

**Facts from one project appear in another.** They were stored globally rather
than in the project — likely learned in a chat that wasn't inside a project.
Check **Settings › Memory**, which shows the scope of each fact, and delete the
ones in the wrong place.

**A chat isn't picking up project instructions.** It isn't in the project. Moving
it applies them from that point.

**Deleting a project didn't remove its chats.** Deliberate. They return to the
ungrouped list; deleting them is a separate, explicit choice.
