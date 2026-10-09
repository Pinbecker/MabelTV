"""Validate a relocated Windows installer without opening Imager or a disk."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
LAUNCHER = ROOT / "scripts/imaging/open-mabeltv-imager.ps1"


@unittest.skipUnless(os.name == "nt" and shutil.which("powershell.exe"), "Windows launcher")
class ImagerLauncherTests(unittest.TestCase):
    def test_relocated_image_with_spaces_is_rebased_and_checked(self):
        with tempfile.TemporaryDirectory(prefix="Mabel TV installer ") as directory:
            root = Path(directory)
            image = root / "Mabel TV.img.xz"
            image.write_bytes(b"small fake image for manifest resolution")
            (root / "icon.svg").write_text("<svg/>")
            original = {"os_list": [{
                "url": "file:///mnt/old-build/Mabel%20TV.img.xz",
                "icon": "file:///mnt/old-build/icon.svg",
                "image_download_sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
                "extract_sha256": "unchanged",
                "init_format": "cloudinit-rpi"}]}
            manifest = root / "KidsTV.rpi-imager-manifest"
            manifest.write_text(json.dumps(original))
            command = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
                       "-File", str(LAUNCHER), "-Manifest", str(manifest), "-PrepareOnly"]
            result = subprocess.run(command, text=True, capture_output=True, timeout=20)
            self.assertEqual(0, result.returncode, result.stderr)
            resolved = Path(result.stdout.strip().splitlines()[-1])
            try:
                entry = json.loads(resolved.read_text())["os_list"][0]
                self.assertEqual(image.as_uri(), entry["url"])
                self.assertEqual((root / "icon.svg").as_uri(), entry["icon"])
                self.assertEqual("unchanged", entry["extract_sha256"])
                self.assertEqual("cloudinit-rpi", entry["init_format"])
                self.assertEqual(original, json.loads(manifest.read_text()))
                image.write_bytes(b"damaged")
                rejected = subprocess.run(command, text=True, capture_output=True, timeout=20)
                self.assertNotEqual(0, rejected.returncode)
                self.assertIn("failed its checksum", rejected.stderr)
            finally:
                resolved.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
