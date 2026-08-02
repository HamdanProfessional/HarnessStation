---
title: Keyboard shortcuts
description: Every shortcut, including the two that work from other applications.
---

# Keyboard shortcuts

## Global

These work anywhere on your system, even when HarnessStation isn't focused.

| | |
| --- | --- |
| `Ctrl` `Shift` `Space` | Bring the window forward on a new chat |
| `Ctrl` `Shift` `V` | Hold to talk to the voice avatar |

> **Note:** If either does nothing, another application has claimed it — global
> shortcuts are first-come, and only one program can hold one. The app logs this
> at startup rather than failing loudly.

## In the app

| | |
| --- | --- |
| `Ctrl` `K` | Command palette — jump anywhere, run anything |
| `Ctrl` `S` | Save, in Settings |
| `Enter` | Send |
| `Shift` `Enter` | Newline instead of sending |
| `Esc` | Close a dialog, or cancel the palette |

## The command palette

`Ctrl` `K` is the fastest route to most things: switch chats, open a panel,
change model, start a call. Type a few letters of what you want.

Worth learning before the sidebar — it's quicker than navigating for almost
everything.

## In the docs

| | |
| --- | --- |
| `Ctrl` `K` | Search |
| `↑` `↓` | Move between results |
| `Enter` | Open |
| `Esc` | Close |

## Worth learning first

If you learn one thing on this page, make it **Ctrl+K**.

The palette does most of what the sidebar does, faster: switching chats, opening
any panel, changing model, starting a call. Type a few letters of what you want
rather than navigating to it.

## Text editing

The composer supports the usual editing keys, plus:

| | |
| --- | --- |
| `Shift` `Enter` | Newline — use this for multi-paragraph prompts |
| `Ctrl` `A` | Select all, within the composer |
| Drag files onto the composer | Attach them |
| Paste an image | Attaches it, on models that accept images |

`Enter` sends. If you find yourself sending half-written messages, get into the
habit of composing longer prompts with `Shift` `Enter` between paragraphs.

## While a reply is streaming

You can keep typing. The composer stays live, so a follow-up can be ready before
the current reply finishes.

**Stop** halts generation and keeps what has arrived so far, which is often what
you want when a reply is going the wrong way — the partial answer stays in the
conversation and you can correct from there.

## If a global shortcut does nothing

Global shortcuts are first-come across the whole operating system, and only one
program can hold one. If **Ctrl+Shift+V** or **Ctrl+Shift+Space** does nothing,
something else has claimed it.

Common culprits are clipboard managers, screenshot tools, and other assistants.
The app logs this at startup rather than failing loudly, so nothing appears
broken — it simply doesn't respond.

Closing the other program and restarting HarnessStation is the quickest way to
confirm it.
