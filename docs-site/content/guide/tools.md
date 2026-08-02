---
title: Tools
description: What the model is allowed to do — the built-in tool groups, how permission works, and writing your own.
---

# Tools

A tool is something the model can *do* rather than say. Read a file, run a
command, fetch a page, generate an image. This is what separates the app from a
chat box.

## Permission

**Every tool is off until you turn it on.** There is no default set, and no
global "allow everything".

Tools are enabled per chat, from the panel on the right of a conversation, or
per [agent](agents) if you want a saved role to always carry them. A tool
switched on in one chat is not switched on in another.

File and terminal tools are additionally confined to a **working directory**,
which you choose when you first enable them. The model cannot read or write
outside it. Choose that folder deliberately — pointing it at your home directory
gives away far more than pointing it at one project.

> **Warning:** The terminal tool runs real commands with your user's
> permissions. A working directory limits which *files* it touches; it does not
> stop a command reaching the network or installing something. Enable it when
> you want that, and not by default.

## What's built in

| Group | What it does |
| --- | --- |
| **Files** | Read, write, list, search within the working directory |
| **Terminal** | Run shell commands there |
| **Web** | Fetch a page or search |
| **[Browser](browser)** | Drive a real browser — click, read, navigate |
| **[Media](media)** | Generate images, audio, video, 3D |
| **[MCP](mcp)** | Anything exposed by connected MCP servers |
| **[Skills](skills)** | Load reference material on demand |
| **[Agents](agents)** | Hand a subtask to another agent |
| **[Workflows](workflows)** | Run a saved multi-step sequence |
| **UI** | Show the user something — a table, a chart, a form |
| **Swarm** | Coordinate several agents on one job |

## Auto-enabling

**Settings › General** has *let the model switch on tools it finds itself*. With
this on, a model that needs a capability it hasn't got can enable it — but only
tools requiring no credentials. It can turn on file search; it cannot connect
something with your API key attached.

Off by default, and reasonable to leave off if you'd rather approve each one.

## Writing your own

**Automation › Tools › New tool** takes a name, a description, a JSON Schema for
its parameters, and either JavaScript or Python.

The description matters more than people expect: it's how the model decides
whether to call the thing. "Looks up an order" is worse than "Look up an order by
its ID in the fulfilment database. Returns status, items and shipping address.
Use when the user mentions an order number."

```python
# Parameters arrive as named variables; whatever you return becomes the result.
import json, urllib.request

with urllib.request.urlopen(f"https://api.example.com/orders/{order_id}") as r:
    data = json.load(r)

return f"Order {order_id}: {data['status']}, {len(data['items'])} items"
```

Python tools need Python on your PATH. The parameter schema is detected from the
code where it can be, and you can correct it by hand.

## Watching what it does

Every call appears in the conversation as a card: which tool, the arguments, and
the result. Both expand.

This is worth reading rather than skipping. When a model does something
surprising, the answer is almost always visible in an argument — the wrong path,
a misread parameter — and it's much quicker to see it there than to infer it from
a bad answer.

## When a tool isn't being used

- **The model can't call tools.** Many small local models can't, whatever their
  card says. Test with a larger model before assuming a configuration problem.
- **It isn't enabled in this chat.** Enabling is per-conversation.
- **The description is too vague.** See above.
- **Too many are on.** A model given forty tools chooses worse than one given
  five. Enable what the task needs.
