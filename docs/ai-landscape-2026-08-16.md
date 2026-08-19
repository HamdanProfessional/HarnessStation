# AI landscape briefing — 16 Aug 2026

Written from the sonic-re-frontiers session. Source: *AI Search* weekly roundup
(2026-08-16, 46 min) plus vendor pages. Everything below is **unverified against
this codebase** — I read the README and `PLAN.md`, nothing deeper. Treat the
recommendations as leads, not decisions.

---

## 1. Cactus Needle 2 — a bundled tiny-model tier

**The claim:** 45M parameters. 14 MB binary. ~28 MB RAM, no VRAM. 500 tok/s on a
Raspberry Pi 5, ~700 tok/s on a sub-$200 phone. Explicitly designed for
**controlling devices, calling tools and extracting information from documents** —
and explicitly *not* for long-horizon reasoning.

**Why it matters here:** HarnessStation ships with no API keys and runs the user's
own model. But a harness constantly does small mechanical work that doesn't need
the main model:

- chat titling
- memory-fact extraction (see `self-improving-memory-plan.md`)
- deciding whether a turn needs the big model at all
- shaping tool arguments
- classifying which knowledge documents are relevant

At 14 MB this is small enough to **ship inside the installer**. That makes those
features work offline, instantly, and at zero cost to the user's token budget —
which is the app's whole pitch.

**Worth checking first:** does it actually hold up on your tool schemas? A 45M
model will fail on anything subtle. The test is whether it can emit valid JSON
against your tool definitions reliably enough to be worth the bundle size.

## 2. Nemo Switchyard — routing

NVIDIA released an open-source model router this week. Reported result: paired
with Opus 4.8 plus smaller models it **completed more tasks than Opus alone at
~3× less cost**, by sending easy turns to cheap models.

`PLAN.md` §2 describes a manual model picker fed from `settings.json`. An app
whose premise is "you bring the model" is the natural home for automatic routing
between the several a user has configured. This composes with item 1: Needle
handles the routing decision itself.

## 3. Qwen 3.8-27B — update the recommended local default

Alibaba's new 27B dense model, multimodal (image + video understanding), tuned
for agentic coding, 1M context. Their benchmarks put it above Opus 4.6 Max on
agentic and knowledge tasks — treat that with the usual scepticism, but the
previous 3.6-27B is genuinely #1 on Artificial Analysis for its size class and
has 7M+ downloads.

Sizes: **56 GB full · 30 GB FP8 · 9 GB at Q2** (Unsloth GGUFs already out).

This is the tier your users actually run. Relevant to `lm-studio-plan.md` and to
whatever session wired llama.cpp as the default provider. If a benchmark session
is measuring 11.3 tok/s locally, this is the model to measure next.

## 4. Competitive note — DeepSeek shipped their own harness

DeepSeek released **DeepSeek Harness** this week (developer preview, breaking
changes expected). The roundup's framing was blunt: *"in general it's best to use
the harness that's built by the same company as the model."*

That is the structural pressure on a neutral harness, and you already have
`deepseek-harness-plan.md`. Worth being explicit about what a BYO harness does
that a first-party one cannot: multi-provider routing, local models, user-owned
tools and files, memory that survives switching providers, no vendor lock.

## 5. Voice — Index TTS 2.5

Open source, **5.5 GB total**. Clones a voice from a few seconds of reference
audio, handles emotion, and does cross-lingual dubbing (clone an English voice,
have it speak Spanish). The README advertises "a voice you can talk to" — this is
the local, no-API-key way to do the output half.

---

## Also released this week (context, not recommendations)

| | |
|---|---|
| DeepSeek V4 Pro | 1.7T MoE, ~6¢/task — best intelligence-per-dollar available |
| Grok 4.6 | caught up to frontier; ties GPT 5.6 on Artificial Analysis |
| GLM 5.3 | best open model on agentic/terminal benchmarks; **weights ~2 weeks** |
| Gemini 3.7 Flash | 340 tok/s, but 40¢/task vs GPT 5.6 Luna Max at 5¢ |
| GPT 5.6 ultra-fast | 750 tok/s via Cerebras, private preview only |
| Nvidia Nemotron 3.5 Lightning | 30B MoE, fastest in its size class, 22 GB FP4 |
