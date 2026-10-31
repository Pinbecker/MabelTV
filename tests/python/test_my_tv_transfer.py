from tests.python.library_test_support import *


class MyTvTransferTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.library.queue_conversion = mock.Mock()
        self.library.refresh_tv = mock.Mock(return_value=True)
        self.library.video_info = mock.Mock(return_value={})
        self.library._apply_management({"action":"add-channel", "number":1,
            "name":"Films", "folder":"films", "content_type":"films", "aspect":"fit"})
        self.source = self.library.my_tv_root / "Shrek.mp4"
        self.source.write_bytes(b"independent video bytes")
        self.library.my_tv_library()
        states = self.library.my_tv_media_states()
        states["Shrek.mp4"].update(remote_position=123, favourite=True,
            metadata={"title":"Shrek", "tmdb_id":808, "year":"2001"})
        self.library.write_my_tv_media_states(states)

    def tearDown(self):
        self.fixture.close()

    def send(self, **extra):
        return self.library.send_my_tv_to_mabel({"kind":"my_tv", "file":"Shrek.mp4", "channel":1, **extra})

    def test_real_copy_retains_metadata_but_not_private_state(self):
        self.source.with_suffix(".en.srt").write_text("independent subtitles")
        before = self.library.my_tv_media_states()
        result = self.send()
        self.assertFalse((self.fixture.media / "films/Shrek.mp4").exists())
        self.assertEqual(self.library.upload_jobs()[0]["offset"], 0)
        self.assertEqual(self.library.upload_status(result["jobs"][0])["offset"], 0)
        self.library.process_conversion(result["jobs"][0])
        target = self.fixture.media / "films/Shrek.mp4"
        self.assertEqual(target.read_bytes(), self.source.read_bytes())
        self.assertEqual(self.library.my_tv_media_states(), before)
        metadata = self.library.channel_media_states()["programmes"]["1/Shrek.mp4"]
        self.assertEqual(metadata["tmdb_id"], 808)
        self.assertNotIn("remote_position", metadata)
        self.assertNotIn("favourite", metadata)
        self.assertEqual(target.with_suffix(".en.srt").read_text(), "independent subtitles")
        target.write_bytes(b"changed Mabel copy")
        self.assertEqual(self.source.read_bytes(), b"independent video bytes")
        target.unlink()
        self.assertTrue(self.source.is_file())

    def test_duplicate_pending_and_published_copies_never_overwrite(self):
        result = self.send()
        with self.assertRaises(ValueError): self.send()
        self.library.process_conversion(result["jobs"][0])
        with self.assertRaises(ValueError): self.send()

    def test_recovery_resumes_partial_copy_without_duplicating_bytes(self):
        result = self.send(); identity = result["jobs"][0]
        (self.library.incoming / f"{identity}.part").write_bytes(self.source.read_bytes()[:5])
        metadata = self.library.upload_meta(identity); metadata["status"] = "copying"
        self.library.write_json(self.library.incoming / f"{identity}.json", metadata)
        self.library.resume_conversion_jobs()
        self.library.process_conversion(identity)
        self.assertEqual((self.fixture.media / "films/Shrek.mp4").read_bytes(), self.source.read_bytes())

    def test_source_change_and_low_space_fail_without_touching_original(self):
        with mock.patch("mabeltv_backend.my_tv_transfer.shutil.disk_usage", return_value=types.SimpleNamespace(free=0)):
            with self.assertRaises(ValueError): self.send()
        result = self.send()
        self.source.write_bytes(b"changed")
        with self.assertRaises(ValueError): self.library.process_conversion(result["jobs"][0])
        self.assertEqual(self.source.read_bytes(), b"changed")
        self.assertFalse((self.fixture.media / "films/Shrek.mp4").exists())

    def test_complete_show_copies_all_seasons_to_its_own_new_channel(self):
        series_id = self.library.create_my_tv_series("Example")
        for season_number in (1,2):
            season = self.library.my_tv_series_root / series_id / f"Season {season_number}"
            season.mkdir(); (season / f"Example.S{season_number:02d}E01.mp4").write_bytes(b"episode")
        result = self.library.send_my_tv_to_mabel({"kind":"my-tv-series", "series":series_id, "new_channel":"Example"})
        self.assertEqual(result["count"],2)
        for identity in result["jobs"]: self.library.process_conversion(identity)
        target = self.library.channel(result["channel"])
        self.assertEqual(target["content_type"], "shows")
        self.assertEqual(len(list((self.fixture.media / target["folder"]).glob("*.mp4"))),2)
        self.assertEqual(self.library.my_tv_series_library()[0]["episode_count"],2)

    def test_wrong_channel_and_nonlocal_sources_are_rejected(self):
        for payload in [{"kind":"movie", "tmdb_id":808}, {"kind":"my_tv", "file":"../secret.mp4"},
                        {"kind":"my-tv-series", "series":"missing"}]:
            with self.assertRaises(ValueError): self.library.send_my_tv_to_mabel({"channel":1, **payload})
