#!/usr/bin/env bash
# =============================================================
#  Perbaiki "RADIUS accounting request not sent: no response"
#  Jalankan:  sudo bash deploy/fix-radius-accounting.sh
#
#  Penyebab umum: paket accounting (UDP 1813) tidak dijawab
#  karena FreeRADIUS hanya mendengarkan 127.0.0.1, port 1813
#  diblokir firewall, atau tabel radacct lambat/rusak.
# =============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="${DB_NAME:-radius}"
RAD="/etc/freeradius/3.0"
[ -d "$RAD" ] || RAD="/etc/freeradius"

echo "==> 1/5 Memastikan FreeRADIUS mendengarkan di semua interface"
sed -i 's/^\(\s*\)ipaddr = 127\.0\.0\.1/\1ipaddr = */; s/^\(\s*\)ipv4addr = 127\.0\.0\.1/\1ipv4addr = */' \
  "$RAD/sites-enabled/default" || true

echo "==> 2/5 Membuka firewall UDP 1812/1813/3799"
if command -v ufw >/dev/null 2>&1; then
  for P in 1812 1813 3799; do ufw allow "$P"/udp >/dev/null 2>&1 || true; done
fi
iptables -C INPUT -p udp --dport 1812:1813 -j ACCEPT 2>/dev/null || \
  iptables -I INPUT -p udp --dport 1812:1813 -j ACCEPT || true
iptables -C INPUT -p udp --dport 3799 -j ACCEPT 2>/dev/null || \
  iptables -I INPUT -p udp --dport 3799 -j ACCEPT || true

echo "==> 3/5 Merapikan tabel accounting (radacct)"
mysqlcheck --auto-repair --optimize "$DB_NAME" radacct >/dev/null 2>&1 || true
mysql "$DB_NAME" <<'SQL' >/dev/null 2>&1 || true
CREATE INDEX idx_acct_open ON radacct (username, acctstoptime);
SQL
GHOST="$(mysql -N -B "$DB_NAME" -e \
  "SELECT COUNT(*) FROM radacct WHERE acctstoptime IS NULL AND acctupdatetime < NOW() - INTERVAL 30 MINUTE" \
  2>/dev/null || echo 0)"
echo "    sesi menggantung: ${GHOST:-0}"
mysql "$DB_NAME" <<'SQL' >/dev/null 2>&1 || true
UPDATE radacct
   SET acctstoptime = COALESCE(acctupdatetime, acctstarttime),
       acctterminatecause = 'Clean-Up'
 WHERE acctstoptime IS NULL
   AND COALESCE(acctupdatetime, acctstarttime) < NOW() - INTERVAL 30 MINUTE;
SQL

echo "==> 4/5 Menguji konfigurasi lalu restart FreeRADIUS"
if ! freeradius -CX >/dev/null 2>&1; then
  echo "    KONFIGURASI ERROR:" >&2
  freeradius -CX 2>&1 | grep -iE "error|denied|failed" | head -20 >&2
  bash "$APP_DIR/deploy/fix-radius-db.sh" || true
fi
systemctl restart freeradius
sleep 2

echo "==> 5/5 Port yang mendengarkan"
ss -lunp | grep -E '1812|1813|3799' || echo "    (tidak ada! jalankan: sudo freeradius -X)"

cat <<INFO

=====================================================================
 Selesai. Di MikroTik pastikan timeout tidak terlalu pendek:
   /radius set [find] timeout=5s accounting-backup=no
   /ip hotspot profile set [find] use-radius=yes
   /ppp aaa set use-radius=yes accounting=yes

 Catatan: pesan "accounting request not sent: no response" hanya
 soal pencatatan sesi, user tetap bisa online. Setelah script ini
 pencatatan sesi (durasi & pemakaian data) kembali normal.
=====================================================================
INFO
