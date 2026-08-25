#!/usr/bin/env bash
# =====================================================================
#  install-mikhmon.sh — Pasang Mikhmon V3 (MikroTik Hotspot Monitor)
#  lengkap dengan PHP-FPM, Nginx, tema elegan, patch ROS6/ROS7,
#  anti-kembar voucher, dan optimasi timeout.
#
#  Jalankan SETELAH install billing dasar selesai:
#    sudo bash /opt/mikrotik-billing/deploy/install-mikhmon.sh
#
#  Atau langsung dari internet (auto-clone repo billing dulu):
#    sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/hifni-84/billing-link-fixer/main/deploy/install-mikhmon.sh)"
#
#  Setelah selesai, pasang domain + SSL:
#    sudo bash /opt/mikrotik-billing/deploy/apply-mikhmon-domain.sh mikhmon.domain-anda.com email@anda.com
#
#  Opsi:
#    --port 8080    gunakan port tertentu (default: 8080)
#    --skip-theme   lewati pemasangan tema
#    --skip-patch   lewati patch ROS6/ROS7 & anti-kembar
# =====================================================================
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

MIKHMON_ROOT="/var/www/mikhmon"
MIKHMON_REPO="https://github.com/laksa19/mikhmonv3.git"
PORT=8080
SKIP_THEME=0
SKIP_PATCH=0

for a in "$@"; do
  case "$a" in
    --port) shift; PORT="${1:-8080}";;
    --port=*) PORT="${a#*=}";;
    --skip-theme) SKIP_THEME=1;;
    --skip-patch) SKIP_PATCH=1;;
  esac
  shift 2>/dev/null || true
done

# ---- Bootstrap: kalau skrip jalan lewat pipe/curl, clone repo billing ----
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
if [[ -z "$DEPLOY_DIR" ]] || [[ ! -f "$DEPLOY_DIR/install-mikhmon.sh" ]]; then
  echo "==> Mode bootstrap: clone repo billing dulu"
  apt-get update -y >/dev/null 2>&1 || true
  apt-get install -y git curl ca-certificates >/dev/null 2>&1 || true
  if [[ ! -d /opt/mikrotik-billing/.git ]]; then
    git clone --depth 1 https://github.com/hifni-84/billing-link-fixer.git /opt/mikrotik-billing
  fi
  DEPLOY_DIR="/opt/mikrotik-billing/deploy"
  exec bash "$DEPLOY_DIR/install-mikhmon.sh" "$@"
fi

echo "============================================="
echo " Instalasi Mikhmon V3"
echo " Folder  : $MIKHMON_ROOT"
echo " Port    : $PORT"
echo "============================================="

# ---- 1. Install PHP-FPM + ekstensi ----
echo "==> [1/6] Memasang PHP-FPM + ekstensi"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null 2>&1
apt-get install -y \
  php-fpm php-curl php-mbstring php-xml php-mysql php-gd php-zip php-intl \
  unzip curl >/dev/null 2>&1

PHP_SOCK="$(ls /run/php/*-fpm.sock 2>/dev/null | head -1 || true)"
if [[ -z "$PHP_SOCK" ]]; then
  echo "!! PHP-FPM belum aktif. Jalankan: sudo systemctl restart php*-fpm"
  exit 1
fi
PHP_VER="$(basename "$PHP_SOCK" | sed -E 's/php([0-9.]+)-fpm.sock/\1/')"
echo "    PHP-FPM $PHP_VER -> $PHP_SOCK"

# ---- 2. Clone / update Mikhmon ----
echo "==> [2/6] Mengunduh Mikhmon V3"
if [[ -d "$MIKHMON_ROOT/.git" ]]; then
  echo "    Folder ada, update..."
  git -C "$MIKHMON_ROOT" pull --ff-only 2>/dev/null || true
else
  rm -rf "$MIKHMON_ROOT"
  git clone --depth 1 "$MIKHMON_REPO" "$MIKHMON_ROOT"
fi

# Pastikan folder session & config ada
mkdir -p "$MIKHMON_ROOT/session" "$MIKHMON_ROOT/include/config"
chown -R www-data:www-data "$MIKHMON_ROOT"
chmod -R 755 "$MIKHMON_ROOT"

# ---- 3. Konfigurasi Nginx (port default, sebelum domain dipasang) ----
echo "==> [3/6] Konfigurasi Nginx port $PORT"
SITE="/etc/nginx/sites-available/mikhmon"
LINK="/etc/nginx/sites-enabled/mikhmon"

cat > "$SITE" <<EOF
server {
    listen ${PORT};
    listen [::]:${PORT};
    server_name _;
    client_max_body_size 20m;
    root ${MIKHMON_ROOT};
    index index.php index.html;

    location / { try_files \$uri \$uri/ /index.php?\$query_string; }

    location ~ \.php\$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:${PHP_SOCK};
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_param PHP_VALUE "session.name=MIKHMON";
        include fastcgi_params;
        fastcgi_read_timeout 600;
        fastcgi_send_timeout 600;
        fastcgi_connect_timeout 60;
        fastcgi_buffers 16 32k;
        fastcgi_buffer_size 64k;
    }

    location ~ /\.(ht|git|env) { deny all; }
}
EOF

ln -sf "$SITE" "$LINK"
nginx -t 2>&1 || { echo "!! nginx -t gagal"; exit 1; }
systemctl reload nginx

# ---- 4. Patch ROS6/ROS7 + anti-kembar voucher ----
if [[ "$SKIP_PATCH" == "0" ]]; then
  echo "==> [4/6] Patch ROS6/ROS7 & anti-kembar voucher"
  python3 "$DEPLOY_DIR/patch-mikhmon-ros7.py" "$MIKHMON_ROOT" || echo "    (patch ROS6/7 dilewati)"
  python3 "$DEPLOY_DIR/patch-mikhmon-unique.py" "$MIKHMON_ROOT" || echo "    (patch anti-kembar dilewati)"
else
  echo "==> [4/6] Patch dilewati (--skip-patch)"
fi

# ---- 5. Tema elegan ----
if [[ "$SKIP_THEME" == "0" ]]; then
  echo "==> [5/6] Pasang tema elegan"
  bash "$DEPLOY_DIR/apply-mikhmon-theme.sh" || echo "    (tema dilewati)"
else
  echo "==> [5/6] Tema dilewati (--skip-theme)"
fi

# ---- 6. Optimasi timeout ----
echo "==> [6/6] Optimasi timeout generate voucher"
bash "$DEPLOY_DIR/fix-mikhmon-timeout.sh" || true

# Fix akses: pastikan billing tetap jadi default_server (bukan Mikhmon)
if [[ -f "$DEPLOY_DIR/fix-akses-billing.sh" ]]; then
  bash "$DEPLOY_DIR/fix-akses-billing.sh" || true
fi

echo
echo "============================================="
echo " MIKHMON V3 TERPASANG!"
echo ""
echo " Akses sementara : http://<IP-SERVER>:${PORT}/"
echo " Login Mikhmon   : user & password router MikroTik Anda"
echo ""
echo " LANGKAH SELANJUTNYA — pasang domain + SSL:"
echo "   sudo bash $DEPLOY_DIR/apply-mikhmon-domain.sh mikhmon.domain-anda.com email@anda.com"
echo ""
echo " Tambah instance Mikhmon lain (domain berbeda):"
echo "   sudo bash $DEPLOY_DIR/add-mikhmon-instance.sh namabisnis namabisnis.hopto.org email@anda.com"
echo "============================================="
