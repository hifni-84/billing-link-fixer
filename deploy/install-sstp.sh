#!/usr/bin/env bash
# =====================================================================
#  SSTP VPN untuk MikroTik Billing (RouterOS v6 & v7)
#  Jalan di TCP 443 — port yang sudah pasti terbuka (panel web memakainya),
#  jadi TIDAK perlu minta port-forward UDP baru ke penyedia internet.
#
#  Cara kerja: nginx pada 443 memakai SNI-routing (ssl_preread).
#    - SNI = domain panel        -> panel web (127.0.0.1:8443)
#    - SNI = vpn.<domain> / kosong -> server SSTP (127.0.0.1:1443)
#
#  Pakai:  sudo bash deploy/install-sstp.sh [DOMAIN_PANEL]
#  Contoh: sudo bash deploy/install-sstp.sh mybillingg.site
# =====================================================================
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

SSTP_NET="${SSTP_NET:-10.40.40}"
SERVER_IP="${SSTP_NET}.1"
RANGE="${SSTP_NET}.0/24"
SSTP_PORT=1443
PANEL_PORT=8443
PSK_FILE="/etc/billing-sstp.pass"     # password default (info saja)
HOST_FILE="/etc/billing-vpn-host"
CERT_DIR="/etc/billing-sstp"

PANEL_HOST="${1:-}"
if [[ -z "$PANEL_HOST" && -f "$HOST_FILE" ]]; then
  PANEL_HOST="$(tr -d '[:space:]' < "$HOST_FILE")"
fi
if [[ -z "$PANEL_HOST" ]]; then
  PANEL_HOST="$(ls /etc/letsencrypt/live 2>/dev/null | head -1 || true)"
fi
[[ -n "$PANEL_HOST" ]] && { printf '%s\n' "$PANEL_HOST" > "$HOST_FILE"; chmod 644 "$HOST_FILE"; }

echo "==> [1/6] Install paket"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y python3-venv python3-pip ppp openssl nginx libnginx-mod-stream >/dev/null

echo "==> [2/6] Install sstp-server"
mkdir -p /opt/billing-sstp
if [[ ! -x /opt/billing-sstp/venv/bin/sstpd ]]; then
  python3 -m venv /opt/billing-sstp/venv
  /opt/billing-sstp/venv/bin/pip install -q --upgrade pip
  /opt/billing-sstp/venv/bin/pip install -q sstp-server
fi

echo "==> [3/6] Sertifikat TLS"
mkdir -p "$CERT_DIR"; chmod 750 "$CERT_DIR"
LE="/etc/letsencrypt/live/${PANEL_HOST}"
if [[ -n "$PANEL_HOST" && -s "$LE/fullchain.pem" ]]; then
  cp -L "$LE/fullchain.pem" "$CERT_DIR/cert.pem"
  cp -L "$LE/privkey.pem"  "$CERT_DIR/key.pem"
  echo "    memakai sertifikat Let's Encrypt ${PANEL_HOST}"
elif [[ ! -s "$CERT_DIR/cert.pem" ]]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -subj "/CN=${PANEL_HOST:-billing-vpn}" \
    -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" >/dev/null 2>&1
  echo "    memakai sertifikat self-signed (MikroTik: verify-server-certificate=no)"
fi
chmod 600 "$CERT_DIR"/*.pem

echo "==> [4/6] Konfigurasi pppd untuk SSTP"
cat > /etc/ppp/options.sstpd <<CFG
name BillingSSTP
require-mschap-v2
refuse-pap
refuse-chap
refuse-mschap
nologfd
nodefaultroute
noccp
mtu 1400
mru 1400
proxyarp
lcp-echo-failure 4
lcp-echo-interval 30
CFG
touch /etc/ppp/chap-secrets; chmod 600 /etc/ppp/chap-secrets
[[ -f "$PSK_FILE" ]] || { head -c 12 /dev/urandom | base64 | tr -d '/+=' > "$PSK_FILE"; chmod 600 "$PSK_FILE"; }

cat > /etc/systemd/system/billing-sstp.service <<CFG
[Unit]
Description=Billing SSTP VPN Server
After=network.target

[Service]
ExecStart=/opt/billing-sstp/venv/bin/sstpd -l 127.0.0.1 -p ${SSTP_PORT} \\
  -c ${CERT_DIR}/cert.pem -k ${CERT_DIR}/key.pem \\
  --local ${SERVER_IP} --remote ${RANGE} \\
  --pppd-config /etc/ppp/options.sstpd
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
CFG

echo "==> [5/6] Routing 443 (nginx SNI) "
# panel: pindahkan listener HTTPS ke 127.0.0.1:8443
for f in /etc/nginx/sites-enabled/*; do
  [[ -f "$f" ]] || continue
  cp -n "$f" "$f.bak-sstp" 2>/dev/null || true
  sed -i -E "s/listen\s+(\[::\]:)?443 ssl[^;]*;/listen 127.0.0.1:${PANEL_PORT} ssl;/g" "$f"
  sed -i -E "/listen\s+127.0.0.1:${PANEL_PORT} ssl;/{x;/./d;x;h}" "$f" 2>/dev/null || true
done
mkdir -p /etc/nginx/stream-enabled
cat > /etc/nginx/stream-enabled/billing-sstp.conf <<CFG
map \$ssl_preread_server_name \$billing_upstream {
    default              127.0.0.1:${SSTP_PORT};
    ""                   127.0.0.1:${SSTP_PORT};
    ${PANEL_HOST:-panel.invalid}       127.0.0.1:${PANEL_PORT};
    www.${PANEL_HOST:-panel.invalid}   127.0.0.1:${PANEL_PORT};
}
server {
    listen 443;
    listen [::]:443;
    ssl_preread on;
    proxy_pass \$billing_upstream;
    proxy_timeout 1h;
}
CFG
if ! grep -q 'stream-enabled' /etc/nginx/nginx.conf; then
  printf '\nstream {\n    include /etc/nginx/stream-enabled/*.conf;\n}\n' >> /etc/nginx/nginx.conf
fi
if ! nginx -t 2>/tmp/nginx-sstp.err; then
  echo "ERROR: konfigurasi nginx gagal, dikembalikan ke semula:"; cat /tmp/nginx-sstp.err
  for f in /etc/nginx/sites-enabled/*.bak-sstp; do [[ -f "$f" ]] && mv "$f" "${f%.bak-sstp}"; done
  rm -f /etc/nginx/stream-enabled/billing-sstp.conf
  nginx -t && systemctl reload nginx || true
  exit 1
fi

echo "==> [6/6] Menjalankan service"
sed -i 's/^#\?net.ipv4.ip_forward.*/net.ipv4.ip_forward=1/' /etc/sysctl.conf
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
sysctl -p >/dev/null
NIC="$(ip route show default | awk '/default/ {print $5; exit}')"
iptables -t nat -C POSTROUTING -s "$RANGE" -o "$NIC" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -s "$RANGE" -o "$NIC" -j MASQUERADE
command -v ufw >/dev/null && ufw allow 443/tcp >/dev/null 2>&1 || true
systemctl daemon-reload
systemctl enable billing-sstp >/dev/null
systemctl restart billing-sstp
systemctl reload nginx || systemctl restart nginx
sleep 2
systemctl is-active --quiet billing-sstp || { echo "ERROR: billing-sstp gagal aktif"; journalctl -u billing-sstp -n 30 --no-pager; exit 1; }

cat <<INFO

=====================================================================
 SSTP SIAP — jalan di TCP 443 (tanpa port-forward tambahan)
=====================================================================
 Host VPN     : ${PANEL_HOST:-IP_PUBLIK_SERVER}
 IP server    : ${SERVER_IP}   (dipakai sebagai IP RADIUS)
 IP router    : ${SSTP_NET}.2 - ${SSTP_NET}.200
 Panel web    : tetap di https://${PANEL_HOST:-IP_PUBLIK_SERVER} (internal 8443)

 Tambahkan router dari panel: menu VPN Router -> tab SSTP (443)
 Agar panel bisa mengelola user: sudo bash deploy/allow-sstp-sudo.sh
=====================================================================
INFO
