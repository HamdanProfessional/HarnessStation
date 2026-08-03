# Agent report — Course curriculum

- **Date:** 2026-08-03
- **Agent:** general-purpose (Sonnet), background
- **Task:** Read the whole app + docs and write a complete video-course curriculum for teaching HarnessStation on YouTube / the website.
- **Deliverable:** [`docs/COURSE_CURRICULUM.md`](../COURSE_CURRICULUM.md)

## Result summary (as reported by the agent)

Read the full doc set (all 40 pages under `docs-site/content/`), `PLAN.md`, `README.md`, and cross-checked against source — `src-tauri/src/local.rs` (llama-server launch flags + unit tests), `src-tauri/src/mesh.rs` / `docs-site/content/advanced/devices.md`, `web/shims/vm.ts` (the v86 real-Linux VM, more advanced than the slightly-stale `web/README.md` describes), and `src/components/ChatWindow.tsx` / `store.ts` (confirmed `rewindTo` and per-item `deleteItem` context-deletion for reasoning/tool-call/tool-response, not documented anywhere in docs-site).

**Structure produced:** 4 tracks, 19 modules, 74 lectures, ~8h45m total.

- **Track A — Beginner** (Modules 1–4, 14 lectures): install (Win/Linux/source), first local + cloud provider, first message, first tool call, sidebar tour, the agent loop, prompting patterns, a full codebase walkthrough.
- **Track B — Intermediate** (Modules 5–11, 32 lectures): voice (calls, engines, barge-in, avatars), MCP + progressive disclosure, built-in tools + writing JS/Python tools, projects, knowledge/RAG, agents/skills/workflows/swarms, schedules + cron, browser (in-app + extension), media generation, compare/benchmarks/evals, full settings deep-dive, memory, chat management, cost control.
- **Track C — Advanced** (Modules 12–16, 17 lectures): local model sizing, Discover/My Models GGUF downloads, llama-server flag tuning (`--cpu-moe`, `--flash-attn`, `--fit-target`, etc.) with its unit tests, device mesh pairing + the plaintext-transport warning, the full web build (OPFS, Pyodide, browser Whisper/Kokoro, the v86 Linux VM with its 9p bridge), rewind and per-item context deletion, deployment/backup/privacy checklist.
- **Track D — For developers** (Modules 17–19, 10 lectures): repo architecture, `store.ts`, the Rust command surface, the Tauri↔web shim seam (with the v86 VM as a case study in landing a feature behind that seam), hands-on exercises (write a shim, add a tool, extend a view), tests, release process and roadmap.

Every lecture includes title, number, duration estimate, objective, on-screen demo steps referencing real UI elements/code, and gotchas. No app code was modified — only the curriculum file was created.

## Usage

- Tokens: ~122,918 subagent tokens
- Tool uses: 52
- Duration: ~5m21s
