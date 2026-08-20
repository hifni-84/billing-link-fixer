#!/usr/bin/env python3
"""Patch Mikhmon v3 supaya penghapusan voucher expired jalan di RouterOS v6 DAN v7,
sekaligus menambahkan huruf "N" di akhir comment voucher segera setelah user login.
Voucher yang sudah kedaluwarsa ditandai huruf "X" lalu dinonaktifkan/dihapus.

Pakai:  sudo python3 patch-mikhmon-ros7.py /var/www/mikhmon
"""
import io
import os
import re
import shutil
import sys
import time

ROOT = sys.argv[1] if len(sys.argv) > 1 else "/var/www/mikhmon"

# --- Skrip on-login: tulis comment kedaluwarsa (format mmm/dd/yyyy hh:mm:ss) ---
# Mendukung format tanggal RouterOS v6 (aug/20/2026) dan v7 (2026-08-20).
ONLOGIN_ROS = (
    '{:local comment [ /ip hotspot user get [/ip hotspot user find where name="$user"] comment]; '
    ':local ucode [:pic $comment 0 2]; '
    ':if ($ucode = "vc" or $ucode = "up" or $comment = "") do={ '
    ':local norm do={:local ma ("jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"); '
    ':if ([:pic $d 4] = "-") do={:local y [:pic $d 0 4]; :local mo [:tonum [:pic $d 5 7]]; '
    ':local da [:pic $d 8 10]; :local mn [:pick $ma ($mo - 1)]; :return ("$mn/$da/$y");} '
    'else={:return $d;}}; '
    ':local date [ /system clock get date ]; :local nd [$norm d=$date]; :local year [:pic $nd 7 11]; '
    '/sys sch add name="$user" disable=no start-date=$date interval="VALIDITY"; :delay 5s; '
    ':local exp [ /sys sch get [ /sys sch find where name="$user" ] next-run]; '
    ':local le [len $exp]; :local out ("$nd $exp"); '
    ':if ($le = 15) do={:set out ("$[:pic $exp 0 6]/$year $[:pic $exp 7 15]");}; '
    ':if ($le > 15) do={:local sp [:find $exp " "]; :local dp [:pic $exp 0 $sp]; '
    ':local tp [:pic $exp ($sp + 1) [len $exp]]; :set out ("$[$norm d=$dp] $tp");}; '
    '/ip hotspot user set comment=("$out"."N") [find where name="$user"]; '
    ':delay 5s; /sys sch remove [find where name="$user"]'
)

# --- Skrip pemantau (scheduler) : tandai / hapus voucher expired ---
BGSERVICE_ROS = (
    ':local dateint do={:local ma ("jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"); '
    ':if ([:pic $d 4] = "-") do={:return [:tonum ("$[:pic $d 0 4]$[:pic $d 5 7]$[:pic $d 8 10]")];} '
    'else={:local days [:pic $d 4 6]; :local month [:pic $d 0 3]; :local year [:pic $d 7 11]; '
    ':local mi ([:find $ma $month] + 1); '
    ':if ([len $mi] = 1) do={:return [:tonum ("$year"."0"."$mi"."$days")];} '
    'else={:return [:tonum ("$year"."$mi"."$days")];}}}; '
    ':local timeint do={:return ([:tonum [:pic $t 0 2]] * 60 + [:tonum [:pic $t 3 5]]);}; '
    ':local date [ /system clock get date ]; :local time [ /system clock get time ]; '
    ':local today [$dateint d=$date]; :local curtime [$timeint t=$time]; '
    ':foreach i in [ /ip hotspot user find where profile="PROFILE" ] do={ '
    ':local comment [ /ip hotspot user get $i comment]; :local name [ /ip hotspot user get $i name]; '
    ':local ln [len $comment]; '
    ':if ($ln > 9 and [:pic $comment ($ln - 1) $ln] != "X") do={ '
    ':local ok false; '
    ':if ([:pic $comment 3] = "/" and [:pic $comment 6] = "/") do={:set ok true;}; '
    ':if ([:pic $comment 4] = "-" and [:pic $comment 7] = "-") do={:set ok true;}; '
    ':if ($ok) do={ :local sp [:find $comment " "]; '
    ':local dpart [:pic $comment 0 $sp]; :local tpart [:pic $comment ($sp + 1) $ln]; '
    ':local expd [$dateint d=$dpart]; :local expt [$timeint t=$tpart]; '
    ':if ($expd < $today or ($expd = $today and $expt <= $curtime)) do={ '
    '/ip hotspot user set comment=("$comment"."X") $i; '
    '[ /ip hotspot user MODE $i ]; '
    '[ /ip hotspot active remove [find where user=$name] ];}}}}'
)


def php_onlogin_line():
    ros = ONLOGIN_ROS.replace("VALIDITY", "' . $validity . '")
    return (
        "    $onlogin = ':put (\",'.$expmode.',' . $price . ',' . $validity . ','.$sprice.',,' "
        ". $getlock . ',\"); " + ros + "';\n"
    )


def php_bgservice_line():
    ros = BGSERVICE_ROS.replace("PROFILE", "'.$name.'").replace("MODE", "'.$mode.'")
    return "    $bgservice = '" + ros + "';\n"


def patch_file(path):
    with io.open(path, "r", encoding="utf-8", errors="surrogateescape") as f:
        lines = f.readlines()
    changed = False
    for idx, line in enumerate(lines):
        stripped = line.lstrip()
        if stripped.startswith("$onlogin = ':put (\",'.$expmode."):
            lines[idx] = php_onlogin_line()
            changed = True
        elif stripped.startswith("$bgservice = ':local"):
            lines[idx] = php_bgservice_line()
            changed = True
    if not changed:
        print("- lewati (pola tidak ditemukan): %s" % path)
        return
    shutil.copy2(path, "%s.bak-%s" % (path, time.strftime("%Y%m%d%H%M%S")))
    with io.open(path, "w", encoding="utf-8", errors="surrogateescape") as f:
        f.writelines(lines)
    print("+ dipatch: %s" % path)


REMOVE_EXTRA = """
// --- tambahan: hapus juga user yang comment-nya diakhiri "X" (expired, ROS6/ROS7) ---
$allusers = $API->comm("/ip/hotspot/user/print");
foreach ((array) $allusers as $u) {
  $c = isset($u['comment']) ? $u['comment'] : '';
  if ($c !== '' && substr($c, -1) === 'X') {
    $API->comm("/ip/hotspot/user/remove", array(".id" => $u['.id']));
  }
}
"""


def patch_remove(path):
    with io.open(path, "r", encoding="utf-8", errors="surrogateescape") as f:
        src = f.read()
    if "substr(\$c, -1) === 'X'" in src:
        print("- sudah dipatch: %s" % path)
        return
    marker = 'if ($_SESSION[\'ubp\']'
    if marker not in src:
        print("- lewati (pola tidak ditemukan): %s" % path)
        return
    src = src.replace(marker, REMOVE_EXTRA + marker, 1)
    shutil.copy2(path, "%s.bak-%s" % (path, time.strftime("%Y%m%d%H%M%S")))
    with io.open(path, "w", encoding="utf-8", errors="surrogateescape") as f:
        f.write(src)
    print("+ dipatch: %s" % path)


def main():
    if not os.path.isdir(ROOT):
        sys.exit("Folder Mikhmon tidak ditemukan: %s" % ROOT)
    for rel in ("hotspot/adduserprofile.php", "hotspot/userprofilebyname.php"):
        p = os.path.join(ROOT, rel)
        if os.path.isfile(p):
            patch_file(p)
        else:
            print("- tidak ada: %s" % p)
    p = os.path.join(ROOT, "process/removeexpiredhotspotuser.php")
    if os.path.isfile(p):
        patch_remove(p)
    print("Selesai. Buka Mikhmon -> Hotspot -> User Profiles, buka tiap profil lalu klik Save "
          "supaya skrip baru ditulis ke router (berlaku untuk ROS6 dan ROS7).")


main()
