#!/usr/bin/env bash
#
# Publish the marketing landing page (site/) to the VPS, atomically.
#
#   ./deploy/site.sh
#   HOST=user@host BASE=/var/www/hssite SITE=https://harnessstation.com ./deploy/site.sh
#
# Same shape as webapp.sh / docs.sh: each build lands in its own releases/ dir and
# a symlink is swapped. Point a domain + nginx site at $BASE/current first (the
# landing page is static — no runtime).

set -euo pipefail

HOST="${HOST:-n00bi2761@ssh.testservers.online}"
BASE="${BASE:-/var/www/hssite}"
SITE="${SITE:-https://harnessstation.retris.io}"
KEEP="${KEEP:-3}"

cd "$(dirname "$0")/.."
test -s site/index.html || { echo "site/index.html missing"; exit 1; }

echo "==> Publishing site/ to $HOST:$BASE"
tar -czf - -C site . | ssh "$HOST" "
  set -eu
  rel='$BASE/releases/'\$(date +%Y%m%d-%H%M%S)
  mkdir -p \"\$rel\"
  tar -xzf - -C \"\$rel\"
  test -s \"\$rel/index.html\"
  ln -sfn \"\$rel\" '$BASE/current.tmp'
  mv -Tf '$BASE/current.tmp' '$BASE/current'
  cd '$BASE/releases'
  live=\$(basename \"\$(readlink '$BASE/current')\")
  ls -1 | sort -r | tail -n +$((KEEP + 1)) | grep -vxF \"\$live\" | xargs -r rm -rf
  echo \"    released \$(basename \"\$rel\")\"
"

if [ -n "$SITE" ]; then
  echo "==> Verifying $SITE"
  code=$(curl -fsS -o /dev/null -w '%{http_code}' "$SITE/" --max-time 20 || true)
  [ "$code" = "200" ] || { echo "FAIL: $SITE/ returned '$code'"; exit 1; }
fi
echo "==> Done${SITE:+: $SITE}"
