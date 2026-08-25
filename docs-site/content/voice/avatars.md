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

The avatar breathes, blinks, and its mouth moves while speaking; the head also
eases toward where your pointer is, over a slow idle sway.

Lip-sync is driven by the *measured* loudness of the voice you're actually
hearing — an audio analyser sits on playback for Kokoro, Piper, data-URL system
voices and cloud engines. The native Windows voice (which plays outside the
app's audio graph) and any moment the analyser can't run fall back to a
synthetic jaw movement, so the mouth always moves with something.

## Licensing

Worth reading before you use a model you found online.

VRoid Hub models each carry conditions the creator set: whether commercial use is
allowed, whether modification is, whether the model may be used for "corporate"
purposes. Those conditions are real, and using a model outside them is a
copyright matter rather than a formality.

For anything you'll show publicly or use commercially, prefer:

- Models explicitly marked CC0, such as those on Open Source Avatars
- Models you made yourself in VRoid Studio
- Models where the creator's terms clearly permit your use

For a character only you ever see, the practical risk is negligible — but the
terms still apply.

## Making your own

[VRoid Studio](https://vroid.com/en/studio) is free and is the usual route. It's
a character creator rather than a modelling tool, so it takes an afternoon rather
than a career, and it exports VRM directly.

The advantage beyond licensing is fit: a character you made for this looks right
at the size and framing the app uses, which stock models often don't.

## Performance

A 3D model renders continuously while a call is open. On a laptop that's the
difference between a quiet fan and a loud one, and it will shorten battery life
noticeably.

Some rough guidance:

- **Integrated graphics** — the orb, or expect a warm laptop
- **Any discrete GPU** — fine
- **On battery** — the orb, unless you want the fan

If a call gets choppy, switch to the orb. Voice quality is completely unaffected;
the avatar is only what you're looking at.

## Where it goes wrong

**The model doesn't appear.** Check it selected in **Settings › Voice**. A VRM
that fails to load usually has an unusual export — try another to establish
whether it's the file or the app.

**MMD renders oddly.** MMD support is less tested than VRM. If a `.pmx` misbehaves,
VRM is the more reliable format and worth switching to.

**Textures are missing on an MMD model.** The zip didn't contain the texture
folder, or the paths inside it don't match what the model expects. Re-export from
the source.

**It's slow to appear on first use.** The model is being loaded and parsed. Large
models take a few seconds; that's once per session rather than once per call.

**The mouth movement looks wrong.** It follows speech volume rather than the
actual sounds, so it's approximate by design. Proper viseme lip-sync is on the
roadmap and isn't there yet.
