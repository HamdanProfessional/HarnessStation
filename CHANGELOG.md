# Changelog

All notable changes are recorded here. Versions follow [semantic versioning](https://semver.org).

## [Unreleased]

### Added
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
