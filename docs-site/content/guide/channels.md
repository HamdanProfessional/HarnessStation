---
title: Channels
description: Reach your agent from Telegram and Discord, not just the app window.
---

# Channels

Channels let you talk to your agent from **Telegram** and **Discord**. While
HarnessStation is running, it stays connected to each platform you enable, routes
every incoming message to an agent, and sends the reply back.

Set them up in **Settings › Channels**.

> **Desktop only.** Channels keep a live bot connection open and call bot APIs a
> browser tab can't reach directly, so they run in the desktop app. On the web
> build the panel points you to the download.

## Telegram

1. In Telegram, message **@BotFather**, create a bot, and copy its **token**.
2. In **Settings › Channels › Telegram**, paste the token and tick **Enable**.
3. Choose which agent handles messages under **Handled by** (or leave it on the
   default, which uses your first provider and your global instructions).
4. Message your bot. The status pill shows **Connected** once it's live.

Uses Bot-API long-polling — no public URL or port forwarding needed.

## Discord

1. At **discord.com/developers**, create an application, add a **Bot**, and copy
   its token.
2. Turn on the **Message Content** intent (Bot → Privileged Gateway Intents) —
   without it the bot can't read message text.
3. Invite the bot to your server (OAuth2 → URL Generator → `bot` scope).
4. In **Settings › Channels › Discord**, paste the token and **Enable**. Pick the
   handling agent, and optionally **Only respond when @-mentioned** so the bot
   stays quiet in busy channels.

Uses the Discord gateway (a WebSocket), reconnecting automatically.

## Who handles a message

Each channel routes to an [agent](agents) you pick, so you decide its
instructions, model, tools and knowledge. Leave it on **Default** for a plain
completion. Replies are trimmed to each platform's limit (4096 characters on
Telegram, 2000 on Discord).

## Security — read this

An incoming message runs the agent **with its tools**. A remote sender could, in
principle, trigger real actions on your machine. So:

- Point a channel at an agent with a **restricted toolset** — only what it needs.
- Use [Hooks & guardrails](hooks) to **Deny** (or gate) sensitive tools like the
  terminal, file writes and HTTP. For a fully unattended channel prefer **Deny**
  over **Ask**, since an "Ask" confirmation only appears in the app window.
- Bot tokens are stored in your settings on this machine. Treat a bot token like
  any credential — anyone with it can act as your bot.

See also [Agents](agents), [Hooks & guardrails](hooks), and
[Privacy & security](../advanced/privacy).
