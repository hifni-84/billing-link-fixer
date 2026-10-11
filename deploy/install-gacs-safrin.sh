#!/usr/bin/env bash
# Pasang GenieACS dari safrinnetwork/GACS-Ubuntu-22.04 ke folder ~/acs,
# lalu pindahkan UI ke port 3001 agar tidak bentrok dengan billing (3000).
# Jalankan: sudo bash /opt/mikrotik-billing/deploy/install-gacs-safrin.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Jalankan dengan sudo."; exit 1; }

OWNER="${SUDO_USER:-root}"
HOME_DIR="$(getent passwd "$OWNER" | cut -d: -f6)"
ACS_DIR="${ACS_DIR:-$HOME_DIR/acs}"
UI_PORT="${GENIEACS_UI_PORT:-3001}"

apt-get update -y
apt-get install -y git dos2unix

if [ -d "$ACS_DIR/.git" ]; then
  git -C "$ACS_DIR" pull --ff-only || true
else
  if [ -d "$ACS_DIR" ] && [ -n "$(ls -A "$ACS_DIR" 2>/dev/null)" ]; then
    mv "$ACS_DIR" "${ACS_DIR}.lama-$(date +%Y%m%d%H%M%S)"
  fi
  rm -rf "$ACS_DIR"
  git clone https://github.com/safrinnetwork/GACS-Ubuntu-22.04.git "$ACS_DIR"
fi
chown -R "$OWNER":"$OWNER" "$ACS_DIR"

cd "$ACS_DIR"
dos2unix GACS-Jammy.sh
chmod +x GACS-Jammy.sh
bash GACS-Jammy.sh

ENV=/opt/genieacs/genieacs.env
if [ -f "$ENV" ]; then
  sed -i '/^GENIEACS_UI_PORT=/d' "$ENV"
  echo "GENIEACS_UI_PORT=${UI_PORT}" >> "$ENV"
fi
mkdir -p /etc/systemd/system/genieacs-ui.service.d
printf '[Service]\nEnvironment=GENIEACS_UI_PORT=%s\n' "$UI_PORT" > /etc/systemd/system/genieacs-ui.service.d/port.conf
systemctl daemon-reload
systemctl restart genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui
for p in 7547 7557 7567 "$UI_PORT"; do ufw allow "${p}/tcp" >/dev/null 2>&1 || true; done

sleep 3
systemctl is-active genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui || true
echo "GenieACS UI : http://$(hostname -I | awk '{print $1}'):${UI_PORT} (admin/admin)"
echo "ACS URL ONU : http://192.168.23.5:7547"
