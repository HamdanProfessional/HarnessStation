---
title: Workflows
description: Chaining steps so the output of one feeds the next, for tasks you repeat.
---

# Workflows

A workflow is a sequence of steps run in order, each receiving what the last
produced. Where an [agent](agents) is one role doing one job, a workflow is a
pipeline.

## Building one

**Automation › Workflows › New workflow**, then add steps. Each step has:

- **A prompt** — what to do, referencing the previous step's output
- **A model** — or the workflow's default
- **Tools** — what that step may use
- **An agent** — optionally, run the step as a saved agent

Steps run top to bottom. The first receives your input; each subsequent one
receives the previous result.

## An example

A weekly summary of a repository's activity:

1. **Gather** — *"List commits from the last seven days with their messages."*
   Tools: Terminal.
2. **Group** — *"Group these into themes. Ignore formatting-only changes."*
   No tools; this is just reasoning.
3. **Write** — *"Write a short summary for someone who wasn't here. Lead with
   anything that changes how the system behaves."*

Splitting it beats one long prompt because each step is judged on its own. A
model asked to gather, group and write at once tends to do the last one well and
the first two carelessly.

## Running

Run by hand from the Workflows panel, from a chat with the **Workflows** tool
group on, or [on a schedule](schedules).

Each step's output is shown as it completes, so a workflow that goes wrong shows
you which step did it.

## When to use what

| | |
| --- | --- |
| One job, one role, repeated | An [agent](agents) |
| Fixed sequence, output feeding forward | A workflow |
| Open-ended, needs judgement about what's next | Just a chat with tools |

Workflows are for things whose *shape* you already know. If the steps depend on
what's found along the way, a chat with tools will do better.

## Why splitting steps helps

It's not obvious that three prompts beat one long one, so it's worth being
explicit about why.

**Each step is judged on its own.** A model asked to gather, group and write at
once does the last part well and the first two carelessly. Given only "group
these into themes", grouping is the whole job.

**Failures become visible.** When one prompt produces a bad result, you don't
know which part went wrong. When step 2's output is visibly wrong, you know
exactly where to look.

**Steps can use different models.** Gathering needs tools and little reasoning; a
cheap fast model does it. Analysis may want a stronger one. Splitting lets you
pay for capability only where it's needed.

**Tools stay scoped.** Step 1 needs Terminal; steps 2 and 3 need nothing. Keeping
tools off where they're not needed reduces both cost and the chance of something
unexpected.

## Passing data between steps

Each step receives the previous step's output as its input. Two habits make that
reliable:

**Tell early steps not to summarise.** "Return the output unchanged" — otherwise
a model compresses at the first opportunity and later steps analyse a summary
rather than the data.

**Have steps signal failure explicitly.** "If there are no results, reply exactly:
NO DATA." Then later steps can check for it. Silent empty input is the commonest
way a workflow produces confident nonsense.

## Where it goes wrong

**A later step invents data.** It received nothing or something malformed and
carried on regardless. Add explicit failure signalling.

**Output changes shape run to run.** Be more specific about format. "A table with
these four columns" is followed far more reliably than "summarise the results".

**It's slower than expected.** Each step is a separate request, and they run in
sequence. Three steps is three round trips.

**One step ruins everything downstream.** Test with a single run and read each
step's output before scheduling it.

## Workflows versus agents versus chats

| | |
| --- | --- |
| One role, one kind of job, repeated | An [agent](agents) |
| Fixed sequence, output feeding forward | A workflow |
| Open-ended, needs judgement about what's next | A chat with tools |

The distinction that matters: a workflow is for something whose *shape* you
already know. If the steps depend on what's discovered along the way, a chat with
tools will do better — you're not gaining anything by fixing an order that
shouldn't be fixed.
