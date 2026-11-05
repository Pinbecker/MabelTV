from tests.python.library_test_support import *


class StudioActivityHistoryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.addCleanup(self.fixture.close)
        self.library = self.fixture.library
        self.db = self.library.state_database

    def test_dismiss_hides_only_history_and_preserves_media_receipts_and_recovery(self):
        media = self.library.my_tv_root / "The Matrix.mp4"
        media.write_bytes(b"existing-media")
        job = {"id": "a" * 32, "title": "The Matrix", "source": {"type": "iplayer", "pid": "m0000001"},
               "destination": {"kind": "film"}, "created": 1, "updated": 2, "status": "complete",
               "stage": "complete", "result": {"complete": True, "file_name": media.name}, "claim": "existing"}
        self.db.studio_add("job", job)
        self.library.studio_job_action({"id": job["id"], "action": "dismiss"})
        stored = self.db.studio_records("job")[0]
        self.assertEqual((stored["status"], stored["claim"]), ("complete", "existing"))
        self.assertTrue(stored["historyHidden"])
        self.assertEqual(self.library.studio_status()["jobs"], [])
        self.assertEqual(media.read_bytes(), b"existing-media")
        self.assertEqual(self.db.studio_records("acquisition")[0]["source"]["pid"], "m0000001")
        self.assertTrue(self.db.studio_records("delivery")[0]["result"]["complete"])

    def test_working_items_cannot_be_dismissed(self):
        for status in ["queued", "active", "paused"]:
            self.db.studio_add("job", {"id": "b" * 32, "title": "Working", "status": status})
            with self.assertRaisesRegex(ValueError, "Finish or cancel"):
                self.library.studio_job_action({"id": "b" * 32, "action": "dismiss"})
            self.assertFalse(self.db.studio_records("job")[0].get("historyHidden"))

    def test_legacy_series_artwork_remains_readable_without_allowing_arbitrary_paths(self):
        for name in ["adult-series-" + "a" * 32 + "-95396.jpg", "my-tv-series-" + "b" * 32 + "-60573.jpg"]:
            target = self.library.my_tv_series_artwork_root / name
            target.write_bytes(b"poster")
            self.assertEqual(self.library.my_tv_series_artwork(name), target)
        for name in ["../private.jpg", "adult-series-arbitrary.jpg", "/etc/passwd"]:
            with self.assertRaises(ValueError):
                self.library.my_tv_series_artwork(name)
