---
title: Voice engines
description: Four ways to make it speak, what each costs, and which to pick.
---

# Voice engines

Choose in **Settings › Voice › Voice engine**.

| Engine | Quality | Cost | Offline | Languages |
| --- | --- | --- | --- | --- |
| **Kokoro** | Very good | Free | Yes, once downloaded | English |
| **Cloud** | Best | Per character | No | Many |
| **Piper** | Good | Free | Yes, once downloaded | English |
| **System** | Flat | Free | Yes | Whatever you've installed |
| **Auto** | — | — | — | Picks the best already installed |

## Kokoro — the recommended default

An 82M-parameter neural model running on your own machine. Real prosody, seven
voices, no key and no per-word cost.

The first preview downloads about 90 MB, once. Synthesis is CPU-bound and roughly
real-time, so a long reply takes a moment before it starts — speech is generated
a sentence at a time, so the first sentence plays while the rest are still being
made.

English only.

## Cloud — the best quality

Four services, each with your own key:

| | |
| --- | --- |
| **OpenAI** | Reliable and cheap. `gpt-4o-mini-tts` takes a style instruction, so the persona genuinely changes the delivery |
| **ElevenLabs** | The most human, and the dearest. Use Flash v2.5 for conversation |
| **Cartesia** | Fastest to first audio, which is what you notice in a call |
| **Groq** | Fast and inexpensive; fewer voices |

If a request fails, it falls back to a local voice rather than going silent, and
tells you why — a rejected key, no credit and a bad voice id each have a
different fix.

## Piper

The older local option. Lighter than Kokoro and quicker to synthesise, but
noticeably more synthetic. Worth choosing on a slow machine.

## System voices

Windows SAPI, or `espeak-ng` / `speech-dispatcher` on Linux. Instant and free,
and the flattest of the lot. Their advantage is **language coverage** — a system
voice installed for a language is the only offline way to speak it.

On Windows, voices installed through Settings › Time & Language live in a
different registry to the classic ones. Both are found and listed.

## Auto

Uses the best voice **already present**: Kokoro if downloaded, then Piper, then
the system voice. It will never start a download or spend money from a setting
you didn't explicitly choose.

## Making it sound less like a machine

In **Settings › Voice**:

- **Human delivery** — contractions, breath pauses, pitch movement.
- **Expressiveness** — how much movement. 0 flat, 1 natural, 2 animated.
- **Persona** — friendly, calm, upbeat or professional. On engines that accept a
  style instruction this changes the delivery, not just the words.
- **Speech rewrite** — runs each reply through a small fast model that rewrites
  it for the ear: numbers spoken as words, no markdown, shorter sentences. Costs
  a little latency and makes a large difference. Use the smallest model you have.
