#!/usr/bin/env bash
# Mengizinkan panel billing mengelola user SSTP tanpa password sudo.
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

APP_USER="${1:-$(stat -c '%U' /opt/mikrotik-billing 2>/dev/null || echo najwa)}"
FILE="/etc/sudoers.d/billing-sstp"

cat > "$FILE" <<CFG
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/cat /etc/ppp/chap-secrets, /usr/bin/cat /etc/billing-vpn-host, /usr/bin/cat /etc/ppp/options.sstpd, /usr/bin/install -m 600 /tmp/chap-secrets.billing /etc/ppp/chap-secrets, /usr/bin/systemctl is-active billing-sstp, /usr/bin/systemctl restart billing-sstp, /bin/ping
CFG
chmod 440 "$FILE"
visudo -c -f "$FILE"
echo "OK: user ${APP_USER} boleh mengelola SSTP dari panel billing."
