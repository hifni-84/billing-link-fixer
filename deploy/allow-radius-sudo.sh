#!/usr/bin/env bash
# Mengizinkan panel billing memuat ulang daftar NAS FreeRADIUS tanpa password.
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

APP_USER="${1:-$(stat -c '%U' /opt/mikrotik-billing 2>/dev/null || echo najwa)}"
FILE="/etc/sudoers.d/billing-radius"

cat > "$FILE" <<CFG
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart freeradius, /usr/bin/systemctl reload-or-restart freeradius, /usr/bin/systemctl is-active freeradius
CFG
chmod 440 "$FILE"
visudo -c -f "$FILE"
echo "OK: user ${APP_USER} boleh memuat ulang daftar NAS FreeRADIUS dari panel."
