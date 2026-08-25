#!/usr/bin/env bash
# =============================================================
#  Instalasi Panel Billing MikroTik di Ubuntu (22.04 / 24.04)
#  Jalankan:  sudo bash deploy/install-ubuntu.sh
#  Atau langsung dari internet (auto clone repo):
#    sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/hifni-84/billing-link-fixer/main/deploy/install-ubuntu.sh)"
# =============================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/hifni-84/billing-link-fixer.git}"
BRANCH="${BRANCH:-main}"
TARGET="${TARGET:-/opt/mikrotik-billing}"

APP_NAME="mikrotik-billing"

[ "$(id -u)" -eq 0 ] || { echo "Harus dijalankan dengan sudo/root."; exit 1; }

# ---- 0. Bootstrap: kalau skrip dijalankan lewat pipe/curl (bukan dari repo),
#         clone dulu repo-nya lalu jalankan ulang skrip asli dari disk.
SELF="${BASH_SOURCE[0]:-}"
if [ -f "$SELF" ]; then
  APP_DIR="$(cd "$(dirname "$SELF")/.." && pwd)"
else
  APP_DIR=""
fi

if [ -z "$APP_DIR" ] || [ ! -f "$APP_DIR/package.json" ] || [ ! -f "$APP_DIR/deploy/mikrotik-billing.service" ]; then
  echo "==> Mode bootstrap: mengambil kode dari $REPO_URL"
  apt-get update -y
  apt-get install -y git curl ca-certificates unzip
  if [ -d "$TARGET/.git" ]; then
    git -C "$TARGET" fetch --all
    git -C "$TARGET" reset --hard "origin/$BRANCH"
  else
    rm -rf "$TARGET"
    git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$TARGET"
  fi
  exec bash "$TARGET/deploy/install-ubuntu.sh"
fi

APP_USER="${SUDO_USER:-$USER}"
if [ -z "${APP_USER:-}" ] || [ "$APP_USER" = "root" ]; then
  APP_USER="$(ls /home 2>/dev/null | head -1)"
  [ -n "$APP_USER" ] || APP_USER="root"
fi
PORT="${PORT:-3000}"

echo "==> Direktori aplikasi : $APP_DIR"
echo "==> Dijalankan sebagai : $APP_USER"
echo "==> Port               : $PORT"


# ---- 1. Dependensi sistem ----
apt-get update
apt-get install -y curl ca-certificates

NODE_MINIMUM="22.12.0"
NODE_CURRENT="$(node -v 2>/dev/null | sed 's/^v//' || true)"
if [ -z "$NODE_CURRENT" ] || [ "$(printf '%s\n%s\n' "$NODE_MINIMUM" "$NODE_CURRENT" | sort -V | head -n1)" != "$NODE_MINIMUM" ]; then
  echo "==> Memasang Node.js 22 LTS (minimum $NODE_MINIMUM)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y nginx

# ---- 2. Build aplikasi ----
# Pastikan APP_USER punya hak tulis ke folder aplikasi (mis. /opt hasil git
# clone oleh root) supaya npm install tidak kena EACCES pada node_modules.
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
echo "==> Memasang dependensi & build (preset node-server)"
echo "    Memakai 'npm install' agar lockfile lama/tidak sinkron diperbarui otomatis"
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm install --legacy-peer-deps && NITRO_PRESET=node-server npm run build"

# ---- 3. Service systemd ----
echo "==> Memasang service systemd"
sed -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__APP_USER__|$APP_USER|g" \
    -e "s|__PORT__|$PORT|g" \
    "$APP_DIR/deploy/mikrotik-billing.service" > "/etc/systemd/system/${APP_NAME}.service"

systemctl daemon-reload
systemctl enable --now "$APP_NAME"

# ---- 4. Nginx reverse proxy ----
echo "==> Memasang konfigurasi Nginx"
sed -e "s|__PORT__|$PORT|g" "$APP_DIR/deploy/nginx.conf" > "/etc/nginx/sites-available/${APP_NAME}"
ln -sf "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx


# ---- 5. FreeRADIUS + MySQL otomatis ----
if [ -f "$APP_DIR/deploy/setup-freeradius-sql.sh" ]; then
  echo "==> Konfigurasi FreeRADIUS + MySQL otomatis"
  APP_DIR="$APP_DIR" bash "$APP_DIR/deploy/setup-freeradius-sql.sh" "${RADIUS_SECRET:-najwa123}" || \
    echo "!! Setup FreeRADIUS gagal, jalankan manual: sudo bash $APP_DIR/deploy/setup-freeradius-sql.sh"
fi

echo
echo "============================================="
echo " Selesai! Buka http://<IP-SERVER>/"
echo " Status : systemctl status $APP_NAME"
echo " Log    : journalctl -u $APP_NAME -f"
echo "============================================="
