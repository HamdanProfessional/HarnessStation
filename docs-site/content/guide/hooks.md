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

## Webhooks

Fire a `POST` to a URL when something happens, for logging, alerts, or piping
results into Slack. Add one under **Webhooks**, choosing:

- **On** — the event: a turn finishing, a tool being called, an error, or a
  scheduled run completing.
- **Format** — raw **JSON**, or a **Slack message** (`{ "text": … }`, so a Slack
  incoming-webhook URL just works).
- **URL** — any endpoint.

Webhooks are **best-effort**: a slow or dead endpoint never holds up the app, and
the payload deliberately carries **no prompts and no keys** — just the event, a
timestamp, and a short summary.

## Delivering scheduled results

A [schedule](schedules) can also POST its own output to a webhook or Slack when
it finishes — set the destination on the schedule itself. That's the outbound
half of automation: a nightly job can land in a channel instead of only the app.

See also [Privacy & security](../advanced/privacy).
