"""Reversible static-asset theme for GenieACS; never changes database or JS."""
import argparse
import base64
import json
import re
import shutil
from pathlib import Path

MARKER = "/* NAJWANET THEME START */"


def apply_theme(package, theme, assets, backup):
    package, theme, assets, backup = map(Path, (package, theme, assets, backup))
    info = json.loads((package / "package.json").read_text())
    if info.get("name") != "genieacs" or info.get("version", "").split("+")[0] != "1.2.13":
        raise ValueError("Tema ini diuji untuk GenieACS 1.2.13 saja.")
    public = package / "public"
    css_files = list(public.glob("app-*.css"))
    logos = list(public.glob("logo-*.svg"))
    favicons = list(public.glob("favicon-*.png"))
    if len(css_files) != 1 or len(logos) != 1 or len(favicons) != 1:
        raise ValueError("Susunan berkas GenieACS berbeda; tidak ada berkas diubah.")
    for name in ("logo.png", "favicon.png"):
        if not (assets / name).read_bytes().startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Unduhan logo bukan PNG; tidak ada berkas diubah.")
    # Read and validate everything before taking a backup or editing files.
    overrides = (theme / "najwanet.css").read_text()
    css = css_files[0].read_text().split(MARKER)[0].rstrip()
    dimensions = (assets / "logo.png").read_bytes()[16:24]
    width = int.from_bytes(dimensions[:4], "big")
    height = int.from_bytes(dimensions[4:], "big")
    if not width or not height:
        raise ValueError("Ukuran logo tidak valid.")
    encoded = base64.b64encode((assets / "logo.png").read_bytes()).decode()
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copytree(public, backup / "public")
    (backup / "package-path").write_text(str(package.resolve()))
    try:
        shutil.copyfile(assets / "logo.png", public / "najwanet-logo.png")
        shutil.copyfile(assets / "favicon.png", favicons[0])
        logos[0].write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}"><image width="{width}" height="{height}" '
            f'href="data:image/png;base64,{encoded}"/></svg>'
        )
        css_files[0].write_text(css + "\n" + MARKER + "\n" + overrides + "\n")
    except Exception:
        shutil.copytree(backup / "public", public, dirs_exist_ok=True)
        raise


def restore_theme(backup):
    backup = Path(backup)
    package = Path((backup / "package-path").read_text())
    if not (package / "package.json").exists():
        raise ValueError("Lokasi GenieACS berubah; pemulihan dihentikan.")
    shutil.copytree(backup / "public", package / "public", dirs_exist_ok=True)
    custom = package / "public" / "najwanet-logo.png"
    if not (backup / "public" / custom.name).exists():
        custom.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--package")
    parser.add_argument("--theme")
    parser.add_argument("--assets")
    parser.add_argument("--backup", required=True)
    parser.add_argument("--restore", action="store_true")
    args = parser.parse_args()
    if args.restore:
        restore_theme(args.backup)
    else:
        apply_theme(args.package, args.theme, args.assets, args.backup)