#!/usr/bin/env bash
# =============================================================
#  Diagnosa "RADIUS accounting request not sent: no response"
#  padahal login (auth) berhasil.
#
#  Jalankan:  sudo bash deploy/cek-radius-accounting.sh
#
#  Kalau login sukses tapi accounting tidak dijawab, artinya
#  port AUTH (1812) jalan sementara port ACCOUNTING (1813)
#  tidak didengarkan / diblokir / ditolak karena NAS-secret.
#  Script ini hanya MEMERIKSA dan melaporkan, tidak mengubah apa pun.
# =============================================================
set -uo pipefail

DB_NAME="${DB_NAME:-radius}"
RAD="/etc/freeradius/3.0"
[ -d "$RAD" ] || RAD="/etc/freeradius"

line() { printf '%s\n' "------------------------------------------------------------"; }

line; echo "1. Status layanan FreeRADIUS"
systemctl is-active freeradius 2>/dev/null || systemctl is-active radiusd 2>/dev/null || echo "TIDAK AKTIF"
systemctl show -p NRestarts freeradius 2>/dev/null || true

line; echo "2. Port yang didengarkan (harus ada 1812 DAN 1813)"
ss -lunp 2>/dev/null | grep -E '1812|1813|3799' || echo "TIDAK ADA port RADIUS yang listen"

line; echo "3. Alamat listen di konfigurasi"
grep -n -A6 -E '^\s*listen\s*\{' "$RAD/sites-enabled/default" 2>/dev/null |
  grep -E 'type|ipaddr|ipv4addr|port' || echo "blok listen tidak terbaca"

line; echo "4. Daftar NAS/client yang dikenal"
grep -h -E '^\s*(client|ipaddr|secret)' "$RAD/clients.conf" 2>/dev/null | sed 's/secret.*/secret = ***/' || true
mysql -N -B "$DB_NAME" -e "SELECT nasname, shortname FROM nas" 2>/dev/null || true

line; echo "5. Uji kirim paket accounting ke diri sendiri (butuh secret NAS)"
SECRET="${1:-}"
if [ -z "$SECRET" ]; then
  echo "   lewati — jalankan ulang dengan: sudo bash deploy/cek-radius-accounting.sh SECRET_NAS"
else
  printf 'User-Name = "uji-accounting"\nAcct-Status-Type = Start\nAcct-Session-Id = "uji123"\nNAS-IP-Address = 127.0.0.1\n' |
    radclient -x 127.0.0.1:1813 acct "$SECRET" 2>&1 | tail -n 15
fi

line; echo "6. Penolakan paket terakhir di log FreeRADIUS"
journalctl -u freeradius -n 200 --no-pager 2>/dev/null |
  grep -iE 'ignoring|unknown client|shared secret|dropping|threads|no space|Discarding' | tail -n 15 ||
  echo "tidak ada catatan penolakan"

line; echo "7. Sesi accounting menggantung di database"
mysql -N -B "$DB_NAME" -e \
  "SELECT CONCAT('terbuka: ', COUNT(*)) FROM radacct WHERE acctstoptime IS NULL" 2>/dev/null || true

line; echo "8. Beban server"
uptime
df -h / | tail -n1

line
cat <<'EOF'
CARA BACA:
- Nomor 2 tidak menampilkan 1813  -> FreeRADIUS tidak melayani accounting.
- Nomor 5 balasan "Access-Accept/Accounting-Response" -> server sehat, jadi
  masalahnya di jalur jaringan MikroTik ke server (VPN/tunnel delay atau
  IP RADIUS di MikroTik salah).
- Nomor 6 muncul "Ignoring request ... unknown client" -> IP MikroTik belum
  terdaftar sebagai NAS.
- Nomor 6 muncul "shared secret" -> secret di MikroTik beda dengan server.
EOF
