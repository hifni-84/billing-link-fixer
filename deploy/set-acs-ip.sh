#!/usr/bin/env bash
# =============================================================
#  Buat GenieACS bisa diakses ONT pada IP:PORT tertentu
#  (mis. ONT sudah tersetting http://192.168.23.5:7547)
#
#  Pakai:
#    sudo bash deploy/set-acs-ip.sh 192.168.23.5 7547
#    sudo bash deploy/set-acs-ip.sh 192.168.23.5 7547 enp1s0
#
#  Yang dilakukan:
#   1. Menambahkan IP tersebut sebagai alias di interface server
#      (jadi server ikut menjawab di IP itu, IP lama tetap jalan)
#   2. Memastikan GenieACS CWMP listen di semua IP pada port itu
#   3. Membuka firewall port CWMP
# =============================================================
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

IP="${1:-}"
PORT="${2:-7547}"
IFACE="${3:-}"

[[ "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "Contoh: sudo bash deploy/set-acs-ip.sh 192.168.23.5 7547"; exit 1; }
[[ "$PORT" =~ ^[0-9]{2,5}$ ]] || { echo "Port tidak valid: $PORT"; exit 1; }

if [[ -z "$IFACE" ]]; then
  IFACE="$(ip -o -4 route show to default | awk '{print $5}' | head -n1)"
fi
[[ -n "$IFACE" ]] || { echo "Interface tidak terdeteksi, sebutkan manual sebagai argumen ke-3."; exit 1; }

echo "==> 1/3 Tambah alias IP $IP di $IFACE"
if ip -4 addr show dev "$IFACE" | grep -q " ${IP}/"; then
  echo "INFO: $IP sudah ada di $IFACE"
else
  ip addr add "${IP}/24" dev "$IFACE" || true
fi

# Bikin permanen lewat systemd unit sederhana (tahan reboot)
cat > /etc/systemd/system/acs-alias-ip.service <<EOF
[Unit]
Description=Alias IP untuk ACS (GenieACS)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash -c 'ip addr add ${IP}/24 dev ${IFACE} || true'

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now acs-alias-ip.service >/dev/null 2>&1 || true

echo "==> 2/3 Set GenieACS CWMP listen di 0.0.0.0:${PORT}"
mkdir -p /etc/systemd/system/genieacs-cwmp.service.d
cat > /etc/systemd/system/genieacs-cwmp.service.d/port.conf <<EOF
[Service]
Environment=GENIEACS_CWMP_INTERFACE=::
Environment=GENIEACS_CWMP_PORT=${PORT}
EOF
systemctl daemon-reload
systemctl restart genieacs-cwmp || true
sleep 2
systemctl is-active genieacs-cwmp && echo "genieacs-cwmp aktif" || journalctl -u genieacs-cwmp -n 20 --no-pager

echo "==> 3/3 Buka firewall port ${PORT}"
ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true

echo
echo "============================================="
echo " URL ACS untuk ONT : http://${IP}:${PORT}"
echo " Cek : curl -s -o /dev/null -w '%{http_code}\\n' http://${IP}:${PORT}"
echo "============================================="
