#!/usr/bin/env bash
# Sudoers untuk apply-mikhmon-domain.sh (Domain & SSL Mikhmon)
# Pasang aturan sudoers agar user najwa bisa menjalankan script domain
# Mikhmon + certbot + reload nginx/php-fpm tanpa password sudo.
set -euo pipefail
[[ $EUID -ne 0 ]] && { echo "Jalankan dengan sudo."; exit 1; }

APP_USER="${1:-najwa}"
SCRIPT="/opt/mikrotik-billing/deploy/apply-mikhmon-domain.sh"

chmod 750 "$SCRIPT" 2>/dev/null || true
chown root:root "$SCRIPT" 2>/dev/null || true

FILE="/etc/sudoers.d/billing-mikhmon-domain"
cat > "$FILE" <<CFG
${APP_USER} ALL=(root) NOPASSWD: ${SCRIPT}
${APP_USER} ALL=(root) NOPASSWD: /usr/bin/certbot
${APP_USER} ALL=(root) NOPASSWD: /bin/systemctl reload nginx
${APP_USER} ALL=(root) NOPASSWD: /usr/sbin/nginx -t
${APP_USER} ALL=(root) NOPASSWD: /bin/systemctl reload php*-fpm
CFG
chmod 440 "$FILE"
visudo -c -f "$FILE"
echo "OK: user ${APP_USER} boleh menerapkan domain + SSL Mikhmon dari panel billing."
