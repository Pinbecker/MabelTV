"""Exercise the first-boot dependency installer without network or a live Pi."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / "scripts/pi/install-matter-runtime.sh"


@unittest.skipUnless(os.name == "posix" and shutil.which("node"), "Linux runtime installer")
class OfflineRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="matter offline ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.prebuilt = self.root / "prebuilt"
        self.destination = self.root / "matter"
        self.prebuilt.mkdir()
        self.destination.mkdir()
        (self.destination / "package-lock.json").write_bytes(b'{"test":true}')
        self.archive = self.prebuilt / "matter-node-modules.tar.gz"

    def bundle(self, extra=None):
        files = {
            "node_modules/@matter/main/package.json": b'{"type":"module","main":"index.js"}',
            "node_modules/@matter/main/index.js": b'export const offline = true;',
        }
        files.update(extra or {})
        with tarfile.open(self.archive, "w:gz") as archive:
            for name, content in files.items():
                entry = tarfile.TarInfo(name)
                entry.mode = 0o644
                entry.size = len(content)
                archive.addfile(entry, io.BytesIO(content))
        manifest = {"files": {self.archive.name: {
            "sha256": hashlib.sha256(self.archive.read_bytes()).hexdigest()}},
            "matter_lock_sha256": hashlib.sha256(
                (self.destination / "package-lock.json").read_bytes()).hexdigest()}
        (self.prebuilt / "BUILD-MANIFEST.json").write_text(json.dumps(manifest))

    def run_installer(self):
        # Any attempted npm/network fallback fails the test immediately.
        bin_dir = self.root / "bin"
        bin_dir.mkdir(exist_ok=True)
        npm = bin_dir / "npm"
        npm.write_text('#!/bin/sh\necho UNEXPECTED_NPM >&2\nexit 97\n')
        npm.chmod(0o755)
        environment = dict(os.environ, PATH=f'{bin_dir}:{os.environ["PATH"]}')
        result = subprocess.run(["bash", str(INSTALLER), str(self.prebuilt), str(self.destination)],
                                env=environment, capture_output=True, text=True, timeout=30)
        self.assertNotIn("UNEXPECTED_NPM", result.stderr)
        return result

    def test_locked_bundle_installs_and_imports_without_network(self):
        self.bundle()
        result = self.run_installer()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertTrue((self.destination / "node_modules/@matter/main/index.js").is_file())

    def test_modified_archive_is_rejected_before_extraction(self):
        self.bundle()
        self.archive.write_bytes(self.archive.read_bytes() + b"tampered")
        result = self.run_installer()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("checksum", result.stderr)
        self.assertFalse((self.destination / "node_modules").exists())

    def test_missing_new_archive_does_not_fall_back_to_network(self):
        self.bundle()
        self.archive.unlink()
        result = self.run_installer()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("missing its offline", result.stderr)

    def test_mismatched_lockfile_is_rejected(self):
        self.bundle()
        (self.destination / "package-lock.json").write_text("{}")
        result = self.run_installer()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("lockfile", result.stderr)

    def test_path_traversal_is_rejected_even_with_matching_checksum(self):
        self.bundle({"node_modules/../../escaped": b"bad"})
        result = self.run_installer()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("Unsafe path", result.stderr)
        self.assertFalse((self.root / "escaped").exists())


if __name__ == "__main__":
    unittest.main()
