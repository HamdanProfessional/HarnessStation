---
title: Comparing & evaluating
description: Benchmarks, side-by-side comparison, and building your own test set.
---

# Comparing & evaluating

Three panels, answering three different questions.

## Benchmarks — how models rank publicly

**Library › Benchmarks** shows published benchmark data: reasoning, coding,
speed, price. Useful for narrowing the field before paying for anything.

This is the one thing the app fetches on your behalf, through a gateway that
holds *our* key for the benchmark source. It needs no key of yours and sends none
of your data — it's public information about models, not anything about you.

> **Note:** Public benchmarks are a weak proxy for your work. They're
> contaminated by training data, and a model that leads a leaderboard often
> isn't the one that does best on your actual task. Use them to shortlist, then
> test properly.

## Compare — the same prompt, several models

**Library › Compare** sends one prompt to several models at once and shows the
replies side by side, with token counts and cost.

This is the fastest way to answer "is the expensive model actually better *for
this*". Often it isn't, and you can see that in thirty seconds.

## Evals — your own test set

**Library › Evals** is for when the answer matters enough to measure.

Define test cases — a prompt and what a good answer looks like — then run them
against any model. Results are scored and kept, so you can re-run the set when a
new model appears and see whether it's genuinely better on *your* cases.

Worth building when:

- You're choosing a model for something that will run many times
- You want to know whether a cheaper model is good enough
- You've changed a prompt and want to know if you improved it

Twenty representative cases tell you far more about your workload than any public
leaderboard.

## Watching what it costs

**Settings › Usage** tracks estimated spend by day and month, and lets you set
caps. When a cap is reached, new requests stop rather than continuing quietly.

Estimates are based on published prices and token counts, so treat them as close
rather than exact. The provider's own dashboard is the authority.
