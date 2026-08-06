---
title: Cloud sync
description: Optional, end-to-end encrypted backup and sync of your data across devices.
---

# Cloud sync

HarnessStation is local-first — everything lives on your machine by default. But
the browser build keeps its data in the browser's storage, which is wiped if the
profile is cleared, so you could lose your chats. **Cloud sync** is an *optional*
account that backs up your data, encrypted, and lets a new device pull it down.

Set it up in **Settings › Cloud sync**. It's off unless you turn it on.

## What it is (and isn't)

- **End-to-end encrypted, zero-knowledge.** Your data is encrypted on your device
  with a key derived from your account password. The server only ever stores
  **ciphertext** and a password *verifier* — it can never read your chats.
- **Your API keys never leave the device.** Provider keys and the
  [secrets vault](../guide/secrets) are **excluded** from the sync; they stay in
  your OS keychain (or the browser's storage). You re-enter them once on each new
  device. Everything else syncs: chats, agents, skills, workflows, schedules,
  projects, presets, and settings.
- **Not an account you need.** Local-only remains the default and needs no
  sign-up. Cloud sync is purely opt-in.

> ⚠️ **A forgotten password can't be recovered.** Because only you hold the key,
> there's no reset — a lost password means the cloud copy is unreadable. Use a
> password you won't lose (a password manager is ideal).

## Getting started

1. **Settings › Cloud sync → Create account**: an email and a password (8+ chars).
   Your current data is uploaded, encrypted, straight away.
2. **On another device**: **Sign in**. If the account already has data, you're
   asked whether to **adopt the cloud copy** (merge it here) or **upload this
   device** instead.
3. Leave **Sync automatically** on and changes are pushed up a few seconds after
   they settle. Use **Sync now** to push immediately, or **Restore from cloud** to
   pull.

## How syncing behaves

- Changes are **pushed** up automatically (debounced), so your latest state is
  always backed up.
- The app does **not** auto-pull on launch — that could overwrite edits you made
  offline. A pull happens when you sign in and when you hit **Restore from cloud**.
- Merges are **by id**: pulling overwrites items that share an id and keeps the
  rest, so a restore never deletes local-only items. If you edit the same thing on
  two devices, the last push wins.
- **Sign out** keeps your local data and just stops syncing. **Delete cloud
  account** removes the encrypted blob from the server; your local data is
  untouched.

See also [Where your data lives](data), [Privacy & security](privacy), and
[Secrets](../guide/secrets).
