#!/usr/bin/env bash
# One-time EC2 bootstrap. Run ON the server (Ubuntu 22.04/24.04) as a sudoer:
#   bash setup-server.sh
set -euo pipefail

APP_DIR=/var/www/smartcogen
# Node 24 = Active LTS. Node 20 reached end-of-life in April 2026.
NODE_MAJOR=24

echo "==> System packages"
sudo apt-get update -y
sudo apt-get install -y nginx git curl unzip postgresql-client

echo "==> Swap"
# Ubuntu EC2 AMIs ship with no swap, and `next build` on this codebase peaks
# well above what is free on a t3.medium's 4 GB once npm and nginx are resident.
# Without this the build dies to the OOM killer partway through, usually with a
# bare "Killed" that looks like a Next.js bug rather than a memory ceiling.
if ! sudo swapon --show=NAME --noheadings | grep -qx /swapfile; then
  sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  # Swap here is an overflow ceiling for build spikes, not a place to page the
  # running app. Keep the kernel biased towards RAM.
  sudo sysctl -q -w vm.swappiness=10
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf >/dev/null
fi
echo "    $(free -h | awk '/^Mem:/ {print "ram " $2}')  $(free -h | awk '/^Swap:/ {print "swap " $2}')"

echo "==> Node ${NODE_MAJOR} (NodeSource)"
# Compare the MAJOR version numerically. The previous check was `!= v2*`, which
# matched anything from v20 to v29 — so a box that already shipped an older or
# newer Node would silently skip this install and build on the wrong runtime.
current_node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0
}
if [[ "$(current_node_major)" -lt "$NODE_MAJOR" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "    node $(node -v)  npm $(npm -v)"

echo "==> PM2"
sudo npm install -g pm2
# restart apps on reboot
sudo env PATH=$PATH pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null || true

echo "==> App directory"
sudo mkdir -p "$APP_DIR"
sudo chown "$USER":"$USER" "$APP_DIR"

echo "==> Nginx site"
if [[ -f "$APP_DIR/deploy/nginx.conf" ]]; then
  sudo cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/smartcogen
  sudo ln -sf /etc/nginx/sites-available/smartcogen /etc/nginx/sites-enabled/smartcogen
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t && sudo systemctl reload nginx
else
  echo "    (deploy the app first, then re-run to install deploy/nginx.conf)"
fi

echo "==> Done. Next steps:"
echo "    1. Put env vars in $APP_DIR/.env.production   (see .env.production.example)"
echo "    2. From your laptop:  ./deploy/deploy.sh ubuntu@<host>"
echo "    3. TLS:  sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d <domain>"
