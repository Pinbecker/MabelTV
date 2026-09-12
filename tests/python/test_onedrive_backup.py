"""Contracts for MabelTV's off-device disaster-recovery backup."""

from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class OneDriveBackupTests(unittest.TestCase):
    def Residents(self, relative: str) -> str:
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_local_snapshot_uses_sqlite_backup_and_excludes_media(self) -> None:
        script = self.Residents("scripts/pi/backup-config.sh")
        self.assertIn("source.backup(destination)", script)
        self.assertIn('PRAGMA integrity_check', script)
        self.assertIn('PRAGMA foreign_key_check', script)
        self.assertIn('var/lib/mabeltv/secrets', script)
        self.assertIn('var/lib/mabeltv/matter', script)
        self.assertIn('etc/rc_keymaps/mabeltv.toml', script)
        self.assertNotIn('paths=(srv/mabeltv/media', script)
        self.assertNotIn('mabeltv.db-wal', script)

    def test_remote_backup_is_immutable_verified_and_bounded(self) -> None:
        script = self.Residents("scripts/pi/onedrive-backup.sh")
        self.assertIn('onedrive:Documents/MabelTV\\ Backups/snapshots', script)
        self.assertIn('rclone copyto', script)
        self.assertIn('--immutable', script)
        self.assertIn('rclone cat', script)
        self.assertIn('sha256sum', script)
        self.assertIn('MABELTV_BACKUP_DAILY_KEEP:-35', script)
        self.assertIn('MABELTV_BACKUP_WEEKLY_KEEP:-12', script)
        self.assertIn('MABELTV_BACKUP_MONTHLY_KEEP:-24', script)
        self.assertNotIn('rclone sync', script)

    def test_timer_is_persistent_and_waits_for_network(self) -> None:
        timer = self.Residents("packaging/linux/mabeltv-onedrive-backup.timer")
        service = self.Residents("packaging/linux/mabeltv-onedrive-backup.service")
        self.assertIn('Persistent=true', timer)
        self.assertIn('RandomizedDelaySec=15min', timer)
        self.assertIn('network-online.target', service)
        self.assertIn('ConditionPathExists=/etc/rclone/mabeltv.conf', service)


if __name__ == "__main__":
    unittest.main()
