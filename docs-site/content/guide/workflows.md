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
