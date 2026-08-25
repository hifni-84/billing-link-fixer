#!/usr/bin/env bash
# =============================================================
#  BACKUP LENGKAP SERVER BILLING  ->  satu file .tar.gz
#  Ikut: database radius, config billing, Nginx, SSL (letsencrypt),
#        FreeRADIUS, Mikhmon (semua instance), GenieACS (+MongoDB),
#        WireGuard/SSTP/L2TP, cron, systemd service.
#
#  Jalankan di SERVER LAMA:
#     sudo bash deploy/clone-server.sh
#  Hasil: /root/billing-clone-YYYYmmdd-HHMM.tar.gz
# =============================================================
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Harus dijalankan dengan sudo/root."; exit 1; }

APP_DIR="${APP_DIR:-/opt/mikrotik-billing}"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="${OUT:-/root/billing-clone-$STAMP.tar.gz}"
WORK="$(mktemp -d /tmp/billing-clone.XXXXXX)"
B="$WORK/billing-clone"
mkdir -p "$B"/{db,config,nginx,ssl,freeradius,mikhmon,genieacs,vpn,systemd,cron,app}

log(){ echo "==> $*"; }
skip(){ echo "    (lewati) $*"; }

# ---------- 1. Database ----------
log "Backup database MySQL/MariaDB"
DB_NAME="${DB_NAME:-radius}"
if [ -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env" "$B/config/app.env"
  DB_NAME="$(grep -E '^RADIUS_DB_NAME=' "$APP_DIR/.env" | cut -d= -f2- | tr -d '"' || true)"
  [ -n "$DB_NAME" ] || DB_NAME=radius
fi
if command -v mysqldump >/dev/null 2>&1; then
  mysqldump --single-transaction --routines --events --databases "$DB_NAME" \
    > "$B/db/$DB_NAME.sql" 2>/dev/null || skip "dump $DB_NAME gagal"
  # daftar user + grant supaya password DB tetap sama
  mysql -N -B -e "SELECT CONCAT('SHOW GRANTS FOR ''',user,'''@''',host,''';') FROM mysql.user WHERE user NOT IN ('root','mysql.sys','mysql.session','mysql.infoschema','debian-sys-maint');" \
    2>/dev/null | mysql -N -B 2>/dev/null | sed 's/$/;/' > "$B/db/grants.sql" || skip "grants"
  # simpan juga CREATE USER dengan hash password asli
  mysql -N -B -e "SELECT CONCAT('CREATE USER IF NOT EXISTS ''',user,'''@''',host,''' IDENTIFIED BY PASSWORD ''',authentication_string,''';') FROM mysql.user WHERE plugin='mysql_native_password' AND authentication_string<>'';" \
    2>/dev/null > "$B/db/users.sql" || true
else
  skip "mysqldump tidak ada"
fi

# ---------- 2. Config aplikasi billing ----------
log "Backup config billing"
for f in .env ecosystem.config.cjs; do
  [ -f "$APP_DIR/$f" ] && cp "$APP_DIR/$f" "$B/config/" || true
done
[ -d "$APP_DIR/data" ] && cp -a "$APP_DIR/data" "$B/app/data" || skip "folder data"
[ -d "$APP_DIR/uploads" ] && cp -a "$APP_DIR/uploads" "$B/app/uploads" || skip "folder uploads"
(cd "$APP_DIR" 2>/dev/null && git rev-parse HEAD > "$B/app/git-commit.txt" 2>/dev/null) || true

# ---------- 3. Nginx ----------
log "Backup konfigurasi Nginx"
[ -d /etc/nginx ] && cp -a /etc/nginx "$B/nginx/etc-nginx" || skip "nginx"

# ---------- 4. SSL Let's Encrypt ----------
log "Backup sertifikat SSL"
[ -d /etc/letsencrypt ] && cp -a /etc/letsencrypt "$B/ssl/letsencrypt" || skip "letsencrypt"

# ---------- 5. FreeRADIUS ----------
log "Backup FreeRADIUS"
for d in /etc/freeradius /etc/raddb; do
  [ -d "$d" ] && cp -a "$d" "$B/freeradius/$(basename "$d")" || true
done

# ---------- 6. Mikhmon (semua instance) ----------
log "Backup Mikhmon"
shopt -s nullglob
for d in /var/www/mikhmon*; do
  cp -a "$d" "$B/mikhmon/$(basename "$d")"
done
shopt -u nullglob

# ---------- 7. GenieACS + MongoDB ----------
log "Backup GenieACS"
[ -d /opt/genieacs ] && cp -a /opt/genieacs "$B/genieacs/opt-genieacs" || skip "genieacs"
[ -d /etc/genieacs ] && cp -a /etc/genieacs "$B/genieacs/etc-genieacs" || true
if command -v mongodump >/dev/null 2>&1; then
  mongodump --db genieacs --out "$B/genieacs/mongo" >/dev/null 2>&1 || skip "mongodump"
else
  skip "mongodump tidak ada (install mongodb-database-tools bila perlu)"
fi

# ---------- 8. VPN ----------
log "Backup VPN (WireGuard / SSTP / L2TP)"
[ -d /etc/wireguard ] && cp -a /etc/wireguard "$B/vpn/wireguard" || true
[ -f /etc/ipsec.conf ] && cp -a /etc/ipsec.conf /etc/ipsec.secrets "$B/vpn/" 2>/dev/null || true
[ -d /etc/xl2tpd ] && cp -a /etc/xl2tpd "$B/vpn/xl2tpd" || true
[ -d /etc/ppp ] && cp -a /etc/ppp "$B/vpn/ppp" || true
[ -d /etc/accel-ppp.conf.d ] && cp -a /etc/accel-ppp.conf.d "$B/vpn/accel-ppp.conf.d" || true
[ -f /etc/accel-ppp.conf ] && cp -a /etc/accel-ppp.conf "$B/vpn/" || true
[ -d /etc/cloudflared ] && cp -a /etc/cloudflared "$B/vpn/cloudflared" || true

# ---------- 9. systemd + cron ----------
log "Backup systemd unit & cron"
shopt -s nullglob
for f in /etc/systemd/system/{mikrotik-billing,genieacs-*,wa-gateway,cloudflared}*.service; do
  cp -a "$f" "$B/systemd/"
done
shopt -u nullglob
crontab -l > "$B/cron/root.cron" 2>/dev/null || true
[ -d /etc/cron.d ] && cp -a /etc/cron.d "$B/cron/etc-cron.d" || true

# ---------- 10. Info server ----------
{
  echo "tanggal_backup: $STAMP"
  echo "hostname: $(hostname)"
  echo "ubuntu: $(lsb_release -ds 2>/dev/null || echo unknown)"
  echo "db_name: $DB_NAME"
  echo "ip: $(hostname -I 2>/dev/null)"
  echo "paket_terinstall:"
  dpkg -l | awk '/^ii/{print "  - "$2}' | head -400
} > "$B/INFO.txt"

log "Mengemas arsip"
tar -czf "$OUT" -C "$WORK" billing-clone
rm -rf "$WORK"
chmod 600 "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
cat <<EOF

=============================================================
 BACKUP SELESAI
 File : $OUT  ($SIZE)

 Pindahkan ke server baru, contoh dari komputer Anda:
   scp root@IP-LAMA:$OUT .
   scp $(basename "$OUT") root@IP-BARU:/root/

 Lalu di server baru jalankan:
   sudo bash -c "\$(curl -fsSL https://raw.githubusercontent.com/hifni-84/billing-link-fixer/main/deploy/install-ubuntu.sh)"
   cd /opt/mikrotik-billing
   sudo bash deploy/restore-server.sh /root/$(basename "$OUT")
=============================================================
EOF
