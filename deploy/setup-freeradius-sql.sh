#!/usr/bin/env bash
# ============================================================
# Setup otomatis FreeRADIUS + MySQL untuk Billing RADIUS
# Menjalankan semua langkah manual sekaligus:
#   1. Tambah client MikroTik (secret)
#   2. Buka firewall UDP 1812/1813
#   3. Aktifkan modul SQL (MySQL, database radius)
#   4. Set sql_user_name & group_attribute
#   5. Aktifkan sql di sites-enabled + restart FreeRADIUS
#
# Pemakaian:
#   sudo bash deploy/setup-freeradius-sql.sh [SECRET]
# Contoh:
#   sudo bash deploy/setup-freeradius-sql.sh najwa123
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mikrotik-billing}"
SECRET="${1:-najwa123}"
FR_DIR="/etc/freeradius/3.0"

if [[ $EUID -ne 0 ]]; then
  echo "Jalankan dengan sudo: sudo bash $0 $SECRET" >&2
  exit 1
fi

if [[ ! -d "$FR_DIR" ]]; then
  echo "==> FreeRADIUS belum terpasang, memasang sekarang"
  apt-get update -y
  apt-get install -y freeradius freeradius-mysql freeradius-utils
fi

echo "==> Memastikan driver MySQL FreeRADIUS terpasang"
apt-get install -y freeradius-mysql >/dev/null

# ---- Ambil kredensial DB dari .env panel ----
ENV_FILE="$APP_DIR/.env"
DB_HOST="127.0.0.1"; DB_PORT="3306"; DB_USER="radius"; DB_NAME="radius"; DB_PASS=""
if [[ -f "$ENV_FILE" ]]; then
  get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"'' | tr -d '\r'; }
  DB_HOST="$(get RADIUS_DB_HOST || true)"; DB_HOST="${DB_HOST:-127.0.0.1}"
  DB_PORT="$(get RADIUS_DB_PORT || true)"; DB_PORT="${DB_PORT:-3306}"
  DB_USER="$(get RADIUS_DB_USER || true)"; DB_USER="${DB_USER:-radius}"
  DB_NAME="$(get RADIUS_DB_NAME || true)"; DB_NAME="${DB_NAME:-radius}"
  DB_PASS="$(get RADIUS_DB_PASSWORD || true)"
else
  echo "!! $ENV_FILE tidak ditemukan — memakai default user radius tanpa password" >&2
fi

# ---- 1. Client MikroTik ----
echo "==> Menambahkan client MikroTik (secret: $SECRET)"
cat > "$FR_DIR/clients.d-mikrotik.conf" << EOF
client mikrotik-all {
    ipaddr = 0.0.0.0/0
    secret = $SECRET
    require_message_authenticator = no
    nas_type = other
}
EOF
sed -i '/clients.d-mikrotik.conf/d' "$FR_DIR/radiusd.conf"
echo '$INCLUDE clients.d-mikrotik.conf' >> "$FR_DIR/radiusd.conf"

# ---- 2. Firewall ----
echo "==> Membuka firewall UDP 1812/1813"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 1812/udp >/dev/null 2>&1 || true
  ufw allow 1813/udp >/dev/null 2>&1 || true
fi

# ---- 3 & 4. Modul SQL ----
echo "==> Menulis konfigurasi modul SQL (MySQL / db $DB_NAME)"
cat > "$FR_DIR/mods-enabled/sql" << EOF
sql {
    dialect = "mysql"
    driver = "rlm_sql_mysql"
    server = "$DB_HOST"
    port = $DB_PORT
    login = "$DB_USER"
    password = "$DB_PASS"
    radius_db = "$DB_NAME"

    sql_user_name = "%{%{Stripped-User-Name}:-%{User-Name}}"
    group_attribute = "SQL-Group"

    read_clients = yes
    client_table = "nas"

    acct_table1 = "radacct"
    acct_table2 = "radacct"
    postauth_table = "radpostauth"
    authcheck_table = "radcheck"
    authreply_table = "radreply"
    groupcheck_table = "radgroupcheck"
    groupreply_table = "radgroupreply"
    usergroup_table = "radusergroup"
    delete_stale_sessions = yes

    pool {
        start = \${thread[pool].start_servers}
        min = \${thread[pool].min_spare_servers}
        max = \${thread[pool].max_servers}
        spare = \${thread[pool].max_spare_servers}
        uses = 0
        retry_delay = 30
        lifetime = 0
        idle_timeout = 60
    }

    \$INCLUDE \${modconfdir}/\${.:name}/main/\${dialect}/queries.conf
}
EOF
chown root:freerad "$FR_DIR/mods-enabled/sql" 2>/dev/null || true
chmod 640 "$FR_DIR/mods-enabled/sql" 2>/dev/null || true

# ---- 5. Aktifkan sql di sites-enabled ----
echo "==> Mengaktifkan sql di sites-enabled"
for SITE in "$FR_DIR/sites-enabled/default" "$FR_DIR/sites-enabled/inner-tunnel"; do
  [[ -f "$SITE" ]] || continue
  sed -i 's/^\(\s*\)-sql$/\1sql/; s/^\(\s*\)#\s*sql$/\1sql/' "$SITE"
done

echo "==> Memeriksa konfigurasi"
if freeradius -CX >/dev/null 2>&1; then
  echo "    CONFIG OK"
else
  echo "    CONFIG ERROR — detail:" >&2
  freeradius -CX 2>&1 | grep -iE "error|failed" | head -20 >&2
  exit 1
fi

systemctl enable freeradius >/dev/null 2>&1 || true
systemctl restart freeradius
sleep 1
systemctl is-active --quiet freeradius && echo "    FreeRADIUS aktif" || {
  echo "!! FreeRADIUS gagal start, cek: journalctl -u freeradius -n 30" >&2; exit 1; }

cat << EOF

=============================================
 Selesai! FreeRADIUS siap dipakai.

 Setting di MikroTik (WinBox > RADIUS):
   Address  : IP server billing
   Secret   : $SECRET
   Auth Port: 1812
   Acct Port: 1813
   Service  : hotspot, ppp

 Debug bila perlu: sudo freeradius -X
=============================================
EOF
