---
title: Researching a topic
description: Gathering sources from the web, keeping what matters, and producing something written you can actually use.
---

# Researching a topic

Reading twenty pages to answer one question is the kind of work worth handing
over — provided you keep the model honest about where its claims came from.

## What you'll end up with

A written summary with sources attached, and a knowledge base you can keep asking
questions of afterwards.

## Setup

- The **Browser** tool group, so it can open and read pages
- The **Files** group if you want the result saved to disk
- A model with a reasonably large context window — research means holding several
  sources at once

## Gathering

Be specific about what counts as a source, or you'll get the first three results
of a search summarised as though they were research.

```text
Research how Postgres handles connection pooling at scale. I want to
understand the actual trade-offs, not a feature list.

Read at least five sources, and prefer official documentation and
engineering write-ups over listicles. For each source, tell me what it
covers and whether it's worth reading in full.
```

You'll see it open each page and read it. That's worth watching rather than
tabbing away — you'll notice quickly if it's collecting marketing pages.

## Insisting on attribution

This is the part that makes research output trustworthy.

```text
Now write me a summary of the trade-offs. For every factual claim,
say which source it came from. If something is your inference rather
than something you read, mark it as such.

If sources disagree, say so instead of picking one.
```

Two things are doing work there. **Marking inference** separates what was read
from what was assumed, which is exactly the distinction that silently disappears
in unmarked summaries. **Surfacing disagreement** stops the answer being falsely
confident on the questions that are genuinely contested — which are usually the
ones you were researching.

## Keeping it

Two options, and they're for different things.

**Save the write-up** with the Files tool:

```text
Save that as research/postgres-pooling.md, keeping the source links.
```

**Build a knowledge base** if you'll come back to the material. Create one in
**Automation › Knowledge**, add the saved pages, and later conversations can
search it without re-reading anything.

The difference: a saved file is a document you read. A
[knowledge base](../guide/knowledge) is something you interrogate.

## Following up

With the knowledge base attached, later questions retrieve from what you gathered
rather than searching afresh:

```text
Based on what we collected, what would go wrong if we ran pgbouncer
in transaction mode with our current use of prepared statements?
```

## Where it goes wrong

**It summarises search results instead of reading pages.** Snippets look like
sources and aren't. Ask it to quote something specific from each page.

**Confident claims with no source.** This is the failure mode worth guarding
against, because a fluent unsourced summary reads exactly like a well-researched
one. Insist on attribution from the start rather than asking afterwards.

**Sites block it.** Publishers with anti-bot measures will refuse. Nothing in the
app evades that — open the page yourself in the browser panel and let the model
read it from there.

**Paywalls.** Same answer. If you have a subscription, sign in inside the browser
panel; the session persists.

**It stops at three sources.** Models satisfy the instruction and stop. If you
want breadth, give a number and ask it to list what it read before summarising.
