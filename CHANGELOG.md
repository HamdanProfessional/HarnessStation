# Changelog

All notable changes are recorded here. Versions follow [semantic versioning](https://semver.org).

## [Unreleased]

### Added
- **Value tab / price intelligence** — live prices for ~6,700 models plus VPS and
  GPU compute, read from providers' own published price lists. No key, no
  account; every row links to its source.
- **Multi-token prediction** for the local engine (`--spec-type draft-mtp`) —
  roughly 1.5-2x tokens/sec with no second model in memory. Off by default in
  Models -> Advanced; needs llama.cpp build 9200+ and a GGUF built with MTP
  heads, and is silently inert without them. Ships with
  `unsloth/Qwen3.6-27B-MTP-GGUF` in the staff picks.
- **Inline first-run key prompt** — a new user lands in the conversation instead
  of a chooser in front of a chooser.
- **Community library** — publish and import Skills, Agents, Workflows and
  Schedules; sort by trending / recommended / most-downloaded / newest; search,
  tag filters, and IP-based likes. Moderation: report → auto-hide, admin
  hide/restore/remove, per-IP publish limits, payload validation.
- **In-browser models (WebGPU / WebLLM)** on both web and desktop, with per-model
  download + progress.
- **Shareable setup links** (`?provider=&model=&style=&mode=`) and gateway
  **trial keys** (`?trial=CODE`) for zero-setup demos.
- **Secrets vault** — save API keys the model can use but never read.
- **Web voice** via the browser's built-in speech recognition (no model download).

### Changed
- New chats start with the built-in tools enabled.
- Flattened, professional UI (real icons, solid accent, no gradients).
- **Discover model catalog refreshed** against each provider's live docs. Several
  entries had gone past stale into broken: Groq's Llama 3.x / Qwen3-32B /
  Kimi-K2 endpoints and DeepSeek's `deepseek-chat` / `deepseek-reasoner` are
  retired and those ids now 404. Adds Qwen 3.8 27B to the local staff picks.
- **The catalog now checks itself.** `tests/catalog.live.test.ts` joins Discover's
  model ids to the live price feed and reports ids the feed has never heard of
  (`CATALOG_LIVE=1`). It found eight stale providers on its first run.

### Fixed
- `docs/freeze.md` claimed the entry chunk was ~6 MB (2.1 MB gzipped) and used
  that to justify freezing features. **The entry is 774 kB (241 kB gzipped)**;
  the 6 MB chunk is `web-llm`, which is lazy and was only named `index-*.js` by
  Rollup. The build now names it, so the log can't be misread the same way.

### Security
- Replaced the compromised dev updater public key in `tauri.conf.json` with a
  placeholder so a build can't ship signed by the leaked key (see `SECURITY.md`).

## Project docs
- Licensed under **Apache-2.0** (`LICENSE`, `NOTICE`).
- Added `PRIVACY.md`, `TERMS.md`, `THIRD_PARTY.md`, `SECURITY.md`, and the
  `docs/launch-plan.md`.

---

*Release entries begin at v1.0.0. Until then, changes accumulate under
"Unreleased".*
