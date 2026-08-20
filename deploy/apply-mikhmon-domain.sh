#!/usr/bin/env bash
# apply-mikhmon-domain.sh — Pasang domain + SSL untuk Mikhmon (PHP-FPM).
#   sudo /opt/mikrotik-billing/deploy/apply-mikhmon-domain.sh "mybillingg.com" "email@anda.com"
#   sudo ... "mybillingg.com" ""        # tanpa email (register-unsafely)
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

DOMAIN="${1:-}"
EMAIL="${2:-}"
MIKHMON_ROOT="/var/www/mikhmon"

[[ -d "$MIKHMON_ROOT" ]] || { echo "Folder Mikhmon tidak ada: $MIKHMON_ROOT"; exit 1; }
[[ -n "$DOMAIN" ]] || { echo "Penggunaan: $0 <domain> [email]"; exit 1; }

# normalisasi domain
DOMAIN="$(echo "$DOMAIN" | tr -d ' ' | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s#:[0-9]+$##')"
[[ "$DOMAIN" =~ ^[a-z0-9.-]+$ ]] || { echo "Domain tidak valid: $DOMAIN"; exit 1; }

# deteksi socket PHP-FPM
PHP_SOCK="$(ls /run/php/*-fpm.sock 2>/dev/null | head -1 || true)"
if [[ -z "$PHP_SOCK" ]]; then
  echo "PHP-FPM socket tidak ditemukan. Install dulu:"
  echo "  sudo apt install -y php-fpm php-curl php-mbstring php-xml php-mysql php-gd"
  exit 1
fi
PHP_VER="$(basename "$PHP_SOCK" | sed -E 's/php([0-9.]+)-fpm.sock/\1/')"
echo "INFO: PHP-FPM $PHP_VER -> $PHP_SOCK"

# nonaktifkan konfigurasi lama mikhmon di port 8080 (opsional, simpan backup)
OLD_8080="/etc/nginx/sites-available/mikhmon"
if [[ -f "$OLD_8080" ]] && grep -q "listen 8080" "$OLD_8080" 2>/dev/null; then
  echo "INFO: memindahkan mikhmon dari port 8080 ke domain $DOMAIN"
  rm -f /etc/nginx/sites-enabled/mikhmon
fi

SITE="/etc/nginx/sites-available/mikhmon-domain"
LINK="/etc/nginx/sites-enabled/mikhmon-domain"

# buang site lain yang memakai domain sama
for f in /etc/nginx/sites-enabled/*; do
  [[ -e "$f" ]] || continue
  [[ "$(basename "$f")" == "mikhmon-domain" ]] && continue
  if grep -Eq "server_name[^;]*(^|[[:space:]])${DOMAIN//./\\.}([[:space:]]|;)" "$f" 2>/dev/null; then
    echo "INFO: menonaktifkan konfigurasi bentrok: $(basename "$f")"
    rm -f "$f"
  fi
done

{
  echo "server {"
  echo "    listen 80;"
  echo "    listen [::]:80;"
  echo "    server_name ${DOMAIN};"
  echo "    client_max_body_size 20m;"
  echo "    root ${MIKHMON_ROOT};"
  echo "    index index.php index.html;"
  echo ""
  echo "    location /.well-known/acme-challenge/ { root /var/www/html; }"
  echo ""
  echo "    location / {"
  echo "        try_files \$uri \$uri/ /index.php?\$query_string;"
  echo "    }"
  echo ""
  echo "    location ~ \.php$ {"
  echo "        include snippets/fastcgi-php.conf;"
  echo "        fastcgi_pass unix:${PHP_SOCK};"
  echo "        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;"
  echo "        include fastcgi_params;"
  echo "    }"
  echo ""
  echo "    location ~ /\.(ht|git|env) { deny all; }"
  echo "}"
} > "$SITE"

ln -sf "$SITE" "$LINK"

# siapkan root acme
mkdir -p /var/www/html
chown -R www-data:www-data /var/www/html 2>/dev/null || true

nginx -t 2>&1 || { echo "nginx -t gagal"; exit 1; }
systemctl reload nginx

# buka firewall
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true

# SSL
if ! command -v certbot >/dev/null 2>&1; then
  echo "INFO: memasang certbot…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y >/dev/null 2>&1 || true
  apt-get install -y certbot python3-certbot-nginx >/dev/null 2>&1 || true
fi

if ! command -v certbot >/dev/null 2>&1; then
  echo "PERINGATAN: certbot tidak tersedia. Akses sementara: http://${DOMAIN}"
  exit 0
fi

ARGS=(--nginx --non-interactive --agree-tos --redirect --keep-until-expiring -d "$DOMAIN")
if [[ -n "$EMAIL" ]]; then
  ARGS+=(-m "$EMAIL")
else
  ARGS+=(--register-unsafely-without-email)
fi

if certbot "${ARGS[@]}" 2>&1; then
  systemctl reload nginx
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
  echo "OK: SSL aktif untuk ${DOMAIN}"
  echo "SELESAI. Akses Mikhmon: https://${DOMAIN}"
else
  echo "PERINGATAN: SSL gagal. Pastikan DNS ${DOMAIN} mengarah ke IP server ini & port 80 terbuka."
  echo "Sementara: http://${DOMAIN}"
fi
