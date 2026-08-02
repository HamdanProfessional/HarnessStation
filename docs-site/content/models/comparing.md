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

## Building an eval set that's worth having

Twenty representative cases tell you more about your workload than any public
leaderboard. What makes them representative:

**Use your real inputs.** Not simplified versions. The messy ones with unusual
formatting are exactly where models differ.

**Include the hard cases you've hit.** Every time a model gets something wrong in
normal use, that's a test case. Collecting them as they happen is much easier
than inventing them later.

**Include cases where the right answer is "I don't know".** Models differ far
more in whether they decline than in whether they can answer, and a model that
confidently invents things is worse than one that's merely weaker.

**Write down what a good answer contains**, not the exact wording. "Mentions the
retry limit and that it's configurable" scores better than trying to match a
paragraph.

## When to re-run it

- A new model appears and you're wondering whether to switch
- You changed a system prompt or an agent's instructions
- Your provider updated a model behind the same name — which happens, and can
  change behaviour without notice
- You're considering a cheaper model and want to know the real cost of switching

That third case is the underrated one. A model id you've pinned can change
underneath you, and an eval set is how you notice.

## Reading the results honestly

**A small difference is noise.** Models vary run to run. If two score within a
case or two of each other on twenty cases, you've learned they're comparable, not
that one is better.

**Look at the failures, not the score.** *How* a model fails matters more than
how often. One that occasionally says "I'm not sure" is more useful than one that
occasionally invents an API that doesn't exist, even at the same score.

**Cost and speed are part of the result.** A model scoring slightly lower at a
tenth of the price and twice the speed is usually the better choice for anything
running repeatedly.
