# Building HarnessStation on Linux

The app is cross-platform, but it must be **built on Linux** — Tauri links against the
system WebKitGTK, so you can't cross-compile a Linux binary from Windows.

## Build dependencies

Debian / Ubuntu (22.04+):

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  libasound2-dev libdbus-1-dev pkg-config
```

Fedora:

```bash
sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel alsa-lib-devel dbus-devel \
  @development-tools
```

Arch:

```bash
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file \
  openssl libappindicator-gtk3 librsvg alsa-lib dbus
```

Why each matters: **webkit2gtk** is the webview, **libayatana-appindicator** is the tray
icon, **alsa** is microphone capture (cpal), **dbus** is the keychain (Secret Service).

Then Node 18+ and Rust:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## Build

```bash
npm install
npm run tauri build     # bundles into src-tauri/target/release/bundle/
npm run tauri dev       # or run in dev mode
```

Artefacts: `.deb`, `.rpm`, and `.AppImage`. The AppImage is the one to hand to someone
on an unknown distro.

## Runtime dependencies

Installed automatically by the `.deb`; for the AppImage you may need them yourself.

| Feature | Needs | Install |
|---|---|---|
| Text-to-speech (system voices) | `espeak-ng` or `speech-dispatcher` | `sudo apt install espeak-ng` |
| Text-to-speech (neural) | nothing — Piper downloads itself | — |
| Speech-to-text | whisper.cpp — see below | — |
| API key storage | gnome-keyring or kwallet | usually already present |
| Tray icon | libayatana-appindicator3 | `sudo apt install libayatana-appindicator3-1` |

### Speech-to-text needs a manual step

whisper.cpp does not reliably publish prebuilt Linux binaries, so the automatic
download that works on Windows may find nothing. Either install it from your package
manager, or build it and point the app at it:

```bash
git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp
cmake -B build && cmake --build build --config Release -j
mkdir -p ~/.harnessx/whisper/engine
ln -s "$PWD/build/bin/whisper-cli"    ~/.harnessx/whisper/engine/whisper-cli
ln -s "$PWD/build/bin/whisper-server" ~/.harnessx/whisper/engine/whisper-server
```

The models themselves still download automatically. Everything except the voice
avatar's listening works without this.

## Platform differences to expect

- **Text-to-speech** uses `spd-say` (which respects your desktop's speech settings) and
  falls back to `espeak-ng`. espeak-ng supports SSML, so the breath pauses and prosody
  shaping carry over from Windows. For a much better voice, pick **Piper** in
  Settings → Voice engine — it's self-contained and identical on both platforms.
- **Global hotkeys** (`Ctrl+Shift+V` push-to-talk, `Ctrl+Shift+Space` quick entry) work
  on X11. On **Wayland** they are unreliable to unavailable — that's a compositor
  restriction, not an app bug. Use the tray menu, or log into an X11/Xorg session.
- **Tray icon** needs an appindicator host. GNOME needs the AppIndicator extension;
  KDE, XFCE and Cinnamon work out of the box.
- **No WinRT voices** — that whole path is Windows-only and returns empty here.

## Status

The Linux code paths compile-check as syntax and are written against the documented
behaviour of each tool, but they have **not been run on a Linux machine yet**. Expect to
shake out small issues on first run; the speech and whisper paths are the likely
suspects.
