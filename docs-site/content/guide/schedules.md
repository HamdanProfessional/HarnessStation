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
