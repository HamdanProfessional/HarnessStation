---
title: Skills
description: Reference material a model loads only when a task actually needs it.
---

# Skills

A skill is a document of instructions for a particular kind of task — a house
style, a deployment runbook, the shape of your API — that the model loads *only
when it's relevant*.

## Why not just use instructions?

Global instructions are sent with every request. Ten detailed procedures in there
is a large fixed cost on every message, including "what time is it in Tokyo".

A skill is different: the model sees a one-line index of what's available, and
loads the full text only when a task calls for it. Twenty skills cost twenty
lines until one is needed.

## Writing one

**Automation › Skills › New skill**. A name, a one-line description, and the
body in Markdown.

The description is what the model matches against, so it should say when to use
the skill, not what it contains:

```text
Good: Use when writing or reviewing SQL for the analytics warehouse — covers
      our naming conventions, partitioning rules and the columns never to select.

Bad:  SQL guidelines.
```

The body can be as long as it needs to be. It's only paid for when loaded.

## Using them

Turn on the **Skills** tool group. The model reads the index and loads what it
needs — you don't have to name a skill, though you can.

## What they're good for

- Coding conventions you keep having to restate
- Step-by-step procedures with an order that matters
- Domain vocabulary and what your terms mean
- Templates for documents you produce repeatedly

## What they're not for

Facts about *you* — that's [memory](memory). Large document sets to search —
that's [knowledge](knowledge). A skill is a procedure, loaded whole.
