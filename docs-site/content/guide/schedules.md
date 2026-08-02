---
title: Schedules
description: Running an agent or workflow on a timer, and what to know before leaving one unattended.
---

# Schedules

A schedule runs an [agent](agents) or [workflow](workflows) on a timer, without
you present.

## Creating one

**Automation › Schedules › New schedule**: choose what to run, how often —
hourly, daily, weekly, or a cron expression — and what to do with the result.

Results can land in a new chat, be appended to an existing one, or raise a
notification.

## The app must be running

Schedules fire from within HarnessStation, so it has to be running for them to
happen. Turn on **keep running in the tray** in **Settings › General** and
closing the window leaves it running in the background rather than quitting.

A schedule that was missed while the app was closed does not fire retroactively.

## Before you leave one unattended

> **Warning:** A scheduled run has the tools you gave it, and no one watching.
> Set [spend caps](../reference/settings) in **Settings › Usage** first — a loop
> in an unattended agent is the one way to run up a bill you didn't intend.

Beyond that:

- **Keep write access narrow.** A schedule that reads and reports is a much
  smaller risk than one that edits files.
- **Run it by hand first.** The Run now button exists for exactly this.
- **Watch the first few.** Something that works once at 10am may behave
  differently at 3am when a service it depends on is down.

## Good candidates

- A morning summary of overnight activity
- Periodically re-indexing a [knowledge base](knowledge) whose files change
- Checking a source and notifying you only when something changed

## Poor candidates

Anything where a wrong answer acts on the world without review — sending mail,
posting, committing. Have it prepare a draft and tell you.

## A worked example

A morning briefing that's ready before you are.

**The agent** — *Automation › Agents*, instructions along these lines:

```text
Summarise what needs my attention today.

Check the project directory for anything failing, and read
notes/todo.md for outstanding items.

Report only what changed since yesterday or needs a decision.
If nothing does, say "Nothing needs you today" and stop.
Keep it under 150 words.
```

**The schedule** — daily at 07:00, result to a new chat.

The instruction to report nothing is what keeps a daily briefing worth reading.
Without it, a quiet day produces a page of filler and you stop opening them
within a fortnight.

## Cron, for anything irregular

The preset intervals cover most cases. For the rest, cron expressions:

| | |
| --- | --- |
| `0 9 * * 1-5` | 9am, weekdays only |
| `0 */4 * * *` | Every four hours |
| `30 8 1 * *` | 08:30 on the first of each month |
| `0 18 * * 5` | 6pm Friday |

## Watching what they do

Each run appears where you sent it, and every tool call it made is in that
conversation. When a schedule starts producing odd output, that record is where
the answer is.

Runs are chats like any other, so they can be searched, exported, and deleted.

## Where it goes wrong

**It didn't run.** The app wasn't running. Schedules fire from inside
HarnessStation, and a missed run doesn't fire late — turn on tray mode in
**Settings › General**.

**It ran but did nothing useful.** Test with **Run now** and read each step. Most
scheduling problems are really agent problems, and they're much easier to see
when you're watching.

**It works in the morning and fails overnight.** Something it depends on wasn't
available — a machine asleep, a service in maintenance, a VPN disconnected. Watch
the first few runs at their real time rather than only testing at your desk.

**Output quality drifts over weeks.** Models vary run to run. The more specific
your instructions about format and length, the less it wanders.

**It ran up a bill.** A loop with nobody watching. This is what
[spend caps](../concepts/cost) are for, and why they should be set before the
first scheduled run rather than after.
