---
title: Working with a codebase
description: Understanding unfamiliar code, reviewing changes, and making edits that span several files.
---

# Working with a codebase

Probably the most common use, and the one where the difference between a good
setup and a careless one is largest.

## What you'll end up with

A conversation that can read your project, answer questions about it with
specifics rather than generalities, and make changes you review before keeping.

## Setup

**A model that can call tools.** For code this matters more than elsewhere —
tool-calling reliability is what separates a useful session from a frustrating
one. A capable cloud model, or a local model of 14B or more.

**The Files tool group**, enabled in the chat. When you enable it you'll be asked
for a **working directory**: choose the project root, not your home folder. That
directory is the boundary — nothing outside it can be read or written.

**The Terminal group**, only if you want it running tests or git commands. It's
genuinely useful for that and worth understanding before you enable it:

> **Warning:** Terminal runs real commands as your user. The working directory
> limits which files it touches; it does not stop a command reaching the network
> or installing packages. Enable it when you want that, and read the calls it
> makes.

## Understanding unfamiliar code

Start broad, then narrow. Asking a specific question about code the model hasn't
seen produces confident guesses.

```text
Look through this project and tell me what it does, how it's structured,
and where the entry points are. Don't guess — read enough files to be sure.
```

The "don't guess" matters. Without it, models tend to infer a structure from
filenames and describe the project they expect rather than the one in front of
them.

Then narrow:

```text
How does authentication work here? Trace it from the HTTP request to
wherever the session is stored, and quote the actual code at each step.
```

Asking it to quote is a check on itself. If it can't produce the code, it hasn't
read it, and you'll see that immediately instead of three answers later.

## Reviewing changes

With Terminal on:

```text
Run `git diff` and review the changes. Look for bugs and cases that
aren't handled. Skip style — I don't need opinions on formatting.
```

Saying what to ignore is as useful as saying what to look for. Left open, models
produce long lists dominated by trivia, and the real finding is buried at
position eleven.

For something more thorough:

```text
For each change, ask what input would break it. If you find one,
give me the specific value and what happens. If you can't, say so
rather than inventing a hypothetical.
```

That last clause is the one that makes review output trustworthy. Models are
strongly inclined to produce a finding because you asked for findings, and the
permission to say "nothing here" is what stops the list filling with noise.

## Making changes

**Take a snapshot first.** Right-click the chat → **Take snapshot**. If a
multi-file edit goes wrong, that's how you get back — and it's much easier than
untangling it afterwards.

Work in small steps:

```text
Add input validation to the create-user endpoint. Reject an email
that isn't valid and a password under 8 characters, returning 400
with a message saying which failed. Match the error style used
elsewhere in this file.
```

"Match the style used elsewhere" is worth including on almost every edit.
Otherwise you get code that works and looks foreign.

For anything larger, ask for the plan before the edit:

```text
I want to move from callbacks to async/await across the service layer.
Show me which files need changing and in what order, before you change
anything.
```

Then work through it a file at a time. A model asked to change fifteen files at
once will do the first few carefully and the rest mechanically.

## Keeping context under control

Reading files fills the context window fast. Two things help:

**Compact** when the conversation gets long — it summarises the earlier part and
keeps working. Turn on auto-compact in **Settings › General** and it happens on
its own.

**Branch** when you move to a new area of the project. Right-click → the chat
menu → **Duplicate**, or branch from a message. Starting fresh with a clean
context beats carrying twenty irrelevant files into a new question.

## Where it goes wrong

**It edits the wrong file.** Almost always because the working directory is
broader than it needed to be, and two files share a name. Set the directory
tightly.

**It claims to have read a file it hasn't.** Ask for a quote. This surfaces
instantly and is worth doing early in a session when accuracy matters.

**It rewrites more than you asked.** Say "change only what's necessary; leave the
rest of the file alone" — models default to tidying.

**It loops on a failing test.** Stop it. Read the error yourself, then tell it
what you found. Two failed attempts is the point at which more attempts stop
helping.

**Long sessions get vaguer.** That's context filling up. Compact, or start a
fresh chat with a short summary of where you got to.
