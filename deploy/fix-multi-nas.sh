#!/usr/bin/env bash
# =============================================================
#  Perbaiki agar BANYAK NAS (2, 3, dst) bisa aktif bersamaan.
#  Penyebab umum: ada client "catch-all" (0.0.0.0/0) di
#  clients.conf sehingga semua NAS dipaksa memakai satu secret.
#  Jalankan: sudo bash deploy/fix-multi-nas.sh
# =============================================================
set -euo pipefail

DB_NAME="${DB_NAME:-radius}"
RAD="/etc/freeradius/3.0"
[ -d "$RAD" ] || RAD="/etc/freeradius"
CLIENTS="$RAD/clients.conf"
SQLCONF="$RAD/mods-available/sql"

echo "==> Membuang client catch-all dari clients.conf"
if [ -f "$CLIENTS" ]; then
  cp -a "$CLIENTS" "$CLIENTS.bak.$(date +%Y%m%d%H%M%S)"
  # hapus blok client najwa {...} dan blok apapun yang memakai 0.0.0.0/0
  python3 - "$CLIENTS" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
def drop(s):
    out, i = [], 0
    for m in re.finditer(r'(?m)^\s*client\s+([^\s{]+)\s*\{', s):
        start = m.start(); depth = 0; j = m.end()-1
        while j < len(s):
            if s[j] == '{': depth += 1
            elif s[j] == '}':
                depth -= 1
                if depth == 0: break
            j += 1
        block = s[start:j+1]
        if '0.0.0.0/0' in block or m.group(1) == 'najwa':
            out.append((start, j+1))
    for a, b in reversed(out):
        s = s[:a] + s[b:]
    return s
open(p, 'w').write(drop(s))
PY
fi

echo "==> Memastikan FreeRADIUS membaca daftar NAS dari database"
sed -i 's/^\([[:space:]]*\)#\?[[:space:]]*read_clients[[:space:]]*=.*/\1read_clients = yes/' "$SQLCONF"
grep -q 'read_clients = yes' "$SQLCONF" || echo "	read_clients = yes" >> "$SQLCONF"

echo "==> Daftar NAS di database:"
mysql -B "$DB_NAME" -e "SELECT id, nasname, shortname, secret FROM nas ORDER BY nasname" || true

echo "==> Memeriksa nasname duplikat / catch-all di database"
mysql "$DB_NAME" -e "DELETE FROM nas WHERE nasname IN ('0.0.0.0/0','0.0.0.0')" || true

echo "==> Memeriksa konfigurasi & restart FreeRADIUS"
freeradius -XC >/dev/null
systemctl restart freeradius
systemctl enable freeradius >/dev/null 2>&1 || true

echo "    OK - setiap NAS sekarang dipakai dengan secret-nya sendiri."
echo "    Pastikan tiap MikroTik memakai secret sesuai barisnya di menu RADIUS."
