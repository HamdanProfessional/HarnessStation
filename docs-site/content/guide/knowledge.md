---
title: Knowledge
description: Giving a model documents it can search, instead of pasting excerpts into every message.
---

# Knowledge

A knowledge base is a set of documents the model can search. Ask a question, and
the relevant passages are found and handed to it — you don't paste them, and the
whole document never has to fit in the context window.

## Setting one up

**Automation › Knowledge › New knowledge base**, then add files. Text, Markdown,
PDF, code and CSV all work.

Each document is split into overlapping chunks and each chunk is turned into an
embedding — a vector capturing its meaning. At question time your query is
embedded the same way, and the closest chunks are retrieved. That's why it finds
a passage about "rolling back a release" when you asked about "undoing a deploy":
it matches meaning, not words.

## You need an embedding model

Indexing requires one, set in **Settings › Providers › Embeddings**.

The cheapest route is local: Ollama with `nomic-embed-text` or `mxbai-embed-large`
costs nothing and never sends your documents anywhere. Cloud embeddings
(`text-embedding-3-small` and similar) are also inexpensive, but every document
you index is uploaded to that provider.

> **Warning:** Changing the embedding model invalidates existing indexes — old
> and new vectors aren't comparable. You'll need to re-index. Pick one before
> importing a lot.

## Using it

Attach a knowledge base to a chat from the panel on the right, or to a
[project](projects) or [agent](agents) so it's always available.

With one attached, relevant passages are retrieved automatically each turn. You
don't need to ask it to search.

## How retrieval actually works

Worth understanding, because it explains both the good and bad results.

Each document is split into overlapping chunks — a few hundred words each. Every
chunk is converted into an **embedding**: a list of numbers positioning it in a
space where similar meanings sit near each other.

When you ask a question, the question is embedded the same way, and the chunks
nearest to it are retrieved and added to the prompt.

Three consequences follow directly:

**It matches meaning, not words.** Asking about "undoing a deploy" finds a
passage on "rolling back a release". This is why it beats keyword search.

**It's not exhaustive.** You get the *nearest* chunks, not every relevant one. A
question phrased very differently from the source may miss it entirely. This is
the main limitation and it's structural rather than a bug.

**Chunk boundaries matter.** An answer split across two chunks may retrieve only
half. Documents with real headings chunk along meaningful lines; a wall of
unbroken text chunks arbitrarily.

## Getting better results

**Ask in the documents' own vocabulary.** If your runbook says "incident", asking
about "outages" retrieves less well.

**Ask narrow questions.** "What's the escalation path for a P1?" retrieves
precisely. "Tell me about support" retrieves a grab-bag.

**Ask for absences explicitly.** "If a document doesn't cover this, say so" —
otherwise a document with no matching chunk simply doesn't appear, and a partial
answer looks complete.

**Split unrelated material into separate bases.** Retrieval finds the closest
passages regardless of which document they came from, and across mixed subjects
that surfaces confident matches from the wrong place.

**Name bases descriptively.** The model reads the name to decide whether the base
is relevant.

## Keeping it current

A knowledge base is a snapshot taken at indexing time. Changed files aren't
picked up until you re-index, and a confident answer from a stale document is
worse than no answer.

For documents that change regularly, [schedule](schedules) a re-index.

## Knowledge versus memory

[Memory](memory) is small facts, learned as you go, always injected. Knowledge is
documents you supply, searched on demand.

A style preference is memory. A specification is knowledge. Putting the
specification in memory would consume the entire memory budget on one file.

## Where it goes wrong

**Nothing useful comes back.** No embedding model set, or the base was indexed
with a different one. Re-index.

**It misses something you know is there.** Retrieval is semantic, not exhaustive
— try the document's own phrasing, or split the question into parts.

**A scanned PDF returns nothing.** A scan is an image with no text to index. It
needs OCR first, which the app doesn't do.

**Answers mix documents up.** Too much unrelated material in one base.

**It's confidently wrong about something absent.** The costliest failure here.
Ask for quotes — a claim with no quotable source is an invention, and requiring
one makes that obvious immediately.
