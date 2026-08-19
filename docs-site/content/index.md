---
title: What HarnessStation is
description: Your AI chat, your machine, your keys. Local-first, no account, no telemetry — a private AI chat app that gives any model real tools.
---

# What HarnessStation is

**Your AI chat. Your machine. Your keys.**

Local-first. No account. No telemetry. Your keys stay in your OS keychain. Your
chats never leave your machine.

It's a serious AI chat app for people who'd rather their conversations weren't on
someone else's server. You bring the model — a local one through Ollama or
LM Studio, or a cloud one through your own API key — and the app gives it real
tools: your files, a terminal, the web, a browser it can drive, knowledge, memory
and a voice you can talk to.

It runs as a desktop app on Windows and Linux, and — from the same codebase — in
a browser tab with no install at all, where a real Linux kernel and real CPython
run inside the page. See [trying it without installing](advanced/web).

## What that means in practice

- **Tools** — read and write files, run searches, call your own scripts, drive a
  browser. Off by default; you turn on what you want it to reach.
- **Knowledge** — point it at documents and it can search them properly, rather
  than you pasting excerpts into every message.
- **Memory** — facts worth keeping persist across chats, so you stop
  re-explaining yourself.
- **Voice** — hold a conversation out loud, with an on-screen character if you
  want one.
- **Automation** — save a repeatable task as an agent, chain steps into a
  workflow, or put either on a schedule.

## What it is not

It isn't a model. It doesn't host one, and it doesn't resell anyone's.

That's a deliberate limit and it shapes everything: **the app ships with no API
keys**. Models, image generation, MCP servers — you supply the credentials, they
go to that provider directly, and nothing routes through us. The only thing we
serve is public benchmark data, which needs no key of yours and carries none of
your data.

If you want a model that costs nothing, [run one locally](models/local) — the app
was built with that as a first-class case, not an afterthought.

## Is it right for you?

It's a good fit if you want a model to actually *do* things on your own machine,
you already have a key or a local model, and you'd rather your conversations
stayed on your disk than someone's server.

It's a poor fit if you want a polished consumer chat app with a subscription and
nothing to configure. That's a genuinely different product, and there are good
ones.

> **Note:** HarnessStation is early software. It's stable enough to use daily —
> that's what it was built for — but you will find rough edges, and some features
> in these docs are newer than others. Where something is unfinished or has a
> sharp corner, these pages say so rather than glossing over it.

## Where to start

New here? [Install it](start/install), then walk through
[your first chat](start/first-chat) — that gets you from nothing to a working
conversation in about five minutes. After that, [the tour](start/tour) explains
what all the other panels are for.

If you'd rather see it doing something real first, the
[use cases](use-cases/overview) are end-to-end walkthroughs — working with a
codebase, researching a topic, automating a weekly report — with the actual
prompts and the failures worth knowing about.

And if you want the mental model before the details,
[how it works](concepts/how-it-works) explains the agent loop and what goes into
each request, which turns out to explain most surprising behaviour.
