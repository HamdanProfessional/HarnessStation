---
title: Avatars
description: Putting a 3D character on screen, in VRM or MMD format.
---

# Avatars

The voice avatar can be an orb, or a 3D character that moves while it speaks.

## Choosing one

**Settings › Voice › On-screen character**. The orb is the default and costs
nothing.

## Getting a model

**VRM** is the format to prefer — self-contained in a single file, designed for
exactly this.

- **[VRoid Hub](https://hub.vroid.com)** — thousands, many free. Check each
  model's licence for whether use like this is permitted.
- **[VRoid Studio](https://vroid.com/en/studio)** — free, makes your own.
- **Open Source Avatars** — browsable from within the app, CC0-licensed.

**MMD** (`.pmx`) also works. Because an MMD model needs its texture folder
alongside it, import it as a `.zip` and the app extracts it.

> **Note:** MMD support is less tested than VRM. If a model renders oddly, VRM is
> the more reliable route.

## Importing

**Import** in the avatar section, then choose your `.vrm` or `.zip`. The file is
copied into the app's own folder, so moving or deleting the original afterwards
is fine.

## What it does

The avatar breathes, blinks, and its mouth moves while speaking. Expression is
currently simple — the mouth follows speech volume rather than the actual sounds
being made. Proper viseme lip-sync is on the roadmap.

## Performance

A 3D model uses your GPU. On a laptop it's the difference between a quiet fan and
a loud one, and it will shorten battery life noticeably.

If a call gets choppy, switch back to the orb. Voice quality is unaffected — the
avatar is only what you're looking at.
