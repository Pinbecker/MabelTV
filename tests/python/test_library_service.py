from __future__ import annotations

import argparse
import http.cookiejar
import importlib.util
import json
import os
import tempfile
import threading
import time
import types
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = PROJECT_ROOT / "scripts" / "pi" / "mabeltv-library.py"
SPEC = importlib.util.spec_from_file_location("mabeltv_library", MODULE_PATH)
assert SPEC and SPEC.loader
mabeltv_library = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mabeltv_library)


class LibraryFixture:
    def __init__(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.media = self.root / "media"
        self.channels = self.root / "channels.json"
        self.settings = self.root / "settings.json"
        self.owner = self.root / "owner.json"
        self.config = self.root / "library.conf"
        self.config.write_text("MABELTV_SETUP_CODE=135790\n", encoding="utf-8")
        self.settings.write_text('{"schema_version": 1}\n', encoding="utf-8")
        args = argparse.Namespace(
            media_root=str(self.media),
            channels=str(self.channels),
            settings=str(self.settings),
            owner=str(self.owner),
            config=str(self.config),
        )
        self.library = mabeltv_library.Library(args)
        self.library.admin_action = lambda action: "ok"

    def close(self) -> None:
        self.library.close()
        self.temporary.cleanup()


class LibraryUnitTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def test_browser_upload_form_supports_resumable_multi_file_batches(self) -> None:
        index = mabeltv_library.INDEX
        self.assertRegex(index, r'id="file"[^>]+\bmultiple\b')
        self.assertIn("let selectedUploadFiles = []", index)
        self.assertIn("$('#file').onchange", index)
        self.assertIn("selectedUploadFiles.push(file)", index)
        self.assertIn("const files = selectedUploadFiles.slice()", index)
        self.assertIn("for (let index = 0; index < files.length; index += 1)", index)
        self.assertIn("await sendSelectedFile(files[index]", index)
        self.assertIn("failures.push({ file: files[index], message: error.message })", index)
        self.assertIn('id="childName"', index)
        self.assertIn("/api/identity", index)
        self.assertNotIn("KidsTV", index)
        self.assertIn("state.tv_name", index)

    def test_first_run_hashes_pin_and_creates_generic_channels(self) -> None:
        result = self.fixture.library.complete_setup({
            "setup_code": "135790",
            "owner_name": "Sam",
            "child_name": "Mabel",
            "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.assertTrue(result["ok"])
        owner = json.loads(self.fixture.owner.read_text(encoding="utf-8"))
        self.assertNotIn("pin", owner)
        self.assertNotEqual(owner["pin_hash"], "2468")
        self.assertTrue(self.fixture.library.verify_pin("2468"))
        self.assertFalse(self.fixture.library.verify_pin("0000"))
        self.assertEqual(owner["child_name"], "Mabel")
        self.assertEqual(owner["tv_name"], "MabelTV")
        self.assertEqual(self.fixture.library.public_setup()["tv_name"], "MabelTV")
        channels = json.loads(self.fixture.channels.read_text(encoding="utf-8"))["channels"]
        self.assertEqual([channel["name"] for channel in channels],
                         ["Kids TV", "Cartoons", "Films", "Family Videos"])
        self.assertEqual([channel["content_type"] for channel in channels],
                         ["shows", "shows", "films", "films"])
        for channel in channels:
            self.assertTrue((self.fixture.media / channel["folder"]).is_dir())

    def test_seeded_channels_do_not_misidentify_a_fresh_install_as_recovery(self) -> None:
        self.fixture.channels.write_text(json.dumps({
            "schema_version": 1, "channels": mabeltv_library.DEFAULT_CHANNELS,
        }), encoding="utf-8")
        self.assertFalse(self.fixture.library.public_setup()["recovering_owner"])

    def test_setup_code_is_one_time_and_channel_paths_are_sanitised(self) -> None:
        with self.assertRaisesRegex(ValueError, "setup code"):
            self.fixture.library.complete_setup({
                "setup_code": "000000", "pin": "2468",
                "channels": mabeltv_library.DEFAULT_CHANNELS,
            })
        channels = self.fixture.library.normalise_channels([
            {"number": 7, "name": "Nature", "folder": "../../Nature", "aspect": "fit"}
        ])
        self.assertEqual(channels[0]["folder"], "Nature")
        self.assertEqual(channels[0]["content_type"], "shows")
        inferred_film = self.fixture.library.normalise_channels([
            {"number": 8, "name": "Movies", "folder": "movies", "aspect": "fit"}
        ])
        self.assertEqual(inferred_film[0]["content_type"], "films")

    def test_tv_name_adds_tv_suffix_and_can_be_changed_later(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468", "child_name": "Mabel TV",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.assertEqual(self.fixture.library.library()["owner"]["tv_name"], "MabelTV")
        with mock.patch.object(self.fixture.library, "admin_action", return_value=""):
            result = self.fixture.library.change_tv_name({"child_name": "John"})
        self.assertEqual(result["tv_name"], "JohnTV")
        self.assertEqual(self.fixture.library.library()["owner"]["child_name"], "John")

    def test_login_attempts_are_rate_limited(self) -> None:
        address = "192.0.2.1"
        for _ in range(5):
            self.assertTrue(self.fixture.library.login_allowed(address))
            self.fixture.library.record_login_failure(address)
        self.assertFalse(self.fixture.library.login_allowed(address))
        self.fixture.library.clear_login_failures(address)
        self.assertTrue(self.fixture.library.login_allowed(address))

    def test_atomic_settings_updates_do_not_drop_parallel_changes(self) -> None:
        def change_channel(number: int) -> None:
            def mutate(settings: dict) -> None:
                values = set(settings["disabled_channels"])
                values.add(number)
                settings["disabled_channels"] = sorted(values)
            self.fixture.library.update_settings(mutate)

        workers = [threading.Thread(target=change_channel, args=(number,))
                   for number in range(1, 9)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()
        values = self.fixture.library.settings()["library"]["disabled_channels"]
        self.assertEqual(values, list(range(1, 9)))

    def test_parent_overlay_style_is_validated_persisted_and_exposed(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)
        self.assertEqual(
            self.fixture.library.library()["appearance"]["parent_overlay_style"],
            "classic")
        self.fixture.library.manage({
            "action": "set-parent-overlay-style", "style": "modern",
        })
        self.assertEqual(
            self.fixture.library.settings()["parent_overlay_style"], "modern")
        self.assertEqual(
            self.fixture.library.library()["appearance"]["parent_overlay_style"],
            "modern")
        self.assertFalse(
            self.fixture.library.library()["appearance"]["tv_guide_enabled"])
        self.fixture.library.manage({
            "action": "set-tv-guide-enabled", "enabled": True,
        })
        self.assertTrue(self.fixture.library.settings()["tv_guide_enabled"])
        self.assertTrue(
            self.fixture.library.library()["appearance"]["tv_guide_enabled"])
        self.assertEqual(self.fixture.library.refresh_tv.call_count, 2)
        with self.assertRaisesRegex(ValueError, "classic or modern"):
            self.fixture.library.manage({
                "action": "set-parent-overlay-style", "style": "neon",
            })
        with self.assertRaisesRegex(ValueError, "on or off"):
            self.fixture.library.manage({
                "action": "set-tv-guide-enabled", "enabled": "yes",
            })

    def test_tv_scrubbing_setting_is_validated_persisted_and_exposed(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)
        settings = self.fixture.library.library()["tv_settings"]
        self.assertFalse(settings["scrubbing_enabled"])

        updated = {
            **settings,
            "scrubbing_enabled": True,
        }
        self.fixture.library.manage({
            "action": "set-tv-settings", "settings": updated,
        })

        self.assertTrue(self.fixture.library.settings()["scrubbing_enabled"])
        self.assertTrue(self.fixture.library.library()["tv_settings"]["scrubbing_enabled"])
        self.fixture.library.refresh_tv.assert_called_once()

        legacy_portal_settings = {key: value for key, value in updated.items()
                                  if key != "scrubbing_enabled"}
        self.fixture.library.manage({
            "action": "set-tv-settings", "settings": legacy_portal_settings,
        })
        self.assertTrue(self.fixture.library.settings()["scrubbing_enabled"])

        updated["scrubbing_enabled"] = "yes"
        with self.assertRaisesRegex(ValueError, "scrubbing"):
            self.fixture.library.manage({
                "action": "set-tv-settings", "settings": updated,
            })

    def test_high_frame_rate_uploads_use_one_background_conversion_worker(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        active = 0
        maximum_active = 0
        counter_lock = threading.Lock()

        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 1920, "height": 1080,
            "avg_frame_rate": "50/1",
        }

        def optimise(source: Path, destination: Path) -> None:
            nonlocal active, maximum_active
            with counter_lock:
                active += 1
                maximum_active = max(maximum_active, active)
            time.sleep(0.1)
            destination.write_bytes(source.read_bytes())
            with counter_lock:
                active -= 1

        self.fixture.library.optimise_for_playback = optimise
        self.fixture.library.refresh_tv = lambda: True
        uploads = []
        for name in ("first.mov", "second.mov"):
            created = self.fixture.library.upload_create({
                "channel": 1, "file_name": name, "size": 16,
            })
            result = self.fixture.library.append_upload(created["id"], 0, b"x" * 16)
            self.assertTrue(result["processing"])
            uploads.append(created["id"])

        deadline = time.monotonic() + 4
        states = []
        while time.monotonic() < deadline:
            states = [self.fixture.library.upload_status(upload_id)
                      for upload_id in uploads]
            if all(state.get("complete") for state in states):
                break
            time.sleep(0.03)
        self.assertTrue(all(state.get("complete") for state in states))
        self.assertEqual(maximum_active, 1)

    def test_adult_upload_stays_original_until_owner_requests_optimisation(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 3840, "height": 2160,
            "avg_frame_rate": "60/1",
        }
        def optimise(source: Path, destination: Path) -> None:
            destination.write_bytes(source.read_bytes())

        self.fixture.library.optimise_adult_for_playback = mock.Mock(side_effect=optimise)
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

        created = self.fixture.library.adult_upload_create({
            "file_name": "My Film.mkv", "size": 16,
        })
        result = self.fixture.library.append_upload(created["id"], 0, b"raw-film-content")
        self.assertTrue(result["processing"])

        deadline = time.monotonic() + 3
        state = {}
        while time.monotonic() < deadline:
            state = self.fixture.library.upload_status(created["id"])
            if state.get("complete"):
                break
            time.sleep(0.02)

        self.assertTrue(state.get("complete"))
        self.assertFalse(state.get("optimised"))
        self.assertEqual((self.fixture.library.adult_root / "My Film.mkv").read_bytes(),
                         b"raw-film-content")
        self.assertEqual(self.fixture.library.adult_library()[0]["display_name"],
                         "My Film")
        self.assertFalse(any((self.fixture.media / channel["folder"] / "My Film.mkv").exists()
                             for channel in mabeltv_library.DEFAULT_CHANNELS))
        self.fixture.library.optimise_adult_for_playback.assert_not_called()
        self.fixture.library.refresh_tv.assert_called_once()

        self.fixture.library.manage({"action": "optimise-adult", "file": "My Film.mkv"})
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            films = self.fixture.library.adult_library()
            if films and films[0]["playback_state"] == "optimised":
                break
            time.sleep(0.02)
        self.assertEqual((self.fixture.library.adult_root / "My Film.mp4").read_bytes(),
                         b"raw-film-content")
        self.assertFalse((self.fixture.library.adult_root / "My Film.mkv").exists())
        self.assertEqual(self.fixture.library.adult_library()[0]["playback_state"], "optimised")
        self.fixture.library.optimise_adult_for_playback.assert_called_once()

    def test_pi_ready_adult_upload_is_kept_without_conversion(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "codec_name": "h264", "pix_fmt": "yuv420p",
            "width": 1280, "height": 720, "avg_frame_rate": "24000/1001",
        }
        self.fixture.library.optimise_adult_for_playback = mock.Mock()
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

        created = self.fixture.library.adult_upload_create({
            "file_name": "Ready Film.mp4", "size": 5,
        })
        self.fixture.library.append_upload(created["id"], 0, b"ready")
        self.fixture.library.conversion_queue.join()
        state = self.fixture.library.upload_status(created["id"])

        self.assertTrue(state["complete"])
        self.assertFalse(state["optimised"])
        self.assertEqual((self.fixture.library.adult_root / "Ready Film.mp4").read_bytes(),
                         b"ready")
        self.fixture.library.optimise_adult_for_playback.assert_not_called()

    def test_pin_recovery_keeps_custom_channels(self) -> None:
        custom = [{"number": 7, "name": "Nature", "folder": "nature", "aspect": "fit"}]
        self.fixture.channels.write_text(json.dumps({"schema_version": 1, "channels": custom}),
                                         encoding="utf-8")
        self.fixture.library.owner_recovery_path.touch()
        setup = self.fixture.library.public_setup()
        self.assertTrue(setup["recovering_owner"])
        expected = [{**custom[0], "content_type": "shows"}]
        self.assertEqual(setup["default_channels"], expected)
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": [{"number": 9, "name": "Wrong", "folder": "wrong",
                          "aspect": "crop"}],
        })
        self.assertEqual(self.fixture.library.channels(), expected)
        self.assertFalse(self.fixture.library.owner_recovery_path.exists())

    def test_channel_renumber_keeps_visibility_and_recycle_blocks_delete(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.refresh_tv = lambda: True
        programme = self.fixture.media / "kids-tv" / "episode.mp4"
        programme.write_bytes(b"video")
        self.fixture.library.manage({"action": "toggle-channel", "channel": 1})
        self.fixture.library.manage({"action": "toggle-programme", "channel": 1,
                                     "file": "episode.mp4"})
        self.fixture.library.manage({"action": "update-channel", "original_number": 1,
                                     "number": 9, "name": "Kids TV", "aspect": "crop",
                                     "content_type": "films"})
        settings = self.fixture.library.settings()["library"]
        self.assertIn(9, settings["disabled_channels"])
        self.assertNotIn(1, settings["disabled_channels"])
        self.assertEqual(settings["disabled_programmes"]["9"], ["episode.mp4"])
        self.assertNotIn("1", settings["disabled_programmes"])
        self.assertEqual(self.fixture.library.channel(9)["content_type"], "films")

        self.fixture.library.manage({"action": "trash", "channel": 9,
                                     "file": "episode.mp4"})
        with self.assertRaisesRegex(ValueError, "recycled programmes"):
            self.fixture.library.manage({"action": "delete-channel", "channel": 9})
        recycled_id = self.fixture.library.recycle_items()[0]["id"]
        self.fixture.library.manage({"action": "restore", "id": recycled_id})
        visible = self.fixture.library.library()["channels"]
        channel = next(value for value in visible if value["number"] == 9)
        self.assertEqual([item["name"] for item in channel["programmes"]],
                         ["episode.mp4"])

    def test_recycle_move_has_durable_intent_and_rolls_back_move_failure(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.refresh_tv = lambda: True
        programme = self.fixture.media / "kids-tv" / "only-copy.mp4"
        programme.write_bytes(b"video")

        def interrupted_move(source: str, destination: str) -> None:
            recycle_directory = Path(destination).parent
            self.assertTrue((recycle_directory / "manifest.json").is_file())
            raise OSError("simulated move failure")

        with mock.patch.object(mabeltv_library.shutil, "move",
                               side_effect=interrupted_move):
            with self.assertRaisesRegex(OSError, "simulated move failure"):
                self.fixture.library.manage({
                    "action": "trash", "channel": 1, "file": programme.name,
                })
        self.assertTrue(programme.is_file())
        self.assertEqual(self.fixture.library.recycle_items(), [])

        self.fixture.library.manage({
            "action": "trash", "channel": 1, "file": programme.name,
        })
        self.assertFalse(programme.exists())
        self.assertEqual(len(self.fixture.library.recycle_items()), 1)

    def test_unreadable_upload_reports_error_and_can_restart_cleanly(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.video_info = mock.Mock(
            side_effect=ValueError("Mabel TV could not find a video stream in that file"))
        created = self.fixture.library.upload_create({
            "channel": 1, "file_name": "broken.mov", "size": 5,
        })
        received = self.fixture.library.append_upload(created["id"], 0, b"nope!")
        self.assertEqual(received["status"], "validating")
        self.fixture.library.conversion_queue.join()
        state = self.fixture.library.upload_status(created["id"])
        self.assertEqual(state["status"], "error")
        self.assertFalse(state["complete"])
        self.assertFalse((self.fixture.media / ".incoming" /
                          f"{created['id']}.part").exists())
        restarted = self.fixture.library.upload_create({
            "channel": 1, "file_name": "broken.mov", "size": 5,
        })
        self.assertNotEqual(restarted["id"], created["id"])
        self.assertEqual(restarted["offset"], 0)
        self.assertFalse(any(job["id"] == created["id"]
                             for job in self.fixture.library.upload_jobs()))

        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 640, "height": 480,
            "avg_frame_rate": "25/1",
        }
        self.fixture.library.refresh_tv = lambda: True
        self.fixture.library.append_upload(restarted["id"], 0, b"valid")
        self.fixture.library.conversion_queue.join()
        self.assertTrue(self.fixture.library.upload_status(restarted["id"])["complete"])
        self.assertEqual(self.fixture.library.upload_jobs(), [])

    def test_resume_reserves_only_remaining_source_space(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        gib = 1024 ** 3
        with mock.patch.object(mabeltv_library.shutil, "disk_usage",
                               return_value=types.SimpleNamespace(free=3 * gib)):
            created = self.fixture.library.upload_create({
                "channel": 1, "file_name": "large.mov", "size": gib,
            })
        part = self.fixture.media / ".incoming" / f"{created['id']}.part"
        part.touch()
        with part.open("r+b") as stream:
            stream.truncate(gib // 4)
        with mock.patch.object(mabeltv_library.shutil, "disk_usage",
                               return_value=types.SimpleNamespace(free=int(2.3 * gib))):
            resumed = self.fixture.library.upload_create({
                "channel": 1, "file_name": "large.mov", "size": gib,
            })
        self.assertEqual(resumed["id"], created["id"])
        self.assertEqual(resumed["offset"], gib // 4)

    def test_upload_reservation_actions_and_channel_guards(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        created = self.fixture.library.upload_create({
            "channel": 1, "file_name": "waiting.mov", "size": 10,
        })
        waiting = next(job for job in self.fixture.library.upload_jobs()
                       if job["id"] == created["id"])
        self.assertEqual(waiting["offset"], 0)
        self.fixture.library.append_upload(created["id"], 0, b"12345")
        with self.assertRaisesRegex(ValueError, "already uploading"):
            self.fixture.library.upload_create({
                "channel": 1, "file_name": "waiting.mov", "size": 11,
            })
        with self.assertRaisesRegex(ValueError, "Finish or cancel"):
            self.fixture.library.manage({
                "action": "update-channel", "original_number": 1,
                "number": 9, "name": "Kids TV", "aspect": "crop",
            })
        with self.assertRaisesRegex(ValueError, "Finish or cancel"):
            self.fixture.library.manage({"action": "delete-channel", "channel": 1})
        cancelled = self.fixture.library.upload_action(created["id"], "cancel")
        self.assertIn("space was freed", cancelled["message"])
        self.assertEqual(self.fixture.library.upload_jobs(), [])

        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 1920, "height": 1080,
            "avg_frame_rate": "50/1",
        }
        self.fixture.library.refresh_tv = lambda: True
        self.fixture.library.optimise_for_playback = mock.Mock(
            side_effect=ValueError("temporary encoder error"))
        retry_job = self.fixture.library.upload_create({
            "channel": 1, "file_name": "retry.mov", "size": 5,
        })
        self.fixture.library.append_upload(retry_job["id"], 0, b"video")
        self.fixture.library.conversion_queue.join()
        queued = next(job for job in self.fixture.library.upload_jobs()
                      if job["id"] == retry_job["id"])
        self.assertTrue(queued["retryable"])
        self.fixture.library.optimise_for_playback = (
            lambda source, destination: destination.write_bytes(source.read_bytes()))
        self.fixture.library.upload_action(retry_job["id"], "retry")
        self.fixture.library.conversion_queue.join()
        self.assertTrue(self.fixture.library.upload_status(retry_job["id"])["complete"])

        deferred = self.fixture.library.upload_create({
            "channel": 1, "file_name": "deferred.mp4", "size": 5,
        })
        incoming = self.fixture.media / ".incoming"
        (incoming / f"{deferred['id']}.part").write_bytes(b"ready")
        deferred_meta = self.fixture.library.upload_meta(deferred["id"])
        deferred_meta.update({"status": "error", "conversion_required": False})
        self.fixture.library.write_json(
            incoming / f"{deferred['id']}.json", deferred_meta)
        # Model the narrow interval after an old worker persisted its error but
        # before it removed the job from the dedupe set.
        self.fixture.library.queued_conversions.add(deferred["id"])
        self.fixture.library.upload_action(deferred["id"], "retry")
        self.assertIn(deferred["id"], self.fixture.library.deferred_retries)
        self.fixture.library.finish_conversion_job(deferred["id"])
        self.fixture.library.conversion_queue.join()
        self.assertTrue(self.fixture.library.upload_status(deferred["id"])["complete"])

    def test_published_conversion_recovers_after_result_write_crash(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 1920, "height": 1080,
            "avg_frame_rate": "50/1",
        }
        self.fixture.library.refresh_tv = lambda: True
        first = True

        def interrupted_optimise(source: Path, destination: Path) -> None:
            nonlocal first
            destination.write_bytes(source.read_bytes())
            if first:
                first = False
                raise RuntimeError("simulated power loss after publish")

        self.fixture.library.optimise_for_playback = interrupted_optimise
        created = self.fixture.library.upload_create({
            "channel": 1, "file_name": "crash.mov", "size": 8,
        })
        self.fixture.library.append_upload(created["id"], 0, b"12345678")
        self.fixture.library.conversion_queue.join()
        self.assertEqual(self.fixture.library.upload_status(created["id"])["status"],
                         "error")
        resumed = self.fixture.library.upload_create({
            "channel": 1, "file_name": "crash.mov", "size": 8,
        })
        self.assertTrue(resumed["processing"])
        self.fixture.library.conversion_queue.join()
        result = self.fixture.library.upload_status(created["id"])
        self.assertTrue(result["complete"])
        self.assertTrue((self.fixture.media / "kids-tv" / "crash.mp4").is_file())

    def test_refresh_failure_is_visible_and_directly_retryable(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 640, "height": 480,
            "avg_frame_rate": "25/1",
        }
        self.fixture.library.refresh_tv = lambda: False
        created = self.fixture.library.upload_create({
            "channel": 1, "file_name": "refresh.mp4", "size": 5,
        })
        self.fixture.library.append_upload(created["id"], 0, b"video")
        self.fixture.library.conversion_queue.join()
        state = self.fixture.library.upload_status(created["id"])
        self.assertTrue(state["complete"])
        self.assertEqual(state["status"], "refresh-error")
        job = next(job for job in self.fixture.library.upload_jobs()
                   if job["id"] == created["id"])
        self.assertTrue(job["refreshable"])

        self.fixture.library.refresh_tv = lambda: True
        self.fixture.library.upload_action(created["id"], "refresh")
        self.assertEqual(self.fixture.library.upload_status(created["id"])["status"],
                         "complete")
        self.assertEqual(self.fixture.library.upload_jobs(), [])

    def test_lost_final_response_reports_publish_states_as_processing(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        created = self.fixture.library.upload_create({
            "channel": 1, "file_name": "publishing.mp4", "size": 5,
        })
        manifest = self.fixture.media / ".incoming" / f"{created['id']}.json"
        metadata = self.fixture.library.read_json(manifest, {})
        metadata["status"] = "publishing"
        self.fixture.library.write_json(manifest, metadata)
        state = self.fixture.library.upload_status(created["id"])
        self.assertTrue(state["processing"])
        self.assertEqual(state["offset"], 5)

    def test_manage_reports_when_change_saved_but_refresh_failed(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.refresh_tv = lambda: False
        refreshed = self.fixture.library.manage({"action": "toggle-channel", "channel": 1})
        self.assertFalse(refreshed)
        self.assertIn(1, self.fixture.library.settings()["library"]["disabled_channels"])

    def test_adult_mode_is_an_allowed_parent_portal_command(self) -> None:
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True):
            with mock.patch.object(mabeltv_library.socket, "socket") as socket_type:
                client = socket_type.return_value.__enter__.return_value
                client.recv.return_value = b"ok\n"
                self.assertEqual(
                    self.fixture.library.live_tv_control({"command": "enter-adult-mode"}),
                    {"ok": True, "message": "Command sent"})
                client.sendall.assert_called_once_with(b"enter-adult-mode\n")

        with self.assertRaisesRegex(ValueError, "Unknown live TV control"):
            self.fixture.library.live_tv_control({"command": "leave-adult-mode"})

    def test_live_tv_navigation_shortcuts_are_forwarded_to_the_player(self) -> None:
        commands = ("open-parent-menu", "open-tv-guide", "close-overlay",
                    "restart-programme", "navigate-up", "navigate-down",
                    "navigate-left", "navigate-right", "select",
                    "toggle-subtitles")
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True):
            with mock.patch.object(mabeltv_library.socket, "socket") as socket_factory:
                client = socket_factory.return_value.__enter__.return_value
                client.recv.return_value = b"ok\n"
                for command in commands:
                    self.assertEqual(
                        self.fixture.library.live_tv_control({"command": command}),
                        {"ok": True, "message": "Command sent"})
                self.assertEqual(client.sendall.call_count, len(commands))
                self.assertEqual(
                    [call.args[0] for call in client.sendall.call_args_list],
                    [f"{command}\n".encode() for command in commands])

    def test_portal_error_notices_clear_automatically(self) -> None:
        portal = (PROJECT_ROOT / "scripts" / "pi" / "mabeltv-library.html").read_text(
            encoding="utf-8"
        )

        self.assertIn("if (message && !message.endsWith('…'))", portal)
        self.assertIn("bad ? 7000 : 5000", portal)
        self.assertNotIn("message && !bad && !message.endsWith", portal)

    def test_worker_survives_failure_while_persisting_an_error(self) -> None:
        self.fixture.library.unexpected_conversion_error = mock.Mock(
            side_effect=OSError("read-only filesystem"))
        self.fixture.library.queue_conversion("not-an-upload")
        self.fixture.library.conversion_queue.join()
        self.assertTrue(self.fixture.library.conversion_worker.is_alive())

    def test_startup_removes_private_encoder_orphans_not_customer_media(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            media = root / "media"
            incoming = media / ".incoming"
            channel = media / "kids-tv"
            incoming.mkdir(parents=True)
            channel.mkdir()
            (incoming / "dead.optimising.mp4").write_bytes(b"orphan")
            (incoming / "dead.ffmpeg.log").write_text("interrupted", encoding="utf-8")
            (incoming / "old.result.json").write_text(json.dumps({
                "id": "0" * 32, "status": "error", "finished": time.time(),
            }), encoding="utf-8")
            customer_video = channel / "Holiday.optimising.mp4"
            customer_video.write_bytes(b"keep")
            channels = root / "channels.json"
            channels.write_text(json.dumps({
                "schema_version": 1,
                "channels": [{"number": 1, "name": "Kids TV",
                              "folder": "kids-tv", "aspect": "crop"}],
            }), encoding="utf-8")
            settings = root / "settings.json"
            settings.write_text('{"schema_version": 1}\n', encoding="utf-8")
            config = root / "library.conf"
            config.write_text("MABELTV_SETUP_CODE=135790\n", encoding="utf-8")
            library = mabeltv_library.Library(argparse.Namespace(
                media_root=str(media), channels=str(channels), settings=str(settings),
                owner=str(root / "owner.json"), config=str(config),
            ))
            try:
                self.assertFalse((incoming / "dead.optimising.mp4").exists())
                self.assertFalse((incoming / "dead.ffmpeg.log").exists())
                self.assertTrue((incoming / "old.result.json").exists())
                self.assertTrue(customer_video.exists())
            finally:
                library.close()

    def test_abandonment_cleanup_uses_recent_activity_and_preserves_queued_work(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        incoming = self.fixture.media / ".incoming"
        old = time.time() - 8 * 24 * 60 * 60

        recent = self.fixture.library.upload_create({
            "channel": 1, "file_name": "recent.mp4", "size": 10,
        })
        self.fixture.library.append_upload(recent["id"], 0, b"12345")
        recent_manifest = incoming / f"{recent['id']}.json"
        recent_meta = self.fixture.library.read_json(recent_manifest, {})
        recent_meta["created"] = old
        self.fixture.library.write_json(recent_manifest, recent_meta)
        os.utime(recent_manifest, (old, old))

        queued = self.fixture.library.upload_create({
            "channel": 1, "file_name": "queued.mp4", "size": 5,
        })
        queued_manifest = incoming / f"{queued['id']}.json"
        queued_part = incoming / f"{queued['id']}.part"
        queued_part.write_bytes(b"ready")
        queued_meta = self.fixture.library.read_json(queued_manifest, {})
        queued_meta.update({"created": old, "updated": old, "status": "queued"})
        self.fixture.library.write_json(queued_manifest, queued_meta)
        os.utime(queued_manifest, (old, old)); os.utime(queued_part, (old, old))

        abandoned = self.fixture.library.upload_create({
            "channel": 1, "file_name": "abandoned.mp4", "size": 5,
        })
        abandoned_manifest = incoming / f"{abandoned['id']}.json"
        abandoned_meta = self.fixture.library.read_json(abandoned_manifest, {})
        abandoned_meta.update({"created": old, "updated": old})
        self.fixture.library.write_json(abandoned_manifest, abandoned_meta)
        os.utime(abandoned_manifest, (old, old))

        self.fixture.library.cleanup_stale_temporary_files()
        self.assertTrue(recent_manifest.exists())
        self.assertTrue(queued_manifest.exists())
        self.assertTrue(queued_part.exists())
        self.assertFalse(abandoned_manifest.exists())


class LibraryHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()
        self.server = mabeltv_library.LibraryServer(("127.0.0.1", 0),
                                                    self.fixture.library)
        self.port = self.server.server_address[1]
        self.base = f"http://127.0.0.1:{self.port}"
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.fixture.close()

    def request(self, path: str, payload: dict | None = None,
                origin: str | None = None) -> tuple[int, dict]:
        data = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(self.base + path, data=data,
                                         method="GET" if payload is None else "POST")
        if payload is not None:
            request.add_header("Content-Type", "application/json")
        if origin:
            request.add_header("Origin", origin)
        try:
            with self.opener.open(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            try:
                return error.code, json.loads(error.read())
            finally:
                error.close()

    def test_setup_login_and_authenticated_dashboard_flow(self) -> None:
        status, state = self.request("/api/setup")
        self.assertEqual(status, 200)
        self.assertFalse(state["configured"])
        self.assertEqual(state["tv_name"], "KidsTV")
        self.assertNotIn("setup_code", state)

        status, _ = self.request("/api/setup", {
            "setup_code": "135790", "owner_name": "Taylor", "child_name": "Taylor",
            "pin": "8642",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.assertEqual(status, 200)
        status, _ = self.request("/api/login", {"pin": "1111"})
        self.assertEqual(status, 403)
        status, _ = self.request("/api/login", {"pin": "8642"})
        self.assertEqual(status, 200)
        status, dashboard = self.request("/api/library")
        self.assertEqual(status, 200)
        self.assertEqual(dashboard["owner"]["name"], "Taylor")
        self.assertEqual(dashboard["owner"]["tv_name"], "TaylorTV")
        self.assertTrue(dashboard["owner"]["portal_pin_required"])
        status, security = self.request("/api/portal-security", {
            "current_pin": "8642", "required": False,
        })
        self.assertEqual(status, 200)
        self.assertFalse(security["portal_pin_required"])
        status, dashboard = self.request("/api/library")
        self.assertEqual(status, 200)
        self.assertFalse(dashboard["owner"]["portal_pin_required"])
        status, security = self.request("/api/portal-security", {
            "current_pin": "1111", "required": True,
        })
        self.assertEqual(status, 400)
        status, security = self.request("/api/portal-security", {
            "current_pin": "8642", "required": True,
        })
        self.assertEqual(status, 200)
        self.assertTrue(security["portal_pin_required"])
        status, _ = self.request("/api/library")
        self.assertEqual(status, 401)
        status, _ = self.request("/api/login", {"pin": "8642"})
        self.assertEqual(status, 200)
        status, state = self.request("/api/setup")
        self.assertEqual(status, 200)
        self.assertEqual(state["tv_name"], "TaylorTV")
        with mock.patch.object(self.server.library, "admin_action", return_value=""):
            status, identity = self.request("/api/identity", {"child_name": "Mabel"})
        self.assertEqual(status, 200)
        self.assertEqual(identity["tv_name"], "MabelTV")
        self.assertEqual(len(dashboard["channels"]), 4)
        status, live = self.request("/api/status")
        self.assertEqual(status, 200)
        self.assertEqual(set(live), {"storage", "system", "uploads"})

    def test_cross_origin_mutation_is_rejected(self) -> None:
        status, body = self.request("/api/setup", {
            "setup_code": "135790", "pin": "8642",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        }, origin="https://example.invalid")
        self.assertEqual(status, 403)
        self.assertIn("did not come from", body["error"])


if __name__ == "__main__":
    unittest.main()
