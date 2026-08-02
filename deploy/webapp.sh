#!/usr/bin/env bash
#
# Build the web app and publish it to the VPS, atomically.
#
#   ./deploy/webapp.sh
#   HOST=n00bi2761@ssh.testservers.online ./deploy/webapp.sh
#
# Same shape as docs.sh: each build lands in its own releases/ directory and a
# symlink is swapped, so no request sees a half-copied site and rollback is one
# command. Uses only ssh and tar (no rsync — not installed with Git Bash).

set -euo pipefail

HOST="${HOST:-n00bi2761@ssh.testservers.online}"
BASE="${BASE:-/var/www/hsapp}"
SITE="${SITE:-https://hsapp.retris.io}"
KEEP="${KEEP:-3}"   # the WASM is 21 MB per release, so keep fewer than the docs

cd "$(dirname "$0")/.."

echo "==> Building"
npm run web:build

test -s web/dist/index.html || { echo "build produced no index.html"; exit 1; }
test -d web/dist/assets     || { echo "build produced no assets"; exit 1; }

echo "==> Publishing to $HOST:$BASE"
tar -czf - -C web/dist . | ssh "$HOST" "
  set -eu
  rel='$BASE/releases/'\$(date +%Y%m%d-%H%M%S)
  mkdir -p \"\$rel\"
  tar -xzf - -C \"\$rel\"
  test -s \"\$rel/index.html\"
  ln -sfn \"\$rel\" '$BASE/current.tmp'
  mv -Tf '$BASE/current.tmp' '$BASE/current'
  # Prune old releases by name (timestamps sort lexicographically), never the
  # one that is currently live.
  cd '$BASE/releases'
  live=\$(basename \"\$(readlink '$BASE/current')\")
  ls -1 | sort -r | tail -n +$((KEEP + 1)) | grep -vxF \"\$live\" | xargs -r rm -rf
  echo \"    released \$(basename \"\$rel\")\"
"

echo "==> Verifying the live site"
code=$(curl -fsS -o /dev/null -w '%{http_code}' "$SITE/" --max-time 20 || true)
[ "$code" = "200" ] || { echo "FAIL: $SITE/ returned '$code'"; exit 1; }

# The app shell must reference a hashed JS bundle, and that bundle must come back
# as JavaScript rather than the SPA fallback.
asset=$(curl -fsS "$SITE/" --max-time 20 | grep -oE '/assets/[^"]*\.js' | head -1)
type=$(curl -fsS -o /dev/null -w '%{content_type}' "$SITE$asset" --max-time 20 || true)
case "$type" in
  *javascript*) ;;
  *) echo "FAIL: $asset served as '$type' — the SPA fallback is catching assets"; exit 1 ;;
esac

echo "==> Done: $SITE"
