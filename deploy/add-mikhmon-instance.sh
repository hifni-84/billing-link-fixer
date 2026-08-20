#!/usr/bin/env bash
# add-mikhmon-instance.sh — Buat salinan Mikhmon mandiri dengan domain sendiri.
#
#   sudo bash /opt/mikrotik-billing/deploy/add-mikhmon-instance.sh aulianet aulianet.hopto.org email@anda.com
#   sudo bash ... faqihnet faqihnet.hopto.org email@anda.com
#   sudo bash ... netcom   netcom.hopto.org   email@anda.com
#
# Opsi:
#   --list                 tampilkan semua instance Mikhmon
#   --remove <nama>        hapus instance (folder + konfigurasi Nginx)
#   --no-ssl               lewati pemasangan SSL (hanya HTTP)
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

SRC="/var/www/mikhmon"
BASE="/var/www"

if [[ "${1:-}" == "--list" ]]; then
  echo "Instance Mikhmon:"
  for d in "$SRC" "$BASE"/mikhmon-*; do
    [[ -d "$d" ]] || continue
    n="$(basename "$d")"
    dom="$(grep -h -m1 -oP 'server_name \K[^;]+' /etc/nginx/sites-available/mikhmon-"${n#mikhmon-}" 2>/dev/null || true)"
    [[ "$n" == "mikhmon" ]] && dom="$(grep -h -m1 -oP 'server_name \K[^;]+' /etc/nginx/sites-available/mikhmon-domain 2>/dev/null || true)"
    echo "  - $n  ->  ${dom:-(belum ada domain)}"
  done
  exit 0
fi

if [[ "${1:-}" == "--remove" ]]; then
  NAME="$(echo "${2:-}" | tr -cd 'a-z0-9-')"
  [[ -n "$NAME" ]] || { echo "Penggunaan: $0 --remove <nama>"; exit 1; }
  rm -rf "$BASE/mikhmon-$NAME"
  rm -f "/etc/nginx/sites-enabled/mikhmon-$NAME" "/etc/nginx/sites-available/mikhmon-$NAME"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx
  echo "OK: instance $NAME dihapus."
  exit 0
fi

NAME="$(echo "${1:-}" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9-')"
DOMAIN="$(echo "${2:-}" | tr -d ' ' | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s#:[0-9]+$##')"
EMAIL="${3:-}"
USE_SSL=1
for a in "$@"; do [[ "$a" == "--no-ssl" ]] && USE_SSL=0; done

[[ -n "$NAME" && -n "$DOMAIN" ]] || { echo "Penggunaan: $0 <nama> <domain> [email] [--no-ssl]"; exit 1; }
[[ "$DOMAIN" =~ ^[a-z0-9.-]+$ ]] || { echo "Domain tidak valid: $DOMAIN"; exit 1; }
[[ -d "$SRC" ]] || { echo "Mikhmon sumber tidak ada di $SRC"; exit 1; }

PHP_SOCK="$(ls /run/php/*-fpm.sock 2>/dev/null | head -1 || true)"
[[ -n "$PHP_SOCK" ]] || { echo "PHP-FPM belum terpasang. Jalankan: sudo apt install -y php-fpm php-curl php-mbstring php-xml php-gd"; exit 1; }

DEST="$BASE/mikhmon-$NAME"
if [[ -d "$DEST" ]]; then
  echo "INFO: folder $DEST sudah ada, dipakai ulang (data tidak ditimpa)."
else
  echo "INFO: menyalin $SRC -> $DEST"
  cp -a "$SRC" "$DEST"
  # bersihkan data sesi/pengaturan router bawaan salinan supaya benar-benar mandiri
  rm -f "$DEST"/include/config/*.php 2>/dev/null || true
  rm -rf "$DEST"/session/* 2>/dev/null || true
fi
chown -R www-data:www-data "$DEST"

SITE="/etc/nginx/sites-available/mikhmon-$NAME"
LINK="/etc/nginx/sites-enabled/mikhmon-$NAME"

# lepas konfigurasi lain yang memakai domain sama
for f in /etc/nginx/sites-enabled/*; do
  [[ -e "$f" ]] || continue
  [[ "$(basename "$f")" == "mikhmon-$NAME" ]] && continue
  if grep -Eq "server_name[^;]*(^|[[:space:]])${DOMAIN//./\\.}([[:space:]]|;)" "$f" 2>/dev/null; then
    echo "INFO: menonaktifkan konfigurasi bentrok: $(basename "$f")"
    rm -f "$f"
  fi
done

cat > "$SITE" <<CFG
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    client_max_body_size 20m;
    root ${DEST};
    index index.php index.html;

    location /.well-known/acme-challenge/ { root /var/www/html; }

    location / { try_files \$uri \$uri/ /index.php?\$query_string; }

    location ~ \.php\$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:${PHP_SOCK};
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_param PHP_VALUE "session.name=MIKHMON_${NAME}";
        include fastcgi_params;
    }

    location ~ /\.(ht|git|env) { deny all; }
}
CFG

mkdir -p /var/www/html
ln -sfn "$SITE" "$LINK"
nginx -t 2>&1 || { echo "nginx -t gagal, konfigurasi dibatalkan"; rm -f "$LINK"; exit 1; }
systemctl reload nginx
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
echo "OK: http://${DOMAIN} -> ${DEST}"

[[ "$USE_SSL" == "1" ]] || { echo "SELESAI (tanpa SSL). Akses: http://${DOMAIN}"; exit 0; }

if ! command -v certbot >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y >/dev/null 2>&1 || true
  apt-get install -y certbot python3-certbot-nginx >/dev/null 2>&1 || true
fi
command -v certbot >/dev/null 2>&1 || { echo "PERINGATAN: certbot tidak ada. Akses: http://${DOMAIN}"; exit 0; }

ARGS=(--nginx --non-interactive --agree-tos --redirect --keep-until-expiring -d "$DOMAIN")
if [[ -n "$EMAIL" ]]; then ARGS+=(-m "$EMAIL"); else ARGS+=(--register-unsafely-without-email); fi
if certbot "${ARGS[@]}" 2>&1; then
  systemctl reload nginx
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
  echo "SELESAI. Akses: https://${DOMAIN}"
else
  echo "PERINGATAN: SSL gagal. Pastikan DNS ${DOMAIN} -> IP server ini & port 80 terbuka. Sementara: http://${DOMAIN}"
fi
