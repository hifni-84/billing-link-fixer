#!/usr/bin/env bash
# =============================================================
#  Pasang GenieACS (repo alijayanet) di server yang sama dengan
#  panel Billing Radius. UI GenieACS dipindah ke port 3001 agar
#  tidak bentrok dengan billing (port 3000).
#
#  Jalankan: sudo bash deploy/install-genieacs.sh
#            sudo bash deploy/install-genieacs.sh --original   (tema asli)
# =============================================================
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Harus dijalankan dengan sudo/root."; exit 1; }

REPO_URL="${GENIEACS_REPO:-https://github.com/alijayanet/genieacs.git}"
SRC_DIR="${GENIEACS_SRC:-/opt/genieacs-installer}"
UI_PORT="${GENIEACS_UI_PORT:-3001}"
MODE="darkmode.sh"
[ "${1:-}" = "--original" ] && MODE="install.sh"

echo "==> 1/5 Dependensi dasar"
apt-get update -y
apt-get install -y git curl ca-certificates

echo "==> 2/5 Ambil installer dari $REPO_URL"
if [ -d "$SRC_DIR/.git" ]; then
  git -C "$SRC_DIR" fetch --all
  git -C "$SRC_DIR" reset --hard origin/HEAD 2>/dev/null || git -C "$SRC_DIR" pull --ff-only
else
  rm -rf "$SRC_DIR"
  git clone --depth 1 "$REPO_URL" "$SRC_DIR"
fi
chmod +x "$SRC_DIR"/*.sh || true

echo "==> 3/5 Jalankan $MODE (MongoDB + GenieACS + UI)"
( cd "$SRC_DIR" && bash "$MODE" )

echo "==> 4/5 Pindahkan UI GenieACS ke port $UI_PORT"
ENV_FILE=""
for f in /opt/genieacs/genieacs.env /etc/genieacs/genieacs.env; do
  [ -f "$f" ] && ENV_FILE="$f" && break
done
if [ -n "$ENV_FILE" ]; then
  if grep -q '^GENIEACS_UI_PORT=' "$ENV_FILE"; then
    sed -i "s|^GENIEACS_UI_PORT=.*|GENIEACS_UI_PORT=${UI_PORT}|" "$ENV_FILE"
  else
    echo "GENIEACS_UI_PORT=${UI_PORT}" >> "$ENV_FILE"
  fi
  systemctl daemon-reload
  systemctl restart genieacs-ui || true
else
  echo "!! genieacs.env tidak ditemukan, ubah port UI manual bila bentrok."
fi

echo "==> 5/5 Buka firewall & verifikasi"
for p in 7547 7557 7567 "$UI_PORT"; do
  ufw allow "${p}/tcp" >/dev/null 2>&1 || true
done

IP="$(hostname -I | awk '{print $1}')"
echo
systemctl is-active genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui || true
echo
echo "============================================="
echo " GenieACS UI : http://${IP}:${UI_PORT}  (admin / admin)"
echo " NBI API     : http://127.0.0.1:7557"
echo " ACS URL ONU : http://${IP}:7547"
echo
echo " Isi URL UI di panel billing menu TR-069."
echo "============================================="
