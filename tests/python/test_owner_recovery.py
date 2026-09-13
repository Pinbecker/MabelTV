from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
AUTH_PATH = PROJECT_ROOT / "scripts" / "pi" / "mabeltv_backend" / "auth.py"

# Load through the real package because auth.py has relative imports.
sys.path.insert(0, str(AUTH_PATH.parents[1]))
from mabeltv_backend.auth import AuthenticationMixin  # noqa: E402
from mabeltv_backend.constants import PRODUCT_NAME  # noqa: E402


class RecoverySubject(AuthenticationMixin):
    pass


class OwnerRecoveryTests(unittest.TestCase):
    def test_recovery_snapshot_preserves_tv_identity(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            recovery = root / "recovery" / "owner-reset-test"
            recovery.mkdir(parents=True)
            (recovery / "owner.json").write_text(json.dumps({
                "child_name": "Mabel", "tv_name": "MabelTV",
            }), encoding="utf-8")
            subject = RecoverySubject()
            subject.owner_recovery_path = root / "owner-recovery-pending"
            subject.owner_recovery_path.write_text(str(recovery), encoding="utf-8")

            self.assertEqual(("Mabel", "MabelTV"), subject.recovery_tv_identity())

    def test_recovery_snapshot_cannot_escape_recovery_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            outside = root / "outside"
            outside.mkdir()
            (outside / "owner.json").write_text(json.dumps({
                "child_name": "Wrong", "tv_name": "WrongTV",
            }), encoding="utf-8")
            subject = RecoverySubject()
            subject.owner_recovery_path = root / "owner-recovery-pending"
            subject.owner_recovery_path.write_text(str(outside), encoding="utf-8")

            self.assertEqual(("", PRODUCT_NAME), subject.recovery_tv_identity())


if __name__ == "__main__":
    unittest.main()
