#!/usr/bin/env bash
# Pasang GenieACS 1.2.13 di Ubuntu 24.04 (noble) — pengganti GACS-Jammy.sh.
# UI di port 3001 agar tidak bentrok dengan billing (3000).
# Jalankan: sudo bash /opt/mikrotik-billing/deploy/install-gacs-noble.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Jalankan dengan sudo."; exit 1; }

UI_PORT="${GENIEACS_UI_PORT:-3001}"
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y curl gnupg ca-certificates

# MongoDB 7.0 (hanya jika belum ada)
if ! systemctl list-unit-files | grep -q '^mongod\.service'; then
  echo "== Memasang MongoDB 7.0 =="
  curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor --yes
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" \
    > /etc/apt/sources.list.d/mongodb-org-7.0.list
  apt-get update -y
  apt-get install -y mongodb-org
fi
systemctl enable --now mongod

# NodeJS + GenieACS
command -v node >/dev/null 2>&1 || apt-get install -y nodejs npm
command -v npm  >/dev/null 2>&1 || apt-get install -y npm
npm install -g genieacs@1.2.13

id -u genieacs >/dev/null 2>&1 || useradd --system --no-create-home --user-group genieacs
mkdir -p /opt/genieacs/ext /var/log/genieacs

ENV=/opt/genieacs/genieacs.env
SECRET=""
[ -f "$ENV" ] && SECRET="$(grep -E '^GENIEACS_UI_JWT_SECRET=' "$ENV" | cut -d= -f2- || true)"
[ -n "$SECRET" ] || SECRET="$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")"
cat > "$ENV" <<EOF
GENIEACS_CWMP_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-cwmp-access.log
GENIEACS_NBI_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-nbi-access.log
GENIEACS_FS_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-fs-access.log
GENIEACS_UI_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-ui-access.log
GENIEACS_DEBUG_FILE=/var/log/genieacs/genieacs-debug.yaml
NODE_OPTIONS=--enable-source-maps
GENIEACS_EXT_DIR=/opt/genieacs/ext
GENIEACS_UI_PORT=${UI_PORT}
GENIEACS_UI_JWT_SECRET=${SECRET}
EOF
chown -R genieacs:genieacs /opt/genieacs /var/log/genieacs
chmod 600 "$ENV"

BIN_DIR="$(dirname "$(command -v genieacs-cwmp || echo /usr/local/bin/genieacs-cwmp)")"
for s in cwmp nbi fs ui; do
  cat > /etc/systemd/system/genieacs-$s.service <<EOF
[Unit]
Description=GenieACS $s
After=network.target mongod.service

[Service]
User=genieacs
EnvironmentFile=$ENV
ExecStart=$BIN_DIR/genieacs-$s
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
done
mkdir -p /etc/systemd/system/genieacs-ui.service.d
printf '[Service]\nEnvironment=GENIEACS_UI_PORT=%s\n' "$UI_PORT" > /etc/systemd/system/genieacs-ui.service.d/port.conf

cat > /etc/logrotate.d/genieacs <<'EOF'
/var/log/genieacs/*.log /var/log/genieacs/*.yaml {
    daily
    rotate 30
    compress
    delaycompress
    dateext
}
EOF

systemctl daemon-reload
systemctl enable genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui
systemctl restart genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui
for p in 7547 7557 7567 "$UI_PORT"; do ufw allow "${p}/tcp" >/dev/null 2>&1 || true; done

sleep 3
for s in mongod genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui; do
  echo "$s: $(systemctl is-active $s || true)"
done
echo "GenieACS UI : http://$(hostname -I | awk '{print $1}'):${UI_PORT} (admin/admin)"
echo "ACS URL ONU : http://192.168.23.5:7547"
