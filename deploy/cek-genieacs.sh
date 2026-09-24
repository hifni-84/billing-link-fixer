#!/usr/bin/env bash
# Pemeriksaan baca-saja GenieACS di server billing (tidak mengubah modem atau layanan).
# Jalankan: bash deploy/cek-genieacs.sh hadi
set -uo pipefail

TARGET="${1:-hadi}"
HOST="192.168.23.5"

echo '== Layanan GenieACS dan database =='
for service in mongod mongodb acs-alias-ip genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui; do
  if systemctl list-unit-files "$service.service" --no-legend 2>/dev/null | grep -q "$service.service"; then
    printf '%-19s %s\n' "$service" "$(systemctl is-active "$service" 2>/dev/null || true)"
  fi
done

echo; echo '== Alamat dan port server =='
ip -br -4 addr 2>/dev/null | grep -F "$HOST" || echo "Alamat $HOST belum terlihat pada antarmuka server (periksa apakah IP ini memang milik server)."
ss -ltn 2>/dev/null | awk 'NR == 1 || /:7547 |:7557 /'

echo; echo '== Akses HTTP dari server =='
for url in "http://127.0.0.1:7547" "http://${HOST}:7547" "http://127.0.0.1:7557/devices/?projection=_id&limit=1"; do
  # 404/405 dari CWMP juga membuktikan port terjangkau; kode 000 berarti koneksi gagal.
  printf '%s → ' "$url"
  curl --noproxy '*' -sS --connect-timeout 2 --max-time 5 -o /dev/null -w 'HTTP %{http_code}\n' "$url" 2>&1 || true
done

echo; echo '== Data modem di NBI (nomor seri, user PPPoE, atau nama akses TR-069; tanpa sandi) =='
python3 - "$TARGET" <<'PY'
import collections
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

target = sys.argv[1].strip().lower()
fields = [
    '_id', '_lastInform', '_tags',
    'InternetGatewayDevice.DeviceInfo.SerialNumber',
    'InternetGatewayDevice.WANDevice', 'InternetGatewayDevice.X_HW_WANDevice',
    'InternetGatewayDevice.X_ZTE-COM_WANDevice',
    'InternetGatewayDevice.ManagementServer.ConnectionRequestUsername',
    'Device.DeviceInfo.SerialNumber', 'Device.ManagementServer.ConnectionRequestUsername',
    'Device.PPP', 'Device.IP',
]
url = 'http://127.0.0.1:7557/devices/?' + urllib.parse.urlencode({'projection': ','.join(fields)})
try:
    with urllib.request.urlopen(urllib.request.Request(url), timeout=15) as res:
        devices = json.load(res)
except (OSError, ValueError) as exc:
    print('NBI tidak dapat dibaca dari server billing:', type(exc).__name__, str(exc)[:160])
    sys.exit(1)
if not isinstance(devices, list):
    print('NBI tidak mengembalikan daftar modem.')
    sys.exit(1)

def leaves(obj, path=''):
    if isinstance(obj, dict):
        if '_value' in obj:
            yield path, str(obj['_value'] or '')
        for key, val in obj.items():
            if not key.startswith('_'):
                yield from leaves(val, path + '.' + key if path else key)

dates = collections.Counter()
matches = []
for doc in devices:
    when = str(doc.get('_lastInform') or '')
    if when:
        dates[when[:10]] += 1
    serials = [val for path, val in leaves(doc) if path.endswith('DeviceInfo.SerialNumber')]
    names = [val for path, val in leaves(doc) if path.endswith('.Username') and ('WANPPPConnection.' in path or 'PPP.Interface.' in path)]
    tags = [str(v) for v in doc.get('_tags', [])]
    # Nama akses TR-069 hanya untuk pencarian, tidak pernah dicetak bersama hasil.
    request_users = [val for path, val in leaves(doc) if path.endswith('ManagementServer.ConnectionRequestUsername')]
    searchable = serials + names + tags + request_users + [str(doc.get('_id', ''))]
    if target and any(target in value.lower() for value in searchable):
        matches.append((serials[0] if serials else str(doc.get('_id', '')), when or '-', names))

print('Total modem:', len(devices))
print('Tanggal laporan terbanyak (UTC):')
for day, count in dates.most_common(5):
    print(' ', day, ':', count, 'modem')
print('Jumlah modem yang cocok:', len(matches))
for serial, when, names in matches[:20]:
    print('  Seri:', serial, '| Lapor:', when, '| User PPPoE:', ', '.join(names) or '-')
if not matches:
    print('Tidak ada kecocokan: cari dengan nomor seri yang tertera di bodi modem; jika belum ada, periksa jalur modem ke ACS.')
PY

echo; echo 'Log rinci (jangan kirim sebelum memeriksa apakah ada data rahasia): journalctl -u genieacs-cwmp -n 30'
echo 'Pemeriksaan selesai. Tidak ada pengaturan yang diubah.'