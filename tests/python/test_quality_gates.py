"""Regression checks for the source, CI, and release qualification boundaries."""

from __future__ import annotations

import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class QualityGateTests(unittest.TestCase):
    def test_cmake_requires_every_portable_runtime_test(self) -> None:
        cmake = (PROJECT_ROOT / "CMakeLists.txt").read_text(encoding="utf-8")

        self.assertIn("find_program(NODE_EXECUTABLE node REQUIRED)", cmake)
        for test_name in (
            "mabeltv_javascript_source_syntax",
            "mabeltv_offline_service_worker_tests",
            "mabeltv_matter_socket_tests",
        ):
            self.assertIn(f"NAME {test_name}", cmake)

    def test_ci_enforces_native_and_installed_pwa_contracts(self) -> None:
        workflow = (PROJECT_ROOT / ".github/workflows/quality.yml").read_text(
            encoding="utf-8"
        )

        self.assertIn("ubuntu-source-quality:", workflow)
        self.assertIn("windows-pwa-contract:", workflow)
        self.assertIn("node-version: '22.14.0'", workflow)
        self.assertIn("run: ctest --test-dir build --output-on-failure", workflow)
        self.assertIn("run: npm ci --ignore-scripts", workflow)
        self.assertIn("run: npx playwright install chromium webkit", workflow)
        self.assertIn("run: npm test", workflow)
        self.assertIn("uses: actions/upload-artifact@v4", workflow)
        self.assertNotIn("continue-on-error: true", workflow)

    def test_release_bundle_is_tied_to_clean_recorded_source(self) -> None:
        builder = (PROJECT_ROOT / "scripts/pi/make-release-bundle.sh").read_text(
            encoding="utf-8"
        )

        required_contracts = (
            "Refusing a release from a dirty working tree",
            'commit="$(git -C "$source_root" rev-parse HEAD)"',
            'git -C "$source_root" archive "$commit"',
            '"dirty_source": sys.argv[4] == "true"',
            '"target": "raspberry-pi-4-arm64"',
            '"sha256": hashlib.sha256(path.read_bytes()).hexdigest()',
            "Corresponding source",
        )
        for contract in required_contracts:
            self.assertIn(contract, builder)

    def test_product_install_verifies_before_atomic_activation(self) -> None:
        installer = (PROJECT_ROOT / "scripts/pi/install.sh").read_text(
            encoding="utf-8"
        )

        manifest_check = installer.index("Release integrity check failed")
        unit_check = installer.index('systemd-analyze verify "$verify_dir"/*')
        activation = installer.index(
            'ln -sfn "$release_dir" /opt/mabeltv/current.new'
        )
        self.assertLess(manifest_check, unit_check)
        self.assertLess(unit_check, activation)
        self.assertIn('mv -Tf /opt/mabeltv/current.new /opt/mabeltv/current', installer)
        self.assertIn('restore_failed_release "$release_dir"', installer)


if __name__ == "__main__":
    unittest.main()
