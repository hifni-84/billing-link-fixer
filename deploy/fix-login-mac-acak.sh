#!/usr/bin/env bash
# =============================================================
#  Perbaikan: user gagal login lagi setelah pindah SSID / MAC acak
#  Penyebab: sesi lama tidak pernah ditutup (tidak ada Accounting-Stop),
#  sehingga Simultaneous-Use menolak login berikutnya.
#
#  Jalankan: sudo bash deploy/fix-login-mac-acak.sh
# =============================================================
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/mikrotik-billing}"
FR_DIR="/etc/freeradius/3.0"
[ -d "$FR_DIR" ] || FR_DIR="/etc/freeradius"

if [[ $EUID -ne 0 ]]; then
  echo "Jalankan dengan sudo: sudo bash $0" >&2
  exit 1
fi

# ---- kredensial DB dari .env panel ----
ENV_FILE="$APP_DIR/.env"
DB_HOST="127.0.0.1"; DB_PORT="3306"; DB_USER="radius"; DB_NAME="radius"; DB_PASS=""
if [[ -f "$ENV_FILE" ]]; then
  get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'\''' | tr -d '\r'; }
  DB_HOST="$(get RADIUS_DB_HOST)"; DB_HOST="${DB_HOST:-127.0.0.1}"
  DB_PORT="$(get RADIUS_DB_PORT)"; DB_PORT="${DB_PORT:-3306}"
  DB_USER="$(get RADIUS_DB_USER)"; DB_USER="${DB_USER:-radius}"
  DB_NAME="$(get RADIUS_DB_NAME)"; DB_NAME="${DB_NAME:-radius}"
  DB_PASS="$(get RADIUS_DB_PASSWORD)"
fi

echo "==> 1/4 Menutup sesi hantu yang masih terbuka sekarang"
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" ${DB_PASS:+-p"$DB_PASS"} "$DB_NAME" <<'SQL' || \
  echo "    !! gagal koneksi database, lewati"
UPDATE radacct
   SET acctstoptime = COALESCE(acctupdatetime, acctstarttime),
       acctterminatecause = 'Stale-Session'
 WHERE acctstoptime IS NULL
   AND COALESCE(acctupdatetime, acctstarttime) < NOW() - INTERVAL 15 MINUTE;
SQL

echo "==> 2/4 Mengaktifkan delete_stale_sessions di modul SQL FreeRADIUS"
for F in "$FR_DIR/mods-enabled/sql" "$FR_DIR/mods-available/sql"; do
  [[ -f "$F" ]] || continue
  cp -a "$F" "$F.bak-stale-$(date +%s)"
  if grep -q "delete_stale_sessions" "$F"; then
    sed -i 's/^\(\s*\)#\?\s*delete_stale_sessions.*/\1delete_stale_sessions = yes/' "$F"
  else
    sed -i '0,/^sql {/s//sql {\n\tdelete_stale_sessions = yes/' "$F"
  fi
done

echo "==> 3/4 Memasang pembersih otomatis tiap 5 menit (cron)"
CLEAN="/usr/local/bin/radius-clean-stale.sh"
cat >"$CLEAN" <<EOF
#!/usr/bin/env bash
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" ${DB_PASS:+-p"$DB_PASS"} "$DB_NAME" -e "
UPDATE radacct
   SET acctstoptime = COALESCE(acctupdatetime, acctstarttime),
       acctterminatecause = 'Stale-Session'
 WHERE acctstoptime IS NULL
   AND COALESCE(acctupdatetime, acctstarttime) < NOW() - INTERVAL 15 MINUTE;" >/dev/null 2>&1
EOF
chmod 700 "$CLEAN"
CRON="/etc/cron.d/radius-clean-stale"
echo "*/5 * * * * root $CLEAN" >"$CRON"
chmod 644 "$CRON"

echo "==> 4/4 Restart FreeRADIUS"
if freeradius -CX >/dev/null 2>&1; then
  systemctl restart freeradius && echo "    FreeRADIUS aktif"
else
  echo "    CONFIG ERROR:" >&2
  freeradius -CX 2>&1 | grep -iE "error|failed" | head -20 >&2
fi

cat <<'INFO'

=====================================================================
 Selesai. Sesi hantu dibersihkan otomatis tiap 5 menit.

 Saran tambahan di MikroTik (agar MAC acak tidak mengunci voucher):
   /ip hotspot profile set [find] login-by=http-chap,http-pap
   /ip hotspot user profile set [find] shared-users=5 mac-cookie-timeout=0
   /ip hotspot set [find] keepalive-timeout=2m idle-timeout=5m
 Interim update wajib aktif supaya sesi terdeteksi hidup:
   /ppp aaa set interim-update=1m
=====================================================================
INFO
