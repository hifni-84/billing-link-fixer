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

GLOBAL_NODE_MODULES="$(npm root -g 2>/dev/null || true)"
GENIEACS_PACKAGE_DIR="${GLOBAL_NODE_MODULES}/genieacs"

echo "==> 3/5 Pasang/perbaiki GenieACS (MongoDB + CWMP + FS + NBI + UI)"
if [ -n "$GLOBAL_NODE_MODULES" ] \
  && [ -f "$GENIEACS_PACKAGE_DIR/package.json" ] \
  && systemctl cat genieacs-cwmp genieacs-fs genieacs-nbi genieacs-ui >/dev/null 2>&1; then
  echo "GenieACS sudah terpasang; lewati restore database dan perbaiki paket yang ada."
else
  ( cd "$SRC_DIR" && bash "$MODE" )
  GLOBAL_NODE_MODULES="$(npm root -g)"
  GENIEACS_PACKAGE_DIR="${GLOBAL_NODE_MODULES}/genieacs"
fi

# Installer alijayanet menyalin kode UI kustom setelah `npm install -g`.
# Pada npm/Node versi baru, penyalinan itu dapat meninggalkan paket tanpa
# dependency seperti koa-router. Salin konten fork secara eksplisit lalu
# pasang semua dependency produksi di direktori paket yang benar.
if [ ! -f "$SRC_DIR/genieacs/package.json" ]; then
  echo "ERROR: paket GenieACS kustom tidak ditemukan di $SRC_DIR/genieacs" >&2
  exit 1
fi
mkdir -p "$GENIEACS_PACKAGE_DIR"
cp -a "$SRC_DIR/genieacs/." "$GENIEACS_PACKAGE_DIR/"
npm --prefix "$GENIEACS_PACKAGE_DIR" install --omit=dev --no-audit --no-fund

if ! node -e "require.resolve('koa-router', { paths: [process.argv[1]] })" "$GENIEACS_PACKAGE_DIR" >/dev/null 2>&1; then
  echo "ERROR: dependency koa-router masih belum tersedia." >&2
  exit 1
fi
echo "Dependency GenieACS lengkap (koa-router tersedia)."

# File bin di fork alijayanet tersimpan tanpa bit executable. Sesudah paket
# kustom disalin, pastikan keempat command dapat dijalankan oleh systemd dan
# buat ulang symlink global yang dapat hilang saat `npm --prefix install`.
for service in cwmp nbi fs ui; do
  executable="$GENIEACS_PACKAGE_DIR/bin/genieacs-$service"
  if [ ! -f "$executable" ]; then
    echo "ERROR: executable genieacs-$service tidak ditemukan." >&2
    exit 1
  fi
  chmod 755 "$executable"
  ln -sfn "$executable" "/usr/bin/genieacs-$service"
done

echo "==> 4/5 Pindahkan UI GenieACS ke port $UI_PORT"
for f in /opt/genieacs/genieacs.env /etc/genieacs/genieacs.env; do
  [ -f "$f" ] || continue
  if grep -q '^GENIEACS_UI_PORT=' "$f"; then
    sed -i "s|^GENIEACS_UI_PORT=.*|GENIEACS_UI_PORT=${UI_PORT}|" "$f"
  else
    echo "GENIEACS_UI_PORT=${UI_PORT}" >> "$f"
  fi
done

# Cara paling andal: drop-in systemd (menang atas EnvironmentFile)
if systemctl cat genieacs-ui >/dev/null 2>&1; then
  mkdir -p /etc/systemd/system/genieacs-ui.service.d
  cat > /etc/systemd/system/genieacs-ui.service.d/port.conf <<EOF
[Service]
Environment=GENIEACS_UI_PORT=${UI_PORT}
EOF
  systemctl daemon-reload
  systemctl restart genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui || true
  sleep 3
  if ! systemctl is-active --quiet genieacs-ui; then
    echo "!! genieacs-ui gagal start. Log terakhir:"
    journalctl -u genieacs-ui -n 30 --no-pager || true
  fi
elif command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null | grep -q genieacs-ui; then
  pm2 restart genieacs-ui --update-env >/dev/null 2>&1 || true
  pm2 save >/dev/null 2>&1 || true
else
  echo "!! service genieacs-ui tidak ditemukan, ubah port UI manual bila bentrok."
fi


echo "==> 5/5 Buka firewall & verifikasi"
for p in 7547 7557 7567 "$UI_PORT"; do
  ufw allow "${p}/tcp" >/dev/null 2>&1 || true
done

IP="$(hostname -I | awk '{print $1}')"
echo
systemctl is-active genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui || true
if ! systemctl is-active --quiet genieacs-ui; then
  echo
  echo "ERROR: GenieACS UI belum aktif. Periksa log di atas." >&2
  exit 1
fi
echo
echo "============================================="
echo " GenieACS UI : http://${IP}:${UI_PORT}  (admin / admin)"
echo " NBI API     : http://127.0.0.1:7557"
echo " ACS URL ONU : http://${IP}:7547"
echo
echo " Isi URL UI di panel billing menu TR-069."
echo "============================================="
