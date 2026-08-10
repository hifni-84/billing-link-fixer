#!/usr/bin/env bash
# =====================================================================
#  SSTP VPN untuk MikroTik Billing (RouterOS v6 & v7)
#  Jalan di TCP (default 8443) SECARA MANDIRI — tidak menyentuh nginx
#  maupun panel web, jadi panel tidak mungkin ikut mati.
#
#  Pakai:  sudo bash deploy/install-sstp.sh [DOMAIN_ATAU_IP] [PORT]
#  Contoh: sudo bash deploy/install-sstp.sh billing.hopto.org 8443
#
#  Di gateway MikroTik cukup forward SATU port TCP:
#    /ip firewall nat add chain=dstnat protocol=tcp dst-port=8443 \
#      action=dst-nat to-addresses=<IP_LOKAL_SERVER> to-ports=8443
# =====================================================================
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

SSTP_NET="${SSTP_NET:-10.40.40}"
SERVER_IP="${SSTP_NET}.1"
RANGE="${SSTP_NET}.0/24"
HOST_FILE="/etc/billing-vpn-host"
PORT_FILE="/etc/billing-sstp-port"
PSK_FILE="/etc/billing-sstp.pass"
CERT_DIR="/etc/billing-sstp"

VPN_HOST="${1:-}"
SSTP_PORT="${2:-}"
[[ -z "$VPN_HOST" && -f "$HOST_FILE" ]] && VPN_HOST="$(tr -d '[:space:]' < "$HOST_FILE")"
[[ -z "$VPN_HOST" ]] && VPN_HOST="$(ls /etc/letsencrypt/live 2>/dev/null | head -1 || true)"
[[ -z "$VPN_HOST" ]] && VPN_HOST="$(curl -s --max-time 5 https://api.ipify.org || true)"
[[ -n "$VPN_HOST" ]] && { printf '%s\n' "$VPN_HOST" > "$HOST_FILE"; chmod 644 "$HOST_FILE"; }
[[ -z "$SSTP_PORT" && -f "$PORT_FILE" ]] && SSTP_PORT="$(tr -dc '0-9' < "$PORT_FILE")"
SSTP_PORT="${SSTP_PORT:-8443}"
printf '%s\n' "$SSTP_PORT" > "$PORT_FILE"; chmod 644 "$PORT_FILE"

echo "==> [1/5] Install paket"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y python3-venv python3-pip ppp openssl curl >/dev/null

echo "==> [2/5] Install sstp-server"
mkdir -p /opt/billing-sstp
if [[ ! -x /opt/billing-sstp/venv/bin/sstpd ]]; then
  python3 -m venv /opt/billing-sstp/venv
  /opt/billing-sstp/venv/bin/pip install -q --upgrade pip
  /opt/billing-sstp/venv/bin/pip install -q sstp-server
fi

echo "==> [3/5] Sertifikat TLS"
mkdir -p "$CERT_DIR"; chmod 750 "$CERT_DIR"
LE="/etc/letsencrypt/live/${VPN_HOST}"
if [[ -s "$LE/fullchain.pem" ]]; then
  cp -L "$LE/fullchain.pem" "$CERT_DIR/cert.pem"
  cp -L "$LE/privkey.pem"  "$CERT_DIR/key.pem"
  echo "    memakai sertifikat Let's Encrypt ${VPN_HOST}"
elif [[ ! -s "$CERT_DIR/cert.pem" ]]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -subj "/CN=${VPN_HOST:-billing-vpn}" \
    -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" >/dev/null 2>&1
  echo "    memakai sertifikat self-signed (MikroTik: verify-server-certificate=no)"
fi
chmod 600 "$CERT_DIR"/*.pem

echo "==> [4/5] Konfigurasi pppd + service"
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
ExecStart=/opt/billing-sstp/venv/bin/sstpd -l 0.0.0.0 -p ${SSTP_PORT} \\
  -c ${CERT_DIR}/cert.pem -k ${CERT_DIR}/key.pem \\
  --local ${SERVER_IP} --remote ${RANGE} \\
  --pppd-config /etc/ppp/options.sstpd
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
CFG

echo "==> [5/5] Menjalankan service"
sed -i 's/^#\?net.ipv4.ip_forward.*/net.ipv4.ip_forward=1/' /etc/sysctl.conf
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
sysctl -p >/dev/null
NIC="$(ip route show default | awk '/default/ {print $5; exit}')"
iptables -t nat -C POSTROUTING -s "$RANGE" -o "$NIC" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -s "$RANGE" -o "$NIC" -j MASQUERADE
command -v ufw >/dev/null && ufw allow "${SSTP_PORT}"/tcp >/dev/null 2>&1 || true
systemctl daemon-reload
systemctl enable billing-sstp >/dev/null
systemctl restart billing-sstp
sleep 2
systemctl is-active --quiet billing-sstp || { echo "ERROR: billing-sstp gagal aktif"; journalctl -u billing-sstp -n 30 --no-pager; exit 1; }

LOCAL_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
cat <<INFO

=====================================================================
 SSTP SIAP — TCP ${SSTP_PORT} (mandiri, panel web tidak diubah)
=====================================================================
 Host VPN     : ${VPN_HOST:-IP_PUBLIK_SERVER}
 Port         : ${SSTP_PORT}
 IP server    : ${SERVER_IP}   (dipakai sebagai IP RADIUS)
 IP router    : ${SSTP_NET}.2 - ${SSTP_NET}.200

 Forward di gateway MikroTik (sekali saja):
   /ip firewall nat add chain=dstnat protocol=tcp dst-port=${SSTP_PORT} \\
     action=dst-nat to-addresses=${LOCAL_IP:-IP_LOKAL_SERVER} to-ports=${SSTP_PORT}

 Tambahkan router dari panel: menu VPN Router -> tab SSTP
 Agar panel bisa mengelola user: sudo bash deploy/allow-sstp-sudo.sh
=====================================================================
INFO
