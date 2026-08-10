#!/usr/bin/env bash
# Mengembalikan nginx ke kondisi semula (panel web kembali di TCP 443).
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

echo "==> Menghapus routing SNI SSTP"
rm -f /etc/nginx/stream-enabled/billing-sstp.conf
# hapus blok stream {...} yang ditambahkan installer
python3 - <<'PY'
p = "/etc/nginx/nginx.conf"
s = open(p).read()
blok = "\nstream {\n    include /etc/nginx/stream-enabled/*.conf;\n}\n"
if blok in s:
    open(p, "w").write(s.replace(blok, ""))
    print("    blok stream dihapus dari nginx.conf")
PY

echo "==> Mengembalikan konfigurasi situs"
shopt -s nullglob
for f in /etc/nginx/sites-available/*.bak-sstp /etc/nginx/sites-enabled/*.bak-sstp; do
  mv -f "$f" "${f%.bak-sstp}"
  echo "    restore ${f%.bak-sstp}"
done
# jika backup tidak ada, balikkan listener ke 443
for f in /etc/nginx/sites-enabled/*; do
  [[ -f "$f" ]] || continue
  sed -i -E 's/listen\s+127\.0\.0\.1:8443 ssl;/listen 443 ssl;\n    listen [::]:443 ssl;/' "$f"
done

systemctl stop billing-sstp 2>/dev/null || true
systemctl disable billing-sstp 2>/dev/null || true

nginx -t
systemctl restart nginx
echo "OK: panel web kembali normal di https://\$(cat /etc/billing-vpn-host 2>/dev/null || echo IP_SERVER)"
