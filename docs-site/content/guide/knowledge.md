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

## Getting good results

**Structure beats size.** Documents with real headings chunk along meaningful
boundaries. A wall of unbroken text chunks arbitrarily and retrieves worse.

**Split unrelated material.** One base per subject retrieves more precisely than
one base holding everything.

**Names are read by the model.** "Q3 Support Runbook" tells it when the base is
relevant; "docs2" tells it nothing.

**Ask specifically.** Retrieval matches your question, so "what's the escalation
path for a P1?" finds more than "tell me about support".

## Knowledge versus memory

[Memory](memory) is small facts, learned as you go, always injected. Knowledge is
documents you supply, searched on demand.

A style preference is memory. A specification is knowledge. Putting the
specification in memory would consume the entire memory budget on one file.
