#!/usr/bin/env bash
# =============================================================
#  Perbaiki "RADIUS server is not responding" / "accounting
#  request not sent: no response" padahal voucher belum expired.
#
#  Jalankan:  sudo bash deploy/fix-radius-lambat.sh
#
#  Penyebab paling sering: FreeRADIUS KEHABISAN TENAGA, bukan
#  voucher expired. Saat banyak user login/accounting bersamaan,
#  antrian penuh atau query ke MySQL lambat, sehingga sebagian
#  permintaan tidak terjawab dalam batas waktu MikroTik (3 detik).
#  Script ini menambah kapasitas thread, memperbesar pool koneksi
#  MySQL, mematikan log detail yang boros disk, dan memangkas
#  riwayat accounting/post-auth yang sudah menumpuk.
# =============================================================
set -euo pipefail

DB_NAME="${DB_NAME:-radius}"
RAD="/etc/freeradius/3.0"
[ -d "$RAD" ] || RAD="/etc/freeradius"
[ -d "$RAD" ] || { echo "FreeRADIUS tidak terpasang di server ini."; exit 1; }

set_val() { # file, key, value  (dalam blok apa pun, indentasi dipertahankan)
  local f="$1" k="$2" v="$3"
  [ -f "$f" ] || return 0
  if grep -qE "^[[:space:]]*#?[[:space:]]*${k}[[:space:]]*=" "$f"; then
    sed -i -E "s|^([[:space:]]*)#?[[:space:]]*${k}[[:space:]]*=.*|\1${k} = ${v}|" "$f"
  fi
}

echo "==> 1/6 Menambah kapasitas antrian & thread FreeRADIUS"
MAIN="$RAD/radiusd.conf"
cp -n "$MAIN" "$MAIN.bak-lambat" 2>/dev/null || true
set_val "$MAIN" "max_requests" "16384"
set_val "$MAIN" "cleanup_delay" "2"
set_val "$MAIN" "start_servers" "16"
set_val "$MAIN" "max_servers" "128"
set_val "$MAIN" "min_spare_servers" "8"
set_val "$MAIN" "max_spare_servers" "32"
set_val "$MAIN" "max_queue_size" "65536"

echo "==> 2/6 Memperbesar pool koneksi MySQL untuk modul sql"
SQLMOD="$RAD/mods-available/sql"
if [ -f "$SQLMOD" ]; then
  cp -n "$SQLMOD" "$SQLMOD.bak-lambat" 2>/dev/null || true
  set_val "$SQLMOD" "start" "10"
  set_val "$SQLMOD" "min" "10"
  set_val "$SQLMOD" "max" "64"
  set_val "$SQLMOD" "spare" "10"
  set_val "$SQLMOD" "connect_timeout" "3.0"
fi

echo "==> 3/6 Mematikan log detail (paling sering bikin lambat)"
for S in "$RAD/sites-enabled/default" "$RAD/sites-enabled/inner-tunnel"; do
  [ -f "$S" ] || continue
  cp -n "$S" "$S.bak-lambat" 2>/dev/null || true
  # nonaktifkan "detail" & "auth_log"/"reply_log" yang menulis ke disk tiap paket
  sed -i -E 's|^([[:space:]]*)(detail|auth_log|reply_log)[[:space:]]*$|\1# \2|' "$S" || true
done

echo "==> 4/6 Memangkas riwayat accounting & post-auth"
mysql "$DB_NAME" <<'SQL' >/dev/null 2>&1 || true
DELETE FROM radacct WHERE acctstoptime IS NOT NULL AND acctstoptime < NOW() - INTERVAL 60 DAY;
UPDATE radacct SET acctstoptime = acctupdatetime, acctterminatecause = 'Stale-Session'
 WHERE acctstoptime IS NULL AND acctupdatetime < NOW() - INTERVAL 30 MINUTE;
DELETE FROM radpostauth WHERE authdate < NOW() - INTERVAL 14 DAY;
SQL
mysqlcheck --auto-repair --optimize "$DB_NAME" radacct radpostauth >/dev/null 2>&1 || true

echo "==> 5/6 Menaikkan batas koneksi MySQL"
MYCNF="/etc/mysql/mysql.conf.d/mysqld.cnf"
[ -f "$MYCNF" ] || MYCNF="/etc/mysql/mariadb.conf.d/50-server.cnf"
if [ -f "$MYCNF" ]; then
  cp -n "$MYCNF" "$MYCNF.bak-lambat" 2>/dev/null || true
  grep -q '^max_connections' "$MYCNF" \
    && sed -i -E 's|^max_connections.*|max_connections = 500|' "$MYCNF" \
    || sed -i '0,/^\[mysqld\]/s//[mysqld]\nmax_connections = 500/' "$MYCNF"
  systemctl restart mysql 2>/dev/null || systemctl restart mariadb 2>/dev/null || true
fi

echo "==> 6/6 Uji konfigurasi lalu restart FreeRADIUS"
if ! freeradius -CX >/tmp/rad-check.log 2>&1 && ! radiusd -CX >/tmp/rad-check.log 2>&1; then
  echo "!! Konfigurasi bermasalah, 25 baris terakhir:"
  tail -n 25 /tmp/rad-check.log
  echo "Perubahan tersimpan sebagai *.bak-lambat bila ingin dikembalikan."
  exit 1
fi
systemctl restart freeradius 2>/dev/null || systemctl restart radiusd 2>/dev/null || true
sleep 3
ss -lunp 2>/dev/null | grep -E '1812|1813' || echo "!! Port 1812/1813 belum terdeteksi"

cat <<'EOF'

Selesai. Tambahan di MikroTik (sangat membantu):
  /radius set [find] timeout=5s
  /ip hotspot profile set [find] radius-interim-update=10m

Kalau log "no response" masih muncul saat jam sibuk, biasanya jaringan
antara MikroTik dan server (VPN/tunnel) yang delay, bukan voucher.
EOF
