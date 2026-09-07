#!/usr/bin/env bash
# Pasang pemulihan OTOMATIS: setelah mati lampu server memperbaiki dirinya sendiri
# (MySQL/FreeRADIUS dinyalakan, tabel diperbaiki, sesi hantu dibersihkan)
# tanpa perlu buka PuTTY.
#
# Pakai:  sudo bash deploy/install-autoheal.sh
# Cabut:  sudo bash deploy/install-autoheal.sh --hapus

set -uo pipefail

APP_DIR="${APP_DIR:-/opt/mikrotik-billing}"
SYSTEMD_DIR="/etc/systemd/system"

if [ "$(id -u)" != "0" ]; then
  echo "Jalankan dengan sudo: sudo bash deploy/install-autoheal.sh"
  exit 1
fi

if [ "${1:-}" = "--hapus" ] || [ "${1:-}" = "--remove" ]; then
  systemctl disable --now billing-autoheal.timer >/dev/null 2>&1 || true
  rm -f "$SYSTEMD_DIR/billing-autoheal.timer" "$SYSTEMD_DIR/billing-autoheal.service"
  systemctl daemon-reload
  echo "Pemulihan otomatis sudah dicabut."
  exit 0
fi

if [ ! -f "$APP_DIR/deploy/fix-setelah-mati-lampu.sh" ]; then
  echo "Tidak menemukan $APP_DIR/deploy/fix-setelah-mati-lampu.sh"
  echo "Jalankan dulu: cd $APP_DIR && sudo git pull origin main"
  exit 1
fi

echo "==> 1/4 Pasang unit systemd"
install -m 644 "$APP_DIR/deploy/billing-autoheal.service" "$SYSTEMD_DIR/billing-autoheal.service"
install -m 644 "$APP_DIR/deploy/billing-autoheal.timer"   "$SYSTEMD_DIR/billing-autoheal.timer"
if [ "$APP_DIR" != "/opt/mikrotik-billing" ]; then
  sed -i "s#/opt/mikrotik-billing#$APP_DIR#g" "$SYSTEMD_DIR/billing-autoheal.service"
fi

echo "==> 2/4 Pastikan layanan penting menyala sendiri setelah reboot"
for svc in mariadb mysql freeradius mikrotik-billing nginx; do
  if systemctl list-unit-files | grep -q "^${svc}.service"; then
    systemctl enable "$svc" >/dev/null 2>&1 && echo "    enable: $svc"
  fi
done

echo "==> 3/4 Aktifkan timer pemulihan otomatis"
systemctl daemon-reload
systemctl enable --now billing-autoheal.timer
touch /var/log/billing-autoheal.log
chmod 640 /var/log/billing-autoheal.log

echo "==> 4/4 Uji sekali sekarang"
systemctl start billing-autoheal.service || true
systemctl --no-pager list-timers billing-autoheal.timer || true

echo
echo "Selesai. Server akan memperbaiki diri sendiri 1 menit setelah listrik kembali,"
echo "lalu memeriksa ulang setiap 15 menit."
echo "Lihat catatan: sudo tail -n 50 /var/log/billing-autoheal.log"
