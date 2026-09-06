#!/usr/bin/env bash
# =============================================================
#  Perbaikan: user gagal login lagi setelah pindah SSID / MAC acak
#  Penyebab: sesi lama tidak pernah ditutup (tidak ada Accounting-Stop),
#  sehingga Simultaneous-Use menolak login berikutnya.
#
#  Jalankan: sudo bash deploy/fix-login-mac-acak.sh
# =============================================================
set -uo pipefail

FR_DIR="/etc/freeradius/3.0"
[ -d "$FR_DIR" ] || FR_DIR="/etc/freeradius"

if [[ $EUID -ne 0 ]]; then
  echo "Jalankan dengan sudo: sudo bash $0" >&2
  exit 1
fi

# ---- cari folder aplikasi ----
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-}"
if [[ -z "$APP_DIR" ]]; then
  for D in "$SELF_DIR" /opt/mikrotik-billing /opt/najwa-billing /root/najwa-billing "$HOME/najwa-billing"; do
    [[ -f "$D/.env" ]] && APP_DIR="$D" && break
  done
fi
APP_DIR="${APP_DIR:-$SELF_DIR}"

DB_HOST="127.0.0.1"; DB_PORT="3306"; DB_USER="radius"; DB_NAME="radius"; DB_PASS=""

get_from() { grep -hE "(^|Environment=)$2=" "$1" 2>/dev/null | tail -1 | sed "s/.*$2=//" | tr -d '"'"'"'' | tr -d '\r'; }

read_creds() {
  local F="$1"
  [[ -f "$F" ]] || return 1
  local v
  v="$(get_from "$F" RADIUS_DB_HOST)";     [[ -n "$v" ]] && DB_HOST="$v"
  v="$(get_from "$F" RADIUS_DB_PORT)";     [[ -n "$v" ]] && DB_PORT="$v"
  v="$(get_from "$F" RADIUS_DB_USER)";     [[ -n "$v" ]] && DB_USER="$v"
  v="$(get_from "$F" RADIUS_DB_NAME)";     [[ -n "$v" ]] && DB_NAME="$v"
  v="$(get_from "$F" RADIUS_DB_PASSWORD)"; [[ -n "$v" ]] && DB_PASS="$v"
  [[ -n "$DB_PASS" ]]
}

read_creds "$APP_DIR/.env" \
  || read_creds /etc/systemd/system/mikrotik-billing.service.d/radius.conf \
  || true

# Cadangan terakhir: ambil password langsung dari konfigurasi FreeRADIUS.
if [[ -z "$DB_PASS" ]]; then
  for F in "$FR_DIR/mods-enabled/sql" "$FR_DIR/mods-available/sql"; do
    [[ -f "$F" ]] || continue
    P="$(grep -E '^\s*password\s*=' "$F" | tail -1 | cut -d= -f2- | tr -d ' "' | tr -d '\r')"
    U="$(grep -E '^\s*login\s*=' "$F" | tail -1 | cut -d= -f2- | tr -d ' "' | tr -d '\r')"
    [[ -n "${P:-}" ]] && DB_PASS="$P" && [[ -n "${U:-}" ]] && DB_USER="$U"
    [[ -n "$DB_PASS" ]] && break
  done
fi

echo "==> 1/4 Menutup sesi hantu yang masih terbuka sekarang"
SQL_STALE="UPDATE radacct
   SET acctstoptime = COALESCE(acctupdatetime, acctstarttime),
       acctterminatecause = 'Stale-Session'
 WHERE acctstoptime IS NULL
   AND COALESCE(acctupdatetime, acctstarttime) < NOW() - INTERVAL 15 MINUTE;"

if mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" ${DB_PASS:+-p"$DB_PASS"} "$DB_NAME" -e "$SQL_STALE" 2>/tmp/mysql-stale.err; then
  echo "    OK"
elif mysql "$DB_NAME" -e "$SQL_STALE" 2>>/tmp/mysql-stale.err; then
  echo "    OK (memakai akses root lokal)"
  DB_PASS=""; DB_USER="root"; DB_HOST="localhost"
else
  echo "    !! gagal koneksi database:"
  tail -2 /tmp/mysql-stale.err | sed 's/^/       /'
  echo "       Jalankan: sudo bash deploy/fix-radius-db.sh  lalu ulangi script ini."
fi

echo "==> 2/4 Mengaktifkan delete_stale_sessions di modul SQL FreeRADIUS"
# Cek dulu apakah konfigurasi sudah bermasalah SEBELUM disunting.
BASE_OK=0
freeradius -CX >/tmp/fr-check-before.log 2>&1 && BASE_OK=1
[[ $BASE_OK -eq 0 ]] && echo "    (catatan: konfigurasi FreeRADIUS sudah error sebelum diubah)"

# Hanya sunting file efektif (mods-enabled). Jika itu symlink, sunting targetnya
# agar konfigurasi tidak terduplikasi dan tidak merusak struktur blok sql { }.
TARGET="$FR_DIR/mods-enabled/sql"
[[ -L "$TARGET" ]] && TARGET="$(readlink -f "$TARGET")"
if [[ -f "$TARGET" ]]; then
  BAK="$TARGET.bak-stale-$(date +%s)"
  cp -a "$TARGET" "$BAK"
  if grep -qE '^\s*delete_stale_sessions' "$TARGET"; then
    sed -i 's/^\(\s*\)delete_stale_sessions.*/\1delete_stale_sessions = yes/' "$TARGET"
  elif grep -qE '^\s*#\s*delete_stale_sessions' "$TARGET"; then
    sed -i 's/^\(\s*\)#\s*delete_stale_sessions.*/\1delete_stale_sessions = yes/' "$TARGET"
  else
    sed -i '0,/^\s*sql\s*{/s//&\n\tdelete_stale_sessions = yes/' "$TARGET"
  fi
  if [[ $BASE_OK -eq 1 ]] && ! freeradius -CX >/dev/null 2>&1; then
    echo "    !! perubahan membuat konfigurasi error, mengembalikan file semula"
    cp -a "$BAK" "$TARGET"
  else
    echo "    OK"
  fi
else
  echo "    !! modul sql FreeRADIUS tidak ditemukan, lewati"
fi


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
  echo "    Perbaiki dengan: sudo bash deploy/setup-freeradius-sql.sh" >&2
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
