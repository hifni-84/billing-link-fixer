<?php
/*
 * Najwa Billing - anti kode voucher kembar untuk Mikhmon v3.
 * Dipanggil sesaat sebelum user hotspot ditambahkan ke MikroTik.
 * Kalau kode (username) sudah ada di router atau sudah dipakai pada batch
 * yang sama, kode dibuat ulang otomatis sampai benar-benar unik.
 */

if (!function_exists('njwExistingNames')) {
    /** Ambil daftar nama user hotspot di router (1x per request, lalu di-cache). */
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
