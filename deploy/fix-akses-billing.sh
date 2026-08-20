#!/usr/bin/env bash
# Pastikan akses lewat IP / domain tanpa konfigurasi selalu membuka BILLING (bukan Mikhmon).
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Jalankan dengan sudo"; exit 1; }

PORT="${1:-3000}"
AVAIL=/etc/nginx/sites-available
ENABLED=/etc/nginx/sites-enabled

# 1) Lepas default_server dari semua konfigurasi lain (mis. mikhmon, default)
for f in "$ENABLED"/*; do
  [[ -e "$f" ]] || continue
  real=$(readlink -f "$f")
  base=$(basename "$real")
  [[ "$base" == "00-billing-default" ]] && continue
  if grep -q "default_server" "$real" 2>/dev/null; then
    cp -f "$real" "$real.bak.$(date +%s)"
    sed -i 's/[[:space:]]default_server//g' "$real"
    echo "INFO: default_server dilepas dari $base"
  fi
done

# 2) Buang symlink 'default' bawaan Nginx bila ada
rm -f "$ENABLED/default"

# 3) Buat catch-all billing (nama diawali 00- agar dimuat paling awal)
CERT_DIR=""
for d in /etc/letsencrypt/live/*/; do
  [[ -f "$d/fullchain.pem" ]] && { CERT_DIR="${d%/}"; break; }
done

{
  echo "# dibuat otomatis oleh fix-akses-billing.sh"
  echo "server {"
  echo "    listen 80 default_server;"
  echo "    listen [::]:80 default_server;"
  echo "    server_name _;"
  echo "    client_max_body_size 10m;"
  echo "    location /.well-known/acme-challenge/ { root /var/www/html; }"
  echo "    location / {"
  echo "        proxy_pass http://127.0.0.1:${PORT};"
  echo "        proxy_http_version 1.1;"
  echo "        proxy_set_header Upgrade \$http_upgrade;"
  echo "        proxy_set_header Connection \"upgrade\";"
  echo "        proxy_set_header Host \$host;"
  echo "        proxy_set_header X-Real-IP \$remote_addr;"
  echo "        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;"
  echo "        proxy_set_header X-Forwarded-Proto \$scheme;"
  echo "        proxy_read_timeout 60s;"
  echo "    }"
  echo "}"
  if [[ -n "$CERT_DIR" ]]; then
    echo "server {"
    echo "    listen 443 ssl default_server;"
    echo "    listen [::]:443 ssl default_server;"
    echo "    server_name _;"
    echo "    ssl_certificate ${CERT_DIR}/fullchain.pem;"
    echo "    ssl_certificate_key ${CERT_DIR}/privkey.pem;"
    echo "    client_max_body_size 10m;"
    echo "    location / {"
    echo "        proxy_pass http://127.0.0.1:${PORT};"
    echo "        proxy_http_version 1.1;"
    echo "        proxy_set_header Upgrade \$http_upgrade;"
    echo "        proxy_set_header Connection \"upgrade\";"
    echo "        proxy_set_header Host \$host;"
    echo "        proxy_set_header X-Real-IP \$remote_addr;"
    echo "        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;"
    echo "        proxy_set_header X-Forwarded-Proto \$scheme;"
    echo "    }"
    echo "}"
  fi
} > "$AVAIL/00-billing-default"

mkdir -p /var/www/html
ln -sfn "$AVAIL/00-billing-default" "$ENABLED/00-billing-default"

if ! nginx -t 2>&1; then
  echo "Nginx gagal diuji, catch-all dibatalkan."
  rm -f "$ENABLED/00-billing-default" "$AVAIL/00-billing-default"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  exit 1
fi
systemctl reload nginx
echo "OK: akses IP / domain tanpa konfigurasi sekarang membuka billing (port ${PORT})."
[[ -n "$CERT_DIR" ]] && echo "INFO: HTTPS default memakai sertifikat $(basename "$CERT_DIR")"
