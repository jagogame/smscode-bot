#!/bin/bash
set -euo pipefail

# ── Update smscode-bot di VPS ────────────────────────────────────────────────
# Jalankan sebagai root: ./deploy/update.sh

APP_DIR="/opt/smscode-bot"

echo "→ Pull update terbaru..."
cd "$APP_DIR"
git pull origin main

echo "→ Install dependencies..."
npm ci --production

echo "→ Restart bot..."
systemctl restart smscode-bot

echo "→ Cek status..."
sleep 2
systemctl status smscode-bot --no-pager

echo ""
echo "✅ Update selesai! Lihat log: journalctl -u smscode-bot -f"
