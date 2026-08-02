---
title: Talking to it
description: Holding a spoken conversation — starting a call, push-to-talk, interrupting, and saving calls like any other chat.
---

# Talking to it

Press **New call** in the sidebar and talk. Speech is transcribed, answered, and
spoken back.

## Starting

A call needs two things beyond a normal chat: a way to hear you, and a way to
speak.

**Hearing** uses Whisper, running locally. The first call downloads a model —
`base` is the sensible default, `tiny` is faster and less accurate, `small` is
slower and better. Nothing is uploaded; transcription happens on your machine.

**Speaking** has [several engines](engines). The default uses whatever's already
available; for a genuinely good voice, choose Kokoro or a cloud service.

## The three modes

| Mode | |
| --- | --- |
| **Auto** | It listens continuously and answers when you stop talking |
| **Push to talk** | Hold a key while speaking. Works from any app: **Ctrl+Shift+V** |
| **Wake word** | Listens, but only responds when addressed by a phrase you set |

Auto is best with headphones. Through speakers, it can hear itself.

## Interrupting

With **barge-in** on, talking over the avatar stops it and it listens to you.
This makes a conversation feel like one rather than a series of announcements.

It needs headphones. Through speakers the app hears its own voice and interrupts
itself constantly — if that happens, this is why.

## While it's thinking

It keeps listening while transcribing and answering, so you can add something
without waiting for the pause. A rolling transcript of what it's hearing can be
turned on in **Settings › Voice** — useful for confirming it heard you, at the
cost of extra transcription passes.

## Ending a call

Press stop. The conversation is saved like any other chat and reopens as a call,
so a spoken thread can be picked up later — with its [memory](../guide/memory)
intact.

Calls that produced nothing aren't saved. A call is created when the first
exchange happens, not when you press the button, so a mistaken press doesn't
leave an empty chat behind.

## Languages

Set the language you speak in **Settings › Voice**, or leave it on auto-detect.
Replies can follow your language or be pinned to one, and speech can be
transcribed straight into English regardless of what you spoke.

> **Note:** Kokoro and Piper are English-only. For other languages use a cloud
> voice or a system voice with that language installed.

## If it hears you but doesn't answer

- **Threshold too high** — check the level meter in **Settings › Voice** while
  speaking; adjust until it moves clearly.
- **Wrong microphone** — pick it explicitly rather than relying on the default.
- **Wake word on** — it's waiting to be addressed.
- **Silence timeout too short** — it's cutting you off mid-sentence. Increase it,
  or turn on smart endpointing, which waits when a sentence sounds unfinished.
