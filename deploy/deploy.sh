#!/usr/bin/env bash
# Deploy the app to an EC2 box over SSH:
#   ./deploy/deploy.sh ubuntu@<host-or-ip>
# Requirements on the server: deploy/setup-server.sh has been run once, and
# /var/www/assessly/.env.production exists (see .env.production.example).
set -euo pipefail

TARGET="${1:?usage: ./deploy/deploy.sh user@host}"
APP_DIR=/var/www/assessly

echo "==> Syncing source to $TARGET:$APP_DIR"
rsync -az --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude '.env*' \
  --exclude '*.log' \
  ./ "$TARGET:$APP_DIR/"

echo "==> Building + (re)starting on the server"
ssh "$TARGET" bash -s <<'REMOTE'
set -euo pipefail
cd /var/www/assessly

if [[ ! -f .env.production ]]; then
  echo "ERROR: /var/www/assessly/.env.production is missing — copy .env.production.example and fill it in." >&2
  exit 1
fi

npm ci
npm run build
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
REMOTE

echo "==> Deployed. Check:  ssh $TARGET 'pm2 status && curl -s localhost:3000/api/health'"
