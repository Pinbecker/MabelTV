"""Family features use isolated databases and never a production media path."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tests.python.library_test_support import mabeltv_library
from mabeltv_backend import database as database_module
from mabeltv_backend.database import StateDatabase
from mabeltv_backend.family_media import FamilyMediaMixin


class FamilyStateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.database = StateDatabase(Path(self.temporary.name) / "state.db")
        self.database.initialise()
        self.database.insert_channel({"number": 1, "name": "Stories", "folder": "Stories", "aspect": "fit", "content_type": "shows"})

    def playlist(self):
        identity = self.database.playlist_change("create", {"name": "A favourite afternoon"})
        for name in ("One.mp4", "Two.mp4"):
            self.database.playlist_change("add", {"id": identity, "channel": 1, "file": name})
        return identity

    def queue_items(self):
        return [{"channel_number": 1, "file_name": name, "title": name, "artwork": "", "channel_name": "Stories"}
                for name in ("One.mp4", "Two.mp4")]

    def test_saved_order_and_identity_follow_channel_renumbering(self):
        identity = self.playlist()
        playlist = self.database.playlists()[0]
        self.database.playlist_change("up", {"id": identity, "item_id": playlist["items"][1]["id"]})
        self.database.update_channel(1, {"number": 4, "name": "Stories", "folder": "Stories", "aspect": "fit", "content_type": "shows"})
        entries = self.database.playlists()[0]["items"]
        self.assertEqual([item["file_name"] for item in entries], ["Two.mp4", "One.mp4"])
        self.assertEqual([item["channel_number"] for item in entries], [4, 4])

    def test_playing_a_copy_never_consumes_the_playlist(self):
        identity = self.playlist()
        queue = self.database.playlist_copy_to_queue(identity, self.queue_items(), replace=True)
        current = queue["items"][0]["id"]
        self.database.mabel_queue_select(current, "tv")
        self.database.mabel_queue_event("started", "tv", current)
        self.database.mabel_queue_event("finish", "tv", current)
        self.assertEqual(len(self.database.playlists()[0]["items"]), 2)
        self.assertEqual(len(self.database.mabel_queue()["items"]), 1)

    def test_repeat_refills_snapshot_for_both_native_and_device_completion(self):
        identity = self.playlist()
        self.database.playlist_change("repeat", {"id": identity, "repeat": True})
        queue = self.database.playlist_copy_to_queue(identity, self.queue_items(), replace=True)
        first_ids = [item["id"] for item in queue["items"]]
        self.database.mabel_queue_select(first_ids[0], "device:test")
        self.database.mabel_queue_event("started", "device:test", first_ids[0])
        queue = self.database.mabel_queue_event("finish", "device:test", first_ids[0])
        self.database.mabel_queue_event("started", "device:test", queue["current_id"])
        queue = self.database.mabel_queue_event("finish", "device:test", queue["current_id"])
        self.assertEqual([item["file_name"] for item in queue["items"]], ["One.mp4", "Two.mp4"])
        self.assertTrue(set(first_ids).isdisjoint(item["id"] for item in queue["items"]))
        self.assertEqual(queue["phase"], "starting")
        self.database.playlist_change("remove", {"id": identity, "item_id": self.database.playlists()[0]["items"][0]["id"]})
        self.assertEqual(len(self.database.mabel_queue()["items"]), 2)

    def test_replace_requires_confirmation_and_clear_disables_repeat(self):
        identity = self.playlist()
        self.database.playlist_change("repeat", {"id": identity, "repeat": True})
        self.database.playlist_copy_to_queue(identity, self.queue_items(), replace=True)
        with self.assertRaisesRegex(ValueError, "Confirm"):
            self.database.playlist_copy_to_queue(identity, self.queue_items(), replace=True)
        self.database.mabel_queue_change("clear")
        self.assertEqual(self.database.mabel_queue()["items"], [])
        self.assertFalse(self.database.mabel_queue()["repeat_playlist"])

    def test_schema_11_upgrade_preserves_parent_and_children(self):
        path = Path(self.temporary.name) / "old.db"
        old = StateDatabase(path)
        with mock.patch.object(database_module, "SCHEMA_VERSION", 11), \
                mock.patch.object(database_module, "MIGRATIONS", database_module.MIGRATIONS[:-1]):
            old.initialise()
        old.insert_channel({"number": 10, "name": "Family Videos", "folder": "Family", "aspect": "fit", "content_type": "shows"})
        old.mabel_queue_change("add", self.queue_items()[0] | {"channel_number": 10})
        before = old.read("channels")
        backup = Path(self.temporary.name) / "before.db"
        import sqlite3
        from contextlib import closing
        with closing(old.connect()) as source, closing(sqlite3.connect(backup)) as destination:
            source.backup(destination)
        result = old.upgrade()
        self.assertEqual(result["previous_schema_version"], 11)
        self.assertEqual(old.read("channels"), before)
        self.assertEqual(old.mabel_queue()["items"][0]["channel_number"], 10)
        connection = old.connect()
        self.addCleanup(connection.close)
        self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        old.update_channel(10, {"number": 10, "name": "Family Videos", "folder": "Family", "aspect": "fit", "content_type": "memories"})
        self.assertEqual(old.read("channels")["channels"][0]["content_type"], "memories")

    def test_story_audio_and_image_are_independent_and_progress_is_retained(self):
        story = self.database.storytime_change("create", {"title": "A little adventure"})
        ids = []
        for kind in ("audio", "illustration"):
            ids.append(self.database.family_asset_create({"kind": kind, "title": "Story", "original_name": "test",
                "source_path": ".family-media/test", "upload_id": kind, "story_id": story}))
        self.database.storytime_change("progress", {"id": story, "position": 123.5})
        saved = self.database.family_catalogue()["stories"][0]
        self.assertEqual((saved["audio_id"], saved["image_id"]), tuple(ids))
        self.assertEqual(saved["position_seconds"], 123.5)
        with self.assertRaises(ValueError):
            self.database.storytime_change("progress", {"id": story, "position": float("nan")})

    def test_compositions_preserve_order_and_pair_short_video_clips_with_photos(self):
        def item(kind, width, height):
            return {"kind": kind, "width": width, "height": height, "title": kind, "duration": 12}
        scenes = FamilyMediaMixin.memory_scenes([item("photo", 600, 900), item("photo", 600, 900),
            item("video", 600, 900), item("photo", 1200, 800), item("photo", 600, 900)], 10)
        self.assertEqual([len(scene["items"]) for scene in scenes], [2, 2, 1])
        self.assertEqual([scene["seconds"] for scene in scenes], [11.6, 8, 10])
        clip = scenes[1]
        self.assertEqual(clip["kind"], "video")
        self.assertEqual(clip["video_index"], 0)
        self.assertGreater(clip["clip_start"], 0)
        self.assertLessEqual(clip["clip_start"] + clip["seconds"], 12)

    def test_a_large_library_gets_varied_bounded_compositions_without_duplicates(self):
        items = [{"id": str(index), "kind": "photo", "width": 600, "height": 900, "title": str(index)} for index in range(29)]
        scenes = FamilyMediaMixin.memory_scenes(items, 10)
        self.assertEqual([item["id"] for scene in scenes for item in scene["items"]], [item["id"] for item in items])
        self.assertEqual(set(scene["layout"] for scene in scenes), {"spotlight", "duet", "triptych"})
        self.assertEqual(set(scene["transition"] for scene in scenes), {"reveal", "rise", "glide", "dissolve"})
        self.assertTrue(all(1 <= len(scene["items"]) <= 3 for scene in scenes))
        for scene in scenes:
            self.assertGreaterEqual(scene["seconds"], 10)
            for key in ("frames", "portrait_frames"):
                self.assertEqual(len(scene[key]), len(scene["items"]))
                for frame in scene[key]:
                    self.assertGreaterEqual(frame["x"], 0)
                    self.assertGreaterEqual(frame["y"], 0)
                    self.assertLessEqual(frame["x"] + frame["width"], 1)
                    self.assertLessEqual(frame["y"] + frame["height"], 1)

    def test_landscapes_and_mixed_compositions_have_a_feature_layout_and_empty_is_empty(self):
        self.assertEqual(FamilyMediaMixin.memory_scenes([], 10), [])
        photos = [{"kind": "photo", "width": 1200, "height": 800, "title": "Family"} for _ in range(6)]
        scenes = FamilyMediaMixin.memory_scenes(photos, 10)
        self.assertEqual([scene["layout"] for scene in scenes], ["panorama", "spotlight", "panorama-feature"])
        self.assertTrue(all(scene["caption"] == "" for scene in scenes))

    def test_videos_are_bounded_even_with_long_photo_pace_and_only_one_decoder_per_scene(self):
        items = [{"id": str(index), "kind": kind, "width": 1280, "height": 720,
                  "title": kind, "duration": duration} for index, (kind, duration) in enumerate([
            ("photo", 0), ("video", 180), ("video", 3), ("photo", 0), ("photo", 0), ("video", 60)])]
        scenes = FamilyMediaMixin.memory_scenes(items, 30)
        self.assertEqual([item["id"] for scene in scenes for item in scene["items"]], [str(index) for index in range(6)])
        self.assertTrue(any(scene["video_index"] == 1 for scene in scenes))
        for scene in scenes:
            videos = [item for item in scene["items"] if item["kind"] == "video"]
            self.assertLessEqual(len(videos), 1)
            if videos:
                self.assertLessEqual(scene["seconds"], 10)
                self.assertLessEqual(scene["clip_start"] + scene["seconds"], videos[0]["duration"])


if __name__ == "__main__":
    unittest.main()
