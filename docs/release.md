# Building & Releasing HarnessStation

The app is wired for a real Windows installer with self-update. Two one-time manual steps are
required (they need secrets that can't live in the repo): an **updater signing keypair** and,
ideally, a **code-signing certificate**.

> ⚠️ **SECURITY — the old dev keypair is COMPROMISED.** An early throwaway updater keypair (and its
> password) was committed to this repo's history and must be treated as public. **Never sign a
> release with it.** `tauri.conf.json` → `plugins.updater.pubkey` is now the placeholder
> `REPLACE_WITH_UPDATER_PUBLIC_KEY`, so a build won't ship with the compromised key by accident —
> generate a fresh keypair (below), paste its public key, and keep the private key in a secrets
> manager. The old key in git history should be purged during the pre-launch history scrub
> (see the launch plan), but purging history does **not** un-leak it — rotation is what protects you.

## 1. Generate the updater keypair (one-time)

```
npm run tauri signer generate -- -w %USERPROFILE%\.harnessx\updater.key
```

- This prints a **public key**. Paste it into `src-tauri/tauri.conf.json` →
  `plugins.updater.pubkey` (replacing `REPLACE_WITH_UPDATER_PUBLIC_KEY`).
- Keep the **private key** (`updater.key`) and its password secret. Set them as env vars when
  building so artifacts get signed:
  ```
  set TAURI_SIGNING_PRIVATE_KEY=%USERPROFILE%\.harnessx\updater.key
  set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<your password>
  ```

## 2. Build the installer

```
npm run tauri build
```

Outputs (under `src-tauri/target/release/bundle/`):
- `nsis/HarnessStation_<ver>_x64-setup.exe` — the installer
- `msi/HarnessStation_<ver>_x64_en-US.msi`
- `.sig` signature files (when the signing env vars above are set)

The installer bundles the WebView2 bootstrapper (`downloadBootstrapper`), so it works on machines
without WebView2 preinstalled.

## 3. Publish a release (enables auto-update)

The updater endpoint is set to:
`https://github.com/najma-lp/harnessstation/releases/latest/download/latest.json`

For each release, upload to the GitHub release:
- the NSIS `-setup.exe` and its `.sig`
- a `latest.json` like:
  ```json
  {
    "version": "0.2.0",
    "notes": "What changed...",
    "pub_date": "2026-07-19T00:00:00Z",
    "platforms": {
      "windows-x86_64": {
        "signature": "<contents of the .exe.sig file>",
        "url": "https://github.com/najma-lp/harnessstation/releases/download/v0.2.0/HarnessStation_0.2.0_x64-setup.exe"
      }
    }
  }
  ```

Bump `version` in `tauri.conf.json` and `Cargo.toml` for each release. On launch (and via Settings →
Check for updates) the app compares its version to `latest.json`, downloads + verifies the signed
installer, installs, and relaunches.

## 4. Code signing (recommended)

Without an Authenticode certificate, Windows SmartScreen warns users on first install. To sign:
- Obtain a code-signing cert (OV or EV) and set `bundle.windows.certificateThumbprint` (or use a
  signing service) in `tauri.conf.json`.
- EV certs avoid SmartScreen reputation warnings immediately; OV certs build reputation over time.

## CI

Two workflows live in `.github/workflows/`:

- **`ci.yml`** — on every push to `main` and every PR: typecheck, `npm test`, the Vite build, plus
  `cargo clippy -D warnings` and `cargo test` on Linux.
- **`release.yml`** — on a `v*` tag: re-runs the checks, then builds Windows and Linux bundles with
  `tauri-apps/tauri-action` and publishes them as a **draft** release with `latest.json` generated.

Set these repository secrets before the first tagged release:

| Secret | Purpose |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of the updater private key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |
| `WINDOWS_CERTIFICATE` | base64 of the Authenticode `.pfx` (optional) |
| `WINDOWS_CERTIFICATE_PASSWORD` | its password (optional) |

To cut a release: bump the version in `package.json`, `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml`, then `git tag v0.2.0 && git push origin v0.2.0`. The release is created as a
draft so you can add notes before publishing.
