---
title: Use cases
description: Worked examples of real jobs, start to finish — what to set up, what to type, and what goes wrong.
---

# Use cases

The rest of the documentation explains features one at a time. This section does
the opposite: it takes real jobs and shows how the pieces fit together.

Each walkthrough gives you the setup, the actual prompts, what to expect back,
and the failures worth knowing about in advance.

## Pick one close to your job

| | |
| --- | --- |
| [Working with a codebase](codebase) | Understand unfamiliar code, review changes, make edits across files |
| [Researching a topic](research) | Gather sources from the web, keep what matters, produce a written summary |
| [A recurring report](recurring-report) | Turn a job you do every Monday into something that arrives on its own |
| [Working through documents](documents) | Index a pile of PDFs and contracts, then extract what you need |
| [Pulling data off websites](scraping) | Collect structured data from pages with no API |
| [An assistant that knows your business](support-assistant) | An agent answering from your own documentation |
| [Hands-free work](hands-free) | Using voice while your hands are busy |

## How to read these

Every walkthrough follows the same shape:

1. **What you'll end up with** — so you can tell whether it's worth your time
2. **Setup** — what to connect before starting
3. **The work** — prompts you can copy, and what comes back
4. **Where it goes wrong** — the failures we actually hit

Prompts are starting points rather than magic strings. The reasoning behind them
is explained, because you'll want to adapt them.

## Before your first one

Two things matter more than which walkthrough you pick.

**Your model has to be able to call tools.** Everything here depends on it, and
many small local models can't do it reliably no matter what their model card
says. Test before investing time — [running models locally](../models/local)
explains how and what sizes work.

**Set a spend cap** if you're using a paid model. **Settings › Usage**. Agents
that run unattended are the one way to be surprised by a bill, and a cap turns
that into a stopped run instead.
