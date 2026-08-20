#!/usr/bin/env bash
# fix-mikhmon-timeout.sh — Perbaiki 504 Gateway Time-out saat generate voucher Mikhmon.
#   sudo bash /opt/mikrotik-billing/deploy/fix-mikhmon-timeout.sh
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

TO=600

# 1) PHP-FPM & PHP-CLI: naikkan batas waktu eksekusi
for INI in /etc/php/*/fpm/php.ini; do
  [[ -f "$INI" ]] || continue
  sed -i -E "s/^;?\s*max_execution_time\s*=.*/max_execution_time = ${TO}/" "$INI"
  sed -i -E "s/^;?\s*max_input_time\s*=.*/max_input_time = ${TO}/" "$INI"
  sed -i -E "s/^;?\s*default_socket_timeout\s*=.*/default_socket_timeout = ${TO}/" "$INI"
  echo "+ php.ini: $INI"
done

# 2) Naikkan jumlah worker PHP-FPM (generate voucher = banyak request bersamaan)
for POOL in /etc/php/*/fpm/pool.d/www.conf; do
  [[ -f "$POOL" ]] || continue
  sed -i -E "s/^;?\s*pm\.max_children\s*=.*/pm.max_children = 25/" "$POOL"
  sed -i -E "s/^;?\s*pm\.start_servers\s*=.*/pm.start_servers = 5/" "$POOL"
  sed -i -E "s/^;?\s*pm\.min_spare_servers\s*=.*/pm.min_spare_servers = 3/" "$POOL"
  sed -i -E "s/^;?\s*pm\.max_spare_servers\s*=.*/pm.max_spare_servers = 10/" "$POOL"
  sed -i -E "s/^;?\s*request_terminate_timeout\s*=.*/request_terminate_timeout = ${TO}/" "$POOL"
  grep -q "^request_terminate_timeout" "$POOL" || echo "request_terminate_timeout = ${TO}" >> "$POOL"
  echo "+ pool: $POOL"
done

# 3) Nginx: tambahkan/perbarui timeout fastcgi di semua site Mikhmon
add_timeout() {
  local f="$1"
  grep -q "fastcgi_pass" "$f" || return 0
  cp -a "$f" "$f.bak-$(date +%Y%m%d%H%M%S)"
  # hapus baris timeout lama supaya tidak dobel
  sed -i -E '/fastcgi_(read|send|connect)_timeout/d' "$f"
  # sisipkan setelah setiap fastcgi_pass
  sed -i -E 's#^(\s*)(fastcgi_pass[^;]*;)#\1\2\n\1fastcgi_read_timeout 600;\n\1fastcgi_send_timeout 600;\n\1fastcgi_connect_timeout 60;#' "$f"
  echo "+ nginx: $f"
}
for f in /etc/nginx/sites-available/mikhmon*; do
  [[ -f "$f" ]] && add_timeout "$f"
done

# 4) Timeout global nginx (jaga-jaga untuk proxy)
GLOBAL=/etc/nginx/conf.d/00-timeout.conf
cat > "$GLOBAL" <<EOF
fastcgi_read_timeout ${TO};
fastcgi_send_timeout ${TO};
proxy_read_timeout ${TO};
proxy_send_timeout ${TO};
send_timeout ${TO};
EOF
echo "+ global: $GLOBAL"

nginx -t
systemctl restart "php$(ls /etc/php | sort -V | tail -1)-fpm" 2>/dev/null || systemctl restart php*-fpm || true
systemctl reload nginx
echo "OK: timeout Mikhmon dinaikkan ke ${TO} detik. Coba generate voucher lagi."
echo "CATATAN: kalau tetap 504, generate voucher dalam jumlah lebih kecil (mis. 50-100 per batch)"
echo "         karena tiap voucher dikirim satu-satu ke MikroTik dan bisa lambat lewat VPN."
