#!/usr/bin/env bash
# ============================================================
#  Setup Raspberry Pi — African Mask Robot (Sprint 3)
#  Usage : sudo bash setup.sh
#  Testé sur Raspberry Pi OS Bullseye / Bookworm (64-bit)
# ============================================================
set -euo pipefail

REPO_DIR="/home/pi/balancing-robot"
VENV_DIR="$REPO_DIR/.venv"
NODE_VER="20"

echo "============================================================"
echo "  African Mask Robot — Setup Raspberry Pi"
echo "============================================================"

# ── 1. Mise à jour système ────────────────────────────────────
echo "[1/9] Mise à jour des paquets..."
apt-get update -qq
apt-get install -y -qq \
    python3 python3-pip python3-venv \
    i2c-tools python3-smbus \
    git curl nginx \
    libatlas-base-dev libopenblas-dev \
    2>/dev/null

# ── 2. Activation I2C et SPI ─────────────────────────────────
echo "[2/9] Activation I2C / SPI..."
raspi-config nonint do_i2c 0
raspi-config nonint do_spi 0
# Vérification
if ! lsmod | grep -q i2c_bcm; then
    modprobe i2c-bcm2708 2>/dev/null || modprobe i2c-bcm2835 2>/dev/null || true
fi
echo "I2C périphériques détectés :"
i2cdetect -y 1 2>/dev/null || echo "  (aucun ou I2C non encore actif — reboot nécessaire)"

# ── 3. Node.js (pour build frontend) ──────────────────────────
echo "[3/9] Installation Node.js $NODE_VER..."
if ! command -v node &>/dev/null; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VER}.x" | bash -
    apt-get install -y nodejs
fi
node --version

# ── 4. Environnement Python ───────────────────────────────────
echo "[4/9] Création de l'environnement Python..."
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip -q

echo "[4/9] Installation dépendances backend..."
"$VENV_DIR/bin/pip" install -r "$REPO_DIR/backend/requirements.txt" -q

echo "[4/9] Installation dépendances hardware..."
"$VENV_DIR/bin/pip" install -r "$REPO_DIR/hardware/requirements.txt" -q \
    || echo "  (certains paquets hardware optionnels non installés)"

# ── 5. Build frontend React ───────────────────────────────────
echo "[5/9] Build frontend React..."
cd "$REPO_DIR/frontend"
npm install --silent
npm run build
echo "  → dist/ généré"

# ── 6. Configuration nginx ────────────────────────────────────
echo "[6/9] Configuration nginx..."
cp "$REPO_DIR/deploy/nginx.conf" /etc/nginx/sites-available/robot
ln -sf /etc/nginx/sites-available/robot /etc/nginx/sites-enabled/robot
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx || true

# ── 7. Services systemd ───────────────────────────────────────
echo "[7/9] Installation des services systemd..."
cp "$REPO_DIR/deploy/robot-backend.service"  /etc/systemd/system/
cp "$REPO_DIR/deploy/robot-frontend.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable robot-backend.service nginx.service
systemctl start  robot-backend.service nginx.service

# ── 8. Démarrage automatique Chromium en kiosk ───────────────
echo "[8/9] Configuration affichage kiosk (Chromium)..."
AUTOSTART_DIR="/home/pi/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
cat > "$AUTOSTART_DIR/robot-kiosk.desktop" << 'EOF'
[Desktop Entry]
Type=Application
Name=Robot Face Kiosk
Exec=bash -c "sleep 5 && chromium-browser --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble http://localhost"
Hidden=false
X-GNOME-Autostart-enabled=true
EOF
echo "  → Kiosk configuré sur http://localhost"

# ── 9. Résumé ─────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  Installation terminée !"
echo "============================================================"
echo ""
echo "  Services actifs :"
systemctl is-active robot-backend.service && echo "  ✓ robot-backend" || echo "  ✗ robot-backend"
systemctl is-active nginx               && echo "  ✓ nginx (frontend)" || echo "  ✗ nginx"
echo ""
echo "  Interface web : http://$(hostname -I | awk '{print $1}')"
echo ""
echo "  IMPORTANT — Configurez le type de hardware dans :"
echo "  /etc/systemd/system/robot-backend.service"
echo ""
echo "  Variables d'environnement disponibles :"
echo "    ROBOT_IMU=mpu6050|bno055|simulated"
echo "    ROBOT_MOTORS=vesc|odrive|simulated"
echo "    ROBOT_VESC_PORT=/dev/ttyACM0"
echo "    ROBOT_MAX_ANGLE=30"
echo ""
echo "  Un REBOOT est recommandé pour activer I2C/SPI :"
echo "  sudo reboot"
echo ""
