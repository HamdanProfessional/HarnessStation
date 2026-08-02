#!/usr/bin/env bash
#
# Build the documentation and publish it to the VPS.
#
#   ./deploy/docs.sh
#   HOST=root@203.0.113.10 ./deploy/docs.sh     # before DNS has propagated
#
# Needs SSH key access to the host. Uses only ssh and tar — deliberately not
# rsync, which isn't installed with Git Bash on Windows.
#
# Deploys are atomic. Each build lands in its own releases/ directory and a
# symlink is swapped to point at it, so there is no moment where a visitor can
# be served a half-copied site, and rolling back is one command.

set -euo pipefail

HOST="${HOST:-deploy@hsdocs.retris.io}"
BASE="${BASE:-/var/www/hsdocs}"
SITE="${SITE:-https://hsdocs.retris.io}"
KEEP="${KEEP:-5}" # releases to retain for rollback

cd "$(dirname "$0")/.."

echo "==> Checking the docs are consistent"
# Catches what would otherwise only show up as broken links in production:
# a page missing from the sidebar, a dead internal link, a nested index.md.
npx vitest run tests/docs.test.ts

echo "==> Building"
npm run docs:build

# A build that silently produced nothing must not be published over a working
# site. Check before anything leaves this machine.
test -s docs-site/dist/index.html || { echo "build produced no index.html"; exit 1; }
test -s docs-site/dist/404.html   || { echo "build produced no 404.html"; exit 1; }
test -d docs-site/dist/assets     || { echo "build produced no assets"; exit 1; }

echo "==> Publishing to $HOST:$BASE"
# tar over ssh: one connection, compressed, and no dependency beyond ssh.
tar -czf - -C docs-site/dist . | ssh "$HOST" "
  set -euo pipefail
  rel='$BASE/releases/'\$(date +%Y%m%d-%H%M%S)
  mkdir -p \"\$rel\"
  tar -xzf - -C \"\$rel\"

  # Refuse to publish an empty extraction rather than pointing the site at it.
  test -s \"\$rel/index.html\"

  # Swapping a symlink is atomic: a request either sees the whole old release
  # or the whole new one, never a mixture. -n stops ln following the existing
  # link and creating current/current instead of replacing it.
  ln -sfn \"\$rel\" '$BASE/current.tmp'
  mv -Tf '$BASE/current.tmp' '$BASE/current'

  # Keep a few for rollback, discard the rest.
  #
  # Sorted by name, not mtime: release names are timestamps and so sort
  # lexicographically, whereas 'ls -t' is unstable when two releases share a
  # second — which deleted the release 'current' pointed at, leaving a symlink
  # to nothing and a site serving 404s. The grep is a second guard on the same
  # thing: never remove the release that is actually live.
  cd '$BASE/releases'
  live=\$(basename \"\$(readlink '$BASE/current')\")
  ls -1 | sort -r | tail -n +$((KEEP + 1)) | grep -vxF \"\$live\" | xargs -r rm -rf
  echo \"    released \$(basename \"\$rel\")\"
"

echo "==> Verifying the live site"
# rsync or ssh exiting 0 means the files moved, not that the site works. These
# are the two failures that actually happen, so check for them directly.
asset=$(grep -o '/assets/[^"]*\.js' docs-site/dist/index.html | head -1)

code=$(curl -fsS -o /dev/null -w '%{http_code}' "$SITE/guide/tools" || true)
[ "$code" = "200" ] || { echo "FAIL: deep link returned '$code' — is try_files set?"; exit 1; }

type=$(curl -fsS -o /dev/null -w '%{content_type}' "$SITE$asset" || true)
case "$type" in
  *javascript*) ;;
  *) echo "FAIL: $asset served as '$type' — the SPA fallback is catching assets"; exit 1 ;;
esac

echo "==> Done: $SITE"
