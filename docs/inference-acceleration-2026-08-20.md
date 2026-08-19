# Inference acceleration briefing — 20 Aug 2026

Follow-up to `ai-landscape-2026-08-16.md`, narrowed to one question: **what has
changed in inference speed, and which of it can HarnessStation actually use?**

Sources are vendor blogs, arXiv abstracts and llama.cpp discussion threads —
read, not run. Nothing here has been benchmarked on this machine. The llama.cpp
build numbers and PR numbers in particular should be checked against the repo
before anyone writes code against them.

Ordered by *actionability here*, not by how impressive the number is.

---

## 1. MTP in llama.cpp — the one that matters

**Status: merged and stable.** Landed 16 May 2026; needs **build 9200+**.

Multi-token prediction trains extra output heads that predict tokens N+1, N+2,
N+3 off the same backbone hidden state. At inference the runtime drafts several
tokens in one forward pass and verifies them against the main distribution.

Why this is different from the speculative decoding llama.cpp already had: the
old path needs **two models resident** — a small draft model plus the real one.
MTP collapses that into one model with built-in heads, costing roughly one extra
transformer layer. No second model, no second VRAM budget.

Reported gains: ~1.5–2× tokens/sec.

### The flags

```
llama-server --model <mtp-model.gguf> --spec-type draft-mtp --spec-draft-n-max 2
```

- `--spec-type draft-mtp` — **renamed** from the pre-merge `--draft-mtp`. Older
  tutorials (and one PR-branch walkthrough that says `--spec-type mtp`) are wrong
  against the stable build.
- `--spec-draft-n-max 2|3` — how many tokens the head drafts per step. 2 for
  dense models, 3 for MoE, per the ggml-org examples.
- `--spec-draft-p-min 0.75` — **the non-obvious one.** Minimum acceptance
  probability for a draft token. Without it, rejection rates on long contexts eat
  the gain. One writeup measured 48.9 tok/s at 2000 output tokens with it — 68%
  over plain autoregressive.

### The catch, and it's a real one

**MTP requires an MTP-labelled GGUF.** A standard GGUF has no heads and the flag
does nothing. This directly limits what we can wire up today:

- Qwen3.6 has first-party MTP repos (`ggml-org/Qwen3.6-27B-MTP-GGUF`,
  `unsloth/Qwen3.6-27B-MTP-GGUF`).
- **Qwen3.8 does not, yet.** The `unsloth/Qwen3.8-27B-GGUF` entry now in
  `lib/catalog.ts` ships an MTP head at `MTP/mtp-Qwen3.8-27B-Q4_0.gguf`, but the
  headline quants don't bundle it. Everything else on HF is third-party
  (`Jackrong/…`, abliterated forks, NVFP4 rebuilds).

Second catch: the win is **long-generation only**. Below ~900 output tokens it
doesn't materialise — one head-to-head had DFlash ahead at 100 tokens (46.9 vs
44.6 tok/s). For a chat app whose median reply is short, MTP is not a
free win on every turn.

### What it would take here

`LaunchOpts` in `src-tauri/src/local.rs` already models exactly this kind of
optional flag — `threads`, `cpu_moe`, `flash_attn`, `mlock`, `no_mmap`, `fit`,
`fit_target`, each appended by `launch_flag_args`. Adding MTP is two more fields
and a push.

The existing comment there is the warning worth heeding: these flags *"fail on an
old engine"*. `--spec-type` is newer than any of them, so it needs the same
version guard, and the guard needs to know about build 9200.

**Verdict: the highest-value item on this list, and the only one that is
mostly an integration job rather than a hardware purchase.**

---

## 2. DFlash — real, fast, and not available to us

**Block Diffusion for Flash Speculative Decoding**, UC San Diego, Feb 2026
(arXiv 2602.06036).

Instead of drafting autoregressively, it uses bidirectional attention to emit
8–16 tokens in a single forward pass, then verifies. Reported: up to 15×
throughput on gpt-oss-120b, 5.8× on Gemma 4 31B, 5.1× on Qwen3 8B, all against
EAGLE-3. ~20 checkpoints published covering Qwen, Kimi K2.6, Llama, Gemma,
gpt-oss.

**Framework support is SGLang and vLLM. Not llama.cpp.**

That is the whole story for us. HarnessStation's local path is llama.cpp; DFlash
is not reachable from it today. It matters indirectly — it is part of why the
hosted providers in the Discover tab keep getting faster and cheaper — but there
is no flag to add.

Worth re-checking in a few months: if a llama.cpp path appears, it beats MTP on
short generations, which is the case MTP loses.

---

## 3. FlashAttention-4 — already exposed, mostly not our hardware

arXiv 2603.05451, published 5 Mar 2026. 1,613 TFLOPs/s, ~71% hardware
utilisation, up to 1.3× over cuDNN 9.13 and 2.7× over Triton. Written in CuTe-DSL
rather than C++ templates, which cut compile times 20–30×.

Two qualifiers before anyone gets excited:

- **Blackwell.** The kernel is co-designed for it. On older cards this is not the
  number you get.
- **Long context.** At 2K–8K it's a modest win; at 32K+ it changes the cost
  model. Most chat turns are not 32K.

We already surface flash attention: `LaunchOpts.flash_attn` emits
`--flash-attn on`, and there's a test (`flash_attention_is_on_not_a_bare_flag`)
pinning the on/off form because a bare `--flash-attn` errors on current builds.
So the user-facing switch exists. Which kernel llama.cpp picks underneath is
llama.cpp's business.

**Verdict: no work here. Already wired; the rest is upstream and hardware.**

---

## 4. FP4 in llama.cpp — NVFP4 and MXFP4

NVFP4 merged through a run of PRs late Mar → Apr 2026, with PR #22196 (21 Apr)
wiring it to Blackwell's FP4 tensor cores. CUDA, SYCL and Vulkan paths all exist.

| | NVFP4 | MXFP4 |
|---|---|---|
| Origin | Nvidia | OCP Microscaling standard |
| Block size | 16 | 32 |
| Scaling | Two-level: FP8 E4M3 per block + FP32 per tensor | Single: one E8M0 exponent per block |
| In llama.cpp | merged | via ik_llama.cpp; constants merged Nov 2025, kernels landing since |

The honest framing for our users: **on Blackwell (RTX 5090, RTX PRO 6000, B200,
GB200) you get tensor-core acceleration. On anything older you get the memory
saving and nothing else.** That distinction is exactly the kind of thing the
Discover tab's fit badges exist to communicate, and it is not currently modelled
— `fitFor()` reasons about size vs RAM/VRAM, not about quant format vs
architecture.

NVFP4 Qwen3.8 builds are already on HF (`esatapedico/…`, `utautako/…`,
`Avifenesh/…`), all third-party.

**Verdict: watch. Worth revisiting when a first-party NVFP4 GGUF of a model we
already ship appears — at that point the fit badge probably needs a
"Blackwell only" note or it will overpromise.**

---

## Summary

| Item | Reachable from llama.cpp? | Work for us |
|---|---|---|
| MTP | **Yes**, build 9200+ | `LaunchOpts` + version guard + MTP-variant catalog rows |
| DFlash | No — SGLang/vLLM | none; re-check later |
| FlashAttention-4 | Yes, via existing `--flash-attn on` | none |
| NVFP4 / MXFP4 | Yes, Blackwell-accelerated | none yet; fit-badge honesty later |

One theme worth naming: **three of the four biggest speed stories of 2026 are
speculative decoding** (MTP, DFlash, EAGLE-3, plus DeepSeek's DSpark). That is
where the throughput is going, and MTP is the branch of it that reaches a
single-user desktop app with no extra VRAM.

---

## Caveats

- Written from secondary sources. The build number (9200), the PR number
  (#22196) and the arXiv IDs should be confirmed upstream before being relied on.
- Vendor-reported speedups are vendor-reported. The 15× is one model on one
  platform against one baseline.
- Assistant knowledge cutoff is May 2026; everything above was gathered from the
  live web on 2026-08-20 rather than recalled.
