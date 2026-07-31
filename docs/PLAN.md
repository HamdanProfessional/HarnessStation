# HarnessX — Master Plan

> A very simple Windows 10/11 desktop harness for AI models: start as a clean chat app over any model endpoint, grow into a lightweight LM Studio + Claude Desktop hybrid.
>
> Planned 2026-07-18. Companion docs: [docs/lm-studio-plan.md](docs/lm-studio-plan.md) · [docs/claude-desktop-plan.md](docs/claude-desktop-plan.md)

## Vision

One small app that can talk to **any** AI model — cloud APIs or local models — with the instruction ergonomics of Claude Desktop and, later, the local-model hosting of LM Studio. Simplicity is the product: two UI modes at most, one settings screen, one data folder.

## Tech stack (decided)

**Tauri v2 + React/TypeScript** (Vite, shadcn/ui or similar).

Why (see research): ~10–20 MB installer using Windows' WebView2 (serviced on Win10 22H2 through at least Oct 2028, so Windows 10 stays supported); full React chat-UI ecosystem for streaming markdown; Tauri's **sidecar** feature is purpose-built for supervising a `llama-server.exe` subprocess in phase 2; far lower idle RAM than Electron — which matters when a local model is also eating RAM. Fallback if Rust becomes a blocker: Electron.

## Data layout (from day one)

Single root, plain files, no database — copied from LM Studio's proven convention:

```
%USERPROFILE%\.harnessx\
├── settings.json          # providers, API keys ref, global system instructions
├── conversations\         # one JSON file per chat
├── presets\               # named JSON: system prompt + sampling params
└── models\                # (phase 2) GGUF files, publisher\model\file.gguf
```

## Phase 1 — The very simple app (build this first)

A chat window over existing model endpoints. No local inference yet.

**Features:**
1. **Chat UI** — message list with streaming markdown + code blocks, input box, stop button, regenerate, chat history sidebar (list + substring search), one JSON file per chat.
2. **Providers/models** — a picker fed from `settings.json`. Supported v1: any **OpenAI-compatible** base URL (covers OpenAI, LM Studio at `localhost:1234/v1`, Ollama at `localhost:11434/v1`, OpenRouter, etc.) and **Anthropic** (`/v1/messages`). Both stream via SSE from the frontend `fetch`.
3. **System instructions** (the Claude Desktop copy):
   - Global instructions textarea in Settings (prepended to every chat).
   - Per-chat system prompt in the chat's right sidebar.
   - Style presets dropdown: Normal / Concise / Explanatory / Formal (canned snippets appended to the system prompt).
   - Composition: global + style + per-chat → single system message.
4. **Sampling basics** — temperature and max tokens in the chat sidebar (LM Studio-style right panel); "Save as preset" writes a JSON to `presets\`.
5. **Settings screen** — providers + API keys (OS keychain via Rust `keyring`), global instructions, theme (dark/light/system).

**Explicitly NOT in phase 1:** local model hosting, model downloads, MCP, attachments, RAG, artifacts, projects, multi-window.

**Project structure:**

```
harnessx/
├── src/                        # React/TS frontend
│   ├── App.tsx
│   ├── components/             # ChatWindow, MessageInput, Sidebar,
│   │                           #   ProviderPicker, SystemPromptPanel, Settings
│   └── lib/
│       ├── providers/          # openaiCompatible.ts, anthropic.ts (SSE clients)
│       └── store.ts            # app state (zustand)
├── src-tauri/                  # Rust backend
│   ├── src/                    # commands: settings load/save, keychain, chat file IO
│   ├── capabilities/           # scoped permissions
│   └── tauri.conf.json
└── package.json
```

## Phase 2 — LM Studio core (local models)

Detailed in [docs/lm-studio-plan.md](docs/lm-studio-plan.md). Summary:
- Download per-hardware **llama.cpp `llama-server.exe`** builds (AVX2 check + GPU detection picks cpu/cuda/vulkan) into versioned `engines\` folders; supervise it as a Tauri sidecar (spawn, `/health` checks, restart, clean shutdown).
- **Discover screen v1**: curated staff-picks catalog + paste-a-Hugging-Face-URL download, resumable progress, quantization picker, and the green/yellow/red **"will it fit" badges** computed from file size vs. detected RAM/VRAM.
- **My Models screen**: folder scan of `models\`, per-model load defaults, Load/Eject with context-length + GPU-offload slider + estimated memory readout.
- The chat's provider picker gains a "Local" entry that talks to the supervised server through the same OpenAI-compatible client from phase 1.

## Phase 3 — Server mode & Claude Desktop extras

- Expose HarnessX's own localhost OpenAI-compatible endpoint (on/off toggle, "Reachable at http://localhost:<port>"), with JIT model loading, 60-min idle TTL, and auto-evict — LM Studio's memory-policy trio.
- MCP support via `mcp_config.json` (same `mcpServers` shape as Claude Desktop, plus validation errors instead of silent failure).
- File attachments (inline into context), global hotkey quick-entry window, small CLI (`harnessx server|load|ls|ps`).

## Deferred indefinitely

Projects/knowledge RAG, artifacts panel, `.mcpb`-style extension installer, custom trained styles, preset sharing hub, MLX, multi-GPU controls.

## Phase 1 build order

1. Scaffold Tauri v2 + React + Vite; window, theme, basic layout (sidebar + chat pane).
2. OpenAI-compatible SSE client + streaming chat against one hardcoded provider.
3. Chat persistence (JSON per chat) + history sidebar.
4. Settings screen: providers, keys (keychain), global instructions.
5. System prompt composition (global + style + per-chat) + sampling controls + presets.
6. Anthropic provider, polish, NSIS installer + updater.
