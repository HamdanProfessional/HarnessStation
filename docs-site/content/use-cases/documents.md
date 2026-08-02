---
title: Working through documents
description: Indexing a pile of PDFs, contracts or reports, then pulling out what you need without reading all of them.
---

# Working through documents

Forty contracts and one question about them. This is where
[knowledge bases](../guide/knowledge) earn their setup cost.

## What you'll end up with

A searchable index of your documents, and answers that cite which document and
which section they came from.

## Setup

**An embedding model**, set in **Settings › Providers › Embeddings**. Indexing
can't happen without one.

For documents you'd rather not upload anywhere, use a local one — Ollama with
`nomic-embed-text` costs nothing and never leaves your machine. This matters more
here than elsewhere: indexing sends *every* document to the embedding provider,
not just the ones you ask about.

> **Warning:** Changing the embedding model later invalidates the index — old and
> new vectors aren't comparable, and you'll re-index everything. Choose before
> importing a hundred files.

## Building the index

**Automation › Knowledge › New knowledge base.** Name it for what it contains —
the model reads that name to decide when the base is relevant, so "Supplier
contracts 2024" works and "docs2" doesn't.

Add files. PDF, Markdown, text, CSV and code all work.

**Use separate bases for unrelated material.** One base per subject retrieves far
more precisely than one holding everything, because retrieval finds the closest
passages regardless of which document they're in — and "closest" across mixed
subjects surfaces confident matches from the wrong place.

## Asking

Attach the base to a chat, then ask normally. Retrieval happens automatically.

```text
Which of these contracts have an auto-renewal clause, and what notice
period does each require?
```

Ask for citations when the answer matters:

```text
For each one, quote the clause and name the document. If a contract
doesn't address it, say so rather than leaving it out.
```

That last clause is important. Retrieval returns what it found; a contract with
*no* matching passage simply doesn't appear, and a list of eight looks complete
whether you had eight contracts or forty. Asking for absences makes the gap
visible.

## Extracting structure

For anything you'll process further:

```text
Produce a table: document name, renewal date, notice period, monthly cost.
Use "not stated" where a contract is silent. Don't infer values.
```

"Don't infer" is doing real work — the natural behaviour when a field is missing
is to produce a plausible one.

## Where it goes wrong

**Nothing useful comes back.** Usually no embedding model is set, or the base was
indexed with a different one. Re-index.

**It misses documents you know match.** Retrieval is semantic, not exhaustive. A
question phrased differently to the source may not reach it. Try the vocabulary
the documents themselves use, and split the question into parts.

**Scanned PDFs return nothing.** A scan is an image; there's no text to index. It
needs OCR first — the app doesn't do that.

**Answers mix up documents.** Too much unrelated material in one base. Split it.

**It's confidently wrong about something absent.** The commonest and most costly
failure here. Ask for quotes; a claim with no quotable source is an invention,
and it becomes obvious the moment you require one.

## When knowledge is the wrong tool

If you have three documents and a specific question, attach them to the message
directly — retrieval adds nothing over just reading them.

Knowledge bases start paying when documents exceed what fits in context, or when
you'll ask many questions over time.
