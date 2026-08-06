#!/usr/bin/env bash
#
# Nightly backup of the gateway's on-disk state. These files live on the box (not
# in git) and are the ONLY copy of the data:
#   library.json   community library — everything users have published
#   users.json     cloud-sync accounts (verifier hashes + session tokens)
#   sync/          one E2E-encrypted blob per account (ciphertext only; the
#                  server cannot read it, so if these are lost the data is gone)
#
# Run it on the gateway host from cron, e.g.:
#   0 4 * * *  /var/www/hs-gateway/deploy/library-backup.sh >> /var/log/hs-gateway-backup.log 2>&1
#
# Keeps the last KEEP daily snapshots (timestamped, gzipped tarballs) under
# BACKUP_DIR. See deploy/gateway.md.

set -euo pipefail

DIR="${DIR:-/var/www/hs-gateway}"
BACKUP_DIR="${BACKUP_DIR:-$DIR/backups}"
KEEP="${KEEP:-14}"

cd "$DIR"

# Only include the pieces that actually exist, so a box running just the library
# (no cloud sync) still backs up cleanly, and vice versa.
paths=()
[ -s library.json ] && paths+=(library.json)
[ -s users.json ]   && paths+=(users.json)
[ -d sync ]         && paths+=(sync)

if [ ${#paths[@]} -eq 0 ]; then
  echo "$(date -Is) no gateway state in $DIR — nothing to back up"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/hs-gateway-$stamp.tar.gz"
tar -czf "$out" "${paths[@]}"
echo "$(date -Is) backed up [${paths[*]}] ($(wc -c < "$out") bytes) -> $(basename "$out")"

# Prune old snapshots, newest KEEP kept. Also sweep up any snapshots from the
# earlier library-only naming scheme so they don't accumulate forever.
ls -1t "$BACKUP_DIR"/hs-gateway-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1t "$BACKUP_DIR"/library-*.json.gz  2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
