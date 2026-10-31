"""Exercise family uploads and native manifests without a live television."""
from __future__ import annotations

import json
import shutil
import struct
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import zipfile
from unittest import mock

from tests.python.library_test_support import LibraryFixture, mabeltv_library, unittest


class FamilyMediaServiceTests(unittest.TestCase):
    def test_audio_only_story_is_explicit_and_never_changes_normal_playback(self):
        identity = self.library.family_action({"action": "story-create", "title": "Quiet story"})["id"]
        for kind, name in [("audio", "quiet.wav"), ("illustration", "quiet.png")]:
            source = self.fixture.root / name
            source.write_bytes(b"prepared fixture")
            asset = self.library.family_upload_create({"media_kind": kind, "story_id": identity,
                "file_name": name, "size": source.stat().st_size})
            row = self.library.state_database.family_asset(asset["asset_id"])
            path = self.library.family_path(row["source_path"])
            path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(source.read_bytes())
            self.library.state_database.family_asset_update(row["id"], status="ready", prepared_path=row["source_path"], duration=120)
        with mock.patch.object(self.library, "family_player_command") as command:
            quiet = self.library.family_start({"kind":"storytime", "id":identity, "audio_only":True})
            self.assertIs(quiet["settings"]["audio_only"], True)
            self.assertIs(command.call_args.args[0]["audio_only"], True)
            normal = self.library.family_start({"kind":"storytime", "id":identity})
            self.assertNotIn("audio_only", normal["settings"])
            self.assertNotIn("audio_only", command.call_args.args[0])
        for bad in [{"kind":"memories", "audio_only":True}, {"kind":"storytime", "audio_only":"true"}]:
            with self.assertRaises(ValueError): self.library.family_start(bad)

    def test_story_bookmarks_expire_after_an_hour_and_metadata_does_not_extend_them(self):
        from contextlib import closing
        from mabeltv_backend.repositories import family_media as repository
        identity = self.library.family_action({"action": "story-create", "title": "Zog"})["id"]
        with mock.patch.object(repository.time, "time", return_value=10000):
            self.library.family_action({"action": "story-progress", "id": identity, "position": 97})
        with mock.patch.object(repository.time, "time", return_value=13599):
            self.assertEqual(self.library.family_media()["stories"][0]["position_seconds"], 97)
            self.library.family_action({"action": "story-rename", "id": identity, "title": "Zog's adventure"})
            self.library.family_action({"action": "story-progress", "id": identity, "position": 97})
        with mock.patch.object(repository.time, "time", return_value=13600):
            self.assertEqual(self.library.family_media()["stories"][0]["position_seconds"], 0)
            self.assertEqual(self.library.family_stories_native()["stories"][0]["position"], 0)
            # Expiry is a read projection, not a destructive rewrite of progress.
            with closing(self.library.state_database.connect()) as database:
                row = database.execute("SELECT position_seconds,updated FROM storytime_items WHERE id=?", (identity,)).fetchone()
                self.assertEqual(tuple(row), (97, 10000))

    def test_stories_keep_alphabetical_slots_when_listening_progress_changes(self):
        titles = ["Zog", "The Snail and the Whale", "a Highway Rat", "Room on the Broom",
                  "The Gruffalo", "A Bear Hunt", "An Adventure", "the Gruffalo’s Child"]
        identities = {title: self.library.family_action({"action": "story-create", "title": title})["id"]
                      for title in titles}
        expected = ["An Adventure", "A Bear Hunt", "The Gruffalo", "the Gruffalo’s Child",
                    "a Highway Rat", "Room on the Broom", "The Snail and the Whale", "Zog"]
        self.assertEqual([story["title"] for story in self.library.family_media()["stories"]], expected)
        self.library.family_action({"action": "story-progress", "id": identities["a Highway Rat"], "position": 97})
        self.assertEqual([story["title"] for story in self.library.family_stories_native()["stories"]], expected)
        self.assertEqual([story["title"] for story in self.library.state_database.family_catalogue()["stories"]], expected)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg required")
    def test_multiple_chapters_prepare_one_ordered_recording_with_whole_story_resume(self):
        identity = self.library.family_action({"action": "story-create", "title": "Zog"})["id"]
        chapters = [self.generated(f"chapter{index}{extension}", ["-f", "lavfi", "-i",
                    f"sine=frequency={frequency}:duration=1"])
                    for index, (extension, frequency) in enumerate([(".mp3", 300), (".m4a", 600), (".wav", 900)])]
        package = self.fixture.root / "Zog.story.zip"
        with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_STORED) as archive:
            for index in (2, 0, 1):
                archive.write(chapters[index], f"{index + 1:03}-Chapter {index + 1}{chapters[index].suffix}")
        saved = self.upload(package, "audio", story_id=identity)
        self.library.process_conversion(saved["id"])
        asset = self.library.state_database.family_asset(saved["asset_id"])
        self.assertEqual(asset["status"], "ready")
        self.assertTrue(2.9 < asset["duration"] < 3.5, asset["duration"])
        original = self.library.family_path(asset["source_path"])
        self.assertEqual(original.read_bytes(), package.read_bytes())
        prepared = self.library.family_path(asset["prepared_path"])
        for second, frequency in ((.2, 300), (1.2, 600), (2.2, 900)):
            pcm = subprocess.check_output(["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", str(second),
                "-i", str(prepared), "-t", "0.25", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"])
            samples = struct.unpack("<" + "h" * (len(pcm) // 2), pcm)
            crossings = sum(left <= 0 < right for left, right in zip(samples, samples[1:]))
            self.assertAlmostEqual(crossings * 4, frequency, delta=16)
        image = self.generated("cover.png", ["-f", "lavfi", "-i", "color=c=blue:s=320x240", "-frames:v", "1"])
        picture = self.upload(image, "illustration", story_id=identity)
        self.library.process_conversion(picture["id"])
        self.library.family_action({"action": "story-progress", "id": identity, "position": 2.2})
        session = self.library.family_start({"kind": "storytime", "id": identity, "target": "device"})
        self.assertEqual(session["position"], 2.2)
        native = self.library.family_session(session["id"], native=True)
        self.assertEqual(native["position"], 2.2)
        self.assertEqual(native["scenes"][0]["audio"]["source"], prepared.as_uri())
        self.assertFalse(list(self.library.incoming.glob("story-chapters-*")))

    def test_story_packages_reject_paths_and_keep_the_original_for_recovery(self):
        identity = self.library.family_action({"action": "story-create", "title": "Zog"})["id"]
        package = self.fixture.root / "Zog.story.zip"
        with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.writestr("../escape.mp3", b"invalid"); archive.writestr("002-safe.mp3", b"invalid")
        saved = self.upload(package, "audio", story_id=identity)
        with self.assertRaisesRegex(ValueError, "only audio chapter files"):
            self.library.process_conversion(saved["id"])
        asset = self.library.state_database.family_asset(saved["asset_id"])
        self.assertEqual(asset["status"], "error")
        self.assertTrue(self.library.family_path(asset["source_path"]).is_file())
        self.assertFalse((self.library.incoming.parent / "escape.mp3").exists())

    def setUp(self):
        self.fixture = LibraryFixture()
        self.addCleanup(self.fixture.close)
        self.library = self.fixture.library
        self.jobs = []
        self.library.queue_conversion = self.jobs.append
        self.library.state_database.insert_channel({"number": 10, "name": "Family Videos",
            "folder": "Family", "aspect": "fit", "content_type": "memories"})
        self.library.cpu_temperature_c = lambda: 40

    def upload(self, path, kind, **extra):
        saved = self.library.family_upload_create({"file_name": path.name, "size": path.stat().st_size,
            "media_kind": kind, "channel": 10, **extra})
        self.library.append_upload(saved["id"], 0, path.read_bytes())
        return saved

    def generated(self, name, options):
        path = self.fixture.root / name
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *options, str(path)],
                       check=True, capture_output=True, timeout=30)
        return path

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg required")
    def test_portrait_phone_photo_is_prepared_whole_and_original_is_retained(self):
        path = self.generated("phone.jpg", ["-f", "lavfi", "-i", "color=c=green:s=640x360",
            "-frames:v", "1", "-update", "1"])
        # EXIF orientation 6 describes a portrait held in a landscape JPEG.
        tiff = b"II" + struct.pack("<HIH", 42, 8, 1) + struct.pack("<HHI", 0x112, 3, 1) \
            + struct.pack("<H", 6) + b"\0\0" + b"\0\0\0\0"
        exif = b"Exif\0\0" + tiff
        original = path.read_bytes()
        path.write_bytes(original[:2] + b"\xff\xe1" + struct.pack(">H", len(exif) + 2) + exif + original[2:])
        saved = self.upload(path, "photo")
        self.library.process_conversion(saved["id"])
        asset = self.library.state_database.family_asset(saved["asset_id"])
        self.assertEqual(asset["status"], "ready")
        self.assertGreater(asset["height"], asset["width"])
        self.assertEqual(self.library.family_path(asset["source_path"]).read_bytes(), path.read_bytes())
        self.assertTrue(self.library.family_content(asset["id"], True).is_file())
        with self.assertRaisesRegex(ValueError, "Remove the photos"):
            self.library.delete_channel(10)
        self.library.family_action({"action": "remove", "id": asset["id"]})
        self.assertTrue(self.library.family_path(asset["source_path"]).is_file())

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg required")
    def test_story_audio_and_illustration_make_a_private_resumable_native_manifest(self):
        identity = self.library.family_action({"action": "story-create", "title": "A quiet story"})["id"]
        audio = self.generated("story.wav", ["-f", "lavfi", "-i", "sine=frequency=440:duration=1"])
        image = self.generated("story.png", ["-f", "lavfi", "-i", "color=c=blue:s=320x240", "-frames:v", "1"])
        for source, kind in ((audio, "audio"), (image, "illustration")):
            saved = self.upload(source, kind, story_id=identity)
            self.library.process_conversion(saved["id"])
        self.library.family_action({"action": "story-progress", "id": identity, "position": .5})
        with mock.patch.object(self.library, "family_player_command") as player:
            session = self.library.family_start({"kind": "storytime", "id": identity, "target": "device"})
            player.assert_not_called()
        self.assertEqual(session["position"], .5)
        self.assertTrue(session["scenes"][0]["audio"]["source"].startswith("/api/family-media/content"))
        native = self.library.family_session(session["id"], native=True)
        self.assertTrue(native["scenes"][0]["audio"]["source"].startswith("file:///"))
        self.assertNotIn("source_path", json.dumps(session))
        self.assertNotIn("prepared_path", json.dumps(self.library.family_media()))
        catalogue = self.library.family_stories_native()
        self.assertEqual(catalogue["stories"], [{"id": identity, "title": "A quiet story", "ready": True,
            "position": .5, "illustration": native["scenes"][0]["items"][0]["source"]}])
        with mock.patch.object(self.library, "family_player_command") as player:
            self.library.family_control({"action": "open-storytime"})
            player.assert_called_once_with({"command": "open-storytime"})
        self.assertEqual(self.library.state_database.family_catalogue()["stories"][0]["position_seconds"], .5)

    def test_failed_preparation_can_retry_retained_bytes_and_cancel_detaches_asset(self):
        path = self.fixture.root / "broken.mp4"
        path.write_bytes(b"unreadable phone video")
        saved = self.upload(path, "video")
        with mock.patch.object(self.library, "family_probe", side_effect=ValueError("Unreadable")):
            with self.assertRaisesRegex(ValueError, "Unreadable"):
                self.library.process_conversion(saved["id"])
        self.library.unexpected_conversion_error(saved["id"], ValueError("Unreadable"))
        self.assertEqual(self.library.upload_status(saved["id"])["offset"], path.stat().st_size)
        self.assertTrue(next(item for item in self.library.upload_jobs() if item["id"] == saved["id"])["retryable"])
        public = self.library.family_media()["assets"][0]
        self.assertTrue(public["can_retry"])
        self.assertFalse(public["available"])
        self.library.family_action({"action": "retry", "id": saved["asset_id"]})
        self.assertEqual(self.library.family_media()["assets"][0]["status"], "uploading")
        asset = self.library.state_database.family_asset(saved["asset_id"])
        self.library.upload_action(saved["id"], "cancel")
        self.assertEqual(self.library.family_media()["assets"], [])
        self.assertTrue(self.library.family_path(asset["source_path"]).is_file())

    def test_failed_memory_can_be_removed_without_leaving_a_retry_job(self):
        path = self.fixture.root / "broken.mov"
        path.write_bytes(b"original phone bytes")
        saved = self.upload(path, "video")
        with mock.patch.object(self.library, "family_probe", side_effect=ValueError("Unreadable")):
            with self.assertRaises(ValueError):
                self.library.process_conversion(saved["id"])
        self.library.unexpected_conversion_error(saved["id"], ValueError("Unreadable"))
        original = self.library.family_path(self.library.state_database.family_asset(saved["asset_id"])["source_path"])
        self.library.family_action({"action": "remove", "id": saved["asset_id"]})
        self.assertEqual(self.library.family_media()["assets"], [])
        self.assertFalse((self.library.incoming / f"{saved['id']}.json").exists())
        self.assertTrue(original.is_file())

    def test_missing_prepared_memory_is_not_offered_as_playable(self):
        identity = self.library.state_database.family_asset_create({"channel": 10, "kind": "video",
            "title": "Missing", "original_name": "missing.mov", "source_path": ".family-media/originals/missing.mov", "upload_id": "missing"})
        self.library.state_database.family_asset_update(identity, status="ready", prepared_path=".family-media/prepared/missing.mp4")
        public = self.library.family_media()["assets"][0]
        self.assertEqual(public["status"], "error")
        self.assertFalse(public["available"])
        with self.assertRaisesRegex(ValueError, "no longer available"):
            self.library.family_start({"kind": "memories", "channel": 10, "id": identity})
        self.library.family_action({"action": "remove", "id": identity})
        self.assertEqual(self.library.family_media()["assets"], [])

    def test_removing_a_queued_channel_import_keeps_the_old_channel_file(self):
        folder = self.library.media_root / "Family"
        folder.mkdir(exist_ok=True)
        original = folder / "old-memory.mov"
        original.write_bytes(b"original channel video")
        self.library.family_import_channel(10)
        asset = self.library.family_media()["assets"][0]
        upload_id = self.jobs[0]
        self.library.family_action({"action": "remove", "id": asset["id"]})
        self.assertEqual(self.library.family_media()["assets"], [])
        self.assertTrue(original.is_file())
        self.assertFalse((self.library.incoming / f"{upload_id}.json").exists())

    def test_removing_a_running_memory_stops_worker_before_detaching_asset(self):
        path = self.fixture.root / "phone.mov"
        path.write_bytes(b"original phone bytes")
        saved = self.upload(path, "video")
        self.library.queued_conversions.add(saved["id"])
        started = threading.Event()
        failures = []
        def long_conversion(source, destination, options, upload_id=""):
            started.set()
            self.library.family_run([sys.executable, "-c", "import time; time.sleep(60)"], upload_id)
        def worker():
            try:
                self.library.process_conversion(saved["id"])
            except ValueError as error:
                failures.append(str(error))
            finally:
                self.library.finish_conversion_job(saved["id"])
        info = {"streams": [{"codec_type": "video", "codec_name": "h264"}]}
        with mock.patch.object(self.library, "family_probe", return_value=info), \
                mock.patch.object(self.library, "family_ffmpeg", side_effect=long_conversion):
            thread = threading.Thread(target=worker)
            thread.start()
            self.assertTrue(started.wait(3))
            asset = self.library.state_database.family_asset(saved["asset_id"])
            self.library.family_action({"action": "remove", "id": asset["id"]})
            thread.join(3)
            self.assertFalse(thread.is_alive())
        self.assertEqual(failures, ["Memory preparation cancelled"])
        self.assertEqual(self.library.family_media()["assets"], [])
        self.assertTrue(self.library.family_path(asset["source_path"]).is_file())
        self.assertFalse((self.library.incoming / f"{saved['id']}.json").exists())
        self.assertFalse((self.library.incoming / f"{saved['id']}.result.json").exists())

    def test_phone_video_selects_one_decodable_soundtrack(self):
        path = self.fixture.root / "phone.mov"
        path.write_bytes(b"fixture")
        saved = self.upload(path, "video")
        streams = [{"index": 0, "codec_type": "audio", "codec_name": "aac"},
                   {"index": 1, "codec_type": "audio", "codec_name": None},
                   {"index": 2, "codec_type": "video", "codec_name": "h264", "width": 1080, "height": 1920}]
        commands = []
        def prepared(source, destination, options, upload_id=""):
            commands.append(options)
            destination.write_bytes(b"prepared")
        with mock.patch.object(self.library, "family_probe", return_value={"streams": streams, "format": {"duration": "1"}}), \
                mock.patch.object(self.library, "family_ffmpeg", side_effect=prepared):
            self.library.process_conversion(saved["id"])
        self.assertEqual(commands[0][:4], ["-map", "0:v:0", "-map", "0:0"])
        self.assertNotIn("0:a?", commands[0])
        self.assertEqual(self.library.state_database.family_asset(saved["asset_id"])["status"], "ready")

    def test_shuffled_memory_manifest_visits_each_item_once_and_never_exposes_paths(self):
        identities = []
        for index in range(8):
            path = self.library.family_root / "prepared" / f"photo{index}.jpg"
            path.write_bytes(b"image")
            identity = self.library.state_database.family_asset_create({"channel": 10, "kind": "photo",
                "title": str(index), "original_name": path.name, "source_path": ".family-media/originals/unused",
                "upload_id": str(index)})
            self.library.state_database.family_asset_update(identity, status="ready", width=600, height=900,
                prepared_path=path.relative_to(self.library.media_root).as_posix())
            identities.append(identity)
        session = self.library.family_start({"kind": "memories", "channel": 10, "id": identities[3]}, native=True)
        shown = [item["id"] for scene in session["scenes"] for item in scene["items"]]
        self.assertEqual(shown[0], identities[3])
        self.assertCountEqual(shown, identities)
        self.assertEqual(session["title"], "Family Videos")
        self.assertEqual([len(scene["items"]) for scene in session["scenes"]], [2, 1, 3, 2])
        self.assertEqual([scene["layout"] for scene in session["scenes"]], ["duet", "spotlight", "triptych", "duet"])
        self.assertTrue(all(scene["composition_version"] == 2 for scene in session["scenes"]))
        with mock.patch.object(self.library, "family_player_command") as tv_control:
            device = self.library.family_start({"kind": "memories", "channel": 10, "target": "device"})
        tv_control.assert_not_called()
        self.assertCountEqual([item["id"] for scene in device["scenes"] for item in scene["items"]], identities)
        self.assertTrue(all(item["source"].startswith("/api/family-media/content?")
                            for scene in device["scenes"] for item in scene["items"]))

    def test_family_http_routes_require_owner_auth_and_native_header(self):
        server = mabeltv_library.LibraryServer(("127.0.0.1", 0), self.library)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close(), thread.join(2)))
        base = f"http://127.0.0.1:{server.server_address[1]}"
        self.library.portal_pin_required = lambda: True
        for path, expected in (("/api/mabel-playlists", 401), ("/api/family-media", 401),
            ("/api/family-media/content?id=no", 401), ("/api/native/family-media/start?kind=memories&channel=10", 403),
            ("/api/native/family-media/stories", 403)):
            with self.assertRaises(urllib.error.HTTPError) as result:
                urllib.request.urlopen(base + path, timeout=5)
            self.assertEqual(result.exception.code, expected)
            result.exception.close()
        request = urllib.request.Request(base + "/api/native/family-media/stories", headers={"X-MabelTV-Native": "1"})
        with urllib.request.urlopen(request, timeout=5) as response:
            self.assertEqual(json.load(response)["stories"], [])


if __name__ == "__main__":
    unittest.main()
