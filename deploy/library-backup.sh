#!/usr/bin/env bash
#
# Nightly backup of the community library's data. library.json is the ONLY copy
# of everything users have published — it lives on the box (not in git), so it
# needs its own backup.
#
# Run it on the gateway host from cron, e.g.:
#   0 4 * * *  /var/www/hs-gateway/deploy/library-backup.sh >> /var/log/hs-library-backup.log 2>&1
#
# Keeps the last KEEP daily snapshots (timestamped, gzipped) under BACKUP_DIR.

set -euo pipefail

DIR="${DIR:-/var/www/hs-gateway}"
FILE="${LIBRARY_FILE:-$DIR/library.json}"
BACKUP_DIR="${BACKUP_DIR:-$DIR/backups}"
KEEP="${KEEP:-14}"

[ -s "$FILE" ] || { echo "$(date -Is) no library.json at $FILE — nothing to back up"; exit 0; }

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
gzip -c "$FILE" > "$BACKUP_DIR/library-$stamp.json.gz"
echo "$(date -Is) backed up $(wc -c < "$FILE") bytes -> library-$stamp.json.gz"

# Prune old snapshots, newest KEEP kept.
ls -1t "$BACKUP_DIR"/library-*.json.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
