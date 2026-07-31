# LM Studio: How It Works & HarnessX Copy Plan

> Research date: 2026-07-18. LM Studio version referenced: 0.4.19 (July 2026).
> Goal: understand LM Studio well enough to replicate its core in later HarnessX phases.

## 1. How LM Studio works

### 1.1 Architecture (the big picture)

LM Studio is a GUI shell over swappable inference runtimes:

- **GUI app** (closed-source, Electron-style) — chat UI, model browser, settings.
- **Inference engines ("LM Runtimes")** — hardware-specific llama.cpp builds (CPU-AVX2, CUDA 11/12, Vulkan, ROCm) plus Apple MLX on Mac. Engines update independently of the app and live as versioned folders under `~/.lmstudio/extensions/backends/` (e.g. `llama.cpp-win-x86_64-nvidia-cuda12-avx2-2.7.1`).
- **Engine Protocol** (default since 0.4.19) — the inference engine runs as a **separate OS process** from the GUI. This is exactly the "wrap a server binary" architecture HarnessX should use.
- **`llmster` daemon** (0.4.0+) — the whole core packaged as a GUI-less service, driven by the `lms` CLI (`lms daemon up`).

### 1.2 On-disk layout (single home directory)

Everything lives under one root: `%USERPROFILE%\.lmstudio\`

| Folder | Contents |
|---|---|
| `models\<publisher>\<model>\<file>.gguf` | Model weights, strict 2-level nesting mirroring Hugging Face repos; folder names drive the UI listing |
| `conversations\` | Chats as plain JSON, one per chat |
| `config-presets\` | Presets as JSON (system prompt + sampling params) |
| `extensions\backends\` | Versioned runtime engine folders |
| `bin\` | The `lms` CLI |
| `.internal\`, `hub\`, `credentials\` | App state, community presets, auth |

A hidden `.lmstudio-home-pointer` file in the user home lets the whole tree be relocated.

### 1.3 The local API server

- Default **port 1234**, bound to `127.0.0.1`; toggle in the Developer tab or `lms server start`. Options: Serve on Local Network (0.0.0.0), CORS, Bearer-token auth.
- Four API surfaces on one port:
  - **OpenAI-compatible**: `GET /v1/models`, `POST /v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/v1/responses` — the contract that makes every existing AI client work by just changing the base URL.
  - **Anthropic-compatible**: `POST /v1/messages` (Claude Code can point at it).
  - **Native REST v0** (legacy): `/api/v0/models` etc., adds per-response stats (tokens/sec, TTFT).
  - **Native REST v1** (stateful): `/api/v1/chat` with `response_id`/`previous_response_id` branching, plus model load/unload/download endpoints.
- **Memory policy** (the feature that makes it feel like a product on 8–16 GB machines):
  - **JIT loading** (default on): calling a non-loaded model loads it on demand.
  - **Idle TTL**: JIT-loaded models auto-unload after 60 min (per-request `"ttl"` field).
  - **Auto-evict**: at most one JIT model resident; the previous one unloads first.

### 1.4 Prompt templates, presets, chats

- Prompting comes from the **Jinja chat template embedded in GGUF metadata** (`tokenizer.chat_template`), with a per-model manual override UI. (llama.cpp's `llama-server --jinja` does this automatically.)
- **Presets** = JSON files bundling system prompt + sampling params; importable from file/URL, shareable via LM Studio Hub.
- **Chats** = JSON files; duplicate, branch-from-message, folders, export to PDF/Markdown/text.

### 1.5 The UX (what users actually see)

- **Left-rail tabs**: Chat (Ctrl+1), Discover (Ctrl+2), My Models (Ctrl+3), Developer, Settings.
- **Two UI modes** (0.4.0 collapsed three modes into two): *User* (chat only, auto-configured) and *Developer* (all parameters + server controls). Don't build three modes — LM Studio itself retreated from that.
- **Chat screen**: model-loader dropdown + Eject button at top; right sidebar with System Prompt editor, sampling params (temperature, top-p, top-k, repeat penalty, max tokens), structured-output JSON schema box, context-overflow policy (Stop at Limit / Truncate Middle / Rolling Window); message edit/regenerate/branch; attach .pdf/.docx/.txt (full injection if it fits context, RAG retrieval otherwise).
- **Discover tab**: Staff Picks curated list + Hugging Face search; per-model quantization picker (Q3_K_S … Q4_K_M "recommended" … Q8_0) with file sizes; **fit badges** — green "Full GPU Offload Possible", yellow partial, "likely too large" warning — computed from file size vs. detected RAM/VRAM. Download manager with pause/resume.
- **My Models tab**: models grouped publisher/repo, disk usage, models-folder path (relocatable), per-model gear for default load params.
- **Load dialog**: context length (default 4,096), GPU offload slider, CPU threads, flash attention, keep-in-memory, with an **Estimated Memory Usage** readout before loading.
- **Requirements**: Windows x64 needs AVX2; 16 GB RAM + 4 GB VRAM recommended. Free for personal and commercial use; `lms` CLI and SDKs are MIT open source.

## 2. HarnessX copy plan (phased)

The key shortcut: **llama.cpp's prebuilt `llama-server.exe` already provides most of what LM Studio's engine does** — OpenAI-compatible `/v1/chat/completions`, `/v1/models`, `/v1/embeddings`, `/health`, streaming, and GGUF-embedded Jinja templates via `--jinja`. HarnessX doesn't reimplement inference; it supervises that binary and puts a good UI on it.

### Phase A — Chat against existing servers (part of HarnessX v1)
- Talk to any OpenAI-compatible endpoint over HTTP: a user's existing LM Studio (`http://localhost:1234/v1`) or Ollama (`http://127.0.0.1:11434/v1`), plus cloud providers.
- This ships the whole chat UX with zero inference work.

### Phase B — Local model hosting (the LM Studio clone core)
1. **Bundle/download `llama-server.exe`** per-hardware (cpu-avx2, cuda, vulkan release zips) into versioned folders `engines\llama.cpp-win-x64-<accel>-<version>\`; run a hardware survey (AVX2 check, GPU detection) at first run to pick the right build. Never hard-link app version to engine version.
2. **Process supervision**: spawn llama-server as a managed subprocess (Tauri sidecar), health-check `/health`, restart on crash, clean shutdown.
3. **Single home dir**: `%USERPROFILE%\.harnessx\` with `models\<publisher>\<model>\<file>.gguf`, `presets\`, `conversations\` — plain folder scans, no database.
4. **Model download**: v1 of Discover = curated Staff-Picks JSON catalog (5–10 GGUF models with per-quant sizes + fit badges) + paste-a-HF-URL download with resumable progress. Full HF search later.
5. **Fit badges + Estimated Memory Usage**: approximate from GGUF file size vs. detected RAM/VRAM — LM Studio's most-loved UX detail and cheap to build.
6. **Load controls**: just context length, GPU offload slider (`--n-gpu-layers`), and the memory estimate. Everything else later.

### Phase C — Server & polish
- Expose our own localhost OpenAI-compatible port (proxy to the supervised llama-server) with an on/off toggle and "Reachable at http://localhost:<port>" label; opt-in serve-on-network + CORS.
- Memory policy primitives, copied verbatim: JIT load-on-request, 60-min idle TTL, auto-evict (max one JIT model resident).
- Small CLI (`harnessx server start|stop|status`, `load --ttl`, `unload`, `ls`, `ps`, `get <hf-repo>`) — LM Studio proved this is cheap and unlocks headless use.

### Explicitly deferred / skipped
- MLX (Apple-only — irrelevant on Windows), stateful native API with response branching, Anthropic-compat endpoint (cheap win later), WebSocket SDK protocol, model.yaml virtual manifests, RAG attachments, structured-output UI, preset sharing hub, MCP, split view, multi-GPU controls.
