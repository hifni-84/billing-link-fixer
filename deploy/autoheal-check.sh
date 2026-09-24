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

# TR-069 berjalan di layanan terpisah dari billing/RADIUS. Setelah listrik padam,
# NBI bisa tetap menyajikan daftar lama sementara CWMP berhenti menerima Inform.
# Hanya start layanan yang benar-benar terpasang dan tidak aktif; jangan restart
# layanan yang aktif karena sedang melayani modem pelanggan.
for svc in mongod mongodb acs-alias-ip genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui; do
  if [ "$svc" = "acs-alias-ip" ] && ! systemctl list-unit-files 'genieacs-cwmp.service' 2>/dev/null | grep -q '^genieacs-cwmp.service'; then
    continue
  fi
  if systemctl list-unit-files "${svc}.service" 2>/dev/null | grep -q "^${svc}.service" && \
      ! systemctl is-active --quiet "$svc"; then
    echo "$svc mati; mencoba start untuk pemulihan TR-069."
    systemctl start "$svc" >/dev/null 2>&1 || echo "$svc gagal start; periksa: journalctl -u $svc"
  fi
done
if systemctl is-active --quiet genieacs-cwmp && command -v ip >/dev/null 2>&1 && \
   ! ip -o -4 addr show 2>/dev/null | grep -q '192\.168\.23\.5/'; then
  echo "PERINGATAN: IP ACS 192.168.23.5 tidak terpasang di server; periksa routing/alias sebelum mengubah konfigurasi."
fi
if systemctl is-active --quiet genieacs-cwmp && \
   ! ss -ltn 2>/dev/null | grep -qE ':7547[[:space:]]'; then
  echo "PERINGATAN: genieacs-cwmp aktif tetapi port 7547 tidak listen; periksa konfigurasi port CWMP."
fi
if systemctl is-active --quiet genieacs-nbi && \
   ! ss -ltn 2>/dev/null | grep -qE ':7557[[:space:]]'; then
  echo "PERINGATAN: genieacs-nbi aktif tetapi port 7557 tidak listen; periksa konfigurasi NBI."
fi

if [ "$NEED_RECOVERY" -eq 1 ]; then
  echo "Masalah RADIUS terdeteksi; menjalankan pemulihan penuh."
  exec /bin/bash "$APP_DIR/deploy/fix-setelah-mati-lampu.sh"
fi

echo "Pemeriksaan selesai; layanan yang aktif tidak di-restart."
