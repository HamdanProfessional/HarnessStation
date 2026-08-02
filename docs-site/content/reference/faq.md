---
title: FAQ
description: Short answers to the questions people ask before and shortly after installing.
---

# FAQ

## Cost and accounts

**Is it free?**

The app is. Models aren't, unless you run one locally — in which case the whole
thing costs nothing. With a cloud model you pay that provider directly, at their
prices, with your own key.

**Do I need an account?**

No. There's nothing to sign into. The app has no accounts, no server holding your
data, and no telemetry.

**Do you see my conversations?**

No. They're files on your disk. Nothing routes through us — your prompts go to
the model provider you chose and nowhere else, and with a local model they don't
leave your machine.

The only network call the app makes on its own behalf is fetching public
benchmark data for the Benchmarks panel. It carries no key of yours and no data
about you. → [Privacy & security](../advanced/privacy)

**Which model should I use?**

If you're unsure: a mid-tier cloud model for general work, and a local one for
anything touching private files. [Compare](../models/comparing) them on your own
task before assuming the expensive one is better — often it isn't, for what
you're doing.

## Running it

**Windows says it isn't safe. Is something wrong?**

No. The app isn't code-signed yet, so Windows warns as it does for any unsigned
program. **More info → Run anyway**, or build from source.
→ [Install](../start/install)

**Does it work offline?**

Entirely, with a local model. Speech recognition and local speech synthesis also
run on your machine, so a full voice conversation works with no connection. Cloud
models obviously don't.

**Mac?**

Not yet. Windows and Linux.

**Can I use it on two machines?**

Yes, and they can share models, tools and knowledge over the
[device mesh](../advanced/devices) — read the encryption warning there first.

To move your data, copy `~/.harnessx`; you'll re-enter keys, which live in your
OS credential store rather than in that folder.

## Behaviour

**Why won't it use the tools I enabled?**

Most often the model can't call tools reliably. Many small local models can't,
whatever their model card says — test with a larger model before assuming a
configuration problem. → [Tools](../guide/tools)

**Why did it forget what we were discussing?**

The conversation was [compacted](../guide/chats) — summarised to fit the context
window — or exceeded it. There's a banner at the top of the chat when that has
happened.

**Why does it keep asking things I've already told it?**

[Memory](../guide/memory) may be off, or the fact wasn't stored. Check
**Settings › Memory**, and say "remember that…" to store something deliberately.

**Can it access my whole computer?**

No. File and terminal tools are confined to the working directory you choose, and
every tool is off until you enable it.

The terminal tool is the one to think about: within that directory it runs real
commands as you, and a working directory limits which files it touches rather
than what a command can do once running.

**Can I see what it did?**

Yes — every tool call is in the conversation with its arguments and result. That
record is complete rather than a summary.

## Data

**Where is everything stored?**

`~/.harnessx` — plain JSON, one file per chat. Keys are in your OS credential
store instead. → [Where your data lives](../advanced/data)

**How do I back up?**

Copy the folder. Exclude `models/` and `engines/`, which are large and
re-downloadable.

**Does uninstalling delete my chats?**

No, deliberately — so reinstalling doesn't lose your history. Delete `.harnessx`
yourself if you want it gone.

**Can I read my chats outside the app?**

Yes, they're readable JSON. Edit them only with the app closed; it holds chats in
memory and will write over your changes.

## Features

**Can it browse the web?**

Yes. → [Browser control](../guide/browser)

**Can it talk?**

Yes, and listen. → [Talking to it](../voice/talking)

**Can I connect my own tools?**

Three ways: write one in JavaScript or Python, connect an
[MCP server](../guide/mcp), or use the browser tools against something with no
API.

**Can it run on a schedule?**

Yes, provided the app is running — turn on tray mode in **Settings › General**.
→ [Schedules](../guide/schedules)

**Is there a mobile app or an API?**

Neither.

## Something's wrong

**It froze.**

Known, most often with a page open in the browser panel. Close the panel when
you're not using it. Your conversations save continuously, so at most you lose
the last few seconds. → [Troubleshooting](troubleshooting)

**How do I report a bug?**

Say what you did, what happened, which model and provider, and whether the
browser panel or a call was open. If it froze, mention that *before* restarting —
the running process holds the evidence.
