#!/usr/bin/env bash
# ============================================================
#  Pakai secret dari panel Billing (tabel `nas`) untuk RADIUS
#  - membuang client catch-all (0.0.0.0/0) yang memaksa satu secret
#  - mengaktifkan read_clients = yes + client_table = nas
#  - restart FreeRADIUS
#
#  Pemakaian:  sudo bash deploy/pakai-secret-billing.sh
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mikrotik-billing}"
FR_DIR="/etc/freeradius/3.0"
[ -d "$FR_DIR" ] || FR_DIR="/etc/freeradius"

if [[ $EUID -ne 0 ]]; then
  echo "Jalankan dengan sudo: sudo bash $0" >&2
  exit 1
fi

# ---- kredensial DB dari .env panel ----
ENV_FILE="$APP_DIR/.env"
DB_USER="radius"; DB_NAME="radius"; DB_PASS=""; DB_HOST="127.0.0.1"
if [[ -f "$ENV_FILE" ]]; then
  get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"'' | tr -d '\r'; }
  DB_HOST="$(get RADIUS_DB_HOST || true)"; DB_HOST="${DB_HOST:-127.0.0.1}"
  DB_USER="$(get RADIUS_DB_USER || true)"; DB_USER="${DB_USER:-radius}"
  DB_NAME="$(get RADIUS_DB_NAME || true)"; DB_NAME="${DB_NAME:-radius}"
  DB_PASS="$(get RADIUS_DB_PASSWORD || true)"
fi
MY=(mysql -h "$DB_HOST" -u "$DB_USER")
[[ -n "$DB_PASS" ]] && MY+=("-p$DB_PASS")

echo "==> Membuang client catch-all (0.0.0.0/0) dari konfigurasi FreeRADIUS"
rm -f "$FR_DIR/clients.d-mikrotik.conf"
sed -i '/clients.d-mikrotik.conf/d' "$FR_DIR/radiusd.conf" 2>/dev/null || true

if [[ -f "$FR_DIR/clients.conf" ]]; then
  cp -a "$FR_DIR/clients.conf" "$FR_DIR/clients.conf.bak.$(date +%Y%m%d%H%M%S)"
  python3 - "$FR_DIR/clients.conf" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
drops = []
for m in re.finditer(r'(?m)^\s*client\s+([^\s{]+)\s*\{', s):
    name = m.group(1); start = m.start(); depth = 0; j = m.end()-1
    while j < len(s):
        if s[j] == '{': depth += 1
        elif s[j] == '}':
            depth -= 1
            if depth == 0: break
        j += 1
    block = s[start:j+1]
    if '0.0.0.0/0' in block or name in ('najwa', 'mikrotik-all', 'mikrotik'):
        drops.append((start, j+1))
for a, b in reversed(drops):
    s = s[:a] + s[b:]
open(p, 'w').write(s)
PY
fi

echo "==> Mengaktifkan pembacaan daftar NAS dari database panel"
SQLCONF="$FR_DIR/mods-enabled/sql"
[[ -f "$SQLCONF" ]] || SQLCONF="$FR_DIR/mods-available/sql"
if grep -qE '^\s*#?\s*read_clients' "$SQLCONF"; then
  sed -i 's/^\([[:space:]]*\)#\?[[:space:]]*read_clients[[:space:]]*=.*/\1read_clients = yes/' "$SQLCONF"
else
  sed -i '0,/radius_db/s//&\n\tread_clients = yes/' "$SQLCONF"
fi
grep -qE '^\s*client_table' "$SQLCONF" || sed -i '0,/read_clients = yes/s//&\n\tclient_table = "nas"/' "$SQLCONF"

echo "==> Membersihkan entri catch-all di tabel nas"
"${MY[@]}" "$DB_NAME" -e "DELETE FROM nas WHERE nasname IN ('0.0.0.0/0','0.0.0.0')" 2>/dev/null || true

echo "==> Daftar NAS yang dipakai (dari panel Billing):"
"${MY[@]}" -B "$DB_NAME" -e "SELECT id, nasname, shortname, secret FROM nas ORDER BY nasname" 2>/dev/null || true

echo "==> Memeriksa konfigurasi"
if freeradius -CX >/dev/null 2>&1; then
  echo "    CONFIG OK"
else
  echo "    CONFIG ERROR — detail:" >&2
  freeradius -CX 2>&1 | grep -iE "error|failed" | head -20 >&2
  exit 1
fi

systemctl restart freeradius
sleep 1
systemctl is-active --quiet freeradius && echo "    FreeRADIUS aktif" || {
  echo "!! Gagal start, cek: journalctl -u freeradius -n 30" >&2; exit 1; }

cat << 'EOF'

=============================================
 Selesai! Sekarang secret diambil dari panel.

 Cara pakai:
  1. Panel Billing > menu RADIUS > NAS (MikroTik)
     - IP / Host Router : IP router (mis. 192.168.23.1)
     - Secret           : bebas, mis. faqih123
     - Simpan
  2. Setiap kali menambah / mengubah NAS, jalankan:
       sudo systemctl restart freeradius
  3. Di MikroTik pakai secret yang sama dengan baris NAS-nya.
=============================================
EOF
