#!/bin/bash
set -euo pipefail

# ── Setup VPS untuk smscode-bot (jagogame.store) ─────────────────────────────
# Jalankan di VPS sebagai root setelah SSH:
#   bash setup-vps.sh
#
# Atau langsung dari repo (jika public):
#   curl -fsSL https://raw.githubusercontent.com/jagogame/smscode-bot/main/deploy/setup-vps.sh | bash

APP_DIR="/root/smscode-bot"
DOMAIN="jagogame.store"
SERVER_IP="157.20.83.122"
NODE_VERSION="20"

echo "══════════════════════════════════════════"
echo "  Setup jagogame-bot di VPS"
echo "  IP: ${SERVER_IP}"
echo "══════════════════════════════════════════"

# ── 1. Update system ─────────────────────────────────────────────────────────
echo ""
echo "→ [1/8] Update sistem..."
apt-get update -y && apt-get upgrade -y

# ── 2. Install Node.js 20 + git + nginx + certbot ───────────────────────────
echo ""
echo "→ [2/8] Install Node.js, git, nginx, certbot..."
if ! command -v node &>/dev/null || [[ "$(node -v)" != v${NODE_VERSION}* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs
fi
apt-get install -y git nginx certbot python3-certbot-nginx
npm install -g pm2
echo "  Node.js $(node -v) | npm $(npm -v) | pm2 $(pm2 -v)"

# ── 3. Clone repo ───────────────────────────────────────────────────────────
echo ""
echo "→ [3/8] Clone repo..."
if [ -d "$APP_DIR" ]; then
    echo "  Folder sudah ada, pull update..."
    cd "$APP_DIR"
    git pull origin main || true
else
    echo "  ⚠️  Repo private! Pilih salah satu:"
    echo "     a) Bikin repo public sementara di GitHub"
    echo "     b) Pakai personal access token:"
    echo "        git clone https://<TOKEN>@github.com/jagogame/smscode-bot.git"
    echo ""
    read -p "  Masukkan GitHub token (kosongkan jika repo sudah public): " GH_TOKEN
    if [ -n "$GH_TOKEN" ]; then
        git clone "https://${GH_TOKEN}@github.com/jagogame/smscode-bot.git" "$APP_DIR"
    else
        git clone "https://github.com/jagogame/smscode-bot.git" "$APP_DIR"
    fi
fi
cd "$APP_DIR"

# ── 4. Install dependencies ─────────────────────────────────────────────────
echo ""
echo "→ [4/8] Install dependencies..."
npm install --production

# ── 5. Buat .env ─────────────────────────────────────────────────────────────
echo ""
echo "→ [5/8] Setup .env..."
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" << 'ENVEOF'
NODE_ENV=production
PORT=3000
BASE_URL=http://157.20.83.122:3000
ADMIN_PASSWORD=jagogame2024

# Kasir passwords
KASIR_ARSHIL_PASSWORD=
KASIR_ARINAL_PASSWORD=
KASIR_DEWO_PASSWORD=

# Enkripsi data customer
ENCRYPTION_KEY=

# 2FA admin (opsional)
ADMIN_2FA=false

# WhatsApp admin number (62xxx)
ADMIN_NUMBER=

# Midtrans (skip dulu)
# MIDTRANS_SERVER_KEY=
# MIDTRANS_CLIENT_KEY=
ENVEOF
    echo "  ✅ .env dibuat dengan default. Edit nanti: nano $ENV_FILE"
else
    echo "  .env sudah ada, skip."
fi

# ── 6. Start dengan PM2 ─────────────────────────────────────────────────────
echo ""
echo "→ [6/8] Start bot dengan PM2..."
cd "$APP_DIR"
pm2 delete jagogame-bot 2>/dev/null || true
pm2 start index.js --name jagogame-bot
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash 2>/dev/null || true

# ── 7. Setup Nginx reverse proxy ────────────────────────────────────────────
echo ""
echo "→ [7/8] Setup Nginx..."
cat > /etc/nginx/sites-available/jagogame << NGINXEOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN} ${SERVER_IP};

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/jagogame /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# ── 8. Firewall ──────────────────────────────────────────────────────────────
echo ""
echo "→ [8/8] Setup firewall..."
if command -v ufw &>/dev/null; then
    ufw allow OpenSSH
    ufw allow 'Nginx Full'
    ufw --force enable
    echo "  ✅ Firewall aktif (SSH + HTTP/HTTPS)"
fi

echo ""
echo "══════════════════════════════════════════════════════"
echo "  ✅ Setup selesai!"
echo "══════════════════════════════════════════════════════"
echo ""
echo "  Bot jalan di: http://${SERVER_IP}"
echo "  QR scan:      http://${SERVER_IP}/qr"
echo "  PM2 logs:     pm2 logs jagogame-bot"
echo "  PM2 status:   pm2 status"
echo ""
echo "  ── Langkah selanjutnya ──"
echo ""
echo "  1. Scan QR WhatsApp:"
echo "     Buka http://${SERVER_IP}/qr di browser"
echo "     atau: pm2 logs jagogame-bot (lihat QR di terminal)"
echo ""
echo "  2. Point DNS di Niagahoster:"
echo "     ${DOMAIN}     A → ${SERVER_IP}"
echo "     www.${DOMAIN} A → ${SERVER_IP}"
echo ""
echo "  3. Setelah DNS propagate, pasang SSL:"
echo "     certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
echo ""
echo "  4. Update BASE_URL di .env:"
echo "     nano ${ENV_FILE}"
echo "     Ganti BASE_URL=https://${DOMAIN}"
echo "     pm2 restart jagogame-bot"
echo ""
echo "  5. GANTI PASSWORD ROOT:"
echo "     passwd"
echo ""
