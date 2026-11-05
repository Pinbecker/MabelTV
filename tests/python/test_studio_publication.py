from tests.python.library_test_support import *


class StudioPublicationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.addCleanup(self.fixture.close)
        self.library = self.fixture.library
        self.library.refresh_tv = mock.Mock(return_value=True)
        self.library.tmdb_request = mock.Mock(return_value={"id": 603, "title": "The Matrix",
            "original_title": "The Matrix", "release_date": "1999-03-31", "runtime": 136})
        self.library.opensubtitles_request = mock.Mock(side_effect=AssertionError("Existing subtitles must be retained"))
        self.source = self.library.my_tv_root / "The.Matrix.1999.1080p.BrRip.x264.YIFY.mp4"
        self.source.write_bytes(b"published video")
        self.subtitle = self.source.with_suffix(".en.srt")
        self.subtitle.write_text("1\n00:00:01,000 --> 00:00:02,000\nHello\n", encoding="utf-8")
        self.library.write_my_tv_media_states({self.source.name: {"library_id": "identity-kept", "state": "original",
            "metadata": {"subtitles": {"status": "external", "file": self.subtitle.name}}}})
        self.identity = "a" * 32
        self.receipt = {"id": self.identity, "kind": "my_tv", "complete": True, "status": "complete",
                        "file_name": self.source.name, "folder": "", "offset": self.source.stat().st_size}
        self.library.write_json(self.library.incoming / (self.identity + ".result.json"), self.receipt)
        self.library.state_database.studio_add("delivery", {"id":"delivery", "result":dict(self.receipt),
            "provenance":{"pi":dict(self.receipt)}})
        self.payload = {"file": self.source.name, "studio_upload": self.identity, "tmdb_id": 603}

    def test_late_match_renames_video_and_subtitles_preserving_identity_and_receipt(self):
        response = self.library.tmdb_apply(self.payload)
        target = self.source.with_name("The Matrix (1999).mp4")
        self.assertEqual(target.read_bytes(), b"published video")
        self.assertFalse(self.source.exists())
        self.assertFalse(self.subtitle.exists())
        self.assertTrue(target.with_suffix(".en.srt").is_file())
        self.assertEqual(response["file"], target.name)
        self.assertEqual(response["metadata"]["subtitles"]["file"], "The Matrix (1999).en.srt")
        self.assertEqual(self.library.my_tv_media_states()[target.name]["library_id"], "identity-kept")
        self.assertEqual(self.library.upload_status(self.identity)["file_name"], target.name)
        saved = self.library.state_database.studio_records("delivery")[0]
        self.assertEqual(saved["provenance"]["pi"]["file_name"], target.name)
        # A stale laptop filename after a lost response still finds its upload.
        retry = self.library.tmdb_apply(self.payload)
        self.assertEqual(retry["publication"]["file_name"], target.name)

    def test_existing_target_is_never_overwritten(self):
        target = self.source.with_name("The Matrix (1999).mp4")
        target.write_bytes(b"another copy")
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.library.tmdb_apply(self.payload)
        self.assertEqual(target.read_bytes(), b"another copy")
        self.assertTrue(self.source.is_file())
        self.assertTrue(self.subtitle.is_file())

    def test_interrupted_state_write_recovers_from_upload_journal(self):
        original = self.library.write_my_tv_media_states
        self.library.write_my_tv_media_states = mock.Mock(side_effect=OSError("interrupted"))
        with self.assertRaises(OSError):
            self.library.tmdb_apply(self.payload)
        self.assertIn("title_rename", self.library.upload_status(self.identity))
        self.library.write_my_tv_media_states = original
        response = self.library.tmdb_apply(self.payload)
        self.assertEqual(response["file"], "The Matrix (1999).mp4")
        self.assertNotIn("title_rename", self.library.upload_status(self.identity))
        self.assertEqual(self.library.my_tv_media_states()[response["file"]]["library_id"], "identity-kept")

    def test_only_complete_film_uploads_can_request_automatic_rename(self):
        self.receipt["complete"] = False
        self.library.write_json(self.library.incoming / (self.identity + ".result.json"), self.receipt)
        with self.assertRaisesRegex(ValueError, "completed"):
            self.library.tmdb_apply(self.payload)
        self.assertTrue(self.source.exists())
