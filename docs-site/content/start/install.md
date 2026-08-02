---
title: Install
description: Getting HarnessStation onto Windows or Linux, including the warning you'll see on first launch and why.
---

# Install

## Windows

Download the installer and run it. HarnessStation needs no runtime you don't
already have — Windows 10 and 11 both ship the WebView2 component it renders
with.

> **Warning:** Windows will show a blue "Windows protected your PC" box on first
> launch, and the app is not currently code-signed, so this is expected rather
> than a sign something is wrong. Click **More info → Run anyway** to proceed.
>
> That warning appears for every unsigned application; a signing certificate is
> an annual cost and is on the roadmap. If you'd rather not run unsigned
> software, building from source is the honest alternative — see below.

## Linux

Both an AppImage and a `.deb` are provided.

```bash
# AppImage — no install, just make it executable
chmod +x HarnessStation_*.AppImage
./HarnessStation_*.AppImage

# Debian / Ubuntu
sudo dpkg -i harnessstation_*.deb
```

If the AppImage won't start, the usual cause is a missing WebKit runtime:

```bash
sudo apt install libwebkit2gtk-4.1-0 libjavascriptcoregtk-4.1-0
```

Speech has an optional extra. The app can use a fully self-contained neural
voice, but if you'd rather use the system one, install a speech engine:

```bash
sudo apt install espeak-ng      # or: speech-dispatcher
```

See [voice engines](../voice/engines) for which to choose and why.

## Building from source

You need [Node.js](https://nodejs.org) 18+, [Rust](https://rustup.rs), and a C++
toolchain — Visual Studio 2022 Build Tools with the C++ workload on Windows,
`build-essential` on Linux.

```bash
git clone <repository-url>
cd HarnessStation
npm install
npm run tauri dev      # run it
npm run tauri build    # produce an installer
```

The first Rust build compiles a few hundred crates and takes several minutes.
Later builds are incremental and much faster.

## Updating

The app checks for updates on startup and offers them in **Settings › Data &
updates**, where you can also check by hand. Updates are signed, and one that
fails its signature check is refused rather than installed.

## Uninstalling

Uninstall through Windows Settings, or `sudo dpkg -r harnessstation` on Debian.

**Your data is not removed with the app.** Conversations, keys and settings live
in a folder in your home directory, which the uninstaller deliberately leaves
alone so that reinstalling doesn't lose your history. To remove it too, delete
`~/.harnessx` — see [where your data lives](../advanced/data) for exactly what's
in there.
