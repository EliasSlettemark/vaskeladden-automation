# Vaskeladden automation

HubSpot webhook server that scrapes company roles and creates contacts.

## Deploy on DigitalOcean (Ubuntu 24.04)

### 1. Push code (local)

```bash
cd server
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/EliasSlettemark/vaskeladden-automation.git
git push -u origin main
```

### 2. On the droplet

```bash
ssh root@YOUR_DROPLET_IP

apt-get update && apt-get install -y git
git clone https://github.com/EliasSlettemark/vaskeladden-automation.git /opt/vaskeladden-automation
cd /opt/vaskeladden-automation
nano .env   # copy from .env.example, set HUBSPOT_ACCESS_TOKEN
bash scripts/setup-droplet.sh
```

### 3. HubSpot webhook URL

```
http://YOUR_DROPLET_IP:8000/webhook
```

For HTTPS, put nginx + Let's Encrypt in front, or use a tunnel.

## Puppeteer on the server

Chrome is installed by `npx puppeteer browsers install chrome` (also in `postinstall`). Ubuntu needs the system libraries in `setup-droplet.sh`.

## Two companies at once

Jobs run **one at a time** (queued). Two segment additions work; the second waits until the first scrape finishes. A $18/mo droplet (2 GB RAM) is usually enough for one Chrome instance at a time.

## Local dev

```bash
cp .env.example .env.local
npx puppeteer browsers install chrome
npm install
npm run start:dev
```
