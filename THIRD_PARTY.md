# Third-party software

HarnessStation is built on open-source software. This lists the primary
components and their licenses; the complete, authoritative list is in
[`package.json`](package.json) / `package-lock.json` (JavaScript) and
[`src-tauri/Cargo.toml`](src-tauri/Cargo.toml) / `Cargo.lock` (Rust). Run
`npm ls` and `cargo tree` for the full transitive set.

*Licenses noted below are the projects' primary licenses at time of writing;
verify against each project before relying on it for a commercial release.*

## Application framework

| Component | Purpose | License |
| --- | --- | --- |
| [Tauri](https://tauri.app) + plugins (fs, http, opener, updater, process, global-shortcut) | Desktop app shell | MIT / Apache-2.0 |
| [React](https://react.dev) / React DOM | UI | MIT |
| [Vite](https://vitejs.dev) | Build/dev tooling | MIT |
| [Zustand](https://github.com/pmndrs/zustand) | State management | MIT |
| [Vitest](https://vitest.dev) | Test runner | MIT |

## Frontend libraries

| Component | Purpose | License |
| --- | --- | --- |
| react-markdown, remark-gfm, rehype-highlight, highlight.js | Markdown + code rendering | MIT |
| mermaid | Diagrams | MIT |
| three, @pixiv/three-vrm | 3D avatars (VRM/MMD) | MIT |

## AI / voice / local-model stack

| Component | Purpose | License |
| --- | --- | --- |
| [@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm) | In-browser model inference (WebGPU) | Apache-2.0 |
| [kokoro-js](https://github.com/hexgrad/kokoro) / Hugging Face Transformers.js | Local TTS / STT in the browser | Apache-2.0 |
| Whisper (Xenova/whisper-\* models) | Browser speech-to-text | model-specific |
| [v86](https://github.com/copy/v86) | x86→WebAssembly emulator (in-browser Linux VM) | **BSD-2-Clause** (free for commercial use) |
| llama.cpp (llama-server, supervised by the app) | Local GGUF inference | MIT |
| [Pyodide](https://pyodide.org) | Python in the browser | MPL-2.0 |

## Rust backend crates

reqwest, tokio, tokio-tungstenite, serde/serde_json, sysinfo, cpal (audio),
keyring (OS credential store), sha2, base64, zip, flate2, tar, rand, url, open —
all MIT and/or Apache-2.0. See `Cargo.toml`/`Cargo.lock` for versions and the
full tree.

## Gateway (server/)

[Express](https://expressjs.com) (MIT) and Node.js built-ins. Deployment tooling
uses [Paramiko](https://www.paramiko.org) (LGPL-2.1).

## Models and content you provide

Models you download (via Discover, Ollama, LM Studio, WebLLM, or Hugging Face) and
any content you generate are governed by **their own** licenses and the terms of
whatever provider you use. HarnessStation ships no model weights and no API keys.

## Community library content

Skills, agents, workflows and schedules in the community library are contributed
by users under the license described in [TERMS.md](TERMS.md), not by this project.
