#!/usr/bin/env bash
# =============================================================
#  NAJWA_BILLING — Cloudflare Tunnel untuk 4 layanan sekaligus
#
#  Domain cadangan (dipakai saat IP publik mati / berubah):
#     billing.mybillingg.site   -> billing (Node, port 3000)
#     aulianet.mybillingg.site  -> /var/www/mikhmon-aulianet  (via Nginx)
#     faqihnet.mybillingg.site  -> /var/www/mikhmon-faqihnet  (via Nginx)
#     netcom.mybillingg.site    -> /var/www/mikhmon-netcom    (via Nginx)
#
#  Tidak butuh IP publik, tidak perlu port forward, HTTPS otomatis.
#  Syarat: domain mybillingg.site sudah ditambahkan (nameserver) di Cloudflare.
#
#  Pemakaian:
#     sudo bash deploy/cloudflare-tunnel-multi.sh            # domain default
#     sudo bash deploy/cloudflare-tunnel-multi.sh domain.com # domain lain
#     sudo bash deploy/cloudflare-tunnel-multi.sh --status
#     sudo bash deploy/cloudflare-tunnel-multi.sh --logs
#     sudo bash deploy/cloudflare-tunnel-multi.sh --remove
# =============================================================
set -uo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Jalankan dengan sudo: sudo bash $0 $*" >&2; exit 1; }

TUNNEL_NAME="najwa-billing"
APP_PORT="${PORT:-3000}"
CFG_DIR="/etc/cloudflared"
CFG="$CFG_DIR/config.yml"

case "${1:-}" in
  --status)
    systemctl status cloudflared --no-pager 2>/dev/null | head -15
    echo; echo "== Konfigurasi ($CFG) =="; cat "$CFG" 2>/dev/null || echo "(belum ada)"
    exit 0 ;;
  --logs)
    journalctl -u cloudflared -n 60 --no-pager; exit 0 ;;
  --remove)
    systemctl disable --now cloudflared 2>/dev/null || true
    cloudflared service uninstall 2>/dev/null || true
    echo "OK: tunnel dinonaktifkan (kredensial di /root/.cloudflared tetap ada)."; exit 0 ;;
esac

BASE="$(echo "${1:-mybillingg.site}" | tr -d ' ' | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##')"
[[ "$BASE" =~ ^[a-z0-9.-]+$ ]] || { echo "Domain tidak valid: $BASE"; exit 1; }

H_BILLING="billing.$BASE"
H_AULIA="aulianet.$BASE"
H_FAQIH="faqihnet.$BASE"
H_NETCOM="netcom.$BASE"

echo "=== 1) Pasang cloudflared ==="
if ! command -v cloudflared >/dev/null 2>&1; then
  ARCH="$(dpkg --print-architecture)"
  curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" \
    || { echo "Gagal unduh cloudflared"; exit 1; }
  apt-get install -y /tmp/cloudflared.deb >/dev/null 2>&1 || dpkg -i /tmp/cloudflared.deb
fi
command -v cloudflared >/dev/null 2>&1 || { echo "cloudflared gagal terpasang"; exit 1; }

echo "=== 2) Login Cloudflare (sekali saja) ==="
if [ ! -f /root/.cloudflared/cert.pem ]; then
  echo
  echo "Browser tidak tersedia di server, jadi cloudflared akan menampilkan URL."
  echo "COPY URL itu, buka di browser laptop/HP, pilih domain: $BASE, lalu Authorize."
  echo
  cloudflared tunnel login || { echo "Login gagal / dibatalkan."; exit 1; }
fi
[ -f /root/.cloudflared/cert.pem ] || { echo "cert.pem belum ada — login belum selesai."; exit 1; }

echo "=== 3) Buat / pakai tunnel: $TUNNEL_NAME ==="
if ! cloudflared tunnel list 2>/dev/null | awk '{print $2}' | grep -qx "$TUNNEL_NAME"; then
  cloudflared tunnel create "$TUNNEL_NAME" || { echo "Gagal membuat tunnel"; exit 1; }
fi
TUNNEL_ID="$(cloudflared tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$2==n {print $1}' | head -1)"
CRED="/root/.cloudflared/${TUNNEL_ID}.json"
[ -n "$TUNNEL_ID" ] && [ -f "$CRED" ] || { echo "Kredensial tunnel tidak ditemukan ($CRED)"; exit 1; }
echo "INFO: tunnel id = $TUNNEL_ID"

echo "=== 4) Arahkan DNS keempat hostname ke tunnel ==="
for h in "$H_BILLING" "$H_AULIA" "$H_FAQIH" "$H_NETCOM"; do
  if cloudflared tunnel route dns "$TUNNEL_NAME" "$h" >/dev/null 2>&1; then
    echo "  + $h"
  else
    echo "  ~ $h (sudah ada / perlu dicek manual di dashboard Cloudflare)"
  fi
done

echo "=== 5) Tulis konfigurasi ingress ==="
mkdir -p "$CFG_DIR"
[ -f "$CFG" ] && cp -a "$CFG" "$CFG.bak.$(date +%s)"

mk_mikhmon_block() {  # $1 = hostname publik, $2 = Host lokal yang dikenal Nginx
  cat <<BLK
  - hostname: $1
    service: http://127.0.0.1:80
    originRequest:
      httpHostHeader: $2
BLK
}

# Host lokal Nginx untuk tiap instance Mikhmon (pakai domain lama bila ada,
# kalau tidak ketemu dipakai hostname publik baru).
local_host() {  # $1 = nama instance, $2 = fallback
  local f="/etc/nginx/sites-available/mikhmon-$1" n=""
  [ -f "$f" ] && n="$(grep -h -m1 -oP 'server_name \K[^;]+' "$f" 2>/dev/null | awk '{print $1}')"
  echo "${n:-$2}"
}

{
  echo "tunnel: $TUNNEL_NAME"
  echo "credentials-file: $CRED"
  echo "originRequest:"
  echo "  connectTimeout: 30s"
  echo "  noTLSVerify: true"
  echo "ingress:"
  echo "  - hostname: $H_BILLING"
  echo "    service: http://127.0.0.1:${APP_PORT}"
  mk_mikhmon_block "$H_AULIA"  "$(local_host aulianet "$H_AULIA")"
  mk_mikhmon_block "$H_FAQIH"  "$(local_host faqihnet "$H_FAQIH")"
  mk_mikhmon_block "$H_NETCOM" "$(local_host netcom  "$H_NETCOM")"
  echo "  - service: http_status:404"
} > "$CFG"

cloudflared tunnel ingress validate --config "$CFG" 2>&1 || echo "PERINGATAN: validasi ingress mengeluh, cek $CFG"

echo "=== 6) Jalankan sebagai service ==="
systemctl disable --now billing-tunnel 2>/dev/null || true   # matikan quick tunnel lama
cloudflared service uninstall >/dev/null 2>&1 || true
cloudflared service install >/dev/null 2>&1 || true
systemctl enable --now cloudflared
sleep 4
systemctl is-active --quiet cloudflared && echo "OK: cloudflared aktif" || {
  echo "cloudflared belum aktif. Log:"; journalctl -u cloudflared -n 30 --no-pager; }

cat <<TIP

=========================================================
 ALAMAT CADANGAN (tetap hidup walau IP publik mati):
   https://$H_BILLING   -> billing / radius
   https://$H_AULIA     -> Mikhmon aulianet
   https://$H_FAQIH     -> Mikhmon faqihnet
   https://$H_NETCOM    -> Mikhmon netcom
=========================================================
Catatan:
 * Domain lama (billing.hopto.org, *.hopto.org) tetap jalan lewat IP publik.
   Kalau IP publik gangguan, pakai alamat di atas.
 * Di panel: Pengaturan -> Domain & SSL, isi host publik $H_BILLING
   supaya link tagihan WhatsApp memakai alamat yang selalu bisa dibuka.
 * Cek status : sudo bash $0 --status
   Lihat log  : sudo bash $0 --logs
   Matikan    : sudo bash $0 --remove
TIP