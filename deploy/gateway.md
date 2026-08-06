# Deploying the gateway

Target: **https://hsapi.retris.io** on your own VPS.

The gateway (`server/index.mjs`) is a small Express app run under **systemd**
behind nginx. Unlike the docs site it is **stateful** — it persists a few files
to disk that are the only copy of that data (see [State on the box](#state-on-the-box)),
so the box setup matters and a careless rebuild can lose data.

Everything secret lives in `/var/www/hs-gateway/.env` **on the box only** — never
in this repo. `deploy/gateway.sh` never touches it.

## One-time setup on the VPS

Assuming Ubuntu or Debian. Substitute your own username where it says `deploy`.

### 1. Point the domain at the box

Add an **A record** for `hsapi` in the `retris.io` DNS pointing at the VPS IPv4
(and an **AAAA** record if it has IPv6). Confirm it resolves before running
certbot:

```bash
dig +short hsapi.retris.io
```

### 2. Install Node and create the app directory

Node 20+ (the code uses the built-in `fetch`).

```bash
sudo apt update
sudo apt install -y nginx
# Node 20 from NodeSource, or your preferred method:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

sudo mkdir -p /var/www/hs-gateway
sudo chown -R "$USER:$USER" /var/www/hs-gateway
```

Owning it as the deploying user matters — `deploy/gateway.sh` uploads over SSH
without sudo (it only uses sudo to restart the service).

### 3. Create `.env` with the keys

The `.env` is the one thing that lives only on the box. Copy the template and
fill it in:

```bash
cd /var/www/hs-gateway
cp .env.example .env      # after the first code upload, or scp .env.example over
```

Set these — see `server/.env.example` for the full annotated list:

| Variable | Needed for | Generate with |
| --- | --- | --- |
| `AA_API_KEY` | Benchmarks feed (Artificial Analysis) | free key at artificialanalysis.ai/api |
| `LIBRARY_SALT` | Community library (hashes like/report keys) | `openssl rand -hex 16` |
| `LIBRARY_ADMIN_TOKEN` | Moderation routes (`/api/admin/library`) | `openssl rand -hex 32` |
| `SYNC_PEPPER` | **Cloud-sync accounts** — routes 503 without it | `openssl rand -hex 32` |

`SYNC_PEPPER` and `LIBRARY_SALT` are secrets that are mixed into stored hashes;
if you rotate them, existing logins / like-keys stop matching. Set them once and
keep them. Cloud-sync data itself is end-to-end encrypted on the client — the
server (and this pepper) never see plaintext or the encryption key.

### 4. Install the systemd unit

The unit is checked in at [`hs-gateway.service`](hs-gateway.service) so it is
reproducible. It includes `ReadWritePaths=/var/www/hs-gateway` — **required**, or
the sandbox blocks all disk writes (see [State on the box](#state-on-the-box)).

```bash
scp deploy/hs-gateway.service deploy@hsapi.retris.io:/tmp/
```

Then on the VPS:

```bash
sudo mv /tmp/hs-gateway.service /etc/systemd/system/hs-gateway.service
sudo systemctl daemon-reload
sudo systemctl enable --now hs-gateway
systemctl is-active hs-gateway            # -> active
```

### 5. Install the nginx site and get a certificate

```bash
scp deploy/hsapi.retris.io.conf deploy@hsapi.retris.io:/tmp/
```

On the VPS:

```bash
sudo mv /tmp/hsapi.retris.io.conf /etc/nginx/sites-available/hsapi
sudo ln -s /etc/nginx/sites-available/hsapi /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d hsapi.retris.io
sudo certbot renew --dry-run
```

### 6. Firewall, if one is enabled

```bash
sudo ufw allow 'Nginx Full'
```

## Deploying

From the repo, every time:

```bash
./deploy/gateway.sh
# or, targeting a specific host:
HOST=deploy@hsapi.retris.io ./deploy/gateway.sh
```

It uploads the server code (excluding `.env`, `node_modules`, and the on-disk
state files), runs `npm ci --omit=dev`, restarts the service, and verifies
`/api/health` returns 200. The `.env` and the data files on the box are never
overwritten.

## State on the box

This is the part that bites. The gateway persists three things to disk in its
working directory, and they are the **only** copy:

| File / dir | Holds |
| --- | --- |
| `library.json` | everything published to the community library |
| `users.json` | cloud-sync accounts (verifier hashes + session tokens) |
| `sync/` | one E2E-encrypted blob per account (ciphertext only) |

Two rules follow:

- **The service must be able to write its working directory.** The unit runs with
  `ProtectSystem=strict`, which makes the filesystem read-only except an
  allowlist. `ReadWritePaths=/var/www/hs-gateway` (baked into
  [`hs-gateway.service`](hs-gateway.service)) is what permits the writes. Omit it
  and every write fails with `EROFS` and the data is **silently lost on the next
  restart** — the service still looks healthy. Verify it is in effect:

  ```bash
  systemctl show hs-gateway -p ReadWritePaths      # -> ReadWritePaths=/var/www/hs-gateway
  ```

- **Back them up** — they are not in git and, for cloud sync, encrypted such that
  only the user can read them. See below.

> If you migrated from an earlier box that used a separate drop-in at
> `/etc/systemd/system/hs-gateway.service.d/override.conf`, the checked-in unit
> now folds `ReadWritePaths` in directly — delete the old drop-in to avoid
> confusion (`sudo rm` it, then `daemon-reload`).

## Backups

`deploy/library-backup.sh` snapshots all three (`library.json`, `users.json`,
`sync/`) into a timestamped, gzipped tarball and prunes old ones. Run it from
cron **on the box**:

```bash
crontab -e
# nightly at 04:00, keeping the last 14 days:
0 4 * * *  /var/www/hs-gateway/deploy/library-backup.sh >> /var/log/hs-gateway-backup.log 2>&1
```

## Health check

```bash
curl -fsS https://hsapi.retris.io/api/health | jq
```

Worth glancing at after a deploy:

- `benchmarks` — object present means `AA_API_KEY` is set and the feed is warm.
- `moderation: "on"` — `LIBRARY_ADMIN_TOKEN` is set.
- `cloud: "on"` and `accounts: <n>` — `SYNC_PEPPER` is set and accounts persist
  across restarts (the whole point of `ReadWritePaths`).

## If something's wrong

**Service is `active` but data vanishes on restart** — `ReadWritePaths` is
missing. This is the classic failure: writes fail silently and the app looks
fine until a restart. Check `systemctl show hs-gateway -p ReadWritePaths` and
the journal for `EROFS` (`journalctl -u hs-gateway -e`).

**`cloud: "off"` in health** — `SYNC_PEPPER` isn't set in `.env`; the account /
sync routes return 503 by design until it is.

**502 from nginx** — the Node process isn't up. `systemctl status hs-gateway`
and `journalctl -u hs-gateway -e`.

**`/api/benchmarks` 503 but health is 200** — `AA_API_KEY` is missing; the rest
of the gateway is fine.
