---
title: Running models locally
description: Using a model on your own hardware — what to install, what fits in your memory, and what you give up.
---

# Running models locally

A local model costs nothing per token, works offline, and sends nothing anywhere.
It's also weaker than a frontier cloud model, and that gap is real.

## What to install

**[Ollama](https://ollama.com)** is the simplest. Install, then:

```bash
ollama pull qwen3          # good all-rounder
ollama serve               # usually already running
```

**[LM Studio](https://lmstudio.ai)** gives you a GUI for browsing and loading
models, and a server you start from the Developer tab.

Both are detected automatically if they're running when you open
**Settings › Providers**.

## What will fit

The limit is memory. A rough guide for 4-bit quantised models:

| RAM / VRAM | Size | Realistic expectation |
| --- | --- | --- |
| 8 GB | 3–4B | Chat and simple edits; tool use is unreliable |
| 16 GB | 7–8B | Solid general use, workable tool calling |
| 32 GB | 14B | Good; handles multi-step tool work |
| 64 GB+ | 32–70B | Approaches cloud quality for many tasks |

A GPU makes it much faster but isn't required — models run on CPU, more slowly.

## Tool calling is the sticking point

The single biggest difference in practice isn't the prose. It's that many small
models **cannot reliably call tools**, whatever their model card claims. They'll
describe calling one, or emit malformed arguments, or ignore the tools entirely.

If tool use is why you're here, test it early:

```text
Read the README in this folder and summarise it.
```

If that fails on a small model, it isn't a configuration problem. Go up a size,
or pick a model whose documentation is specific about tool calling.

## Where models live

Models pulled through Ollama or LM Studio stay in their own folders. Models the
app downloads for you go under `~/.harnessx/models`.

Speech models are separate and much smaller: Whisper for hearing, Kokoro or Piper
for speaking. → [Voice engines](../voice/engines)

## Mixing local and cloud

Nothing says you must choose. A common arrangement:

- A local model for everyday questions and anything touching private files
- A cloud model for hard reasoning, long context, or when the local one stalls

Switch per chat, or mid-chat. If you have a second machine with a better GPU, the
[device mesh](../advanced/devices) lets you use its models from this one.
