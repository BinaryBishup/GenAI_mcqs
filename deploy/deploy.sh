#!/usr/bin/env bash
# Deploy the app to an EC2 box over SSH:
#   ./deploy/deploy.sh ubuntu@<host-or-ip>
# Requirements on the server: deploy/setup-server.sh has been run once, and
# /var/www/smartcogen/.env.production exists (see .env.production.example).
set -euo pipefail

TARGET="${1:?usage: ./deploy/deploy.sh user@host}"
APP_DIR=/var/www/smartcogen

echo "==> Syncing source to $TARGET:$APP_DIR"
# Exclude real secrets but KEEP the .env.*.example templates — setup-server.sh
# and DEPLOYMENT.md both tell you to copy .env.production.example on the server,
# so it has to actually get there.
rsync -az --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.env.production' \
  --exclude '.env.*.local' \
  --exclude '*.log' \
  ./ "$TARGET:$APP_DIR/"

echo "==> Building + (re)starting on the server"
ssh "$TARGET" bash -s <<'REMOTE'
set -euo pipefail
cd /var/www/smartcogen

if [[ ! -f .env.production ]]; then
  echo "ERROR: /var/www/smartcogen/.env.production is missing — copy .env.production.example and fill it in." >&2
  exit 1
fi

npm ci

# Cap the build heap below total RAM. On a t3.medium (4 GB) an uncapped V8 sizes
# its heap off the box and will happily grow until the OOM killer takes it; the
# cap makes it collect instead. setup-server.sh adds swap for the rest.
NODE_OPTIONS="--max-old-space-size=${BUILD_HEAP_MB:-3072}" npm run build

pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
REMOTE

echo "==> Deployed. Check:  ssh $TARGET 'pm2 status && curl -s localhost:3000/api/health'"
