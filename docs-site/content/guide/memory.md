---
title: Memory
description: How the app remembers things across conversations — three scopes, what gets kept, and the budget that stops memory eating your context window.
---

# Memory

Memory is what stops you re-explaining yourself in every new chat. A fact learned
once — your name, your stack, how you like answers written — is recalled later
without you repeating it.

## Three scopes

Memory is kept at three levels, and which one a fact lands in decides who sees
it.

| Scope | Recalled by | Good for |
| --- | --- | --- |
| **Chat** | This conversation only | Details of the task at hand |
| **Project** | Every chat in the project | A client's conventions, a codebase's quirks |
| **Global** | Everything | Who you are, how you work, lasting preferences |

The separation is the point. A fact about one client's deployment process
shouldn't surface while you're working on another's, and something that belongs
in a single conversation shouldn't follow you around forever.

## How facts get there

**Passive memory** (**Settings › Memory**) harvests them for you. After a turn,
a small background pass looks for anything durable and files it in the right
scope. It costs a little, doesn't block the reply, and needs no tool call.

You can also just say so — "remember that I prefer TypeScript" — and it will be
stored deliberately.

## Reading and pruning

**Settings › Memory** lists everything remembered, with what scope each fact is
in. You can delete individual entries or clear a scope entirely. It's worth
looking through occasionally: passive extraction sometimes keeps things that
were true for an afternoon.

**Tidy** merges duplicates and near-duplicates that build up when the same fact
is learned several ways.

## The budget

This is the part worth understanding, because it's where memory stops being free.

Everything recalled is *text in the prompt*, competing with your actual
conversation for the model's context window. Unbounded memory would eventually
crowd out the thing you're talking about.

So recall is capped as a share of the model's context window — **20% by default,
25% maximum**. When there's more memory than fits, the least relevant is dropped
rather than the newest, and the three scopes each get a slice of the allowance so
global facts can't crowd out the ones about the task in hand.

The cap is deliberately not adjustable past a quarter. Beyond that, memory costs
more than it returns.

> **Note:** Because the budget is a share of the *model's* window, switching to a
> model with a smaller one means less is recalled. That's usually what you want
> — but it's why a small local model can seem more forgetful than it is.

## Memory versus knowledge

They're often confused.

- **Memory** is small facts, learned as you go, injected automatically.
- **[Knowledge](knowledge)** is documents you supply deliberately and searched on
  demand.

"I use pnpm, not npm" is memory. A 200-page specification is knowledge. Putting a
document into memory would eat the whole budget for one file.
