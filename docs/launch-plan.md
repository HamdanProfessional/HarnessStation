# HarnessStation — Launch plan

*Written 2026-08-04. The go-to-market plan for shipping HarnessStation publicly:
what must be fixed first, how it gets distributed, and how it's promoted. For the
mechanics of building/signing an installer see [`release.md`](release.md); for
the feature backlog see [`roadmap.md`](roadmap.md). This document is the
sequencing and the decisions around them.*

## The one-line goal

Ship a **downloadable, self-updating desktop app** (Windows + Linux) plus the
**browser build** at `hsapp.retris.io`, positioned as *"run any AI model as a
private, local agent — bring your own key, no account, no telemetry"* — without
shipping any of the sharp edges below into strangers' hands.

## Current state (honest snapshot)

- **Product**: mature. Desktop (Tauri v2) + web build share one React tree; voice,
  MCP, tools, projects, knowledge, agents/workflows/schedules, local models, the
  device mesh, the community library, and a 74-lecture course all exist.
- **Live infra**: web app `hsapp.retris.io`, gateway `hsapi.retris.io`, docs
  `hsdocs.retris.io` — all on **one shared VPS** that also runs other production
  sites.
- **Not yet done**: code signing, a real (non-dev) updater key, a license, privacy
  policy/terms, community-library moderation, a marketing site, a bought domain.

---

## Phase 0 — Hard blockers (do these before any public binary)

These are release-gating. None are optional.

- [ ] **Rotate the updater signing key.** A throwaway dev keypair (password
  `harnessdev`) is documented in `release.md` and its public key is in
  `tauri.conf.json` — **anyone with it can push a malicious update to every
  install.** Generate a fresh keypair, replace `plugins.updater.pubkey`, and store
  the private key + password in a secrets manager (never the repo). This is the
  single most important item.
- [ ] **Decide the repo's fate and scrub secrets from history.** The repo is
  private today. Whatever the license decision (below), the git history contains
  the old updater password and references to gateway secrets. If the repo ever goes
  public, rewrite history (`git filter-repo`) to purge them **and** rotate anything
  exposed (AA key, gateway `.env`, trial keys, `LIBRARY_SALT`). If it stays private,
  ship binaries from a separate public releases repo.
- [ ] **Code signing.**
  - *Windows*: an OV/EV Authenticode certificate removes the "Windows protected
    your PC" SmartScreen wall (an EV cert clears SmartScreen reputation
    immediately; OV builds reputation over time). Budget ~$100–400/yr. Until then,
    the install docs (course E02) must show the "More info → Run anyway" path.
  - *Linux*: sign the `.deb` with a GPG key and publish the public key; sign/notarize
    the AppImage where practical. Lower stakes than Windows.
- [ ] **Community-library moderation.** The library is **public, anonymous, and
  unmoderated** — a launch-day abuse magnet. Before promoting it: add a **report/flag**
  endpoint + an **admin removal** path, a **content policy**, a stricter **per-IP
  publish rate limit** (e.g. 10/hour on top of the global 60/min), and server-side
  payload validation hardening. Back up `library.json` (it's the only copy).
- [ ] **Secrets & backups audit on the box.** Confirm `.env`, `trials.json`,
  `library.json` are `chmod 600`, excluded from deploys (they are), and backed up.
  Add a nightly backup of `library.json` off the box.

---

## Phase 1 — Legal & policy (parallel with Phase 0)

- [ ] **Pick a license.** This is a fork in the road — see Open Decisions. It gates
  whether the repo can be public and how the app can be monetized.
- [ ] **Privacy policy.** Easy to write honestly because the app collects nothing:
  no account, no telemetry, keys in the OS keychain, data in `~/.harnessx`. State
  what the **gateway** does touch (a hashed IP for library likes/rate-limiting;
  benchmark/HF proxy caching) and that user prompts/keys never pass through it.
- [ ] **Terms of use** for the hosted pieces (web app, gateway, community library):
  UGC ownership, acceptable use, no-warranty, the mesh's plaintext-transport
  caveat, and that trial keys are rate-limited demos.
- [ ] **Third-party attribution.** Ship a `THIRD_PARTY.md`: Tauri, v86 (BSD),
  transformers.js/Kokoro/Whisper, WebLLM, llama.cpp, and the model licenses users
  pull. Confirm nothing is GPL-incompatible with the chosen license.
- [ ] **Trademark check** for the final name (HarnessStation cleared earlier — all
  TLDs available, no conflicts found; re-verify at filing time).

---

## Phase 2 — Distribution & infrastructure

**Domain & identity**
- [ ] Buy the domain (harnessstation.com ~$12; add .io/.dev ~$40 each if desired).
- [ ] A simple **marketing landing page** (can reuse the docs-site stack): hero,
  the three "aha" demos (E01 what-it-is, E09 first-tool, E58 Linux-in-a-tab), a
  **"Try it in the browser"** button → `hsapp.retris.io`, and download buttons.
- [ ] Point the app's in-web "Get the desktop app" CTA (already wired) at the real
  download page instead of `hsdocs.retris.io/start/install`.

**Release pipeline**
- [ ] Move to **GitHub Releases** as the source of truth for binaries + the update
  manifest (`latest.json`), served signed. A public *releases* repo works even if
  the code stays private.
- [ ] **CI build** (GitHub Actions): tag → build Windows + Linux artifacts → sign →
  attach to the release → update the manifest. Removes the manual Windows-only build.
- [ ] Verify the **auto-updater** end to end against the new key: install an old
  build, publish a new one, confirm it updates and that a **bad signature is
  refused** (course E61).

**Package managers (post-v1, widens reach)**
- [ ] Windows: **winget**, **Scoop**, **Chocolatey**.
- [ ] Linux: a hosted **APT repo** for the `.deb`, **AUR** (Arch), **Flathub**, and
  optionally **Snap**.

**Infra hardening for public traffic**
- [ ] The gateway is currently one shared VPS. Before a traffic spike: confirm the
  systemd service auto-restarts, add **uptime monitoring** + alerting on
  `/api/health`, and load-test the library endpoints. If the box is a risk, move the
  gateway to its own small instance.
- [ ] **No app telemetry** stays a selling point. If crash data is ever wanted, make
  it **opt-in** and local-first.

---

## Phase 3 — Marketing & go-to-market

**Assets (mostly already built)**
- [ ] Record the **course** — the production kit for all 74 lectures is in `course/`.
  Cut the recommended **3–4 min trailer** (E01 + E09 + E58) as the pinned/hero video.
- [ ] Screenshots + a 60-second product GIF for the landing page and listings.
- [ ] A **trial link** (`?trial=CODE`, already built) so a "try with no key" button
  works — register a rate-limited demo key in `trials.json`.

**Positioning & channels**
- [ ] Positioning line: *"A desktop app for running AI models as agents — local or
  your own cloud key, with tools, files, knowledge, voice and a browser, private by
  default."* Lead with **privacy + bring-your-own-model**, not "another chat app."
- [ ] Launch posts, in likely order of fit:
  - **r/LocalLLaMA**, **r/selfhosted** (the core audience — local models, privacy).
  - **Hacker News** "Show HN" (lead with the v86 Linux-in-a-tab + the shim
    architecture — it's the most technically interesting hook).
  - **Product Hunt** (needs the polished landing page + GIF first).
  - X/Twitter + the YouTube course as an ongoing content engine.
- [ ] Prepare for the top FAQ: "is it free?", "do you see my keys/data?" (no), "Mac?"
  (not yet), "why the SmartScreen warning?" (until the cert lands).

---

## Phase 4 — Launch day

- [ ] Freeze a version, tag it, run the full release checklist (below).
- [ ] Publish binaries + manifest; smoke-test a fresh Windows and Linux install from
  the public download.
- [ ] Flip the landing page live; post to the chosen channels in a staggered order
  (not all at once — you want to be present to answer each).
- [ ] Watch `/api/health`, gateway logs, and the community library for abuse in the
  first 24–48h; keep the report/removal tools within reach.

## Phase 5 — Post-launch

- [ ] Support channel: GitHub Issues (+ a Discord if community forms).
- [ ] Triage feedback into `roadmap.md`; the top open items are **code signing**,
  **mesh transport encryption** (currently plaintext after the handshake — course
  E52), and **macOS support** (the most-requested absence).
- [ ] A predictable cadence: batch fixes into signed point releases; the updater
  does the rest.

---

## Release checklist (per release)

- [ ] `npm test` green, `npx tsc --noEmit` clean, both builds succeed.
- [ ] Version bumped; `CHANGELOG` updated.
- [ ] Artifacts **signed** with the production updater key (and code-signing cert).
- [ ] `latest.json` manifest updated and served.
- [ ] Fresh-install smoke test on Windows + Linux; **auto-update** from the previous
  version verified; **bad-signature refusal** verified.
- [ ] Gateway healthy; `library.json` backed up.
- [ ] Docs/course reflect any changed behavior.

---

## Open decisions (need a call before Phase 1 can finish)

1. **License / source model.** Fully open-source (MIT/Apache — maximal trust and
   contribution, hardest to monetize), **source-available** (e.g. BSL/Elastic — code
   visible, commercial use restricted), or **closed** (binaries only, private repo)?
   This gates the repo-public question and everything downstream.
2. **Money.** Free forever? Donations/sponsors? A paid tier (hosted gateway, signed
   builds, priority support) while the app stays free? The current design
   (bring-your-own-key, no accounts) means there's no built-in billing surface yet.
3. **Code-signing budget.** EV cert (clears Windows SmartScreen immediately, ~$300+/yr,
   hardware token) vs OV (cheaper, reputation builds over time) vs ship-unsigned-for-now
   (the course already handles the warning).
4. **macOS.** Deferred at launch, or is a Mac build (+ Apple notarization, $99/yr)
   part of v1? It's the most likely first FAQ.
5. **Gateway hosting.** Keep it on the shared box for launch, or move it to its own
   instance before promoting (safer under a spike)?

## Suggested sequencing

Phase 0 blockers are the critical path — **rotate the updater key first**, it's
cheap and it's the one thing that's genuinely dangerous. Legal (Phase 1) and the
landing page (Phase 2) can run in parallel. Don't promote the **community library**
until its moderation tools exist. Target a **soft launch** (r/LocalLLaMA + the web
demo link) before a **big launch** (HN/Product Hunt with the signed installer and
the trailer), so the first wave of feedback lands while the blast radius is small.
