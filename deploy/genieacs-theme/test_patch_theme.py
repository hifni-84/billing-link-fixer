import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("patch_theme", Path(__file__).with_name("patch_theme.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ThemeSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.package = self.root / "package"
        self.public = self.package / "public"
        self.public.mkdir(parents=True)
        (self.package / "package.json").write_text(json.dumps({"name": "genieacs", "version": "1.2.13"}))
        self.original = {"app-test.css": b"body{margin:0}", "app-test.js": b"original login logic", "logo-test.svg": b"original logo", "favicon-test.png": b"original favicon"}
        for name, value in self.original.items():
            (self.public / name).write_bytes(value)
        self.assets = self.root / "assets"
        self.assets.mkdir()
        png = b"\x89PNG\r\n\x1a\n" + b"\0" * 8 + (100).to_bytes(4, "big") + (30).to_bytes(4, "big")
        for name in ("logo.png", "favicon.png"):
            (self.assets / name).write_bytes(png)

    def apply(self, backup):
        module.apply_theme(self.package, Path(__file__).parent, self.assets, backup)

    def test_authentication_program_is_unchanged(self):
        self.apply(self.root / "backup")
        self.assertEqual((self.public / "app-test.js").read_bytes(), b"original login logic")

    def test_restore_recovers_original_assets(self):
        backup = self.root / "backup"
        self.apply(backup)
        module.restore_theme(backup)
        self.assertEqual({p.name: p.read_bytes() for p in self.public.iterdir()}, self.original)

    def test_unsupported_version_does_not_modify_files(self):
        (self.package / "package.json").write_text(json.dumps({"name": "genieacs", "version": "2.0.0"}))
        with self.assertRaises(ValueError):
            self.apply(self.root / "backup")
        self.assertEqual({p.name: p.read_bytes() for p in self.public.iterdir()}, self.original)

    def test_repeat_apply_does_not_stack_overrides(self):
        self.apply(self.root / "backup1")
        self.apply(self.root / "backup2")
        self.assertEqual((self.public / "app-test.css").read_text().count(module.MARKER), 1)


if __name__ == "__main__":
    unittest.main()