#!/usr/bin/env bash
# =============================================================================
# fix-pesan-expired.sh
# -----------------------------------------------------------------------------
# Mengubah pesan penolakan login untuk voucher/user yang SUDAH EXPIRED.
#
# Tanpa script ini, MikroTik hanya menampilkan:
#   "login failed: invalid username or password"
# padahal masalahnya voucher expired — bikin pelanggan bingung.
#
# Script ini mengatur FreeRADIUS agar saat menolak user yang expired, ia
# menyertakan Reply-Message "Voucher expired..." yang akan ditampilkan
# MikroTik di halaman login hotspot (menggantikan pesan "invalid username").
#
# Pakai:
#   sudo bash deploy/fix-pesan-expired.sh
# =============================================================================
set -euo pipefail

FR_DIR="/etc/freeradius/3.0"
[[ -d "$FR_DIR" ]] || FR_DIR="/etc/freeradius"
SITE="$FR_DIR/sites-enabled/default"

[[ -f "$SITE" ]] || { echo "!! File site default tidak ditemukan: $SITE" >&2; exit 1; }

PESAN='Voucher sudah expired, silakan beli voucher baru'

cp -a "$SITE" "${SITE}.bak-pesan-$(date +%Y%m%d%H%M%S)"

# ---- 1. Pastikan modul expiration aktif di authorize ------------------------
# Modul inilah yang membaca atribut Expiration di radcheck dan menolak
# user yang sudah lewat masa aktif.
if ! grep -Eq '^\s*expiration\s*$' "$SITE"; then
  echo "==> Menambahkan modul 'expiration' ke authorize"
  # Sisipkan setelah baris 'sql' di authorize
  sed -i '0,/^\(\s*\)sql\s*$/s//\1sql\n\texpiration/' "$SITE"
else
  echo "==> Modul 'expiration' sudah aktif"
fi

# ---- 2. Tambahkan Reply-Message pada penolakan karena expired ---------------
if grep -q 'Voucher sudah expired' "$SITE"; then
  echo "==> Pesan expired sudah terpasang"
else
  echo "==> Menambahkan pesan expired di Post-Auth-Type REJECT"
  if grep -q 'Post-Auth-Type REJECT' "$SITE"; then
    # Sisipkan tepat setelah baris pembuka blok REJECT
    sed -i '/Post-Auth-Type REJECT\s*{/a\
\t\t# Jika penolakan karena masa aktif habis, kirim pesan jelas ke MikroTik\
\t\tif ("%{reply:Module-Failure-Message}" =~ /expired/i) {\
\t\t\tupdate reply {\
\t\t\t\tReply-Message := "'"$PESAN"'"\
\t\t\t}\
\t\t}' "$SITE"
  else
    # Belum ada blok REJECT — buat di akhir section post-auth
    cat >> "$SITE" << EOF

post-auth {
	Post-Auth-Type REJECT {
		if ("%{reply:Module-Failure-Message}" =~ /expired/i) {
			update reply {
				Reply-Message := "$PESAN"
			}
		}
	}
}
EOF
  fi
fi

# ---- 3. Validasi & restart --------------------------------------------------
echo "==> Memeriksa konfigurasi"
if freeradius -CX >/dev/null 2>&1; then
  echo "    CONFIG OK"
else
  echo "!! CONFIG ERROR — mengembalikan backup" >&2
  freeradius -CX 2>&1 | grep -iE "error|failed" | head -20 >&2
  BACKUP=$(ls -t "${SITE}".bak-pesan-* | head -1)
  cp -a "$BACKUP" "$SITE"
  systemctl restart freeradius || true
  exit 1
fi

systemctl restart freeradius
sleep 1
systemctl is-active --quiet freeradius && echo "    FreeRADIUS aktif" || {
  echo "!! FreeRADIUS gagal start, cek: journalctl -u freeradius -n 30" >&2; exit 1; }

cat << 'EOF'

=============================================
 Selesai! Sekarang bila voucher/user expired:

 - FreeRADIUS menolak dengan pesan jelas
 - MikroTik menampilkan:
     "Voucher sudah expired, silakan beli voucher baru"
   di halaman login hotspot
 - User yang password-nya salah tetap mendapat
   pesan "invalid username or password" seperti biasa

 Catatan: pesan ini tampil bila halaman login hotspot
 di MikroTik menampilkan variabel $(error)
 (halaman bawaan MikroTik sudah menampilkannya).
=============================================
EOF
