#!/usr/bin/env bash
# =============================================================
#  Perbaiki "413 Request Entity Too Large" saat Restore backup
#  Menaikkan batas upload Nginx ke 200 MB untuk semua vhost.
#  Jalankan:  sudo bash deploy/fix-upload-besar.sh
# =============================================================
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

LIMIT="${1:-200m}"

echo "==> Menyetel batas global http { client_max_body_size $LIMIT; }"
mkdir -p /etc/nginx/conf.d
cat >/etc/nginx/conf.d/00-upload-besar.conf <<CFG
client_max_body_size $LIMIT;
client_body_timeout 600s;
CFG

echo "==> Menaikkan batas di setiap vhost yang sudah ada"
for f in /etc/nginx/sites-available/* /etc/nginx/conf.d/*.conf; do
  [ -f "$f" ] || continue
  [ "$f" = "/etc/nginx/conf.d/00-upload-besar.conf" ] && continue
  if grep -q "client_max_body_size" "$f"; then
    sed -i -E "s/client_max_body_size[[:space:]]+[0-9]+[kKmMgG]?;/client_max_body_size $LIMIT;/g" "$f"
  fi
done

echo "==> Menaikkan timeout proxy panel billing"
for f in /etc/nginx/sites-available/* /etc/nginx/conf.d/*.conf; do
  [ -f "$f" ] || continue
  grep -q "proxy_pass" "$f" || continue
  grep -q "proxy_read_timeout" "$f" || \
    sed -i "0,/proxy_pass/s//proxy_read_timeout 600s;\n        proxy_send_timeout 600s;\n        proxy_pass/" "$f"
done

nginx -t
systemctl reload nginx
echo "OK: batas upload sekarang $LIMIT. Coba Restore lagi dari panel (Ctrl+F5 dulu)."
