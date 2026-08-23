<?php
/*
 * Najwa Billing - anti kode voucher kembar untuk Mikhmon v3.
 * Dipanggil sesaat sebelum user hotspot ditambahkan ke MikroTik.
 * Kalau kode (username) sudah ada di router atau sudah dipakai pada batch
 * yang sama, kode dibuat ulang otomatis sampai benar-benar unik.
 */

if (!function_exists('njwExistingNames')) {
    /**
     * Ambil daftar kode yang sudah terpakai:
     *  - nama user hotspot di router
     *  - kode voucher pada nama record Report Mikhmon di /system script
     *  - semua kode yang tertulis di nama/isi /system script
     * Diambil 1x per request lalu di-cache.
     */
    function njwExistingNames($API, $reload = false)
    {
        static $names = null;
        if ($names === null || $reload) {
            $names = array();

            $rows = $API->comm("/ip/hotspot/user/print", array(".proplist" => "name"));
            if (is_array($rows)) {
                foreach ($rows as $row) {
                    if (isset($row['name']) && $row['name'] !== "") {
                        $names[strtolower($row['name'])] = true;
                    }
                }
            }

            // Kode yang tersimpan di /system script (mis. script expired/monitor Mikhmon).
            $scripts = $API->comm("/system/script/print", array(".proplist" => "name,source"));
            if (is_array($scripts)) {
                foreach ($scripts as $sc) {
                    if (isset($sc['name']) && $sc['name'] !== "") {
                        $scriptName = (string) $sc['name'];
                        $names[strtolower($scriptName)] = true;

                        // Report Mikhmon menyimpan penjualan dalam nama script:
                        // tanggal-|-jam-|-USERNAME-|-harga-|-alamat-|-mac-|-
                        // masa-aktif-|-profil-|-komentar. Username harus diambil
                        // dari kolom ke-3; sebelumnya hanya seluruh nama record
                        // yang dibandingkan sehingga voucher expired bisa dipakai lagi.
                        if (strpos($scriptName, '-|-') !== false) {
                            $reportFields = explode('-|-', $scriptName);
                            if (isset($reportFields[2])) {
                                $reportName = trim((string) $reportFields[2]);
                                if ($reportName !== "") {
                                    $names[strtolower($reportName)] = true;
                                }
                            }
                        }
                    }
                    if (isset($sc['source']) && $sc['source'] !== "") {
                        // Ambil semua token alfanumerik 3-16 karakter dari isi script.
                        if (preg_match_all('/[A-Za-z0-9_-]{3,16}/', $sc['source'], $m)) {
                            foreach ($m[0] as $tok) {
                                $names[strtolower($tok)] = true;
                            }
                        }
                    }
                }
            }
        }
        return $names;
    }
}


if (!function_exists('njwRandCode')) {
    /** Buat kode acak sesuai mode karakter yang dipilih di form Mikhmon. */
    function njwRandCode($char, $len)
    {
        $len = (int) $len;
        if ($len < 3) {
            $len = 5;
        }
        if ($len > 12) {
            $len = 12;
        }
        switch ($char) {
            case 'lower':
                return randLC($len);
            case 'upper':
                return randUC($len);
            case 'upplow':
                return randULC($len);
            case 'mix':
                return randNLC($len);
            case 'mix1':
                return randNUC($len);
            case 'mix2':
                return randNULC($len);
            default:
                return randN($len);
        }
    }
}

if (!function_exists('njwUniq')) {
    /**
     * Pastikan $name unik. Untuk mode voucher (vc) password mengikuti username.
     * $mode: "vc" (voucher) atau "up" (user & password terpisah).
     */
    function njwUniq($API, &$name, &$pass, $char, $len, $prefix, $mode)
    {
        static $seen = array();
        $existing = njwExistingNames($API);
        $len = (int) $len;
        if ($len < 3) {
            $len = 5;
        }
        $key = strtolower((string) $name);
        $tries = 0;
        while (($name === "" || isset($existing[$key]) || isset($seen[$key])) && $tries < 80) {
            $tries++;
            // Setelah beberapa kali gagal, panjangkan kode supaya ruang acaknya lebih besar.
            $extra = $tries > 40 ? 1 : 0;
            $name = $prefix . njwRandCode($char, $len + $extra);
            if ($mode === "vc") {
                $pass = $name;
            }
            $key = strtolower($name);
        }
        if (isset($existing[$key]) || isset($seen[$key])) {
            // Jalan terakhir: tempel angka waktu agar tetap tidak kembar.
            $name = $prefix . njwRandCode($char, $len) . substr((string) microtime(true), -3);
            if ($mode === "vc") {
                $pass = $name;
            }
            $key = strtolower($name);
        }
        if ($mode === "vc") {
            $pass = $name;
        }
        $seen[$key] = true;
    }
}

if (!function_exists('njwTaken')) {
    /**
     * Cek apakah $name sudah dipakai (user hotspot mana pun - profil apa pun -
     * atau tercatat pada Report Mikhmon di /system script, mis. voucher expired).
     * Dipakai untuk penambahan user MANUAL: tidak boleh diubah otomatis,
     * jadi cukup dilaporkan sebagai duplikat.
     */
    function njwTaken($API, $name)
    {
        $name = trim((string) $name);
        if ($name === "") {
            return false;
        }
        $existing = njwExistingNames($API);
        return isset($existing[strtolower($name)]);
    }
}

if (!function_exists('njwBlockDup')) {
    /** Hentikan proses + beri pesan bila kode/username manual sudah dipakai. */
    function njwBlockDup($API, $name)
    {
        if (!njwTaken($API, $name)) {
            return;
        }
        $safe = htmlspecialchars((string) $name, ENT_QUOTES);
        echo "<div style=\"font-family:sans-serif;padding:16px;color:#b91c1c\">"
            . "<b>Gagal:</b> kode/username <b>" . $safe . "</b> sudah dipakai "
            . "(user hotspot lain atau riwayat Report Mikhmon). "
            . "Pakai kode lain.</div>"
            . "<script>try{alert('Kode/username " . $safe . " sudah dipakai. Pakai kode lain.');history.back();}catch(e){}</script>";
        exit;
    }
}
