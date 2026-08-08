#!/usr/bin/env bash
# =====================================================================
#  L2TP/IPsec VPN untuk MikroTik Billing (alternatif WireGuard)
#  Dipakai untuk MikroTik RouterOS v6 yang TIDAK mendukung WireGuard.
#
#  Pakai:  sudo bash deploy/install-l2tp.sh
# =====================================================================
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

L2TP_NET="${L2TP_NET:-10.30.30}"
SERVER_IP="${L2TP_NET}.1"
RANGE_START="${L2TP_NET}.10"
RANGE_END="${L2TP_NET}.200"
PSK_FILE="/etc/billing-l2tp.psk"

echo "==> [1/6] Install paket"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y strongswan strongswan-pki xl2tpd ppp iptables >/dev/null

echo "==> [2/6] Menyiapkan PSK"
if [[ ! -f "$PSK_FILE" ]]; then
  head -c 18 /dev/urandom | base64 | tr -d '/+=' > "$PSK_FILE"
  chmod 600 "$PSK_FILE"
fi
PSK="$(cat "$PSK_FILE")"

echo "==> [3/6] Konfigurasi IPsec (strongSwan)"
cat > /etc/ipsec.conf <<CFG
config setup
  charondebug="ike 1, knl 1, cfg 0"
  uniqueids=no

conn billing-l2tp
  keyexchange=ikev1
  authby=secret
  type=transport
  left=%any
  leftprotoport=17/1701
  right=%any
  rightprotoport=17/%any
  ike=aes256-sha1-modp1024,aes128-sha1-modp1024,3des-sha1-modp1024!
  esp=aes256-sha1,aes128-sha1,3des-sha1!
  dpddelay=30
  dpdtimeout=120
  dpdaction=clear
  auto=add
CFG
echo ": PSK \"${PSK}\"" > /etc/ipsec.secrets
chmod 600 /etc/ipsec.secrets

echo "==> [4/6] Konfigurasi L2TP (xl2tpd)"
cat > /etc/xl2tpd/xl2tpd.conf <<CFG
[global]
port = 1701
access control = no

[lns default]
ip range = ${RANGE_START}-${RANGE_END}
local ip = ${SERVER_IP}
require chap = yes
refuse pap = yes
require authentication = yes
name = BillingL2TP
ppp debug = no
pppoptfile = /etc/ppp/options.xl2tpd
length bit = yes
CFG

cat > /etc/ppp/options.xl2tpd <<CFG
ipcp-accept-local
ipcp-accept-remote
require-mschap-v2
refuse-pap
refuse-chap
refuse-mschap
noccp
auth
mtu 1400
mru 1400
proxyarp
lcp-echo-failure 4
lcp-echo-interval 30
connect-delay 5000
CFG
touch /etc/ppp/chap-secrets
chmod 600 /etc/ppp/chap-secrets

echo "==> [5/6] Routing & firewall"
sed -i 's/^#\?net.ipv4.ip_forward.*/net.ipv4.ip_forward=1/' /etc/sysctl.conf
grep -q '^net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
sysctl -p >/dev/null
NIC="$(ip route show default | awk '/default/ {print $5; exit}')"
iptables -t nat -C POSTROUTING -s ${L2TP_NET}.0/24 -o "$NIC" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -s ${L2TP_NET}.0/24 -o "$NIC" -j MASQUERADE
if command -v ufw >/dev/null; then
  ufw allow 500/udp  >/dev/null 2>&1 || true
  ufw allow 4500/udp >/dev/null 2>&1 || true
  ufw allow 1701/udp >/dev/null 2>&1 || true
fi

echo "==> [6/6] Menjalankan service"
systemctl enable --now strongswan-starter 2>/dev/null || systemctl enable --now strongswan 2>/dev/null || true
systemctl enable --now xl2tpd
systemctl restart xl2tpd

PUBLIC_HOST="${PUBLIC_HOST:-$(curl -s -4 --max-time 5 ifconfig.me || true)}"
cat <<INFO

=====================================================================
 L2TP/IPsec SIAP (cocok untuk MikroTik RouterOS v6)
=====================================================================
 Server L2TP  : ${PUBLIC_HOST:-IP_PUBLIK_SERVER}
 IPsec PSK    : ${PSK}
 IP server    : ${SERVER_IP}   (dipakai sebagai IP RADIUS)
 IP router    : ${RANGE_START} - ${RANGE_END}

 Tambahkan router dari panel billing:  menu VPN Router -> tab L2TP/IPsec
 Agar panel bisa mengelola user: sudo bash deploy/allow-l2tp-sudo.sh
=====================================================================
INFO
