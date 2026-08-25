#!/usr/bin/env bash
# =============================================================
#  GANTI IP SERVER BILLING (lama -> baru) di semua config
#
#  Jalankan di SERVER BARU setelah restore-server.sh selesai:
#     sudo bash deploy/ganti-ip-server.sh 192.168.23.251 192.168.40.254
#
#  Script ini mengganti IP lama dengan IP baru di:
#    - FreeRADIUS clients.conf / sql module
#    - Nginx vhost (server_name, proxy_pass, listen)
#    - .env billing panel
#    - GenieACS config
#    - Mikhmon config (semua instance)
#    - WireGuard / SSTP / L2TP / accel-ppp config
#    - Cloudflared config
#    - crontab root
#  Lalu restart semua service.
# =============================================================
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Harus dijalankan dengan sudo/root."; exit 1; }

IP_LAMA="${1:-}"
IP_BARU="${2:-}"
[ -n "$IP_LAMA" ] && [ -n "$IP_BARU" ] || {
  echo "Pemakaian: sudo bash deploy/ganti-ip-server.sh <IP-LAMA> <IP-BARU>"
  echo "Contoh   : sudo bash deploy/ganti-ip-server.sh 192.168.23.251 192.168.40.254"
  exit 1
}

# validasi format IP sederhana
valid_ip(){ [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "IP tidak valid: $1"; exit 1; }; }
valid_ip "$IP_LAMA"
valid_ip "$IP_BARU"

[ "$IP_LAMA" != "$IP_BARU" ] || { echo "IP lama dan baru sama — tidak perlu diganti."; exit 0; }

APP_DIR="${APP_DIR:-/opt/mikrotik-billing}"
GANTI=0
log(){ echo "==> $*"; }
ok(){ echo "    ok: $*"; GANTI=$((GANTI+1)); }
skip(){ echo "    (lewati) $*"; }

# ganti dalam satu file (idempoten, backup .bak sekali)
ganti_file(){
  local f="$1"
  [ -f "$f" ] || return 0
  if grep -qF "$IP_LAMA" "$f"; then
    cp -a "$f" "$f.bak-ip-$STAMP" 2>/dev/null || true
    sed -i "s/${IP_LAMA//./\\.}/$IP_BARU/g" "$f"
    ok "update: $f"
  fi
}

# ganti di seluruh folder (rekursif, backup per file)
ganti_dir(){
  local d="$1"
  [ -d "$d" ] || return 0
  local hit=0
  while IFS= read -r -d '' f; do
    if grep -qIqF "$IP_LAMA" "$f" 2>/dev/null; then
      cp -a "$f" "$f.bak-ip-$STAMP" 2>/dev/null || true
      sed -i "s/${IP_LAMA//./\\.}/$IP_BARU/g" "$f"
      hit=$((hit+1))
    fi
  done < <(find "$d" -type f -not -name "*.bak-ip-*" -print0 2>/dev/null)
  [ "$hit" -gt 0 ] && ok "update: $d ($hit file)" || skip "$d (tidak ada IP lama)"
}

STAMP="$(date +%Y%m%d-%H%M)"

echo "============================================================="
echo " Ganti IP server: $IP_LAMA  ->  $IP_BARU"
echo " Server: $(hostname)   $(date)"
echo "============================================================="

# ---------- 1. .env billing panel ----------
log "Billing .env"
ganti_file "$APP_DIR/.env"

# ---------- 2. FreeRADIUS ----------
log "FreeRADIUS config"
for d in /etc/freeradius /etc/raddb /etc/freeradius/3.0; do
  ganti_dir "$d"
done

# ---------- 3. Nginx ----------
log "Nginx config"
ganti_dir /etc/nginx/sites-available
ganti_dir /etc/nginx/sites-enabled
ganti_dir /etc/nginx/conf.d
# file utama juga
ganti_file /etc/nginx/nginx.conf

# ---------- 4. GenieACS ----------
log "GenieACS config"
ganti_dir /etc/genieacs
ganti_dir /opt/genieacs/config
# env genieacs
for f in /etc/genieacs/genieacs.env /opt/genieacs/config/genieacs.env /opt/genieacs/.env; do
  ganti_file "$f"
done

# ---------- 5. Mikhmon (semua instance) ----------
log "Mikhmon config"
shopt -s nullglob
for d in /var/www/mikhmon*; do
  ganti_dir "$d"
done
shopt -u nullglob

# ---------- 6. VPN ----------
log "VPN config (WireGuard / SSTP / L2TP / accel-ppp)"
ganti_dir /etc/wireguard
ganti_file /etc/ipsec.conf
ganti_file /etc/ipsec.secrets
ganti_dir /etc/xl2tpd
ganti_dir /etc/ppp
ganti_dir /etc/accel-ppp.conf.d
ganti_file /etc/accel-ppp.conf
# xl2tpd sering pakai option file
ganti_file /etc/xl2tpd/xl2tpd.conf
ganti_file /etc/ppp/options.xl2tpd
ganti_file /etc/ppp/chap-secrets

# ---------- 7. Cloudflared ----------
log "Cloudflared config"
ganti_dir /etc/cloudflared
ganti_file /etc/cloudflared/config.yml

# ---------- 8. crontab root ----------
log "crontab root"
if crontab -l 2>/dev/null | grep -qF "$IP_LAMA"; then
  crontab -l 2>/dev/null | sed "s/${IP_LAMA//./\\.}/$IP_BARU/g" | crontab -
  ok "update: crontab root"
else
  skip "crontab root (tidak ada IP lama)"
fi

# ---------- 9. Database RADIUS: tabel nas (ip server RADIUS) ----------
log "Database RADIUS: update IP di tabel nas & billing_setting"
DB_NAME="radius"
[ -f "$APP_DIR/.env" ] && DB_NAME="$(grep -E '^RADIUS_DB_NAME=' "$APP_DIR/.env" | cut -d= -f2- | tr -d '"' || true)"
[ -n "$DB_NAME" ] || DB_NAME=radius
if command -v mysql >/dev/null 2>&1; then
  # nas: kolom nasname / server bisa berisi IP server RADIUS
  mysql "$DB_NAME" -e "UPDATE nas SET nasname=REPLACE(nasname,'$IP_LAMA','$IP_BARU') WHERE nasname LIKE '%${IP_LAMA}%';" 2>/dev/null && ok "nas.nasname" || skip "nas.nasname"
  mysql "$DB_NAME" -e "UPDATE nas SET server=REPLACE(server,'$IP_LAMA','$IP_BARU') WHERE server LIKE '%${IP_LAMA}%';" 2>/dev/null || true
  # billing_setting: mungkin simpan IP server / URL
  mysql "$DB_NAME" -e "UPDATE billing_setting SET svalue=REPLACE(svalue,'$IP_LAMA','$IP_BARU') WHERE svalue LIKE '%${IP_LAMA}%';" 2>/dev/null && ok "billing_setting.svalue" || skip "billing_setting.svalue"
else
  skip "mysql tidak tersedia"
fi

# ---------- 10. Validasi & restart ----------
log "Validasi config"
nginx -t 2>&1 | head -3 || echo "    !! nginx -t gagal — periksa manual"

log "Restart service"
for s in nginx mikrotik-billing freeradius genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui php8.3-fpm php8.2-fpm php8.1-fpm cloudflared; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^$s"; then
    systemctl restart "$s" >/dev/null 2>&1 && echo "    restart: $s" || skip "restart $s"
  fi
done
# WireGuard: tiap interface
if command -v wg >/dev/null 2>&1; then
  for wgif in $(wg show interfaces 2>/dev/null); do
    wg-quick down "$wgif" 2>/dev/null || true
    wg-quick up "$wgif" 2>/dev/null && echo "    wg up: $wgif" || skip "wg $wgif"
  done
fi

echo
echo "============================================================="
echo " GANTI IP SELESAI  ($GANTI file/config diupdate)"
echo " IP lama: $IP_LAMA"
echo " IP baru: $IP_BARU"
echo
echo " Backup config lama: *.bak-ip-$STAMP"
echo
echo " Yang MASIH HARUS manual:"
echo "  1. MikroTik: /radius set address=$IP_BARU  (untuk setiap NAS)"
echo "  2. MikroTik: update endpoint WireGuard/SSTP/L2TP ke IP baru"
echo "  3. DNS: arahkan domain (billing, mikhmon, acs) ke IP publik baru"
echo "  4. SSL: setelah DNS pindah, jalankan"
echo "       sudo certbot renew --force-renewal"
echo "  5. Cek: sudo systemctl status mikrotik-billing freeradius nginx"
echo "  6. Hapus backup bila sudah yakin:"
echo "       sudo find /etc /opt/mikrotik-billing -name '*.bak-ip-$STAMP' -delete"
echo "============================================================="
