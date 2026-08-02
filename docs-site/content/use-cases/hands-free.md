---
title: Hands-free work
description: Using voice when your hands are busy, and the setup that makes it genuinely useful rather than a novelty.
---

# Hands-free work

Voice is a novelty for five minutes and genuinely useful after that — but only
with the right setup. This page is mostly about that setup, because it's what
makes the difference.

## Where it earns its place

- **Thinking out loud** — talking through a problem is faster than typing it, and
  something that asks questions back beats a notebook
- **Hands occupied** — cooking, driving, soldering, holding a baby
- **Dictating long text** — speaking a first draft is quicker than typing one
- **Away from the desk** — the global hotkey works from anywhere

Where it doesn't: anything needing exact text. Code, commands, URLs. Speech
recognition mangles punctuation and identifiers, and you'll spend longer fixing
the result than typing would have taken.

## The setup that matters

Three things separate "usable" from "abandoned after a day".

**Headphones.** Not optional if you want to interrupt it. Through speakers the
app hears its own voice, and barge-in makes it interrupt itself continuously.

**A good voice.** The system voice is flat enough to be tiring over a long
session. Switch to **Kokoro** in **Settings › Voice** — local, free, and much
better. → [Voice engines](../voice/engines)

**Speech rewrite**, also in **Settings › Voice**. It runs each reply through a
small fast model that rewrites it for the ear: numbers as words, no markdown,
shorter sentences. It costs a little latency and makes a large difference,
because text written to be read is genuinely unpleasant to listen to. Use the
smallest model you have.

## Choosing a mode

| Mode | Good for |
| --- | --- |
| **Auto** | Sitting down for a conversation. Needs headphones and a quiet room |
| **Push to talk** | Noisy places, and anywhere you don't want it listening between questions. **Ctrl+Shift+V**, from any app |
| **Wake word** | Long sessions where you speak only occasionally |

Push-to-talk is the most reliable, and the one to start with.

## Talking through a problem

The most valuable use, and worth setting up for deliberately.

```text
I'm trying to work out whether the retry logic belongs in the client
or the server. Ask me questions until you understand the constraints,
then tell me what you'd do.
```

Asking it to interrogate you first is what makes this better than dictation.

Turn on **barge-in** so you can cut in the moment it goes the wrong way. That one
setting is the difference between a conversation and a series of announcements.

## Dictating

```text
I'm going to dictate a draft. Don't interrupt and don't summarise.
When I stop, clean up the grammar but keep my wording and tone.
```

"Keep my wording" is worth insisting on — models rewrite into their own voice by
default, and you'll get something correct that doesn't sound like you.

For text you'll edit anyway, use **Dictate** in the composer instead. It types
into the box without generating a reply.

## Away from your desk

Push-to-talk works system-wide, so the app doesn't need to be focused or even
visible:

1. Turn on **keep running in the tray** in **Settings › General**
2. Close the window — it keeps running
3. Hold **Ctrl+Shift+V** anywhere, speak, release

If the hotkey does nothing, another application has claimed it. Global shortcuts
are first-come, and only one program can hold one.

## Calls are saved

A call is saved like any other chat and reopens as a call, with its
[memory](../guide/memory) intact. A thinking-out-loud session on Monday can be
picked up on Tuesday.

Calls that produced nothing aren't saved — the chat is created at the first
exchange, not when you press the button, so a mistaken press leaves nothing
behind.

## Where it goes wrong

**It hears you but doesn't answer.** Threshold too high, wrong microphone, a wake
word set, or the silence timeout cutting you off. Watch the level meter in
**Settings › Voice** while speaking; if it barely moves, that's your answer.

**It interrupts itself constantly.** Barge-in through speakers. Use headphones,
or turn barge-in off.

**It cuts you off mid-sentence.** Increase the silence timeout, or turn on smart
endpointing, which waits longer when a sentence sounds unfinished.

**Technical words come out wrong.** Whisper transcribes what it hears, and
product names and identifiers are the hardest case. A larger STT model helps
somewhat; typing helps more.

**Long replies take a moment to start.** Kokoro synthesises on your CPU. It works
a sentence at a time, so the first plays while the rest are still being made —
but on an older machine, Piper is quicker.
