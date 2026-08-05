# Security

HarnessStation is a local-first desktop app: it has no account, no telemetry, and
no cloud sync. Your API keys live in the OS credential store (Windows Credential
Manager / Linux Secret Service), and your conversations live in `~/.harnessx`.
The optional gateway (`hsapi.retris.io`) never receives your prompts or provider
keys — see [PRIVACY.md](PRIVACY.md).

## Reporting a vulnerability

Email the maintainer (see the repo's contact) with details and, if possible, a
proof of concept. Please do not open a public issue for anything exploitable.
We aim to acknowledge within a few days.

## Trust boundaries worth knowing

- **Terminal / file tools** run with your user's permissions inside the chosen
  working directory. The working directory limits *files*, not the network.
- **Browser session delegation**: if the model drives a browser you're signed
  into, it can act on any site in that session.
- **Device mesh**: after the pairing handshake, mesh traffic is **not encrypted**
  yet. Use it on a trusted LAN, or only inside a VPN/tunnel across the internet.
- **Community library**: published content is user-generated. Importing does not
  execute code (a skill is markdown loaded on demand; agents/workflows reference
  only built-in tool ids), but review anything before you rely on it. Report bad
  items with the **Report** button.

---

## Maintainer runbook — pre-launch secret hygiene

These are one-time tasks required before a public release. They must run on a
maintainer's machine / the server; they can't be done from the repo alone.

### 1. Rotate the updater signing key (CRITICAL)

An early **throwaway updater keypair and its password were committed to git
history** and are compromised. Anyone with them could sign a malicious auto-update.

- `tauri.conf.json` → `plugins.updater.pubkey` is now the placeholder
  `REPLACE_WITH_UPDATER_PUBLIC_KEY`, so a build can't ship with the old key.
- Generate a fresh keypair and paste its public key (see [docs/release.md](docs/release.md)):
  ```
  npm run tauri signer generate -- -w %USERPROFILE%\.harnessx\updater.key
  ```
- Store the private key + password in a secrets manager, never the repo. Set them
  as env vars only at build time.

### 2. Rotate every secret that touched git history

Purging history does not un-leak a secret — **rotate**, then purge. Rotate:
- the updater keypair (above),
- the Artificial Analysis key (`AA_API_KEY` in the gateway `.env`),
- any `trials.json` keys,
- set a fresh private `LIBRARY_SALT` and a `LIBRARY_ADMIN_TOKEN` (see
  `server/.env.example`).

### 3. Scrub the git history (only if the repo will be made public)

If the code stays private and only binaries ship, you can skip this. To purge
leaked secrets from history before opening the repo:

```
# install: pipx install git-filter-repo   (or pip install git-filter-repo)
# 1. Make a fresh clone as a backup first.
git clone --mirror <repo> repo-backup.git

# 2. Replace known secrets with ***REMOVED*** across all history.
cat > /tmp/replacements.txt <<'EOF'
harnessdev==>***REMOVED***
dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEU2Mzc4QkVGQkVGNUQ2MTUKUldRVjF2Vys3NHMzNWdBWGd4b1NwSWlnWGZ5ejJrL0RFU1dEMy8zVjhHci9vcjhETG5rR0hBa3QK==>***REMOVED***
EOF
git filter-repo --replace-text /tmp/replacements.txt

# 3. Verify nothing remains, then force-push. Coordinate — this rewrites history.
git log -p | grep -i harnessdev || echo clean
```

### 4. Back up the community library

`library.json` on the gateway is the only copy of everything users publish. Wire
up the nightly backup:

```
# on the gateway host, in crontab:
0 4 * * *  /var/www/hs-gateway/deploy/library-backup.sh >> /var/log/hs-library-backup.log 2>&1
```

### 5. Confirm file permissions on the box

```
chmod 600 /var/www/hs-gateway/.env /var/www/hs-gateway/trials.json /var/www/hs-gateway/library.json 2>/dev/null || true
```
