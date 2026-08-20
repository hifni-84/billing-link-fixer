#!/usr/bin/env bash
# =====================================================================
#  Tambahkan filter "Profil Voucher + Total Terjual" pada Report Mikhmon
#
#  Pakai:
#    sudo bash deploy/apply-mikhmon-report-filter.sh          # pasang
#    sudo bash deploy/apply-mikhmon-report-filter.sh --undo   # lepas
# =====================================================================
set -euo pipefail

MIKHMON_DIR="${MIKHMON_DIR:-/var/www/mikhmon}"
SRC_JS="$(cd "$(dirname "$0")" && pwd)/mikhmon-report-filter.js"
MARK="<!-- najwa-report-filter -->"
JS_REL="js/najwa-report-filter.js"

if [[ $EUID -ne 0 ]]; then echo "Jalankan dengan sudo."; exit 1; fi
[[ -d "$MIKHMON_DIR" ]] || { echo "Mikhmon tidak ditemukan di $MIKHMON_DIR"; exit 1; }

if [[ "${1:-}" == "--undo" ]]; then
  echo "==> Melepas filter profil dari Mikhmon"
  grep -rl "$MARK" "$MIKHMON_DIR" --include='*.php' 2>/dev/null | while read -r f; do
    sed -i "\|$MARK|d" "$f"; echo "  - bersih: $f"
  done
  # pulihkan backup jika ada (paling aman)
  find "$MIKHMON_DIR" -name '*.bak-rfilter-*' 2>/dev/null | while read -r b; do
    orig="${b%.bak-rfilter-*}"
    cp -a "$b" "$orig" && rm -f "$b"
    echo "  - pulih: $orig"
  done
  rm -f "$MIKHMON_DIR/$JS_REL"
  echo "OK: filter dilepas. Tekan Ctrl+F5 di browser."
  exit 0
fi

[[ -f "$SRC_JS" ]] || { echo "File JS tidak ditemukan: $SRC_JS"; exit 1; }

echo "==> [1/3] Menyalin skrip filter"
mkdir -p "$MIKHMON_DIR/js"
install -m 0644 "$SRC_JS" "$MIKHMON_DIR/$JS_REL"

echo "==> [2/3] Menyuntik skrip ke halaman Mikhmon"
STAMP="$(date +%Y%m%d%H%M%S)"
COUNT=0
while IFS= read -r f; do
  grep -q "$MARK" "$f" && continue
  cp -a "$f" "$f.bak-rfilter-$STAMP"
  rel="${f#$MIKHMON_DIR/}"
  depth=$(awk -F'/' '{print NF-1}' <<<"$rel")
  prefix=""
  for ((i = 0; i < depth; i++)); do prefix="../$prefix"; done
  tag="$MARK<script src=\"${prefix}${JS_REL}?v=$STAMP\"></script>"
  if grep -qi '</body>' "$f"; then
    sed -i "0,/[<]\/[bB][oO][dD][yY][>]/s||$tag\n</body>|" "$f"
  elif grep -qi '</html>' "$f"; then
    sed -i "0,/[<]\/[hH][tT][mM][lL][>]/s||$tag\n</html>|" "$f"
  else
    rm -f "$f.bak-rfilter-$STAMP"
    continue
  fi
  COUNT=$((COUNT + 1))
  echo "  + $rel"
done < <(find "$MIKHMON_DIR" -maxdepth 2 -name '*.php' 2>/dev/null)

echo "==> [3/3] Menyesuaikan pemilik file"
chown -R www-data:www-data "$MIKHMON_DIR/js" 2>/dev/null || true

cat <<INFO

=====================================================================
 OK: filter profil voucher terpasang di $COUNT halaman Mikhmon.
 Buka menu Report di Mikhmon, tekan Ctrl+F5, lalu pilih profil
 pada dropdown "Filter Profil Voucher". Total terjual + total harga
 tampil otomatis di kanan.

 Lepas kembali: sudo bash $0 --undo
=====================================================================
INFO
