#!/usr/bin/env bash
# Jalankan sudo bash /opt/mikrotik-billing/deploy/apply-genieacs-theme.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Jalankan dengan sudo."; exit 1; }
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
THEME="$HERE/genieacs-theme"
command -v python3 >/dev/null || { echo "Pasang python3 terlebih dahulu."; exit 1; }
if [ "${1:-}" = "--restore" ]; then
  [ -n "${2:-}" ] || { echo "Sertakan lokasi cadangan."; exit 1; }
  python3 "$THEME/patch_theme.py" --restore --backup "$2"
  systemctl restart genieacs-ui
  echo "Tampilan lama dipulihkan. Refresh browser dengan Ctrl+F5."
  exit 0
fi
command -v curl >/dev/null || { echo "Pasang curl terlebih dahulu."; exit 1; }
BIN="$(command -v genieacs-ui || true)"
[ -n "$BIN" ] || { echo "GenieACS belum terpasang atau tidak ada di PATH."; exit 1; }
PACKAGE="$(dirname "$(dirname "$(readlink -f "$BIN")")")"
[ -f "$PACKAGE/package.json" ] || { echo "Lokasi paket GenieACS tidak ditemukan."; exit 1; }
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
# Pointer URLs are hosted by this project; files are installed locally in GenieACS.
ASSET_ORIGIN="${NAJWANET_ASSET_ORIGIN:-https://id-preview--b47775be-69c2-4297-859f-a1ef85a9d327.lovable.app}"
for NAME in logo favicon; do
  URL="$(python3 - "$THEME/$NAME.png.asset.json" "$ASSET_ORIGIN" <<'PY'
import json, sys
from urllib.parse import urljoin
with open(sys.argv[1]) as f:
    print(urljoin(sys.argv[2], json.load(f)["url"]))
PY
  )"
  curl --fail --location --silent --show-error --connect-timeout 15 --max-time 90 "$URL" -o "$STAGE/$NAME.png"
done
BACKUP="/var/backups/genieacs-ui/najwanet-$(date +%Y%m%d-%H%M%S)-$$"
python3 "$THEME/patch_theme.py" --package "$PACKAGE" --theme "$THEME" --assets "$STAGE" --backup "$BACKUP"
systemctl restart genieacs-ui
echo "Tema NAJWANET terpasang. Buka http://192.168.23.251:3001 lalu Ctrl+F5."
echo "Cadangan: $BACKUP"
echo "Pulihkan: sudo bash $HERE/apply-genieacs-theme.sh --restore $BACKUP"
echo "Data modem, akun login, port dan billing tidak diubah."