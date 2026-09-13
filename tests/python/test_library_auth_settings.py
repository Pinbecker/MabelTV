from __future__ import annotations

from tests.python.library_test_support import *


class LibraryAuthSettingsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def test_first_run_hashes_pin_and_creates_generic_channels(self) -> None:
        result = self.fixture.library.complete_setup({
            "setup_code": "135790",
            "owner_name": "Sam",
            "child_name": "Mabel",
            "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.assertTrue(result["ok"])
        owner = self.fixture.library.read_state("owner")
        self.assertNotIn("pin", owner)
        self.assertNotEqual(owner["pin_hash"], "2468")
        self.assertTrue(self.fixture.library.verify_pin("2468"))
        self.assertFalse(self.fixture.library.verify_pin("0000"))
        self.assertEqual(owner["child_name"], "Mabel")
        self.assertEqual(owner["tv_name"], "MabelTV")
        self.assertEqual(self.fixture.library.public_setup()["tv_name"], "MabelTV")
        channels = self.fixture.library.read_state("channels")["channels"]
        self.assertEqual([channel["name"] for channel in channels],
                         ["Kids TV", "Cartoons", "Films", "Family Videos"])
        self.assertEqual([channel["content_type"] for channel in channels],
                         ["shows", "shows", "films", "films"])
        for channel in channels:
            self.assertTrue((self.fixture.media / channel["folder"]).is_dir())

    def test_seeded_channels_do_not_misidentify_a_fresh_install_as_recovery(self) -> None:
        self.fixture.library.write_state("channels", json.loads(json.dumps({
            "schema_version": 1, "channels": mabeltv_library.DEFAULT_CHANNELS,
        })))
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

    def test_channel_uploads_publish_originals_without_automatic_optimisation(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 3840, "height": 2160,
            "avg_frame_rate": "60/1",
        }
        self.fixture.library.needs_playback_optimisation = mock.Mock(return_value=True)
        self.fixture.library.optimise_for_playback = mock.Mock()
        self.fixture.library.refresh_tv = lambda: True
        uploads = []
        for channel, name in ((1, "show.mov"), (3, "film.mkv")):
            created = self.fixture.library.upload_create({
                "channel": channel, "file_name": name, "size": 16,
            })
            result = self.fixture.library.append_upload(created["id"], 0, b"x" * 16)
            self.assertTrue(result["processing"])
            uploads.append((created["id"], channel, name))

        deadline = time.monotonic() + 4
        states = []
        while time.monotonic() < deadline:
            states = [self.fixture.library.upload_status(upload_id)
                      for upload_id, _, _ in uploads]
            if all(state.get("complete") for state in states):
                break
            time.sleep(0.03)
        self.assertTrue(all(state.get("complete") for state in states))
        self.assertTrue(all(not state.get("optimised") for state in states))
        self.assertTrue((self.fixture.media / "kids-tv" / "show.mov").is_file())
        self.assertTrue((self.fixture.media / "films" / "film.mkv").is_file())
        self.fixture.library.needs_playback_optimisation.assert_not_called()
        self.fixture.library.optimise_for_playback.assert_not_called()

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

    def test_adult_optimisation_progress_is_exposed_without_reloading_library(self) -> None:
        film = self.fixture.library.adult_root / "Long Film.mkv"
        film.write_bytes(b"video")
        self.fixture.library.set_adult_media_state(
            "Long Film.mkv", "processing", "", progress=37)

        progress = self.fixture.library.adult_optimisations()
        self.assertTrue(progress["active"])
        self.assertEqual(progress["items"], [{
            "path": "Long Film.mkv",
            "title": "Long Film",
            "state": "processing",
            "progress": 37,
            "message": "",
            "updated": mock.ANY,
            "started": 0.0,
            "eta_seconds": 0,
        }])
        self.assertEqual(self.fixture.library.adult_library()[0]["playback_progress"], 37)
        self.assertIn("/api/adult/optimisations", PORTAL_SOURCE)
        self.assertIn("Optimising ${Math.round(progress)}%", PORTAL_SOURCE)
        self.assertNotIn("setInterval(() => load()", PORTAL_SOURCE)


if __name__ == "__main__":
    unittest.main()
