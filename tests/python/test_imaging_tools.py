import argparse
import hashlib
import importlib.util
import lzma
import pathlib
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "imaging" / "generate-imager-manifest.py"
SPEC = importlib.util.spec_from_file_location("generate_imager_manifest", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ImagerManifestTests(unittest.TestCase):
    def test_local_xz_manifest_hashes_compressed_and_extracted_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            raw = (b"KidsTV image\0" * 4096) + b"end"
            image = root / "KidsTV.img.xz"
            image.write_bytes(lzma.compress(raw))
            icon = root / "icon.svg"
            icon.write_text("<svg xmlns='http://www.w3.org/2000/svg'/>", encoding="utf-8")
            args = argparse.Namespace(
                image=image,
                icon=icon,
                image_url=None,
                icon_url=None,
                version="0.2.2",
                website="https://example.test/mabeltv",
                release_date="2026-08-20",
            )

            manifest = MODULE.build_manifest(args)
            entry = manifest["os_list"][0]

            self.assertEqual(hashlib.sha256(raw).hexdigest(), entry["extract_sha256"])
            self.assertEqual(len(raw), entry["extract_size"])
            self.assertEqual(hashlib.sha256(image.read_bytes()).hexdigest(), entry["image_download_sha256"])
            self.assertEqual(image.stat().st_size, entry["image_download_size"])
            self.assertEqual("cloudinit-rpi", entry["init_format"])
            self.assertEqual(["pi4-64bit"], entry["devices"])
            self.assertTrue(entry["url"].startswith("file:"))

    def test_remote_manifest_requires_web_urls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            image = root / "KidsTV.img"
            image.write_bytes(b"image")
            icon = root / "icon.svg"
            icon.write_text("<svg/>", encoding="utf-8")
            args = argparse.Namespace(
                image=image,
                icon=icon,
                image_url="ftp://example.test/image.img",
                icon_url="https://example.test/icon.svg",
                version="1.0.0",
                website="https://example.test",
                release_date="2026-08-20",
            )
            with self.assertRaisesRegex(ValueError, "https"):
                MODULE.build_manifest(args)

    def test_recipe_uses_shared_product_installer_and_preserves_update_path(self):
        firstboot = (
            ROOT
            / "packaging/image/pi-gen/stage-mabeltv/00-install/files/mabeltv-image-firstboot"
        ).read_text(encoding="utf-8")
        installer = (ROOT / "scripts/pi/install-product.sh").read_text(encoding="utf-8")
        shared_installer = (ROOT / "scripts/pi/install.sh").read_text(encoding="utf-8")
        self.assertIn('"${installers[0]}" --enable-ir --skip-packages', firstboot)
        self.assertIn("scripts/pi/install.sh", installer)
        self.assertIn("--product-install", installer)
        self.assertIn('-f /etc/rc_keymaps/mabeltv.toml', shared_installer)

    def test_boot_configuration_preserves_existing_ir_unless_explicitly_disabled(self):
        configure_boot = (ROOT / "scripts" / "pi" / "configure-boot.sh").read_text(
            encoding="utf-8")
        self.assertIn('ir_mode="preserve"', configure_boot)
        self.assertIn('--disable-ir', configure_boot)
        self.assertIn('existing_ir_line=', configure_boot)


if __name__ == "__main__":
    unittest.main()
