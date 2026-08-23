#!/usr/bin/env python3
"""Patch Mikhmon v3 agar kode voucher hasil generate / quick print tidak pernah kembar.

Cara kerja: sebelum tiap user hotspot ditambahkan ke MikroTik, kode diperiksa
terhadap daftar user yang sudah ada di router dan kode lain pada batch yang sama.
Kalau kembar, kode dibuat ulang otomatis.

Pakai:  sudo python3 deploy/patch-mikhmon-unique.py [/var/www/mikhmon ...]
Tanpa argumen: semua folder /var/www/mikhmon* akan dipatch.
"""
import glob
import os
import re
import shutil
import sys
import time

HELPER_SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mikhmon-unique.php")
MARK = "NAJWA-UNIQUE"
REQUIRE_LINE = (
    "/* " + MARK + " */ if (file_exists(__DIR__.'/../include/najwa-unique.php')) "
    "{ require_once(__DIR__.'/../include/najwa-unique.php'); }\n"
)
ADD_CALL = '$API->comm("/ip/hotspot/user/add"'


def patch_file(path: str, manual: bool = False) -> bool:
    with open(path, "r", encoding="utf-8", errors="ignore") as fh:
        src = fh.read()
    if MARK in src:
        print("  - %s: sudah dipatch" % os.path.basename(path))
        return False
    if ADD_CALL not in src:
        print("  ! %s: tidak ada pemanggilan user/add, dilewati" % os.path.basename(path))
        return False

    # 1. Sisipkan require helper setelah session_start().
    if "session_start();" in src:
        src = src.replace("session_start();", "session_start();\n" + REQUIRE_LINE, 1)
    else:
        src = re.sub(r"^<\?php", "<?php\n" + REQUIRE_LINE, src, count=1)

    if manual:
        # User manual: nama tidak boleh diubah otomatis, jadi cukup ditolak.
        def repl_manual(m):
            indent, expr = m.group(1), m.group(2).strip()
            return (
                indent
                + "if (function_exists('njwBlockDup')) { njwBlockDup($API, " + expr + "); }\n"
                + m.group(0).lstrip("\r\n")
            )

        # Tangkap ekspresi nilai "name" pada pemanggilan add.
        pattern = (
            r"([ \t]*)"
            + re.escape(ADD_CALL)
            + r"[^;]*?[\"']name[\"']\s*=>\s*([^,\)]+)"
        )
        new_src, n = re.subn(pattern, lambda m: repl_manual(m), src, flags=re.S)
        if n == 0:
            print("  ! %s: pola nama user tidak dikenali, dilewati" % os.path.basename(path))
            return False
        src = new_src
    else:
        # 2. Sisipkan pemeriksaan unik tepat sebelum setiap penambahan user batch.
        def repl(m):
            indent = m.group(1)
            return (
                indent
                + "if (function_exists('njwUniq')) { njwUniq($API, $u[$i], $p[$i], $char, $userl, $prefix, $user); }\n"
                + indent
                + ADD_CALL
            )

        src = re.sub(r"([ \t]*)" + re.escape(ADD_CALL), repl, src)

    shutil.copy2(path, path + ".bak-" + time.strftime("%Y%m%d%H%M%S"))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(src)
    print("  OK %s" % os.path.basename(path))
    return True


BATCH_FILES = ("hotspot/generateuser.php", "hotspot/quickuser.php")


def patch_root(root: str) -> None:
    print("Mikhmon: %s" % root)
    inc = os.path.join(root, "include")
    if not os.path.isdir(inc):
        print("  ! bukan folder Mikhmon (tidak ada include/), dilewati")
        return
    shutil.copyfile(HELPER_SRC, os.path.join(inc, "najwa-unique.php"))
    for name in BATCH_FILES:
        target = os.path.join(root, name)
        if os.path.isfile(target):
            patch_file(target)
        else:
            print("  ! %s tidak ada" % name)

    # File lain yang menambah user (mis. tambah user manual) juga dijaga.
    batch_abs = {os.path.abspath(os.path.join(root, n)) for n in BATCH_FILES}
    for path in sorted(glob.glob(os.path.join(root, "**", "*.php"), recursive=True)):
        if os.path.abspath(path) in batch_abs:
            continue
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                if ADD_CALL not in fh.read():
                    continue
        except OSError:
            continue
        patch_file(path, manual=True)


def main() -> None:
    if not os.path.isfile(HELPER_SRC):
        sys.exit("File helper tidak ditemukan: %s" % HELPER_SRC)
    roots = sys.argv[1:] or sorted(glob.glob("/var/www/mikhmon*"))
    if not roots:
        sys.exit("Tidak ada folder Mikhmon di /var/www")
    for root in roots:
        if os.path.isdir(root):
            patch_root(root)
    print("SELESAI. Coba generate voucher lagi di Mikhmon.")


if __name__ == "__main__":
    main()
