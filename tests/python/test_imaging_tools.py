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
        self.assertNotIn('hdmi_enable_4kp60=1', configure_boot)
        self.assertIn('hdmi_ignore_cec_init=1', configure_boot)
        self.assertNotIn("printf 'hdmi_ignore_cec=1", configure_boot)

        self.assertIn('mabeltv-audio-edid.base64', configure_boot)
        self.assertIn('drm.edid_firmware=HDMI-A-1:edid/mabeltv-audio-edid.bin',
                      configure_boot)
        self.assertIn('mabeltv-edid-initramfs-hook', configure_boot)
        self.assertIn('/etc/initramfs-tools/hooks/mabeltv-edid', configure_boot)
        self.assertIn('update-initramfs -u -k all', configure_boot)

        initramfs_hook = (
            ROOT / "packaging" / "linux" / "mabeltv-edid-initramfs-hook"
        ).read_text(encoding="utf-8")
        self.assertIn('$DESTDIR/usr/lib/firmware/edid', initramfs_hook)
        self.assertIn('mabeltv-audio-edid.bin', initramfs_hook)

        uninstall = (ROOT / "scripts" / "pi" / "uninstall.sh").read_text(
            encoding="utf-8"
        )
        self.assertIn('/etc/initramfs-tools/hooks/mabeltv-edid', uninstall)
        self.assertIn('/lib/firmware/edid/mabeltv-audio-edid.bin', uninstall)
        self.assertIn('update-initramfs -u -k all', uninstall)

        capture = (ROOT / "packaging" / "linux" / "mabeltv-screen-capture").read_text(
            encoding="utf-8"
        )
        capture_stop = (
            ROOT / "packaging" / "linux" / "mabeltv-screen-capture-stop"
        ).read_text(encoding="utf-8")
        activation = (ROOT / "scripts" / "pi" / "activate-assets.sh").read_text(
            encoding="utf-8"
        )
        sudoers = (ROOT / "packaging" / "linux" / "mabeltv-sudoers").read_text(
            encoding="utf-8"
        )
        self.assertIn('runtime_dir=/run/mabeltv-screen-capture', capture)
        self.assertIn('pid_path="$runtime_dir/ffmpeg.pid"', capture)
        self.assertIn('mabeltv-screen-capture-stop', capture)
        self.assertIn('Refusing to stop an unexpected process', capture_stop)
        self.assertIn('mabeltv-screen-capture-stop', activation)
        self.assertIn('mabeltv-screen-capture-stop', sudoers)
        self.assertIn('mabeltv-screen-capture-stop', uninstall)

    def test_pi_images_and_updates_install_cec_runtime(self):
        packages = (ROOT / "packaging/image/pi-gen/stage-mabeltv/00-install/00-packages").read_text(
            encoding="utf-8")
        installer = (ROOT / "scripts/pi/install.sh").read_text(encoding="utf-8")
        self.assertIn("cec-utils", packages.splitlines())
        self.assertIn("cec-utils", installer)

    def test_pi_images_and_updates_install_local_matter_runtime(self):
        packages = (ROOT / "packaging/image/pi-gen/stage-mabeltv/00-install/00-packages").read_text(
            encoding="utf-8")
        installer = (ROOT / "scripts/pi/install.sh").read_text(encoding="utf-8")
        activation = (ROOT / "scripts/pi/activate-assets.sh").read_text(encoding="utf-8")
        service = (ROOT / "packaging/linux/mabeltv-matter.service").read_text(
            encoding="utf-8")
        bridge = (ROOT / "integrations/matter/mabeltv-matter.mjs").read_text(
            encoding="utf-8")
        socket_bridge = (ROOT / "integrations/matter/mabeltv-power-socket.mjs").read_text(
            encoding="utf-8")

        for package in ("nodejs", "npm"):
            self.assertIn(package, packages.splitlines())
            self.assertIn(package, installer)
        for bluetooth_package in ("rfkill", "bluez", "libbluetooth-dev"):
            self.assertNotIn(bluetooth_package, packages.splitlines())
        self.assertIn("mabeltv-matter.service", activation)
        self.assertIn("User=mabeltv", service)
        self.assertNotIn("AF_BLUETOOTH", service)
        self.assertIn("AF_NETLINK", service)
        self.assertNotIn("Conflicts=bluetooth.service", service)
        self.assertIn("/run/mabeltv/portal-control.sock", socket_bridge)
        self.assertIn('on ? "turn-on" : "turn-off"', socket_bridge)
        self.assertIn("getMabelTvPower", bridge)
        self.assertIn("discoveryCapabilities: { onIpNetwork: true, ble: false }", bridge)

    def test_laptop_only_builder_uses_local_arm64_docker_bundle_then_image_recipe(self):
        builder = (ROOT / "scripts" / "imaging" / "build-local-pi-image.sh").read_text(
            encoding="utf-8")
        dockerfile = (ROOT / "packaging" / "image" / "arm64-builder" / "Dockerfile").read_text(
            encoding="utf-8")
        launcher = (ROOT / "scripts" / "imaging" / "build-local-pi-image.ps1").read_text(
            encoding="utf-8")
        self.assertIn("--platform linux/arm64", builder)
        self.assertIn("MABELTV_IMAGE_BUILD=true", builder)
        self.assertIn("build-pi-image.sh", builder)
        self.assertIn("debian:trixie-slim", dockerfile)
        self.assertIn("build-local-pi-image.sh", launcher)

    def test_appliance_image_bypasses_pi_os_account_wizard_without_a_retained_login(self):
        recipe = (ROOT / "scripts" / "imaging" / "build-pi-image.sh").read_text(
            encoding="utf-8")
        firstboot = (
            ROOT
            / "packaging/image/pi-gen/stage-mabeltv/00-install/files/mabeltv-image-firstboot"
        ).read_text(encoding="utf-8")
        self.assertIn("FIRST_USER_NAME='mabeltv-bootstrap'", recipe)
        self.assertIn("FIRST_USER_PASS='${bootstrap_password}'", recipe)
        self.assertIn("DISABLE_FIRST_BOOT_USER_RENAME='1'", recipe)
        self.assertIn("ENABLE_SSH='0'", recipe)
        self.assertIn("userdel -r mabeltv-bootstrap", firstboot)
        self.assertIn("passwd -l root", firstboot)

    def test_first_boot_provisions_before_a_console_login_can_appear(self):
        service = (
            ROOT
            / "packaging/image/pi-gen/stage-mabeltv/00-install/files/mabeltv-image-firstboot.service"
        ).read_text(encoding="utf-8")
        firstboot = (
            ROOT
            / "packaging/image/pi-gen/stage-mabeltv/00-install/files/mabeltv-image-firstboot"
        ).read_text(encoding="utf-8")
        self.assertIn("Before=getty.target multi-user.target", service)
        self.assertIn("Do not use the keyboard", firstboot)


if __name__ == "__main__":
    unittest.main()
