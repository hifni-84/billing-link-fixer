#!/usr/bin/env bash
# =============================================================
#  RESTORE SERVER BILLING dari hasil clone-server.sh
#
#  Jalankan di SERVER BARU (setelah install-ubuntu.sh):
#     sudo bash deploy/restore-server.sh /root/billing-clone-XXXX.tar.gz
# =============================================================
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Harus dijalankan dengan sudo/root."; exit 1; }

ARCHIVE="${1:-}"
[ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ] || { echo "Pemakaian: sudo bash deploy/restore-server.sh /path/billing-clone-XXXX.tar.gz"; exit 1; }

APP_DIR="${APP_DIR:-/opt/mikrotik-billing}"
WORK="$(mktemp -d /tmp/billing-restore.XXXXXX)"
log(){ echo "==> $*"; }
skip(){ echo "    (lewati) $*"; }

log "Membuka arsip"
tar -xzf "$ARCHIVE" -C "$WORK"
B="$WORK/billing-clone"
[ -d "$B" ] || { echo "Arsip tidak valid."; exit 1; }
[ -f "$B/INFO.txt" ] && cat "$B/INFO.txt" | head -6

# ---------- 0. Paket dasar yang wajib ada ----------
log "Memastikan paket dasar terinstall"
apt-get update -y >/dev/null
apt-get install -y nginx mariadb-server certbot python3-certbot-nginx rsync >/dev/null 2>&1 || true

# ---------- 1. Database ----------
log "Restore database"
shopt -s nullglob
for f in "$B"/db/*.sql; do
  case "$(basename "$f")" in
    grants.sql|users.sql) continue ;;
  esac
  mysql < "$f" && echo "    ok: $(basename "$f")" || skip "$(basename "$f")"
done
for f in "$B"/db/users.sql "$B"/db/grants.sql; do
  [ -f "$f" ] && { mysql < "$f" >/dev/null 2>&1 && echo "    ok: $(basename "$f")" || skip "$(basename "$f")"; }
done
shopt -u nullglob
mysql -e "FLUSH PRIVILEGES;" 2>/dev/null || true

# ---------- 2. Config aplikasi ----------
log "Restore config billing"
mkdir -p "$APP_DIR"
[ -f "$B/config/app.env" ] && cp "$B/config/app.env" "$APP_DIR/.env"
[ -f "$B/config/.env" ] && cp "$B/config/.env" "$APP_DIR/.env"
[ -f "$B/config/ecosystem.config.cjs" ] && cp "$B/config/ecosystem.config.cjs" "$APP_DIR/"
[ -d "$B/app/data" ] && cp -a "$B/app/data" "$APP_DIR/data"
[ -d "$B/app/uploads" ] && cp -a "$B/app/uploads" "$APP_DIR/uploads"

# ---------- 3. FreeRADIUS ----------
log "Restore FreeRADIUS"
if [ -d "$B/freeradius/freeradius" ] || [ -d "$B/freeradius/raddb" ]; then
  apt-get install -y freeradius freeradius-mysql freeradius-utils >/dev/null 2>&1 || true
  [ -d "$B/freeradius/freeradius" ] && rsync -a "$B/freeradius/freeradius/" /etc/freeradius/
  [ -d "$B/freeradius/raddb" ] && rsync -a "$B/freeradius/raddb/" /etc/raddb/
  chown -R freerad:freerad /etc/freeradius 2>/dev/null || true
else
  skip "freeradius tidak ada di backup"
fi

# ---------- 4. Mikhmon ----------
log "Restore Mikhmon"
if compgen -G "$B/mikhmon/*" >/dev/null; then
  apt-get install -y php-fpm php-curl php-mbstring php-zip >/dev/null 2>&1 || true
  mkdir -p /var/www
  cp -a "$B"/mikhmon/* /var/www/
  chown -R www-data:www-data /var/www/mikhmon* 2>/dev/null || true
else
  skip "mikhmon tidak ada di backup"
fi

# ---------- 5. GenieACS ----------
log "Restore GenieACS"
if [ -d "$B/genieacs/opt-genieacs" ]; then
  bash "$APP_DIR/deploy/install-genieacs.sh" >/dev/null 2>&1 || skip "install-genieacs.sh"
  rsync -a "$B/genieacs/opt-genieacs/" /opt/genieacs/ 2>/dev/null || true
  [ -d "$B/genieacs/etc-genieacs" ] && rsync -a "$B/genieacs/etc-genieacs/" /etc/genieacs/ || true
  if [ -d "$B/genieacs/mongo/genieacs" ] && command -v mongorestore >/dev/null 2>&1; then
    mongorestore --drop --db genieacs "$B/genieacs/mongo/genieacs" >/dev/null 2>&1 || skip "mongorestore"
  fi
else
  skip "genieacs tidak ada di backup"
fi

# ---------- 6. VPN ----------
log "Restore VPN"
[ -d "$B/vpn/wireguard" ] && { apt-get install -y wireguard >/dev/null 2>&1 || true; rsync -a "$B/vpn/wireguard/" /etc/wireguard/; }
[ -d "$B/vpn/xl2tpd" ] && rsync -a "$B/vpn/xl2tpd/" /etc/xl2tpd/ || true
[ -d "$B/vpn/ppp" ] && rsync -a "$B/vpn/ppp/" /etc/ppp/ || true
[ -d "$B/vpn/accel-ppp.conf.d" ] && rsync -a "$B/vpn/accel-ppp.conf.d/" /etc/accel-ppp.conf.d/ || true
[ -f "$B/vpn/accel-ppp.conf" ] && cp "$B/vpn/accel-ppp.conf" /etc/ || true
[ -f "$B/vpn/ipsec.conf" ] && cp "$B/vpn/ipsec.conf" "$B/vpn/ipsec.secrets" /etc/ 2>/dev/null || true
[ -d "$B/vpn/cloudflared" ] && rsync -a "$B/vpn/cloudflared/" /etc/cloudflared/ || true

# ---------- 7. SSL + Nginx ----------
log "Restore SSL Let's Encrypt"
[ -d "$B/ssl/letsencrypt" ] && rsync -a "$B/ssl/letsencrypt/" /etc/letsencrypt/ || skip "letsencrypt"

log "Restore konfigurasi Nginx"
if [ -d "$B/nginx/etc-nginx" ]; then
  cp -a /etc/nginx "/etc/nginx.bak-$(date +%s)" 2>/dev/null || true
  rsync -a "$B/nginx/etc-nginx/" /etc/nginx/
fi

# ---------- 8. systemd + cron ----------
log "Restore systemd unit & cron"
if compgen -G "$B/systemd/*.service" >/dev/null; then
  cp -a "$B"/systemd/*.service /etc/systemd/system/
  systemctl daemon-reload
fi
[ -f "$B/cron/root.cron" ] && crontab "$B/cron/root.cron" || true
[ -d "$B/cron/etc-cron.d" ] && rsync -a "$B/cron/etc-cron.d/" /etc/cron.d/ || true

# ---------- 9. Build ulang aplikasi ----------
if [ -f "$APP_DIR/package.json" ]; then
  log "Build ulang panel billing"
  (cd "$APP_DIR" && npm install --omit=dev=false >/dev/null 2>&1 || npm install >/dev/null 2>&1; npm run build) || skip "build gagal, jalankan manual: cd $APP_DIR && npm install && npm run build"
fi

# ---------- 10. Restart semua service ----------
log "Restart service"
nginx -t && systemctl reload nginx || echo "!! Nginx config error — periksa dengan: nginx -t"
for s in mariadb mysql mikrotik-billing freeradius genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui php8.3-fpm php8.2-fpm php8.1-fpm cloudflared; do
  systemctl list-unit-files | grep -q "^$s" && { systemctl enable "$s" >/dev/null 2>&1 || true; systemctl restart "$s" >/dev/null 2>&1 && echo "    restart: $s" || skip "restart $s"; }
done

rm -rf "$WORK"

cat <<'EOF'

=============================================================
 RESTORE SELESAI

 Yang WAJIB diperiksa manual:
 1. DNS: arahkan semua domain (billing, mikhmon, acs) ke IP server BARU
 2. Sertifikat SSL: setelah DNS pindah, jalankan
      sudo certbot renew --force-renewal
 3. IP MikroTik/NAS: kalau IP server berubah, update di menu NAS billing
    dan di MikroTik (/radius set address=IP-BARU)
 4. VPN: WireGuard/SSTP/L2TP endpoint di MikroTik arahkan ke IP baru
 5. Cek status: sudo systemctl status mikrotik-billing freeradius nginx
=============================================================
EOF
