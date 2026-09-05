"""Contracts for the guarded portal-only Raspberry Pi deployment path."""

from __future__ import annotations

import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEPLOY_SCRIPT = PROJECT_ROOT / "scripts/windows/deploy-portal-to-pi.ps1"


class PortalDeployContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = DEPLOY_SCRIPT.read_text(encoding="utf-8")

    def test_fast_path_is_strictly_portal_only(self) -> None:
        self.assertIn("scripts/pi/portal/", self.source)
        self.assertIn("mixedNativeChanges", self.source)
        self.assertIn("unsupportedServiceChanges", self.source)
        self.assertIn("will not delete live files", self.source)
        self.assertNotIn("restart mabeltv.service", self.source)

    def test_validation_precedes_the_live_handoff(self) -> None:
        validation = self.source.index("'diff', '--check'")
        browser = self.source.index("'playwright', 'test', 'portal.spec.mjs'")
        install = self.source.index("sudo install -m 0644")
        self.assertLess(validation, install)
        self.assertLess(browser, install)
        self.assertIn("tests.python.test_architecture_guardrails", self.source)
        self.assertIn("Increment SHELL_CACHE first", self.source)

    def test_live_handoff_is_backed_up_and_verified(self) -> None:
        self.assertIn("/var/backups/mabeltv/portal-quick-", self.source)
        self.assertIn("restoring the previous live files", self.source)
        self.assertIn("Get-FileHash -Algorithm SHA256", self.source)
        self.assertIn("sha256sum", self.source)
        self.assertIn("curl -sS", self.source)
        self.assertIn("NRestarts", self.source)
        self.assertIn("vcgencmd get_throttled", self.source)

    def test_script_never_commits_or_pushes(self) -> None:
        self.assertNotIn("git commit", self.source)
        self.assertNotIn("git push", self.source)
        self.assertIn("No native build, player restart, commit, or push", self.source)


if __name__ == "__main__":
    unittest.main()
