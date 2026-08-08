#!/usr/bin/env bash
# Mengizinkan panel billing mengelola user L2TP tanpa password sudo.
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

APP_USER="${1:-$(stat -c '%U' /opt/mikrotik-billing 2>/dev/null || echo najwa)}"
FILE="/etc/sudoers.d/billing-l2tp"

cat > "$FILE" <<CFG
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/cat /etc/ppp/chap-secrets, /usr/bin/cat /etc/billing-l2tp.psk, /usr/bin/install -m 600 /tmp/chap-secrets.billing /etc/ppp/chap-secrets, /usr/bin/systemctl is-active xl2tpd, /usr/bin/systemctl is-active strongswan-starter, /usr/bin/systemctl is-active strongswan, /usr/bin/systemctl restart xl2tpd, /bin/ping
CFG
chmod 440 "$FILE"
visudo -c -f "$FILE"
echo "OK: user ${APP_USER} boleh mengelola L2TP dari panel billing."
