#!/usr/bin/env bash
# Perbaikan setelah server mati lampu / listrik padam.
# Gejala di MikroTik: "login failed: RADIUS server is not responding"
# Penyebab umum: MySQL/MariaDB atau FreeRADIUS tidak jalan kembali setelah reboot,
# tabel radacct rusak/terkunci, atau sesi hantu menumpuk sehingga login ditolak.

set -uo pipefail

step() { echo; echo "==> $*"; }
ok()   { echo "    OK"; }
warn() { echo "    !! $*"; }

DB_NAME="${DB_NAME:-radius}"

step "0/6 Bersihkan file cadangan nyasar di folder modul FreeRADIUS"
# FreeRADIUS membaca SEMUA file di mods-enabled/ dan mods-available/.
# File cadangan (*.bak*, *.orig, *~, *.save, *.dpkg-*) membuat modul terbaca dua kali
# -> error: Duplicate module "sql { ... }" dan service menolak start.
FR_DIR="/etc/freeradius/3.0"
BAK_DIR="/var/backups/freeradius"
FOUND=0
if [ -d "$FR_DIR" ]; then
  mkdir -p "$BAK_DIR"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    echo "    pindah: $f"
    mv -f "$f" "$BAK_DIR/$(basename "$f").$(date +%s)" 2>/dev/null && FOUND=$((FOUND+1))
  done < <(find "$FR_DIR/mods-enabled" "$FR_DIR/mods-available" "$FR_DIR/sites-enabled" \
             -maxdepth 1 -type f \( -name '*.bak*' -o -name '*.orig' -o -name '*~' \
             -o -name '*.save' -o -name '*.dpkg-*' -o -name '*.rpmsave' \) 2>/dev/null)
fi
if [ "$FOUND" -gt 0 ]; then
  echo "    $FOUND file dipindahkan ke $BAK_DIR"
else
  echo "    tidak ada file nyasar"
fi

step "1/6 Cek layanan penting"
for svc in mariadb mysql freeradius mikrotik-billing nginx; do
  if systemctl list-unit-files | grep -q "^${svc}.service"; then
    systemctl enable "$svc" >/dev/null 2>&1
    if systemctl is-active --quiet "$svc"; then
      echo "    $svc : aktif"
    else
      echo "    $svc : MATI -> mencoba start"
      systemctl start "$svc" >/dev/null 2>&1 && echo "      berhasil start" || warn "$svc gagal start (lihat: journalctl -u $svc -n 40)"
    fi
  fi
done

step "2/6 Perbaiki tabel database yang rusak akibat listrik padam"
if command -v mysqlcheck >/dev/null 2>&1; then
  mysqlcheck --auto-repair --optimize "$DB_NAME" 2>&1 | tail -n 20 || warn "mysqlcheck gagal"
  ok
else
  warn "mysqlcheck tidak ditemukan, dilewati"
fi

step "3/6 Menutup sesi hantu (sesi yang tidak pernah ditutup saat listrik mati)"
mysql "$DB_NAME" <<'SQL' 2>&1 | tail -n 5
UPDATE radacct
   SET acctstoptime = NOW(),
       acctterminatecause = 'Power-Failure'
 WHERE acctstoptime IS NULL
   AND acctupdatetime < (NOW() - INTERVAL 10 MINUTE);
SELECT ROW_COUNT() AS sesi_ditutup;
SQL
ok

step "4/6 Uji koneksi FreeRADIUS ke database"
if command -v radiusd >/dev/null 2>&1 || command -v freeradius >/dev/null 2>&1; then
  BIN=$(command -v radiusd || command -v freeradius)
  if "$BIN" -CX >/tmp/radius-check.log 2>&1; then
    ok
  else
    warn "konfigurasi FreeRADIUS error. Pesan asli:"
    tail -n 30 /tmp/radius-check.log
    warn "Perbaiki dengan: sudo bash deploy/setup-freeradius-sql.sh"
  fi
else
  warn "FreeRADIUS tidak terpasang"
fi

step "5/6 Restart FreeRADIUS"
if systemctl restart freeradius >/dev/null 2>&1; then
  ok
else
  warn "gagal restart. Pesan asli dari FreeRADIUS:"
  journalctl -u freeradius -n 40 --no-pager 2>&1 | sed 's/^/      /'
  echo "      ---- hasil uji konfigurasi ----"
  if [ -s /tmp/radius-check.log ]; then
    grep -iE 'error|failed|cannot|unknown|denied' /tmp/radius-check.log | tail -n 25 | sed 's/^/      /'
  fi
fi

step "6/6 Ringkasan"
echo "    Sesi aktif sekarang :"
mysql -N -B "$DB_NAME" -e "SELECT COUNT(*) FROM radacct WHERE acctstoptime IS NULL;" 2>/dev/null | sed 's/^/      /'
echo "    Port RADIUS (1812/1813) :"
ss -lunp 2>/dev/null | grep -E '181[23]' | sed 's/^/      /' || echo "      tidak terdeteksi -> FreeRADIUS belum jalan"

echo
echo "Selesai. Coba login voucher dari HP sekarang."
