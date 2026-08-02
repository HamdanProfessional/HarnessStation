---
title: An assistant that knows your business
description: Building an agent that answers from your own documentation instead of guessing.
---

# An assistant that knows your business

An [agent](../guide/agents) with your documentation attached, a role written
down, and clear instructions about what to do when it doesn't know.

Useful for internal help ("how do I request access to staging?"), for drafting
support replies, and for onboarding people who would otherwise interrupt someone.

## What you'll end up with

A saved agent you can open any time, answering from your material, saying "I
don't know" when it doesn't, and citing where its answers came from.

## Setup

- A [knowledge base](../guide/knowledge) with your documentation
- An embedding model (**Settings › Providers › Embeddings**)
- A model good enough to follow instructions carefully — that matters more here
  than raw capability

## Build the knowledge base first

Gather what actually answers questions: internal docs, runbooks, policies,
resolved support threads.

**Use separate bases for separate audiences.** If you're building both a
customer-facing helper and an internal one, keep internal material in its own
base — otherwise a customer-facing answer can retrieve from it, and that mistake
only becomes visible after it has been made.

## Write the agent

**Automation › Agents › New agent.** The instructions carry almost all the weight
here, so they're worth writing properly:

```text
You answer questions about our product using the attached documentation.

Rules:
- Answer only from the documentation. If it doesn't cover something,
  say "I don't have documentation on that" and stop. Do not fill gaps
  from general knowledge — a plausible wrong answer about our product
  is worse than no answer.
- Quote or reference the section you used, so the reader can check.
- If the documentation is ambiguous, or two parts disagree, say so
  rather than choosing one.
- Keep answers short. Two or three sentences unless the question
  genuinely needs more.
- For anything involving billing, security, or deleting data, answer
  what the docs say and add: "Please confirm with the team before
  acting on this."
```

Three of those rules matter more than the rest.

**"Do not fill gaps from general knowledge"** is the whole game. Without it, a
question your docs don't cover gets a fluent answer drawn from how software
usually works — which reads exactly like an answer drawn from your documentation.
This is the single most important instruction on the page.

**"Quote the section"** makes checking cheap. An answer you can verify in five
seconds gets verified; one you can't, doesn't.

**The escalation rule** puts a human in front of the expensive mistakes.

Attach the knowledge base, and leave tools off unless it genuinely needs them. An
assistant that answers questions does not need file access.

## Test it properly

Test the failures, not the happy path. Anything can answer a documented question.

**Ask something you know isn't documented.** It should decline. If it answers,
your instructions aren't strong enough yet — this is the test that matters.

**Ask something documented ambiguously.** It should say so.

**Ask something adjacent** — near your product but not about it. It should
notice.

**Ask a question phrased unlike your docs.** Retrieval is semantic, but there are
limits, and this tells you whether your material covers the words real people
use.

If you're going to rely on it, build an [eval set](../models/comparing) from
these cases. Then when you change the instructions or the model, you can tell
whether you improved it rather than hoping.

## Keeping it current

Documentation goes stale, and a confident answer from a stale document is worse
than no assistant at all.

Re-index when your docs change — you can [schedule](../guide/schedules) that.
Include dates in documents where they matter, and tell the agent to mention when
material looks old.

## Where it goes wrong

**It answers things it shouldn't know.** Strengthen the instruction and test
again with an undocumented question. Some models need it said more than once.

**It won't answer things it should.** Usually retrieval rather than instructions
— check the knowledge base actually contains the answer and is attached.

**Answers are too long.** Say how long. Models default to thorough.

**It contradicts itself between sessions.** Two documents disagree, and different
retrievals surface different ones. That's your documentation telling you
something useful.
