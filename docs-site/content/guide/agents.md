---
title: Agents
description: Saving a role — instructions, tools, knowledge and memory — as one reusable thing.
---

# Agents

An agent is a configuration you've named: a system prompt, a model, a set of
tools, knowledge bases, and its own memory. Instead of setting all that up again
each time, you pick the agent.

## Creating one

**Automation › Agents › New agent**:

| Field | |
| --- | --- |
| **Name** | How you'll refer to it, and how other agents see it |
| **Instructions** | Its role, in as much detail as it needs |
| **Model** | Or inherit the chat's |
| **Tools** | What it may do |
| **Knowledge** | Documents it can search |
| **Working directory** | Where file tools are confined |

Instructions carry most of the weight. "You review code" produces generic
commentary; describing what to look for, what to ignore, and how to report it
produces something worth reading.

## Running one

Three ways:

- **Directly** — choose it from Agents and give it a task.
- **From a chat** — the model can hand a subtask to a named agent, if the
  **Agents** tool group is on. Useful for delegating something noisy so its
  output doesn't fill the main conversation.
- **[On a schedule](schedules)** — unattended, on a timer.

## Agent memory

Each agent keeps its own memory, separate from your chats. A research agent
accumulates what it has learned about your sources; a code reviewer learns your
conventions. It doesn't leak into your normal conversations, and yours doesn't
leak into it.

## Swarms

Several agents can work on one job at once, with a shared view of which files
each is touching so they don't overwrite each other. When one changes a file
another is depending on, the second is told.

This is worthwhile for genuinely parallel work — reviewing twelve files, checking
one thing across many places. It's slower and dearer than a single agent for
anything sequential.

## Writing instructions that work

**Be specific about scope.** What it should do, and what it shouldn't.

**Say what output you want.** "Reply with a bulleted list, most serious first"
beats hoping.

**Give it the tools it needs and no more.** An agent with every tool enabled
chooses worse than one with three.

**Say what to do when stuck** — ask, stop, or make an assumption and flag it.
Otherwise it will pick one, and probably not the one you wanted.
