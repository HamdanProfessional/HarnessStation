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

## A worked example

Say every SQL query you write has to follow house conventions. Without a skill,
you either restate them each time or put them in global instructions where
they're paid for on every message, including ones about lunch.

As a skill:

**Name:** `SQL conventions`

**Description:** `Use when writing or reviewing SQL for the analytics warehouse.`

**Body:**

```text
# SQL conventions

## Naming
- Tables are plural and snake_case: `order_items`, not `OrderItem`
- Every table has `id`, `created_at`, `updated_at`
- Foreign keys are `<singular_table>_id`

## Rules
- Never SELECT * in anything committed — name the columns
- Every query against `events` must filter on `occurred_at`;
  it's partitioned by day and an unfiltered scan is expensive
- Prefer CTEs to nested subqueries; we optimise for readability

## Columns never to select
- `users.password_hash`, `users.raw_pii` — restricted
```

Now any conversation with the Skills group on will load this when SQL comes up,
and ignore it otherwise.

## What makes a good description

The description is matched against the task, so it should describe *when* to load
the skill rather than what it contains.

| | |
| --- | --- |
| Good | "Use when writing or reviewing SQL for the analytics warehouse" |
| Bad | "SQL guidelines" |
| Bad | "Everything about our database" |

The second tells the model nothing about applicability. The third is broad enough
that it loads constantly.

## Skills that work well

- **Conventions** — code style, naming, structure
- **Procedures** with an order that matters — releasing, onboarding, incidents
- **Domain vocabulary** — what your terms mean, especially where they differ from
  common usage
- **Templates** — the shape of documents you produce repeatedly
- **Hard-won specifics** — "the staging database resets nightly, so don't rely on
  data persisting"

## Skills that don't

**Facts about you.** That's [memory](memory) — it applies everywhere and doesn't
need loading.

**Large reference material.** A skill loads whole. Anything you'd want *searched*
rather than read in full belongs in [knowledge](knowledge).

**Things needed on every message.** If it always applies, global instructions are
simpler.

## Where it goes wrong

**It never loads.** The description doesn't match how tasks are actually phrased,
or the Skills tool group is off.

**It loads constantly.** The description is too broad. Narrow it to the specific
situation.

**It loads but is ignored.** Usually a conflict — something in your global or
chat instructions contradicts it. → [How it works](../concepts/how-it-works)
