---
title: Controlling cost
description: Why agent work costs more than chat, where the money actually goes, and how to spend less without giving much up.
---

# Controlling cost

If you're using a local model, this page doesn't apply — that's free, and it's a
legitimate answer to everything below. This is about cloud models.

## Why agents cost more than chat

A chat message is one request. An agent task is a loop, and **each pass is a full
request that includes the entire conversation so far**.

A task with eight tool calls is nine requests, and the ninth carries everything
from the first eight. Cost grows faster than the number of steps — which is why a
long agent session can cost many times what the same number of chat messages
would.

## Where the money actually goes

**Input tokens, mostly.** Not the model's replies. Everything assembled into each
request — instructions, memory, retrieved passages, tool definitions, and the
whole conversation history — is charged on every pass round the loop.

Practical consequence: a long conversation costs more *per message* than a short
one, because you're resending it each time.

## Set a cap first

**Settings › Usage.** A daily and a monthly limit. When one is reached, new
requests stop rather than continuing quietly.

Do this before running anything unattended. A loop in a scheduled agent is the
one realistic way to be genuinely surprised by a bill, and a cap turns that into
a stopped run and a message.

The usage panel also shows estimated spend by day and month. It's based on
published prices and token counts, so treat it as close rather than exact — the
provider's own dashboard is the authority.

## The things that actually save money

In rough order of effect.

**Use a smaller model for most things.** The largest models are worth it for hard
reasoning and rarely for anything else. You can switch model mid-conversation, so
the expensive one can answer the hard part and a cheap one handle the follow-ups.

**Compact long chats.** A conversation you keep adding to gets more expensive
every turn. [Compacting](../guide/chats) replaces the early part with a summary
and cuts the per-message cost immediately. Auto-compact does it for you.

**Start fresh chats.** Related but different: when you move to a new task,
starting a new chat is cheaper than carrying twenty irrelevant tool results into
it. Cheaper *and* better — irrelevant context degrades answers.

**Enable fewer tools.** Every enabled tool's description is sent on every
request. Forty tools is a standing charge on each message, and it makes tool
choice worse as well.

**Be specific.** Vague requests cause exploration — reading files that turn out
to be irrelevant, searching when you could have named the file. Each of those is
a paid round trip.

**Split large tasks.** Not obviously a saving, but reliably one: a task that goes
wrong at step six costs everything up to step six plus the retry.

## Things that don't save much

**Shortening your prompts.** Your message is a rounding error next to the
conversation history and tool definitions.

**Turning off memory.** It's capped at a fifth of the context window, and it's
usually earning that by preventing repetition.

**Avoiding tools.** A tool call costs a round trip; doing the work yourself costs
your time. That's usually the wrong trade.

## Where cost is easy to lose track of

**Scheduled runs.** They happen whether you're watching or not. Cap first, and
watch the first few.

**Multi-agent swarms.** Several agents on one job means several conversations at
once. Genuinely useful for parallel work, expensive for anything sequential.

**Long browser sessions.** Each page read goes into context and is resent on every
subsequent request. Reading thirty pages in one conversation is dear — work in
batches, saving results as you go.

**Image generation.** Substantially dearer than text, and easy to forget when an
agent is generating them unattended.

## Reasonable defaults

If you want a setup that won't surprise you:

- A daily cap you'd be comfortable losing
- Auto-compact on, at a moderate threshold
- A mid-tier model as your default, switching up when needed
- A [local model](../models/local) for anything touching private files, which is
  free and doesn't leave your machine

Then check the usage panel weekly for the first month. Where your money goes is
usually a surprise the first time you look.
