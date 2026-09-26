# Perbaikan Deteksi Telegram

## Perubahan
- Pertahankan kategori Browsing Web dan Lainnya.
- Prioritaskan Telegram sebelum klasifikasi browsing/other.
- Baca identitas Telegram dari seluruh metadata flow ntopng, termasuk label nDPI/domain yang tersimpan di kolom berbeda.
- Kenali rentang alamat Telegram IPv4 dan IPv6.
- Pastikan flow Telegram tidak masuk ke Browsing Web atau Lainnya.

## Verifikasi
- Jalankan pemeriksaan kode dan pastikan halaman Trafik Aplikasi tetap dapat dibangun.
- Verifikasi produksi dilakukan setelah server diperbarui dan Telegram dipakai selama 10–20 detik.
