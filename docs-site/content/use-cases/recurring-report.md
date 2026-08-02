---
title: A recurring report
description: Turning something you do every Monday morning into something that has already happened by the time you look.
---

# A recurring report

The clearest return in the app: a job you repeat on a schedule, done without you.

## What you'll end up with

A [workflow](../guide/workflows) that gathers, analyses and writes, on a
[schedule](../guide/schedules), landing in a chat you read when convenient.

## The example

A Monday summary of what changed in a project last week — but the shape applies
to anything: support tickets, sales numbers, competitor pages, server logs.

## Build it as steps, not one prompt

The instinct is one long prompt. Split it instead. A model asked to gather,
analyse and write in one go does the last part well and the first two carelessly,
and when the output is wrong you can't tell which part failed.

**Automation › Workflows › New workflow.**

**Step 1 — gather.** Tools: Terminal.

```text
Run: git log --since="7 days ago" --pretty=format:"%h %an %s"
Return the output unchanged. Don't summarise it yet.
```

"Don't summarise yet" matters. Left alone, a model compresses at the first
opportunity, and step two then analyses a summary rather than the data.

**Step 2 — analyse.** No tools; this is reasoning over what step 1 returned.

```text
Group these commits into themes. Ignore formatting and dependency bumps.
For each theme, say what changed and whether it affects how the system
behaves for users.
```

**Step 3 — write.** No tools.

```text
Write a short summary for someone who wasn't here last week.

Lead with anything that changes behaviour. Keep it under 300 words.
Plain sentences, no headings, no bullet lists. If nothing significant
happened, say that in one line rather than padding.
```

That last sentence prevents the most common failure of scheduled reports: a
quiet week producing an important-sounding page about nothing, which teaches you
to stop reading them.

## Test before scheduling

**Run now**, and read every step's output. You're checking that step 1 returned
real data and step 2 saw all of it. Fixing a workflow after four weeks of bad
Monday reports is worse than spending ten minutes now.

## Schedule it

**Automation › Schedules › New schedule.** Choose the workflow, set Monday
morning, and where the result should go — a new chat, or a notification.

Two requirements:

**The app has to be running.** Schedules fire from inside HarnessStation. Turn on
**keep running in the tray** in **Settings › General**, and closing the window
leaves it running instead of quitting. A schedule missed while the app was closed
does not fire late.

**Set a spend cap** in **Settings › Usage** before leaving anything unattended.

## Where it goes wrong

**The report is confidently wrong about a quiet week.** See above — give explicit
permission to report nothing.

**Step 1 returns nothing and the rest carries on regardless.** Add "if there are
no commits, say exactly: NO DATA" and have step 2 pass that through. Silent
failure is worse than a loud one.

**It works at 10am and fails at 3am.** Something it depends on wasn't available.
Watch the first few runs at their real time.

**Output drifts over weeks.** Models vary run to run. The more specific your
formatting instructions, the less it wanders.

## Variations

The same three-step shape covers most reporting:

- **Support** — pull yesterday's tickets, group by cause, flag anything recurring
- **Competitors** — read a set of pages, compare with last week, report changes
- **Infrastructure** — scan logs for errors, group them, report anything new
- **Personal** — calendar and inbox, summarised into what actually needs you

The step that changes is the first one. Analysis and writing stay much the same.
