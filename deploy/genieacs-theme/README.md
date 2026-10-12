# NAJWANET — tampilan GenieACS

Tema untuk GenieACS **1.2.13** standalone, bukan halaman billing.
Mengganti logo dan favicon, serta merapikan form login dengan warna teal, latar terang, dan kolom yang lebih besar.

## Pasang di server

```bash
cd /opt/mikrotik-billing
sudo git pull origin main
sudo bash deploy/apply-genieacs-theme.sh
```

Buka `http://192.168.23.251:3001`, lalu tekan **Ctrl+F5**.
Tidak perlu membangun ulang atau merestart billing. Akun dan password tetap sama.
Tema tidak mengubah database, parameter modem, konfigurasi Safrin, atau program login.
Judul tab bawaan GenieACS tetap dipertahankan agar tidak perlu mengubah program JavaScript.

Installer membuat cadangan lengkap berkas tampilan dan mencetak perintah pemulihan.
Jika GenieACS dipasang ulang atau diperbarui, berkas tampilan bisa terganti; jalankan installer lagi hanya pada versi yang didukung.
Logo diunduh sekali dari aset proyek lalu disajikan lokal oleh GenieACS, tidak bergantung CDN saat login.
Jika unduhan tidak dapat diakses, installer berhenti sebelum mengubah berkas.

## Pengujian

```bash
python3 -m unittest discover -s deploy/genieacs-theme -p 'test_*.py'
```