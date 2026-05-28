#!/bin/bash
set -euo pipefail

# Run on Ubuntu 24.04 as root:
# curl -fsSL ... | bash
# Or: bash scripts/setup-droplet.sh

apt-get update
apt-get install -y ca-certificates curl git

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

apt-get install -y \
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libc6 libcairo2 libcups2t64 \
  libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc-s1 libglib2.0-0t64 \
  libgtk-3-0t64 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 \
  libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
  libxkbcommon0 libxrandr2 wget xdg-utils

APP_DIR=/opt/vaskeladden-automation
mkdir -p "$APP_DIR"

if [ ! -f "$APP_DIR/package.json" ]; then
  echo "Clone the repo into $APP_DIR first, then run this script again."
  exit 1
fi

cd "$APP_DIR"
npm ci --ignore-scripts
npm run build
npm run install-chrome

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Edit $APP_DIR/.env with HUBSPOT_ACCESS_TOKEN, then: systemctl restart scraper"
fi

npm install -g pm2
pm2 delete scraper 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root

ufw allow OpenSSH
ufw allow 8000/tcp
ufw --force enable

echo "Done. Webhook: http://$(curl -s ifconfig.me):8000/webhook"
