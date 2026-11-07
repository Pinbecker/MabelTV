"""Version isolation, subtitle recovery and live-file presence contracts."""
import base64
import sqlite3
from tests.python.library_test_support import *
from mabeltv_backend.subtitle_matching import movie_hash


SRT = b"1\n00:00:01,000 --> 00:00:02,000\nOriginal dialogue\n"


class StudioVersionsSubtitleTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.db = self.library.state_database
        self.video = self.library.my_tv_root / "Film.mp4"
        self.video.write_bytes(b"video" * 30000)
        self.source = {"kind": "my_tv", "file": self.video.name}
        self.library.write_my_tv_media_states({self.video.name: {"library_id": "a" * 32,
            "metadata": {"tmdb_id": 100, "media_type": "movie", "title": "Film"}}})
        self.library.opensubtitles_key = mock.Mock(return_value="private-test-key")
        self.library.refresh_tv = mock.Mock()
        self.library.studio_cloud_files = [self.cloud("a", "Film.mkv", 200), self.cloud("b", "Film.mp4", 100)]
        self.library.studio_cloud_title_for_file = mock.Mock(return_value={"title": "Film", "metadata": {"tmdb_id": 100, "media_type": "movie"}})

    def tearDown(self):
        self.fixture.close()

    def cloud(self, identity, name, size):
        return {"id": identity * 24, "path": "Films/" + name, "name": name, "bytes": size,
            "modified": "v1", "remoteId": "remote-" + identity, "extension": Path(name).suffix,
            "kind": "video" if Path(name).suffix in {".mp4", ".mkv"} else "file"}

    def receive(self, data=SRT, **extra):
        return self.library.subtitle_receive({"source": self.source, "data": base64.b64encode(data).decode(), **extra})

    def test_subtitle_alternatives_survive_selection_off_and_backup_without_touching_video(self):
        original = self.video.stat()
        first = self.receive()["track"]
        second = self.receive(SRT.replace(b"Original", b"Alternative"), label="Other release")["track"]
        current = self.library.subtitle_tracks({"source": self.source})
        self.assertEqual(len(current["tracks"]), 2)
        for choice in (first, "off", second):
            self.library.subtitle_select({"source": self.source, "fingerprint": current["fingerprint"], "track": choice})
        self.assertIn("Alternative", self.video.with_suffix(".en.srt").read_text())
        self.assertEqual((original.st_ino, original.st_size, original.st_mtime_ns),
                         (self.video.stat().st_ino, self.video.stat().st_size, self.video.stat().st_mtime_ns))
        self.library.refresh_tv.assert_not_called()
        snapshot = self.fixture.root / "subtitles-backup.db"
        connection = self.db.connect()
        with sqlite3.connect(snapshot) as backup:
            connection.backup(backup)
        backup.close()
        connection.close()
        self.assertEqual(len(type(self.db)(snapshot).studio_records("subtitles")[0]["tracks"]), 2)

    def test_replaced_video_rejects_old_track_and_stale_selection(self):
        first = self.receive()["track"]
        current = self.library.subtitle_tracks({"source": self.source})
        self.video.write_bytes(b"different cut")
        with self.assertRaisesRegex(ValueError, "version changed"):
            self.library.subtitle_select({"source": self.source, "fingerprint": current["fingerprint"], "track": first})

    def test_unselected_included_tracks_are_kept_without_overwriting_selection(self):
        first = self.receive()["track"]
        self.receive(SRT.replace(b"Original", b"Foreign-only"), activate=False)
        current = self.library.subtitle_tracks({"source": self.source})
        self.assertEqual(current["selected"], first)
        self.assertEqual(len(current["tracks"]), 2)

    def test_transfer_retry_does_not_overwrite_user_selection(self):
        first = self.receive()["track"]
        current = self.library.subtitle_tracks({"source": self.source})
        self.library.subtitle_select({"source": self.source, "track": "off", "fingerprint": current["fingerprint"]})
        self.receive()
        self.assertEqual(self.library.subtitle_tracks({"source": self.source})["selected"], "off")
        self.assertIn(first, [track["id"] for track in self.db.studio_records("subtitles")[0]["tracks"]])

    def test_replacement_tracks_rebind_to_kept_identity_without_old_cut_sidecars(self):
        self.receive()
        new = self.library.my_tv_root / "New copy.mp4"
        new.write_bytes(b"new edition")
        new.with_suffix(".srt").write_bytes(SRT.replace(b"Original", b"New cut"))
        states = self.library.my_tv_media_states()
        states[new.name] = {"library_id": "b" * 32}
        self.library.write_my_tv_media_states(states)
        snapshot = self.library.subtitle_replacement_snapshot({"kind":"my_tv","file_name":self.video.name}, {"kind":"my_tv","file_name":new.name})
        new.replace(self.video)
        self.library.subtitle_replacement_restore({"kind":"my_tv","file_name":self.video.name}, snapshot)
        result = self.library.subtitle_tracks({"source":self.source})
        self.assertEqual(len(result["tracks"]), 1)
        self.assertIn("New cut", self.db.studio_records("subtitles")[0]["tracks"][0]["text"])

    def test_search_download_is_bound_to_version_and_preserves_included_track(self):
        self.receive()
        self.library.opensubtitles_request = mock.Mock(side_effect=[
            {"data": [{"attributes": {"language": "en", "release": "Film Rogue Cut", "fps": 23.976, "files": [{"file_id": 45}]}}]},
            {"link": "https://example.invalid/track"}])
        self.library.opensubtitles_download_bytes = mock.Mock(return_value=SRT.replace(b"Original", b"Rogue"))
        result = self.library.subtitle_search({"source": self.source, "query": "Film Rogue Cut"})
        self.assertEqual(result["results"][0]["label"], "Film Rogue Cut")
        self.library.subtitle_download({"source": self.source, "id": "45"})
        self.assertEqual(len(self.library.subtitle_tracks({"source": self.source})["tracks"]), 2)
        with self.assertRaisesRegex(ValueError, "Search"):
            self.library.subtitle_download({"source": self.source, "id": "999"})

    def test_automatic_matching_does_not_install_popular_wrong_release(self):
        self.library.subtitle_availability = mock.Mock(return_value={"status": "missing"})
        self.library.opensubtitles_request = mock.Mock(return_value={"data": [{"attributes": {"language": "en",
            "download_count": 90000, "moviehash_match": False, "files": [{"file_id": 99}]}}]})
        self.library.opensubtitles_download_bytes = mock.Mock()
        self.assertEqual(self.library.fetch_automatic_subtitle(self.video, 100)["status"], "unavailable")
        self.library.opensubtitles_download_bytes.assert_not_called()
        self.assertEqual(len(movie_hash(self.video)), 16)

    def test_cloud_delete_keeps_other_version_and_its_shared_or_specific_subtitles(self):
        self.library.studio_cloud_files += [self.cloud("c", "Film.en.srt", 40), self.cloud("d", "Film.mp4.en.srt", 50), self.cloud("e", "Film.mkv.en.srt", 60)]
        item = self.library.studio_cloud_files[0]
        self.library.studio_cloud_operation({"action": "delete", "confirmed": True, "items": [item]})
        deleted = [item["path"] for item in self.db.studio_records("cloudop")[0]["items"]]
        self.assertEqual(deleted, ["Media/Films/Film.mkv", "Media/Films/Film.mkv.en.srt"])
        actual = self.library.studio_cloud_item("b" * 24)
        self.assertEqual({item["path"] for item in actual["subtitles"]}, {"Films/Film.en.srt", "Films/Film.mp4.en.srt"})

    def test_presence_matches_metadata_and_keep_does_not_download_again(self):
        presence = self.library.studio_presence({"ids": ["a" * 24]})
        copy = presence["items"][0]["copies"][0]
        self.assertEqual(copy["source"], self.source)
        source = {"type": "cloud", "id": "a" * 24, "existingCopy": {"mode": "keep", "key": copy["key"], "fingerprint": copy["fingerprint"]}}
        self.assertEqual(self.library.studio_add_jobs({"sources": [source], "destination": {"kind": "film"}})["ids"], [])
        source["existingCopy"]["mode"] = "replace"
        self.library.studio_add_jobs({"sources": [source], "destination": {"kind": "film"}})
        job = self.db.studio_records("job")[0]
        self.assertTrue(job["originalRecovery"])
        self.assertEqual(job["destination"]["replaceFrozen"]["bytes"], self.video.stat().st_size)
        self.assertTrue(self.video.exists())
        self.video.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "copy changed"):
            self.library.studio_add_jobs({"sources": [source], "destination": {"kind": "film"}})

    def test_presence_requires_specific_episode_and_ignores_removed_files(self):
        copies = [{"tmdb_id": 100, "media_type": "tv", "season": 1, "episode": 2}]
        self.library.studio_local_copies = mock.Mock(return_value=copies)
        self.library.studio_cloud_title_for_file.return_value = {"metadata": {"tmdb_id": 100, "media_type": "tv"}}
        self.library.studio_cloud_item = mock.Mock(return_value={"id": "a" * 24, "series": 1, "episodeNumber": 3})
        self.assertEqual(self.library.studio_presence({"ids": ["a" * 24]})["items"][0]["copies"], [])
        self.library.studio_cloud_item.return_value["episodeNumber"] = 2
        self.assertEqual(self.library.studio_presence({"ids": ["a" * 24]})["items"][0]["copies"], copies)
