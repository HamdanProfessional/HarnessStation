# HarnessX

A very simple Windows desktop harness for AI models — chat with any OpenAI-compatible endpoint (LM Studio, Ollama, OpenAI, OpenRouter…) or Anthropic, with Claude-Desktop-style system instructions.

Built with Tauri v2 + React/TypeScript. See [PLAN.md](PLAN.md) for the roadmap and `docs/` for the research behind it.

## Features (Phase 1)

- Streaming chat with markdown rendering, stop and regenerate
- Providers: any OpenAI-compatible base URL + Anthropic, configurable in Settings
- System instructions, composed in layers: global (Settings) → style preset (Normal/Concise/Explanatory/Formal) → per-chat prompt
- Temperature / max-tokens controls; save the current prompt+params as a named preset
- Chat history with search; everything stored as plain JSON under `%USERPROFILE%\.harnessx\`

## Development

Prerequisites: Node.js 18+, Rust (via [rustup](https://rustup.rs)), VS 2022 Build Tools with the C++ workload.

```
npm install
npm run tauri dev     # run the desktop app
npm run tauri build   # produce the installer
```

## Data layout

```
%USERPROFILE%\.harnessx\
├── settings.json      # providers, keys, global instructions, theme
├── conversations\     # one JSON file per chat
└── presets\           # one JSON file per saved preset
```
