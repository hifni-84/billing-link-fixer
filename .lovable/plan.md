# Perbaiki popup Print Voucher yang tidak bisa ditutup

## Latar belakang

Pada menu **Voucher & User**, tombol **Cetak Voucher** membuka dialog **Print Voucher** (pilih template + voucher per baris). Pengguna melaporkan dialog ini tidak bisa ditutup (X / Cancel / Escape tidak merespons) padahal sebelumnya bisa.

## Temuan dari pengecekan kode

Pemeriksaan `src/routes/voucher.tsx` (baris 302-320, 1150-1199) dan `src/lib/voucher-template.ts` (baris 166-176) menemukan dua masalah nyata pada alur cetak:

1. **Submit tidak menutup dialog saat popup diblokir browser.**
   `cetakSekarang()`:
   ```ts
   if (!printVouchers(t, data, kolom)) toast.error("Izinkan popup untuk mencetak");
   else setPrintOpen(false);
   ```
   `printVouchers` memanggil `window.open(...)`. Jika browser memblokir popup, `window.open` mengembalikan `null` → fungsi kembali `false` → dialog **tetap terbuka** + toast. Inilah yang membuat dialog "terkunci" terbuka setelah menekan Submit.

2. **Jendela cetak browser tidak pernah ditutup otomatis.**
   `printVouchers()` membuka jendela baru, memanggil `w.print()`, lalu selesai — tidak ada `w.close()`. Jendela print yang tertinggal bisa menangkap fokus sehingga dialog di belakangnya terlihat tidak merespons.

Catatan: tombol Cancel (`onClick={() => setPrintOpen(false)}`), X (`DialogPrimitive.Close`), dan Escape (default Radix `onOpenChange`) secara kode langsung menutup dialog dan seharusnya berfungsi. Karena tidak ada backend RADIUS di sandbox ini, dialog tidak bisa dibuka untuk uji langsung; perbaikan di bawah membuat penutupan menjadi bulletproof dan akan diverifikasi setelah deploy dengan data asli.

## Perubahan

### 1. `src/routes/voucher.tsx` — `cetakSekarang`
Tutup dialog **selalu** saat Submit, lalu cetak. Jika popup diblokir, tampilkan toast (dialog sudah ditutup):
```ts
const cetakSekarang = () => {
  const t = templates.find((x) => x.id === tplId) ?? templates[0] ?? TEMPLATE_DEFAULT;
  const kolom = Math.max(1, Math.min(10, Number(perRow) || 1));
  const data = antrian.slice(0, 2000).map((u, i) => { /* ...map sama... */ });
  setPrintOpen(false);                 // tutup dialog dulu, selalu
  if (!printVouchers(t, data, kolom)) toast.error("Izinkan popup browser untuk mencetak voucher");
};
```

### 2. `src/lib/voucher-template.ts` — `printVouchers`
Tutup jendela cetak otomatis setelah print (dan setelah dialog print native selesai):
```ts
export function printVouchers(t, list, perRow?) {
  const html = buildHtml(t, list, perRow);
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  w.onafterprint = () => { try { w.close(); } catch {} };
  setTimeout(() => { w.print(); }, 400);
  return true;
}
```

### 3. Verifikasi
- Typecheck: `cd /dev-server && npx tsgo --noEmit`.
- Setelah deploy ke server produksi (dengan data RADIUS), buka menu Voucher & User → Cetak Voucher → pastikan X, Cancel, Escape menutup dialog; Submit menutup dialog dan memunculkan jendela cetak lalu tertutup sendiri.

## Deploy
```bash
cd /opt/mikrotik-billing && sudo git pull origin main && sudo npm run build && sudo systemctl restart mikrotik-billing
```

## Catatan
Jika setelah perbaikan ini X/Cancel/Escape masih tidak merespons di lingkungan produksi, kemungkinan penyebabnya interaksi Radix Select-dalam-Dialog (dropdown template terbuka menelan klik pertama). Solusi cadangan yang akan diterapkan bila terjadi: tambahkan `onPointerDownOutside` pada `SelectContent` agar dropdown tertutup tanpa memblokir klik ke tombol Cancel/X. Ini tidak dimasukkan dini karena menunggu konfirmasi gejala pada data asli.
