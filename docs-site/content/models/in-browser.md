---
title: In-browser models
description: Run a small model entirely on your GPU with WebGPU — no key, no server, no install.
---

# In-browser models

You can run a small model **entirely on your GPU, inside the app**, with no API
key, no server, and — after a one-time download — no network. It's the zero-setup
way to try a local model, and it works in both the [web version](../advanced/web)
and the desktop app.

This is separate from [running full local models](local) with llama.cpp:
in-browser models are smaller and capped by the browser, but they need nothing
installed.

## Requirements

- **WebGPU** — a recent **Chrome or Edge**. If your browser doesn't have it, the
  card tells you (and points to the desktop app's native local models instead).
- A reasonably capable GPU. Great on a gaming laptop; slow on a weak one.

## Enabling it

Open **Settings › Providers** and find **"Run a model with WebGPU"**:

1. Each model shows its **download size**. Click **Download** to pre-fetch one —
   a progress bar shows the fetch, and it flips to **Downloaded ✓** when cached
   (it stays cached across reloads).
2. Downloading also adds the **In-browser (WebGPU)** provider automatically.
3. In any chat, pick that provider and a model, and send. The first message loads
   the model (progress shows in the chat) if you didn't pre-download it.

## The models

A curated set of small, quantized models known to run in a browser — Llama 3.2
(1B / 3B), Qwen2.5 (1.5B / 3B), Phi-3.5-mini, Gemma 2 2B, SmolLM2. Sizes range
from roughly 0.9 GB to 2.2 GB.

## Good to know

- **First load is a real download** (hundreds of MB to a couple of GB), cached
  after that. Pre-download from Settings so your first message isn't a wait.
- **Small models are limited** — expect "small local model" quality, and note
  that tool-calling is less reliable than on a big cloud model.
- Fully **private and offline** once cached: nothing leaves your machine.

For bigger models and full GPU offload, use [native local models](local)
(desktop) with any GGUF from Hugging Face.
