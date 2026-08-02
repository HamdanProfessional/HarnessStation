---
title: Getting better results
description: The prompt patterns that make the difference with tool-using models, and the ones that don't.
---

# Getting better results

Most prompting advice is written for chat. Agents are different — they act, and
the failures that matter are the ones where they act confidently on a wrong
assumption. These are the patterns that reliably help.

## Say what you don't want

The single highest-return habit.

Models fill unspecified space with reasonable-sounding defaults, and the defaults
are rarely yours.

```text
Review this code. Skip style and formatting — I only want bugs
and unhandled cases.
```

Without the second sentence you get a list dominated by naming and spacing, with
the real finding at position eleven. Exclusions shape output more than
instructions do.

## Give permission to find nothing

The most underused instruction in this page.

```text
If you don't find anything significant, say so rather than listing
minor issues to fill the space.
```

You asked for findings, so a model produces findings. Explicitly permitting an
empty answer is what stops the list padding out with things nobody cares about —
and it's what makes a non-empty list worth reading.

The same idea, elsewhere: "if the documentation doesn't cover it, say so", "if a
field is missing, write *not stated* rather than inferring".

## Make it show its evidence

For anything where being wrong is costly:

```text
Quote the actual code at each step.
For each claim, name the source it came from.
If that's your inference rather than something you read, mark it.
```

This works because it's a cheap check *you* can run. A model that hasn't read the
file can't quote it, and the gap shows up immediately rather than three answers
later.

It's the main defence against the failure mode that matters most with agents: a
fluent, plausible answer that was never grounded in anything.

## Ask for the plan before the work

For anything spanning more than one or two files:

```text
Show me which files need changing and in what order, before
you change anything.
```

Correcting a plan costs a sentence. Correcting fifteen edited files costs an
afternoon — and you may not spot the mistake until later.

## Work in small steps

A model asked to do one thing does it carefully. Asked to do eight, it does the
first two carefully and the rest mechanically.

This is the most common cause of disappointing agent output, and splitting the
request is a bigger improvement than any wording change.

## Say what to do when stuck

Otherwise it picks, and probably not what you'd have picked:

```text
If you're not sure which approach I want, ask instead of choosing.
If a test fails twice, stop and tell me what you found rather
than trying again.
```

That second rule is worth adding to anything involving tests. Left alone, models
will try the same fix repeatedly.

## Match the surrounding code

```text
Match the error-handling style used elsewhere in this file.
```

Without it you get code that works and looks foreign — technically correct, and
obviously written by something else.

## Point at the thing

Vague references get vague results. "Fix the bug in the login flow" sends it
hunting; "in `auth/session.ts`, `refreshToken` doesn't handle an expired refresh
token — it throws instead of returning null" gets a fix.

If you know where the problem is, say so. You're not testing it.

## What doesn't help

**Politeness and pressure.** "Please" and "this is very important" change
nothing. Specificity does.

**Telling it to be an expert.** "You are a senior engineer" is close to noise.
Describing what a good answer contains is not.

**Very long instructions.** Past a point, more text dilutes rather than clarifies
— and in this app it also competes for context with your actual conversation.

**Repeating yourself.** If it ignored an instruction, repeating it rarely works.
Something else in the prompt is probably contradicting it →
[how it works](how-it-works).

## Where to put instructions

| Scope | Where | For |
| --- | --- | --- |
| Everything | **Settings › General** | Language, how you like answers written |
| One project | Project instructions | Conventions for that body of work |
| One chat | The panel on the right | This task |
| One message | The message | Anything specific |

These layer rather than replace, so keep the higher levels short and general.
Long global instructions are paid for on every message, including trivial ones.

If you find yourself writing the same detailed instructions repeatedly, that's
what [agents](../guide/agents) and [skills](../guide/skills) are for.
