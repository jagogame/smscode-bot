#!/bin/bash
set -euo pipefail

# ── Setup VPS untuk smscode-bot ──────────────────────────────────────────────
# Jalankan di VPS sebagai root:
#   curl -fsSL https://raw.githubusercontent.com/jagogame/smscode-bot/main/deploy/setup-vps.sh | bash
# Atau copy file ini ke VPS lalu: chmod +x setup-vps.sh && ./setup-vps.sh

APP_DIR="/opt/smscode-bot"
APP_USER="smscode"
REPO="https://github.com/jagogame/smscode-bot.git"
NODE_VERSION="20"

echo "══════════════════════════════════════════"
echo "  Setup smscode-bot di VPS"
echo "══════════════════════════════════════════"

# 1. Update system
echo "→ Update sistem..."
apt-get update -y && apt-get upgrade -y

# 2. Install Node.js 20
if ! command -v node &>/dev/null || [[ "$(node -v)" != v${NODE_VERSION}* ]]; then
    echo "→ Install Node.js ${NODE_VERSION}..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs
fi
echo "  Node.js $(node -v)"

# 3. Install git
apt-get install -y git

# 4. Buat user khusus (non-root)
if ! id "$APP_USER" &>/dev/null; then
    echo "→ Buat user ${APP_USER}..."
    useradd -r -m -s /bin/bash "$APP_USER"
fi

# 5. Clone atau pull repo
if [ -d "$APP_DIR" ]; then
    echo "→ Update repo..."
    cd "$APP_DIR"
    git pull origin main
else
    echo "→ Clone repo..."
    git clone "$REPO" "$APP_DIR"
    cd "$APP_DIR"
fi

# 6. Install dependencies
echo "→ Install dependencies..."
cd "$APP_DIR"
npm ci --production

# 7. Setup .env
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "→ Buat .env template..."
    cat > "$ENV_FILE" << 'ENVEOF'
NODE_ENV=production
PORT=3000

# Keamanan - WAJIB diisi
ADMIN_PASSWORD=
KASIR_ARSHIL_PASSWORD=
KASIR_ARINAL_PASSWORD=
KASIR_DEWO_PASSWORD=
ENCRYPTION_KEY=
ADMIN_2FA=true

# WhatsApp admin number (62xxx)
ADMIN_NUMBER=
ENVEOF
    echo "  ⚠️  Edit file .env dan isi password: nano $ENV_FILE"
fi

# 8. Buat direktori data
mkdir -p "$APP_DIR/data"

# 9. Set permissions
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# 10. Install systemd service
echo "→ Setup systemd service..."
cat > /etc/systemd/system/smscode-bot.service << EOF
[Unit]
Description=SMSCode WhatsApp Bot
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=smscode-bot
EnvironmentFile=${APP_DIR}/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable smscode-bot

echo ""
echo "══════════════════════════════════════════"
echo "  ✅ Setup selesai!"
echo "══════════════════════════════════════════"
echo ""
echo "Langkah selanjutnya:"
echo "  1. Edit .env:        nano $ENV_FILE"
echo "  2. Start bot:        systemctl start smscode-bot"
echo "  3. Lihat log:        journalctl -u smscode-bot -f"
echo "  4. Buka QR scan:     http://157.20.83.122:3000/qr"
echo ""
echo "Perintah berguna:"
echo "  systemctl status smscode-bot   - cek status"
echo "  systemctl restart smscode-bot  - restart bot"
echo "  systemctl stop smscode-bot     - stop bot"
echo ""
