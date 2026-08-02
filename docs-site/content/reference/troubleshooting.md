---
title: Troubleshooting
description: The things that actually go wrong, and what to do about each.
---

# Troubleshooting

## Nothing happens when I send a message

**No provider configured.** Check **Settings › Providers** has one, saved.

**Local server not running.** Start Ollama or LM Studio's server.

**Key rejected.** A 401 or 403 means the key is wrong or has no credit. Verify it
at the provider's own console.

**Cap reached.** If you've set [spend caps](settings), requests stop. The message
says so.

## It ignores the tools

Most often the model simply can't call them — many small local models can't,
whatever the model card says. Test with a larger or cloud model before assuming a
configuration problem.

Otherwise: the tool isn't enabled *in this chat* (enabling is per-conversation),
its description is too vague for the model to know when to use it, or too many
are enabled and it's choosing badly among forty options.

→ [Tools](../guide/tools)

## The app has frozen

Frozen while a page was open in the browser panel is the known case. A heavy page
can stop responding, and some operations wait on it.

Close the browser panel when you're not using it. If it locks up, the app has to
be ended from Task Manager or `kill`; your conversations are saved continuously,
so at most the last few seconds of a reply are lost.

If you can reproduce it, that's genuinely useful in a bug report — say which site
and what you were doing.

## Voice hears me but doesn't reply

- The **threshold** is too high — watch the level meter in **Settings › Voice**
  while speaking.
- The wrong **microphone** is selected; choose it explicitly.
- A **wake word** is set and it's waiting to be addressed.
- The **silence timeout** is cutting you off. Increase it, or turn on smart
  endpointing.

## It interrupts itself constantly

Barge-in through speakers: it's hearing its own voice. Use headphones, or turn
barge-in off.

## The voice sounds robotic

You're on a system voice. Switch to **Kokoro** in **Settings › Voice** — free,
local, much better — or a cloud service for the best quality.
→ [Voice engines](../voice/engines)

## Windows says the app isn't safe

The app isn't code-signed yet, so Windows warns about it as it does for any
unsigned program. **More info → Run anyway**, or build from source if you'd
rather not. → [Install](../start/install)

## A knowledge base returns nothing useful

**No embedding model** set — **Settings › Providers › Embeddings**.

**The embedding model changed** since indexing. Old vectors aren't comparable
with new ones; re-index.

**The documents are unstructured.** Text without headings chunks arbitrarily.

**The question is too broad.** Retrieval matches your wording — ask specifically.

## Changes in Settings don't stick

Settings apply on **Save**. If you navigated away, you were asked to confirm; the
draft is discarded. Look for the unsaved marker beside the title.

## Everything is slow

**A local model too large for your memory** will swap and crawl. → [Running models locally](../models/local)

**Kokoro synthesis** is CPU-bound; on an older machine Piper is quicker.

**A 3D avatar** uses the GPU continuously. Switch to the orb.

**A very long chat** costs more to process each turn. [Compact it](../guide/chats).

## Reporting a bug

Useful to include: what you did, what happened, which model and provider, and
whether the browser panel or a call was open. If the app froze, say so before
restarting — the running process holds the evidence.
