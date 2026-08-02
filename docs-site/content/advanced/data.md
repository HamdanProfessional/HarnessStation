---
title: Where your data lives
description: Every folder the app writes to, what's in it, and how to back it up or move it to another machine.
---

# Where your data lives

Everything is in one folder in your home directory:

```text
Windows   C:\Users\<you>\.harnessx\
Linux     ~/.harnessx/
```

Plain files. No database, nothing proprietary.

## What's in it

| Path | |
| --- | --- |
| `settings.json` | Providers *(without keys)*, instructions, theme, all preferences |
| `conversations/` | One JSON file per chat, plus `index.json` for the sidebar |
| `presets/` | Saved prompt and parameter combinations |
| `snapshots/` | Chat snapshots |
| `exports/` | Anything you've exported |
| `agent-memory/` | Per-agent memory |
| `avatars/` | Imported VRM and MMD characters |
| `models/` | Models the app downloaded |
| `engines/` | Speech engines — Whisper, Piper |
| `tmp/` | Scratch space; safe to delete |

## What isn't in it

**API keys.** Those are in your OS credential store — Windows Credential Manager,
or the GNOME/KDE keyring — not in any of these files.

That's a deliberate split, and it has a consequence for backups: copying
`.harnessx` gives you your conversations and settings, but you'll re-enter keys
on the new machine.

## Backing up

Copy the folder. That's the whole procedure.

```bash
# Linux
tar czf harnessx-backup.tar.gz ~/.harnessx
```

```powershell
# Windows
Compress-Archive "$env:USERPROFILE\.harnessx" harnessx-backup.zip
```

Worth excluding `models/` and `engines/` — they're large and re-downloadable.

## Moving to another machine

Close the app on both, copy the folder across, re-enter your keys in
**Settings › Providers**.

One caveat: **device identity is per-machine**. A copied install keeps the same
device id, which will confuse the [mesh](devices) if both machines run at once.
Re-pair from the new machine if you use it.

## Reading it yourself

Chats are readable JSON with the messages in order, including tool calls and
results. Easy to grep, easy to process:

```bash
grep -rl "deployment" ~/.harnessx/conversations/
```

Nothing stops you editing these files, but do it with the app closed — it holds
chats in memory and will write over your changes.

## Deleting things

Deleting a chat in the app removes the file. Uninstalling the app leaves the
folder alone deliberately, so reinstalling doesn't lose your history — delete
`.harnessx` yourself if you want it gone.
