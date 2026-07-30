#!/bin/bash
set -euo pipefail

# ── Update smscode-bot di VPS ────────────────────────────────────────────────
APP_DIR="/root/smscode-bot"

echo "→ Pull update..."
cd "$APP_DIR"
git pull origin main

echo "→ Install dependencies..."
npm install --production

echo "→ Restart bot..."
pm2 restart jagogame-bot

echo "→ Status:"
pm2 status
echo ""
echo "✅ Update selesai! Log: pm2 logs jagogame-bot"
