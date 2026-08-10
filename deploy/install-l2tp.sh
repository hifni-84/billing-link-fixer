#!/usr/bin/env bash
# =====================================================================
#  L2TP/IPsec VPN untuk MikroTik Billing (alternatif WireGuard)
#  Dipakai untuk MikroTik RouterOS v6 yang TIDAK mendukung WireGuard.
#
#  Pakai:  sudo bash deploy/install-l2tp.sh [IP_PUBLIK_ATAU_DNS]
#  Contoh: sudo bash deploy/install-l2tp.sh 38.156.95.73
# =====================================================================
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

L2TP_NET="${L2TP_NET:-10.30.30}"
SERVER_IP="${L2TP_NET}.1"
RANGE_START="${L2TP_NET}.10"
RANGE_END="${L2TP_NET}.200"
PSK_FILE="/etc/billing-l2tp.psk"
HOST_FILE="/etc/billing-vpn-host"

# IP publik / DNS server VPN: argumen > env PUBLIC_HOST > file tersimpan
PUBLIC_HOST="${1:-${PUBLIC_HOST:-}}"
if [[ -z "$PUBLIC_HOST" && -f "$HOST_FILE" ]]; then
  PUBLIC_HOST="$(tr -d '[:space:]' < "$HOST_FILE")"
fi
if [[ -n "$PUBLIC_HOST" ]]; then
  printf '%s\n' "$PUBLIC_HOST" > "$HOST_FILE"
  chmod 644 "$HOST_FILE"
fi

echo "==> [1/6] Install paket"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y strongswan strongswan-pki xl2tpd ppp iptables tcpdump >/dev/null

echo "==> [2/6] Menyiapkan PSK"
if [[ ! -f "$PSK_FILE" ]]; then
  head -c 18 /dev/urandom | base64 | tr -d '/+=' > "$PSK_FILE"
  chmod 600 "$PSK_FILE"
fi
PSK="$(cat "$PSK_FILE")"

echo "==> [3/6] Konfigurasi IPsec (strongSwan)"
cat > /etc/ipsec.conf <<CFG
config setup
  charondebug="ike 2, knl 1, cfg 1, net 1"
  uniqueids=no

conn billing-l2tp
  keyexchange=ikev1
  authby=secret
  type=transport
  forceencaps=yes
  fragmentation=yes
  rekey=no
  left=%any
  leftid=%any
  leftprotoport=17/1701
  right=%any
  rightid=%any
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
name BillingL2TP
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
iptables -C INPUT -p udp --dport 500 -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p udp --dport 500 -j ACCEPT
iptables -C INPUT -p udp --dport 4500 -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p udp --dport 4500 -j ACCEPT
iptables -C INPUT -p udp --dport 1701 -m policy --dir in --pol ipsec -j ACCEPT 2>/dev/null \
  || iptables -I INPUT 1 -p udp --dport 1701 -m policy --dir in --pol ipsec -j ACCEPT

echo "==> [6/6] Menjalankan service"
pkill -x charon 2>/dev/null || true
if systemctl list-unit-files strongswan-starter.service >/dev/null 2>&1; then
  systemctl enable strongswan-starter
  systemctl restart strongswan-starter
else
  systemctl enable strongswan
  systemctl restart strongswan
fi
systemctl enable xl2tpd
systemctl restart xl2tpd
sleep 3
if ! systemctl is-active --quiet strongswan-starter && ! systemctl is-active --quiet strongswan; then
  echo "ERROR: service IPsec gagal aktif"
  journalctl -u strongswan-starter -n 30 --no-pager || true
  exit 1
fi
systemctl is-active --quiet xl2tpd || { echo "ERROR: xl2tpd gagal aktif"; exit 1; }

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

 PENTING jika server memakai IP lokal/NAT:
 forward UDP 500, 4500, dan 1701 dari router gateway ke IP server ini.
=====================================================================
INFO
