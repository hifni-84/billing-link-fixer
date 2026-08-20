#!/usr/bin/env bash
# =====================================================================
#  Pasang tema elegan (dark modern) ke Mikhmon v3
#
#  Pakai:
#    sudo bash deploy/apply-mikhmon-theme.sh            # pasang tema
#    sudo bash deploy/apply-mikhmon-theme.sh --undo     # kembalikan asli
#
#  Cara kerja: menaruh CSS di /var/www/mikhmon/css/najwa-theme.css lalu
#  menyuntik <link> sebelum </head> di semua file PHP Mikhmon.
#  File asli otomatis di-backup (*.bak-theme).
# =====================================================================
set -euo pipefail

MIKHMON_DIR="${MIKHMON_DIR:-/var/www/mikhmon}"
SRC_CSS="$(cd "$(dirname "$0")" && pwd)/mikhmon-theme.css"
MARK_START="<!-- najwa-theme -->"
CSS_REL="css/najwa-theme.css"

if [[ $EUID -ne 0 ]]; then echo "Jalankan dengan sudo."; exit 1; fi
[[ -d "$MIKHMON_DIR" ]] || { echo "Mikhmon tidak ditemukan di $MIKHMON_DIR"; exit 1; }

undo() {
  echo "==> Mengembalikan tampilan asli Mikhmon"
  # hapus baris link tema dari semua file php
  grep -rl "$MARK_START" "$MIKHMON_DIR" --include='*.php' 2>/dev/null | while read -r f; do
    sed -i "\|$MARK_START|d" "$f"
    echo "  - bersih: $f"
  done
  rm -f "$MIKHMON_DIR/$CSS_REL"
  echo "OK: tema dilepas. Muat ulang browser (Ctrl+F5)."
}

if [[ "${1:-}" == "--undo" ]]; then undo; exit 0; fi

[[ -f "$SRC_CSS" ]] || { echo "CSS tema tidak ditemukan: $SRC_CSS"; exit 1; }

echo "==> [1/3] Menyalin CSS tema"
mkdir -p "$MIKHMON_DIR/css"
install -m 0644 "$SRC_CSS" "$MIKHMON_DIR/$CSS_REL"

echo "==> [2/3] Menyuntik tema ke halaman Mikhmon"
STAMP="$(date +%Y%m%d%H%M%S)"
COUNT=0
while IFS= read -r f; do
  grep -q "$MARK_START" "$f" && continue
  grep -qi '</head>' "$f" || continue
  cp -a "$f" "$f.bak-theme-$STAMP"
  # hitung kedalaman folder relatif supaya path CSS benar di subfolder
  rel="${f#$MIKHMON_DIR/}"
  depth=$(awk -F'/' '{print NF-1}' <<<"$rel")
  prefix=""
  for ((i = 0; i < depth; i++)); do prefix="../$prefix"; done
  link="$MARK_START<link rel=\"stylesheet\" href=\"${prefix}${CSS_REL}?v=$STAMP\">"
  # sisipkan sebelum </head> (case-insensitive)
  sed -i "0,/[<]\/[hH][eE][aA][dD][>]/s||$link\n</head>|" "$f"
  COUNT=$((COUNT + 1))
done < <(grep -ril '</head>' "$MIKHMON_DIR" --include='*.php' 2>/dev/null)

echo "==> [3/3] Menyesuaikan pemilik file"
chown -R www-data:www-data "$MIKHMON_DIR/css" 2>/dev/null || true

cat <<INFO

=====================================================================
 OK: tema elegan terpasang di $COUNT halaman Mikhmon.
 Buka Mikhmon lalu tekan Ctrl+F5 (hard refresh) untuk melihat hasilnya.

 Ingin ubah warna?  edit: $MIKHMON_DIR/$CSS_REL
 Ingin kembali asli: sudo bash $0 --undo
=====================================================================
INFO