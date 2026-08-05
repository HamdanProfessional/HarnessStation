---
title: Hooks & guardrails
description: Control what tools the agent may run, and fire webhooks on lifecycle events.
---

# Hooks & guardrails

Two related controls, both in **Settings › Hooks & guardrails**: *guardrails*
decide what the agent is allowed to do on its own, and *webhooks* let you react
to what it does.

## Guardrails

For each sensitive built-in tool — running terminal commands, writing, editing
or deleting files, making HTTP requests — pick a policy:

- **Allow** — runs freely (the default).
- **Ask** — pops a confirmation before the tool runs; you approve or decline.
- **Deny** — the tool is blocked entirely; the model is told it's off.

The policy is enforced in one place for **every** chat, agent and schedule, so a
guardrail you set once covers unattended runs too. This is the safety net for the
tools that actually touch your machine — set **Ask** on `run_terminal` if you
want to see every command before it executes.

> **Tip:** guardrails complement the [working directory](tools#the-working-directory),
> which already limits *which files* a tool can reach. Guardrails limit *whether*
> a tool runs at all.

### Rules — match on the arguments

For finer control, add a **rule** that inspects the tool's *arguments*, not just
its name. A rule fires when:

- the **tool** matches (an exact id, or `*` for any), and
- if a **pattern** is given, the tool's JSON arguments match that regex
  (case-insensitive).

…and then it does one of **Allow / Ask / Deny**. Rules are checked in order and
the **first match wins**, so an early **Allow** can whitelist a specific case a
later broader **Deny** would otherwise block. A malformed regex simply never
matches, so it can't accidentally block everything.

One-click presets cover the common cases: **block destructive shell** (`rm -rf`,
`mkfs`, `dd if=`, fork bombs…), **confirm every HTTP request**, and **confirm
writes to `.env` / secret-looking paths**. Examples:

| Tool | Pattern | Action |
| --- | --- | --- |
| `run_terminal` | `rm\s+-rf` | Deny |
| `write_file` | `\.env\|credential` | Ask |
| `*` | `password` | Deny |

## Webhooks

Fire a `POST` to a URL when something happens, for logging, alerts, or piping
results into Slack. Add one under **Webhooks**, choosing:

- **On** — the event: a turn finishing, a tool being called, an error, or a
  scheduled run completing.
- **Format** — raw **JSON**, or a **Slack message** (`{ "text": … }`, so a Slack
  incoming-webhook URL just works).
- **URL** — any endpoint.

Add optional **custom headers** (for a private or authenticated endpoint — e.g.
an `Authorization` token), a **label**, and use **Test** to fire a sample payload
and confirm the endpoint answers.

Webhooks are **best-effort**: a slow or dead endpoint never holds up the app, and
the payload deliberately carries **no prompts and no keys** — just the event, a
timestamp, and a short summary.

## Delivering scheduled results

A [schedule](schedules) can also POST its own output to a webhook or Slack when
it finishes — set the destination on the schedule itself. That's the outbound
half of automation: a nightly job can land in a channel instead of only the app.

See also [Privacy & security](../advanced/privacy).
