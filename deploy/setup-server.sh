#!/usr/bin/env bash
# One-time EC2 bootstrap. Run ON the server (Ubuntu 22.04/24.04) as a sudoer:
#   bash setup-server.sh
set -euo pipefail

APP_DIR=/var/www/assessly

echo "==> System packages"
sudo apt-get update -y
sudo apt-get install -y nginx git curl unzip postgresql-client

echo "==> Node 20 (NodeSource)"
if ! command -v node >/dev/null || [[ "$(node -v)" != v2* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> PM2"
sudo npm install -g pm2
# restart apps on reboot
sudo env PATH=$PATH pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null || true

echo "==> App directory"
sudo mkdir -p "$APP_DIR"
sudo chown "$USER":"$USER" "$APP_DIR"

echo "==> Nginx site"
if [[ -f "$APP_DIR/deploy/nginx.conf" ]]; then
  sudo cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/assessly
  sudo ln -sf /etc/nginx/sites-available/assessly /etc/nginx/sites-enabled/assessly
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t && sudo systemctl reload nginx
else
  echo "    (deploy the app first, then re-run to install deploy/nginx.conf)"
fi

echo "==> Done. Next steps:"
echo "    1. Put env vars in $APP_DIR/.env.production   (see .env.production.example)"
echo "    2. From your laptop:  ./deploy/deploy.sh ubuntu@<host>"
echo "    3. TLS:  sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d <domain>"
