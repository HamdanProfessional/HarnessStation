---
title: How it works
description: What actually happens when you send a message — the agent loop, what goes into the prompt, and why that explains most surprising behaviour.
---

# How it works

You don't need this to use the app. You do need it the first time something
behaves oddly, because almost every surprise comes from one of two things: what
went into the prompt, or where the loop stopped.

## The loop

Sending a message doesn't produce one request. It starts a loop:

1. **Assemble the prompt** — your message, plus everything described below
2. **Send it** to the model, with the list of tools it may call
3. **The model replies**, either with text or with a request to call a tool
4. **If it called a tool**, run it, put the result in the conversation, and go
   back to step 2
5. **If it replied with text**, stop and show it to you

That loop is the whole idea. A model on its own can only produce text; the loop
is what lets text become an action, and the action's result become the next
thing it reasons about.

Each pass round the loop is a separate charged request, which is why a task with
eight tool calls costs several times a plain question.

## What actually goes into the prompt

Not just your message. In order:

| | From |
| --- | --- |
| Global instructions | **Settings › General** |
| Project instructions | The [project](../guide/projects), if the chat is in one |
| Chat instructions | The panel on the right of this chat |
| Recalled [memory](../guide/memory) | Facts matching this conversation, budget-capped |
| Retrieved [knowledge](../guide/knowledge) | Passages matching your question, if a base is attached |
| [Skill](../guide/skills) index | One line per available skill |
| Tool definitions | Every enabled tool's name, description and parameters |
| Conversation history | Earlier messages, or a summary if [compacted](../guide/chats) |
| Your message | Last |

Two consequences worth internalising.

**Everything competes for the same space.** The context window is finite, and
memory, knowledge, tools and history all consume it. Enabling forty tools costs
real room before you've typed a word.

**Instructions layer rather than replace.** A chat prompt doesn't override your
global one — the model sees both. If they conflict, behaviour gets unpredictable,
and that's usually the cause when a chat ignores something you told it.

## Why it stops when it does

The loop ends for one of these reasons, and knowing which explains most "why did
it stop there" moments:

- **It answered.** Text with no tool call.
- **It hit the step limit.** A cap on tool rounds per turn, so a confused model
  can't spend your budget indefinitely. You'll see a message saying so; send
  "continue" to carry on.
- **It repeated itself.** If the same tool call is made three times with no
  progress, the loop stops rather than burning the budget on a stuck retry.
- **You stopped it.**
- **A spend cap was reached.** → [Controlling cost](cost)
- **It errored.** The message says what happened.

## Where things run

Worth knowing, because it explains what works offline and what doesn't.

**On your machine:** the interface, all file and terminal work, tool execution,
speech recognition (Whisper), local speech synthesis (Kokoro, Piper), the browser
panel, and all storage.

**On the provider:** the model itself, and only the model. It receives the
assembled prompt and returns text.

So with a [local model](../models/local), nothing leaves your machine at all.
With a cloud model, the prompt goes to that provider and nowhere else — and the
tools still run locally. The model never touches your files; it asks the app to,
and the app does it inside the working directory you set.

## Tools are described, not attached

A subtle point that explains a lot of behaviour.

The model doesn't get your tools. It gets a *description* of them — name,
purpose, parameters — and replies with a request to call one. The app runs it and
puts the result back into the conversation.

That means:

- **Descriptions are the interface.** A vague description produces an unused
  tool. The model is choosing from text alone.
- **The model can't do anything you haven't enabled.** There's no list of hidden
  capabilities; the enabled set is exactly what's possible.
- **Every call is visible.** The cards in the conversation are the complete
  record, not a summary of one.

## What this explains

Most confusing behaviour reduces to this:

**"It ignored my instruction."** Something else in the prompt contradicted it, or
the conversation is long enough that the instruction is far away. Put important
constraints in the message, not just global settings.

**"It forgot what we discussed."** The conversation was compacted, or exceeded
the window. Check the compaction banner.

**"It won't use the tool."** Either the model can't call tools at all, or the
description doesn't tell it when to.

**"It's suddenly expensive."** Tool rounds. Each is a full request including the
whole conversation so far.

**"It's slower than it was."** The prompt grows as the chat does. Compacting
helps immediately.
