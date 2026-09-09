#!/usr/bin/env bash
# Kembalikan konfigurasi RADIUS ke keadaan sebelum fix-radius-lambat.sh.
# Jalankan:  sudo bash deploy/undo-radius-lambat.sh
set -uo pipefail

RAD="/etc/freeradius/3.0"
[ -d "$RAD" ] || RAD="/etc/freeradius"

n=0
while IFS= read -r bak; do
  asli="${bak%.bak-lambat}"
  cp -f "$bak" "$asli" && n=$((n + 1)) && echo "dikembalikan: $asli"
done < <(find "$RAD" /etc/mysql -name '*.bak-lambat' 2>/dev/null)

echo "total dikembalikan: $n"
systemctl restart mysql 2>/dev/null || systemctl restart mariadb 2>/dev/null || true
systemctl restart freeradius 2>/dev/null || systemctl restart radiusd 2>/dev/null || true
sleep 3
ss -lunp 2>/dev/null | grep -E '1812|1813' || echo "!! Port 1812/1813 belum terdeteksi"
