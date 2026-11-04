"""Source recovery and restore contracts, independent of transient queue history."""
import json
import sqlite3
from tests.python.library_test_support import *


class StudioRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.db = self.library.state_database

    def tearDown(self):
        self.fixture.close()

    def claimed(self):
        identity = self.library.studio_add_jobs({"sources": [{"type": "iplayer", "pid": "m0000001", "title": "Test film"}],
                                               "destination": {"kind": "film", "cloudCopies": "optimised"}})["ids"][0]
        self.assertIsNone(self.library.studio_worker_poll({"id": "b" * 32})["job"])
        job = self.library.studio_worker_poll({"id": "a" * 32, "capabilities": ["intel-policy-v2", "compression-presets"]})["job"]
        self.assertEqual(job["id"], identity)
        return job

    def test_original_recovery_survives_history_pruning_and_online_backup_restore(self):
        job = self.claimed()
        cloud = {"id": "cloud-variant", "bytes": 100, "confirmed": True}
        self.library.studio_record_provenance({"job": job["id"], "claim": job["claim"],
            "provenance": {"source": {"bytes": 300, "name": "source.mp4"}, "cloudCopies": {"optimised": cloud}, "policyVersion": 2}})
        with self.db.transaction() as db:
            db.execute("DELETE FROM application_settings WHERE key LIKE 'studio.job.%'")
        snapshot = self.fixture.root / "backup.db"
        source = self.db.connect()
        with sqlite3.connect(snapshot) as target:
            source.backup(target)
        target.close()
        source.close()
        restored = type(self.db)(snapshot)
        self.assertEqual(restored.integrity_report()["foreign_key_errors"], [])
        self.library.state_database = restored
        info = self.library.studio_original_info({"id": "cloud-variant"})
        self.assertTrue(info["available"])
        result = self.library.studio_download_original({"id": "cloud-variant", "destination": {"kind": "icloud"}})
        pending = restored.studio_records("job")[0]
        self.assertEqual(pending["source"]["pid"], "m0000001")
        self.assertEqual(pending["destination"]["preparationIntent"], "compatible")
        self.assertEqual(pending["destination"]["cloudCopies"], "original")
        self.assertEqual(result["ids"], [pending["id"]])

    def test_stale_claim_cannot_overwrite_provenance(self):
        job = self.claimed()
        with self.assertRaisesRegex(ValueError, "claim"):
            self.library.studio_record_provenance({"job": job["id"], "claim": "wrong", "provenance": {}})
        self.assertEqual(self.db.studio_records("delivery"), [])

    def test_pi_optimisation_waits_for_laptop_and_rejects_source_mutation(self):
        source = self.library.my_tv_root / "Film.mp4"
        source.write_bytes(b"original" * 200)
        self.library.write_my_tv_media_states({"Film.mp4": {"library_id": "1" * 32}})
        with mock.patch("mabeltv_backend.transcoding.subprocess.run", side_effect=AssertionError("Pi encoder must not run")):
            self.library.request_my_tv_optimisation("Film.mp4", "compact")
        job = self.db.studio_records("job")[0]
        self.assertEqual(job["source"]["type"], "pi")
        self.assertEqual(self.library.studio_pi_download(job["id"]), source)
        source.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "changed"):
            self.library.studio_pi_download(job["id"])

    def test_private_profile_snapshot_and_credential_boundary(self):
        snapshot = {"version": 1, "sourceId": "a" * 32, "settings": {"workspace": "C:/Media"}, "jobs": []}
        self.library.studio_profile_backup({"worker": "a" * 32, "snapshot": snapshot})
        self.assertEqual(self.library.studio_profile_restore("a" * 32)["snapshot"], snapshot)
        snapshot["settings"]["password"] = "excluded"
        with self.assertRaisesRegex(ValueError, "settings"):
            self.library.studio_profile_backup({"worker": "a" * 32, "snapshot": snapshot})

    def test_interrupted_pi_replacement_keeps_original_and_recovers_identity_without_reencoding(self):
        source = self.library.my_tv_root / "Film.mp4"
        original = b"original" * 1000
        source.write_bytes(original)
        self.library.write_my_tv_media_states({"Film.mp4": {"library_id": "2" * 32, "remote_position": 123}})
        self.library.request_my_tv_optimisation("Film.mp4")
        job = self.library.studio_worker_poll({"id": "a" * 32, "capabilities": ["intel-policy-v2", "compression-presets"]})["job"]
        reply = self.library.studio_pi_return({"job": job["id"], "claim": job["claim"], "size": 1000, "source_id": "a" * 32})
        upload = reply["id"]
        (self.library.incoming / (upload + ".part")).write_bytes(b"p" * 1000)
        self.library.video_info = lambda _: {"codec_name": "h264", "pix_fmt": "yuv420p", "width": 1920, "height": 1080, "avg_frame_rate": "24/1"}
        with mock.patch.object(self.library, "write_my_tv_media_states", side_effect=OSError("interrupted state write")):
            with self.assertRaisesRegex(OSError, "interrupted"):
                self.library.studio_pi_publish_replacement(upload, self.library.upload_meta(upload))
        self.assertEqual((self.library.incoming / (upload + ".previous")).read_bytes(), original)
        result = self.library.studio_pi_publish_replacement(upload, self.library.upload_meta(upload))
        self.assertTrue(result["complete"])
        state = self.library.my_tv_media_states()["Film.mp4"]
        self.assertEqual(state["library_id"], "2" * 32)
        self.assertEqual(state["remote_position"], 123)
        self.assertEqual(source.read_bytes(), b"p" * 1000)
        self.assertFalse((self.library.incoming / (upload + ".previous")).exists())
        self.assertEqual(self.library.studio_pi_publish_replacement(upload, self.library.upload_meta(upload)), result)

    def test_backup_path_cannot_select_other_private_files(self):
        for name in ["../secrets/ntfy.json", "backup.tar.gz", "/etc/passwd"]:
            with self.assertRaises(ValueError):
                self.library.studio_backup_file(name)

    def test_recovered_original_replacement_survives_interrupted_identity_write(self):
        old = self.library.my_tv_root / "Existing.mp4"
        new = self.library.my_tv_root / "Recovered - Pi compatible.mp4"
        old.write_bytes(b"old-copy")
        new.write_bytes(b"high-quality-recovered-copy")
        self.library.write_my_tv_media_states({old.name: {"library_id": "3" * 32, "remote_position": 321}, new.name: {"library_id": "4" * 32}})
        job = self.claimed()
        stat = old.stat()
        job.update(originalRecovery=True)
        job["destination"].update(recoveryMode="replace", replaceFrozen={"receipt": {"kind": "my_tv", "file_name": old.name},
                                    "bytes": stat.st_size, "mtime": stat.st_mtime_ns, "inode": stat.st_ino})
        self.db.studio_add("job", job)
        output = {"complete": True, "kind": "my_tv", "file_name": new.name}
        with mock.patch.object(self.library, "upload_status", return_value=output):
            with mock.patch.object(self.library, "write_my_tv_media_states", side_effect=OSError("interrupted identity write")):
                with self.assertRaisesRegex(OSError, "interrupted"):
                    self.library.studio_finish_recovery({"job": job["id"], "claim": job["claim"], "upload": "c" * 32})
            self.assertEqual((self.library.incoming / (job["id"] + ".recovery-previous")).read_bytes(), b"old-copy")
            result = self.library.studio_finish_recovery({"job": job["id"], "claim": job["claim"], "upload": "c" * 32})
            self.assertTrue(result["complete"])
            self.assertEqual(old.read_bytes(), b"high-quality-recovered-copy")
            state = self.library.my_tv_media_states()[old.name]
            self.assertEqual(state["library_id"], "3" * 32)
            self.assertEqual(state["remote_position"], 321)
            self.assertNotIn(new.name, self.library.my_tv_media_states())
            self.assertEqual(self.library.studio_finish_recovery({"job": job["id"], "claim": job["claim"], "upload": "c" * 32}), result)

    def test_pi_progress_and_laptop_pending_upload_actions_have_one_owner(self):
        source = self.library.my_tv_root / "Film.mp4"
        source.write_bytes(b"original")
        self.library.request_my_tv_optimisation(source.name)
        job = self.library.studio_worker_poll({"id": "a" * 32, "capabilities": ["intel-policy-v2", "compression-presets"]})["job"]
        self.library.studio_worker_poll({"id": "a" * 32, "capabilities": ["intel-policy-v2", "compression-presets"],
                                        "active": {"id": job["id"], "claim": job["claim"], "stage": "preparing", "percent": 42}})
        state = self.library.my_tv_media_states()[source.name]
        self.assertEqual((state["state"], state["progress"]), ("processing", 42))
        upload = "d" * 32
        self.library.write_json(self.library.incoming / (upload + ".json"), {"id": upload, "status": "waiting-laptop", "studioPreparationJob": job["id"], "size": 8})
        self.library.upload_action(upload, "pause")
        self.assertEqual(self.db.studio_records("job")[0]["status"], "paused")
        self.library.upload_action(upload, "resume")
        self.assertEqual(self.db.studio_records("job")[0]["status"], "queued")
        self.library.upload_action(upload, "cancel")
        self.assertEqual(self.db.studio_records("job")[0]["status"], "cancelled")

    def test_backup_retention_keeps_recent_daily_weekly_and_monthly_recovery_points(self):
        import datetime as dt
        from mabeltv_backend.studio_backups import retained_backups
        end = dt.datetime(2026, 11, 4)
        names = [(end - dt.timedelta(days=i)).strftime("MabelTV-Backup-%Y-%m-%dT%H%M%SZ.tar.gz") for i in range(800)]
        keep = retained_backups(names)
        self.assertTrue(set(names[:35]) <= keep)
        self.assertIn("MabelTV-Backup-2025-11-30T000000Z.tar.gz", keep)
        self.assertLess(len(keep), 90)
        self.assertNotIn(names[799], keep)

    def test_offsite_backup_is_verified_by_remote_bytes_before_receipt_or_retention(self):
        import hashlib
        from types import SimpleNamespace
        name = "MabelTV-Backup-2026-11-04T120000Z.tar.gz"
        root = self.library.database_path.parent / "backup-export"
        root.mkdir()
        payload = b"protected-complete-archive"
        (root / name).write_bytes(payload)
        (root / (name + ".sha256")).write_text(hashlib.sha256(payload).hexdigest() + "  " + name)
        self.library._studio_cloud_stat = lambda _: {"Size": len(payload), "ID": "immutable-archive", "ModTime": "same"}
        def downloaded(args, **kwargs):
            kwargs["stdout"].write(payload)
            return SimpleNamespace(returncode=0)
        with mock.patch("mabeltv_backend.studio_backups.subprocess.run", side_effect=downloaded):
            receipt = self.library.studio_backup_confirm({"name": name})
        self.assertTrue(receipt["confirmed"])
        self.assertEqual(receipt["remoteId"], "immutable-archive")
        self.assertEqual(self.db.studio_records("backupreceipt")[0]["sha256"], hashlib.sha256(payload).hexdigest())
        with self.db.transaction() as db:
            db.execute("DELETE FROM application_settings WHERE key LIKE 'studio.backupreceipt.%'")
        def corrupted(args, **kwargs):
            kwargs["stdout"].write(b"different-archive")
            return SimpleNamespace(returncode=0)
        with mock.patch("mabeltv_backend.studio_backups.subprocess.run", side_effect=corrupted):
            with self.assertRaisesRegex(ValueError, "checksum"):
                self.library.studio_backup_confirm({"name": name})
        self.assertEqual(self.db.studio_records("backupreceipt"), [])
        self.assertEqual((root / name).read_bytes(), payload)
