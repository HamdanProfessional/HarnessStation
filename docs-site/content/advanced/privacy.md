---
title: Privacy & security
description: What leaves your machine, what doesn't, and the things worth being careful with.
---

# Privacy & security

## What leaves your machine

**Your prompts, files and documents** go to the model provider you chose, and
nowhere else. With a local model they don't leave at all.

**Nothing routes through us.** The app has no account, no telemetry, and no
server holding your conversations. There is nothing to opt out of because there
is nothing collecting.

**One exception:** public benchmark data is fetched through a gateway so the
Benchmarks panel isn't empty. It's a read of public information about models. It
carries no key of yours and no data about you.

## Where credentials are kept

API keys and OAuth tokens go in your operating system's credential store —
Windows Credential Manager, or Secret Service on Linux. Not in settings files,
and not in exports.

An [exported chat](../guide/chats) contains the conversation, not your keys.

## Things worth being careful with

**The terminal tool** runs real commands as you. A working directory limits which
files it can reach; it doesn't stop a command using the network. Enable it when
you want that.

**Browser sessions.** A site you sign into in the [in-app browser](../guide/browser)
stays signed in, and the model can act on it. Treat that as delegated access.

**Scheduled runs** act with no one watching. Set [spend caps](../reference/settings),
and prefer schedules that report over ones that change things.

**The device mesh is not encrypted yet.** See [the warning](devices) — over
anything but your own network, put it inside a VPN or tunnel.

**Passive memory** stores facts from your conversations on disk. Review it in
**Settings › Memory** occasionally; it sometimes keeps more than you'd expect.

## Reviewing what it did

Every tool call is recorded in the conversation with its arguments and result, so
there's a full record of what was touched. It's worth reading after an
agent has been working unattended.

## Reporting a security issue

If you find a vulnerability, please report it privately rather than opening a
public issue, and allow time for a fix before disclosing.
