---
title: Device mesh
description: Pairing the machines you own so they can share models, tools and knowledge — and the encryption caveat you must read first.
---

# Device mesh

The mesh lets HarnessStation on one machine reach HarnessStation on another. Use
the desktop's GPU from the laptop; search a knowledge base that only exists on one
of them.

> **Warning:** Mesh traffic is **not encrypted yet**. The pairing handshake stops
> anyone stealing your credentials or replaying a request, but the messages
> themselves — prompts, tool output, retrieved documents — travel in plain text.
>
> On your own home network that's the same exposure as any other local service.
> Across the internet it is not enough. Use a VPN or tunnel (Tailscale,
> WireGuard, SSH) rather than forwarding a port. The app detects public addresses
> and warns you, but the warning is the mitigation, not a fix.

## Turning it on

**Settings › Devices**. Name the machine, press **Turn on**. Optionally have it
start with the app.

Machines on the same network find each other automatically — no addresses to
type. A machine elsewhere is added by address.

## Pairing

Pairing has two ends, and it's easy to muddle them.

1. On the machine you want to reach, press **Show pairing code**.
2. On the other, type that code and the first machine's address, then **Pair**.

The code is valid for five minutes and is consumed by the first device that uses
it. Neither the code nor the long-lived token replacing it ever crosses the
network — the two ends prove they know the secret without sending it.

## What gets shared

**Pairing on its own grants nothing.** Three separate switches, all off by
default:

| Switch | Lets a paired device |
| --- | --- |
| **Models** | Run inference here, using this machine's keys and GPU |
| **Tools** | Call tools on this machine |
| **Knowledge** | Search knowledge bases stored here |

**Shell, Python and file-writing tools are never shared**, whatever the tools
switch says. Pairing is a code typed once; it should not amount to a remote
shell, and that's not a mistake you can take back.

## Using another device

Once paired, **What can it do?** shows what that machine is offering you. Its
models appear alongside your own.

## If a device won't appear

- **Both need the mesh on.** Check **Turn on** on each.
- **Discovery is a network broadcast**, which some networks block — guest and
  corporate Wi-Fi especially. Add the machine by address instead.
- **A firewall may be blocking it.** The mesh listens on port 8793 and announces
  on 8794.
- **Sleeping machines show as offline.** That's correct rather than a fault; they
  stay in the list because they're still yours.
