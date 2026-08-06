#!/usr/bin/env bash
#
# Redeploy the HarnessStation gateway (the benchmarks / shared-feeds API).
#
#   ./deploy/gateway.sh
#   HOST=n00bi2761@ssh.testservers.online ./deploy/gateway.sh
#
# Uploads the server code, installs production dependencies, and restarts the
# systemd service. The .env on the server (which holds AA_API_KEY) is never
# touched — secrets live only on the box, not in this repo.

set -euo pipefail

HOST="${HOST:-n00bi2761@ssh.testservers.online}"
DIR="${DIR:-/var/www/hs-gateway}"
SERVICE="${SERVICE:-hs-gateway}"
API="${API:-https://hsapi.retris.io}"

cd "$(dirname "$0")/.."

echo "==> Uploading server code to $HOST:$DIR"
# node_modules and .env are deliberately excluded: deps are installed on the
# box, and the env file with the API key stays there and is never overwritten.
tar -czf - -C server \
  --exclude=node_modules --exclude=.env --exclude=trials.json --exclude=library.json --exclude=users.json --exclude=sync \
  index.mjs package.json package-lock.json mcp-directory.json .env.example trials.example.json README.md \
  | ssh "$HOST" "
    set -eu
    mkdir -p '$DIR'
    tar -xzf - -C '$DIR'
    cd '$DIR'
    npm ci --omit=dev
    sudo systemctl restart '$SERVICE'
    sleep 2
    systemctl is-active '$SERVICE'
  "

echo "==> Verifying"
# is-active above proves the process is up; this proves it actually serves.
code=$(curl -fsS -o /dev/null -w '%{http_code}' "$API/api/health" --max-time 20 || true)
[ "$code" = "200" ] || { echo "FAIL: $API/api/health returned '$code'"; exit 1; }

# Surface whether the benchmarks feed has its key, since a running service with
# no AA_API_KEY looks healthy but serves 503 on /api/benchmarks.
echo -n "    benchmarks feed: "
curl -fsS "$API/api/health" --max-time 20 |
  grep -o '"benchmarks":{[^}]*}' || echo "(could not read health detail)"

echo "==> Done: $API"
