#!/usr/bin/env bash
# Menerapkan domain/IP publik ke Nginx + SSL Let's Encrypt.
# Dipanggil otomatis oleh panel billing (menu Pengaturan > Domain & SSL).
#   sudo /opt/mikrotik-billing/deploy/apply-domain.sh "domain1,domain2" "email" 3000 1
# Gunakan kata "auto" sebagai domain untuk memakai <ip-publik>.sslip.io otomatis.
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

DOMAINS_RAW="${1:-}"
EMAIL="${2:-}"
PORT="${3:-3000}"
USE_SSL="${4:-0}"

[[ "$PORT" =~ ^[0-9]{2,5}$ ]] || { echo "Port tidak valid: $PORT"; exit 1; }

detect_ip() {
  local ip=""
  for u in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    ip="$(curl -fsS --max-time 6 "$u" 2>/dev/null | tr -d '[:space:]')" || ip=""
    [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] && { echo "$ip"; return 0; }
  done
  return 1
}

IFS=',' read -r -a RAW <<< "$DOMAINS_RAW"
DOMAINS=()
for d in "${RAW[@]}"; do
  d="$(echo "$d" | tr -d ' ' | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s#:[0-9]+$##')"
  [[ -z "$d" ]] && continue
  if [[ "$d" == "auto" ]]; then
    if IP="$(detect_ip)"; then
      d="${IP//./-}.sslip.io"
      echo "INFO: memakai domain gratis otomatis: $d"
    else
      echo "Gagal mendeteksi IP publik server."; exit 1
    fi
  fi
  # IP publik murni -> pakai sslip.io supaya tetap bisa dapat SSL gratis
  if [[ "$d" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] && [[ "$USE_SSL" == "1" ]]; then
    echo "INFO: $d adalah IP publik; ditambahkan juga ${d//./-}.sslip.io agar bisa HTTPS."
    DOMAINS+=("${d//./-}.sslip.io")
  fi
  [[ "$d" =~ ^[a-z0-9.-]+$ ]] || { echo "Nama domain tidak valid: $d"; exit 1; }
  DOMAINS+=("$d")
done
[[ ${#DOMAINS[@]} -eq 0 ]] && { echo "Domain kosong."; exit 1; }

# buang duplikat
mapfile -t DOMAINS < <(printf '%s\n' "${DOMAINS[@]}" | awk '!a[$0]++')

SITE="/etc/nginx/sites-available/billing-domain"
LINK="/etc/nginx/sites-enabled/billing-domain"
BACKUP="${SITE}.bak"
[[ -f "$SITE" ]] && cp -f "$SITE" "$BACKUP"

# Hindari bentrok: site lain yang memakai domain yang sama dinonaktifkan
for f in /etc/nginx/sites-enabled/*; do
  [[ -e "$f" ]] || continue
  [[ "$(basename "$f")" == "billing-domain" ]] && continue
  for d in "${DOMAINS[@]}"; do
    if grep -Eq "server_name[^;]*(^|[[:space:]])${d//./\\.}([[:space:]]|;)" "$f" 2>/dev/null; then
      echo "INFO: menonaktifkan konfigurasi bentrok: $(basename "$f")"
      rm -f "$f"
      break
    fi
  done
done

{
  echo "server {"
  echo "    listen 80;"
  echo "    listen [::]:80;"
  echo "    server_name ${DOMAINS[*]};"
  echo ""
  echo "    client_max_body_size 10m;"
  echo ""
  echo "    location /.well-known/acme-challenge/ { root /var/www/html; }"
  echo ""
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
} > "$SITE"

mkdir -p /var/www/html
ln -sfn "$SITE" "$LINK"

if ! nginx -t 2>&1; then
  echo "Konfigurasi Nginx gagal diuji, perubahan dibatalkan."
  if [[ -f "$BACKUP" ]]; then cp -f "$BACKUP" "$SITE"; else rm -f "$LINK" "$SITE"; fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  exit 1
fi
systemctl reload nginx
echo "OK: Nginx aktif untuk ${DOMAINS[*]} -> 127.0.0.1:${PORT}"

# Pastikan firewall mengizinkan HTTP/HTTPS bila ufw aktif
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi "^Status: active"; then
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  echo "OK: port 80 & 443 diizinkan di firewall."
fi

if [[ "$USE_SSL" != "1" ]]; then
  echo "SELESAI. Akses: http://${DOMAINS[0]}"
  exit 0
fi

if ! command -v certbot >/dev/null 2>&1; then
  echo "INFO: memasang certbot…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y >/dev/null 2>&1 || true
  apt-get install -y certbot python3-certbot-nginx >/dev/null 2>&1 || true
fi
command -v certbot >/dev/null 2>&1 || { echo "Certbot tidak tersedia, SSL dilewati."; exit 0; }

ARGS=(--nginx --non-interactive --agree-tos --redirect --keep-until-expiring)
if [[ -n "$EMAIL" ]]; then ARGS+=(-m "$EMAIL"); else ARGS+=(--register-unsafely-without-email); fi
SSL_DOMAINS=()
for d in "${DOMAINS[@]}"; do
  # Let's Encrypt tidak menerbitkan sertifikat untuk IP address
  [[ "$d" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] && continue
  SSL_DOMAINS+=("$d")
  ARGS+=(-d "$d")
done
if [[ ${#SSL_DOMAINS[@]} -eq 0 ]]; then
  echo "PERINGATAN: hanya IP publik yang diisi, SSL gratis tidak tersedia untuk IP."
  exit 0
fi

if certbot "${ARGS[@]}" 2>&1; then
  systemctl reload nginx
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
  echo "OK: SSL aktif & perpanjangan otomatis dinyalakan."
  echo "SELESAI. Akses: https://${SSL_DOMAINS[0]}"
else
  echo "PERINGATAN: SSL gagal dipasang. Pastikan domain '${SSL_DOMAINS[0]}' sudah mengarah ke IP server ini dan port 80 terbuka."
  echo "Sementara ini situs tetap bisa diakses via http://${DOMAINS[0]}"
fi
