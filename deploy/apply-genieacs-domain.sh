#!/usr/bin/env bash
# =============================================================
#  Beri GenieACS domain HTTPS sendiri (mis. acs.domain-anda.com)
#  agar bisa tampil langsung di dalam panel billing (iframe).
#
#  Pakai:
#    sudo bash deploy/apply-genieacs-domain.sh acs.domain-anda.com email@anda.com
#    sudo bash deploy/apply-genieacs-domain.sh acs.domain.com email@anda.com 3001
#
#  Syarat: domain sudah diarahkan (A record) ke IP publik server ini.
# =============================================================
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

DOMAIN="$(echo "${1:-}" | tr -d ' ' | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s#:[0-9]+$##')"
EMAIL="${2:-}"
PORT="${3:-3001}"

[[ -n "$DOMAIN" ]] || { echo "Contoh: sudo bash deploy/apply-genieacs-domain.sh acs.domain.com email@anda.com"; exit 1; }
[[ "$DOMAIN" =~ ^[a-z0-9.-]+$ ]] || { echo "Nama domain tidak valid: $DOMAIN"; exit 1; }
[[ "$PORT" =~ ^[0-9]{2,5}$ ]] || { echo "Port tidak valid: $PORT"; exit 1; }

echo "==> 1/4 Pastikan Nginx & Certbot tersedia"
command -v nginx >/dev/null 2>&1 || apt-get install -y nginx
command -v certbot >/dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx

NAME="genieacs-${DOMAIN}"
SITE="/etc/nginx/sites-available/${NAME}"
LINK="/etc/nginx/sites-enabled/${NAME}"

echo "==> 2/4 Bersihkan konfigurasi bentrok untuk $DOMAIN"
for f in /etc/nginx/sites-enabled/*; do
  [[ -e "$f" ]] || continue
  [[ "$(basename "$f")" == "$NAME" ]] && continue
  if grep -Eq "server_name[^;]*(^|[[:space:]])${DOMAIN//./\\.}([[:space:]]|;)" "$f" 2>/dev/null; then
    echo "INFO: menonaktifkan $(basename "$f")"
    rm -f "$f"
  fi
done

cat > "$SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        client_max_body_size 50m;
    }
}
EOF
ln -sfn "$SITE" "$LINK"
nginx -t
systemctl reload nginx

echo "==> 3/4 Pasang SSL Let's Encrypt untuk $DOMAIN"
CB_ARGS=(--nginx -d "$DOMAIN" --redirect --agree-tos --non-interactive)
if [[ -n "$EMAIL" ]]; then CB_ARGS+=(-m "$EMAIL"); else CB_ARGS+=(--register-unsafely-without-email); fi
if certbot "${CB_ARGS[@]}"; then
  systemctl reload nginx
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
  SCHEME="https"
  echo "SSL aktif dan akan diperbarui otomatis."
else
  SCHEME="http"
  echo "!! SSL gagal. Pastikan A record ${DOMAIN} sudah mengarah ke IP publik server ini,"
  echo "   port 80 terbuka, lalu jalankan ulang skrip ini."
fi

echo "==> 4/4 Buka firewall"
for p in 80 443; do ufw allow "${p}/tcp" >/dev/null 2>&1 || true; done

echo
echo "============================================="
echo " GenieACS : ${SCHEME}://${DOMAIN}   (admin / admin)"
echo " Isi URL di atas pada panel billing menu TR-069."
echo "============================================="
