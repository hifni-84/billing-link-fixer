#!/usr/bin/env bash
# Pemeriksaan ringan berkala. Tidak me-restart layanan yang masih sehat.

set -uo pipefail

APP_DIR="${APP_DIR:-/opt/mikrotik-billing}"
LOCK_FILE="/run/billing-autoheal.lock"

if [ "$(id -u)" != "0" ]; then
  echo "Jalankan dengan sudo: sudo bash deploy/autoheal-check.sh"
  exit 1
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date '+%F %T') Pemeriksaan sebelumnya masih berjalan; dilewati."
  exit 0
fi

echo "$(date '+%F %T') Memeriksa layanan billing..."
NEED_RECOVERY=0

# Hanya salah satu dari mariadb/mysql yang biasanya terpasang.
DB_SERVICE=""
for svc in mariadb mysql; do
  if systemctl list-unit-files "${svc}.service" 2>/dev/null | grep -q "${svc}.service"; then
    DB_SERVICE="$svc"
    break
  fi
done

if [ -n "$DB_SERVICE" ] && ! systemctl is-active --quiet "$DB_SERVICE"; then
  echo "Database mati; mencoba menyalakan $DB_SERVICE."
  systemctl start "$DB_SERVICE" >/dev/null 2>&1 || true
  systemctl is-active --quiet "$DB_SERVICE" || NEED_RECOVERY=1
fi

if ! systemctl is-active --quiet freeradius; then
  echo "FreeRADIUS mati."
  NEED_RECOVERY=1
fi

# Layanan dapat terlihat aktif walau socket RADIUS belum tersedia.
if ! ss -lun 2>/dev/null | grep -qE ':(1812|1813)[[:space:]]'; then
  echo "Port RADIUS 1812/1813 tidak terdeteksi."
  NEED_RECOVERY=1
fi

for svc in mikrotik-billing nginx; do
  if systemctl list-unit-files "${svc}.service" 2>/dev/null | grep -q "${svc}.service" && \
     ! systemctl is-active --quiet "$svc"; then
    echo "$svc mati; mencoba start."
    systemctl start "$svc" >/dev/null 2>&1 || true
  fi
done

if [ "$NEED_RECOVERY" -eq 1 ]; then
  echo "Masalah RADIUS terdeteksi; menjalankan pemulihan penuh."
  exec /bin/bash "$APP_DIR/deploy/fix-setelah-mati-lampu.sh"
fi

echo "Semua layanan sehat; tidak ada restart."
