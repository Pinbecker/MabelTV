from __future__ import annotations

from tests.python.library_test_support import *


class SeriesAndChannelManagementTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def test_adult_series_groups_episodes_and_tracks_manual_watched_state(self) -> None:
        series_id = self.fixture.library.create_adult_series("Silicon Valley")
        season = self.fixture.library.adult_series_root / series_id / "Season 1"
        season.mkdir()
        episode = season / "Silicon.Valley.S01E06.720p.HDTV.x264.mkv"
        episode.write_bytes(b"episode")

        series = self.fixture.library.adult_series_library()[0]
        self.assertEqual(series["title"], "Silicon Valley")
        self.assertEqual(series["season_count"], 1)
        self.assertEqual(series["episode_count"], 1)
        self.assertEqual(series["episodes"][0]["season"], 1)
        self.assertEqual(series["episodes"][0]["episode"], 6)
        self.assertEqual(series["episodes"][0]["display_name"], "Silicon Valley")

        states = self.fixture.library.adult_series_states()
        episode_state = next(iter(states["episodes"].values()))
        episode_state.update({
            "remote_position": 300.0,
            "remote_duration": 1800.0,
            "remote_last_watched": 1234.0,
        })
        self.fixture.library.write_adult_series_states(states)

        self.fixture.library.set_favourite({
            "kind": "adult-series", "series": series_id, "enabled": True,
        })
        self.assertTrue(self.fixture.library.adult_series_library()[0]["favourite"])

        result = self.fixture.library.set_adult_episode_watched(
            series_id, "Season 1/Silicon.Valley.S01E06.720p.HDTV.x264.mkv", True)
        self.assertTrue(result["watched"])
        refreshed = self.fixture.library.adult_series_library()[0]
        self.assertEqual(refreshed["watched_count"], 1)
        self.assertTrue(refreshed["episodes"][0]["watched"])
        self.assertEqual(refreshed["episodes"][0]["remote_position"], 0)

        result = self.fixture.library.set_adult_episode_watched(
            series_id, "Season 1/Silicon.Valley.S01E06.720p.HDTV.x264.mkv", False)
        self.assertFalse(result["watched"])
        self.assertEqual(result["remote_position"], 300.0)
        refreshed = self.fixture.library.adult_series_library()[0]
        self.assertFalse(refreshed["episodes"][0]["watched"])
        self.assertEqual(refreshed["episodes"][0]["remote_position"], 300.0)
        self.assertEqual(refreshed["episodes"][0]["remote_last_watched"], 1234.0)

        bulk = self.fixture.library.set_adult_season_watched(series_id, 1, True)
        self.assertEqual(bulk["episodes_updated"], 1)
        self.assertTrue(bulk["episodes"][0]["watched"])
        bulk = self.fixture.library.set_adult_season_watched(series_id, 1, False)
        self.assertFalse(bulk["episodes"][0]["watched"])
        self.assertEqual(bulk["episodes"][0]["remote_position"], 300.0)
        self.assertEqual(bulk["episodes"][0]["remote_last_watched"], 1234.0)

    def test_adult_series_restart_clears_one_season_or_complete_show(self) -> None:
        series_id = self.fixture.library.create_adult_series("Silicon Valley")
        root = self.fixture.library.adult_series_root / series_id
        for season, episode in ((1, 1), (1, 2), (2, 1)):
            folder = root / f"Season {season}"
            folder.mkdir(exist_ok=True)
            (folder / f"Silicon.Valley.S{season:02d}E{episode:02d}.mp4").write_bytes(
                b"episode")
        self.fixture.library.adult_series_library()
        states = self.fixture.library.adult_series_states()
        for value in states["episodes"].values():
            value.update({
                "watched": True,
                "remote_position": 420.0,
                "remote_duration": 1800.0,
                "remote_last_watched": 1234.0,
            })
        self.fixture.library.write_adult_series_states(states)

        result = self.fixture.library.restart_adult_series_progress(
            series_id, "season", 1)
        self.assertEqual(result["episodes_reset"], 2)
        refreshed = self.fixture.library.adult_series_library()[0]
        first = [item for item in refreshed["episodes"] if item["season"] == 1]
        second = [item for item in refreshed["episodes"] if item["season"] == 2]
        self.assertTrue(all(not item["watched"] for item in first))
        self.assertTrue(all(item["remote_position"] == 0 for item in first))
        self.assertTrue(all(item["watched"] for item in second))
        self.assertEqual(first[0]["remote_duration"], 1800.0)

        result = self.fixture.library.restart_adult_series_progress(
            series_id, "series")
        self.assertEqual(result["episodes_reset"], 3)
        refreshed = self.fixture.library.adult_series_library()[0]
        self.assertTrue(all(not item["watched"] for item in refreshed["episodes"]))
        self.assertTrue(all(item["remote_position"] == 0
                            for item in refreshed["episodes"]))

    def test_adult_series_direct_upload_publishes_into_selected_series_number(self) -> None:
        series_id = self.fixture.library.create_adult_series("Silicon Valley")
        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "codec_name": "h264", "pix_fmt": "yuv420p",
            "width": 1280, "height": 720, "avg_frame_rate": "24000/1001",
        }
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

        created = self.fixture.library.adult_series_upload_create({
            "series": series_id, "season": 2,
            "file_name": "Silicon.Valley.S02E01.mp4", "size": 7,
        })
        self.fixture.library.append_upload(created["id"], 0, b"episode")
        self.fixture.library.conversion_queue.join()
        state = self.fixture.library.upload_status(created["id"])

        self.assertTrue(state["complete"])
        self.assertEqual(state["kind"], "adult-series")
        self.assertEqual(state["series_id"], series_id)
        self.assertEqual(state["season"], 2)
        self.assertEqual(
            (self.fixture.library.adult_series_root / series_id / "Season 2" /
             "Silicon.Valley.S02E01.mp4").read_bytes(), b"episode")
        episode = self.fixture.library.adult_series_library()[0]["episodes"][0]
        self.assertEqual((episode["season"], episode["episode"]), (2, 1))
        self.fixture.library.refresh_tv.assert_not_called()

    def test_adult_series_portal_uses_scoped_series_and_episode_workflow(self) -> None:
        self.assertIn('id="adultSeasonSheet"', PORTAL_SOURCE)
        self.assertIn('class="adult-series-seasons"', PORTAL_SOURCE)
        self.assertIn("function openAdultSeasonSheet(series, season, returnTo = null, targetPath = '')", PORTAL_SOURCE)
        self.assertIn("openAdultSeriesUpload(current, number)", PORTAL_SOURCE)
        self.assertIn("const season = Number(target?.season)", PORTAL_SOURCE)
        self.assertIn("Create Series ${nextSeries}", PORTAL_SOURCE)
        self.assertIn("action: 'create-adult-season'", PORTAL_SOURCE)
        self.assertIn("scope: 'season', season: number", PORTAL_SOURCE)
        self.assertIn('id="adultSeriesSourceSheet"', PORTAL_SOURCE)
        self.assertIn('id="adultSeriesSourceFiles"', PORTAL_SOURCE)
        self.assertIn('id="adultSeriesSourceUsb"', PORTAL_SOURCE)
        self.assertIn("function openAdultSeriesSourceSheet()", PORTAL_SOURCE)
        self.assertIn("function returnToAdultSeriesUploadSheet()", PORTAL_SOURCE)
        self.assertNotIn('id="adultSeriesUpload"', PORTAL_SOURCE)
        self.assertNotIn('id="adultSeriesAddUsb"', PORTAL_SOURCE)
        self.assertNotIn('id="adultSeriesUploadSeason"', PORTAL_SOURCE)
        self.assertNotIn('Use an existing number', PORTAL_SOURCE)
        self.assertNotIn('id="adultSeasonBack"', PORTAL_SOURCE)
        self.assertIn('id="adultSeriesRestartSheet"', PORTAL_SOURCE)
        self.assertIn('id="adultSeasonRestart"', PORTAL_SOURCE)
        self.assertIn('id="adultSeriesRestart"', PORTAL_SOURCE)
        self.assertIn("function adultSeriesContinueEntries()", PORTAL_SOURCE)
        self.assertIn("[...resumableFilms, ...adultSeriesContinueEntries()]",
                      PORTAL_SOURCE)
        home_renderer = re.search(
            r"function renderHomeLibrary\(\) \{(.*?)\n    \}\n\n    async function setFilmFavourite",
            PORTAL_SOURCE, re.DOTALL)
        self.assertIsNotNone(home_renderer)
        self.assertNotIn("adultSeriesContinueEntries", home_renderer.group(1))

    def test_adult_series_episode_season_and_show_cleanup_use_recycle_bin(self) -> None:
        series_id = self.fixture.library.create_adult_series("Silicon Valley")
        root = self.fixture.library.adult_series_root / series_id
        for season, episode in ((1, 1), (1, 2), (2, 1)):
            folder = root / f"Season {season}"
            folder.mkdir(exist_ok=True)
            (folder / f"Silicon.Valley.S{season:02d}E{episode:02d}.mp4").write_bytes(b"episode")

        removed = self.fixture.library.trash_adult_series_items({
            "series": series_id, "scope": "season", "season": 1,
        })
        self.assertEqual(removed, 2)
        remaining = self.fixture.library.adult_series_library()[0]
        self.assertEqual([(item["season"], item["episode"])
                          for item in remaining["episodes"]], [(2, 1)])
        recycle = self.fixture.library.recycle_items()
        self.assertEqual(len(recycle), 2)

        self.fixture.library.manage({"action": "restore", "id": recycle[0]["id"]})
        restored = self.fixture.library.adult_series_library()[0]
        self.assertEqual(restored["episode_count"], 2)

        removed = self.fixture.library.trash_adult_series_items({
            "series": series_id, "scope": "series",
        })
        self.assertEqual(removed, 2)
        self.assertEqual(self.fixture.library.adult_series_library(), [])

    def test_viewing_insights_use_current_film_metadata_title(self) -> None:
        self.fixture.library.write_state("channels", json.loads(json.dumps({
            "schema_version": 1, "channels": mabeltv_library.DEFAULT_CHANNELS,
        })))
        film = self.fixture.media / "films" / "Room on the Broom - original.mp4"
        film.parent.mkdir(parents=True, exist_ok=True)
        film.write_bytes(b"film")
        self.fixture.library.write_channel_media_states({
            "programmes": {
                self.fixture.library.channel_programme_key(3, film.name): {
                    "title": "Room on the Broom",
                },
            },
        })
        now = time.time()
        self.fixture.library.viewing_store["sessions"] = [{
            "id": "film-session",
            "item_key": f"channel:3:{film.name.casefold()}",
            "title": "Room on the Broom - original",
            "channel_number": 3,
            "channel_name": "Old name",
            "kind": "film",
            "surface": "tv",
            "started": now - 180,
            "ended": now,
            "seconds": 180,
        }]

        summary = self.fixture.library.viewing_insights(1, 0)
        self.assertEqual(summary["top_films"][0]["title"], "Room on the Broom")
        self.assertEqual(summary["sessions"][0]["source"], "Films")

    def test_viewing_insights_include_item_drilldowns_and_completion_patterns(self) -> None:
        self.fixture.library.write_state("channels", json.loads(json.dumps({
            "schema_version": 1, "channels": mabeltv_library.DEFAULT_CHANNELS,
        })))
        local_now = time.localtime()
        now = time.mktime((local_now.tm_year, local_now.tm_mon, local_now.tm_mday,
                           12, 0, 0, 0, 0, -1))
        item_key = "channel:3:the film.mp4"
        self.fixture.library.viewing_store["sessions"] = [
            {
                "id": "film-one", "item_key": item_key, "title": "The Film",
                "channel_number": 3, "channel_name": "Films", "kind": "film",
                "surface": "tv", "started": now - 7200, "ended": now - 6900,
                "seconds": 300, "position": 1800, "media_duration": 3600,
            },
            {
                "id": "film-two", "item_key": item_key, "title": "The Film",
                "channel_number": 3, "channel_name": "Films", "kind": "film",
                "surface": "device", "started": now - 3600, "ended": now - 3420,
                "seconds": 180, "position": 3420, "media_duration": 3600,
            },
        ]

        insights = self.fixture.library.viewing_insights(365, 0)
        item = insights["items"][0]
        self.assertEqual(item["item_key"], item_key)
        self.assertEqual(item["sessions"], 2)
        self.assertEqual(item["active_days"], 1)
        self.assertEqual(item["average_session_seconds"], 240)
        self.assertAlmostEqual(item["average_progress"], .725, places=3)
        self.assertAlmostEqual(item["furthest_progress"], .95, places=3)
        self.assertEqual(item["completion_sessions"], 1)
        self.assertEqual({value["name"] for value in item["by_surface"]},
                         {"tv", "device"})
        self.assertEqual(len(item["hourly"]), 24)
        self.assertEqual(len(item["weekdays"]), 7)
        self.assertEqual(len(item["timeline"]), 12)
        self.assertEqual(insights["top_films"][0]["item_key"], item_key)
        self.assertEqual(len(insights["hourly"]), 24)
        self.assertEqual(len(insights["weekdays"]), 7)

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

    def test_adult_folders_are_real_shared_collections_and_preserve_identity(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)
        source = self.fixture.library.adult_root / "Fellowship.mkv"
        source.write_bytes(b"film")

        first = self.fixture.library.adult_library()[0]
        identity = first["library_id"]
        self.fixture.library.manage({
            "action": "create-adult-folder", "name": "The Lord of the Rings",
        })
        self.fixture.library.manage({
            "action": "move-adult", "file": first["path"],
            "folder": "The Lord of the Rings",
        })

        moved = self.fixture.library.adult_library()[0]
        self.assertEqual(moved["path"], "The Lord of the Rings/Fellowship.mkv")
        self.assertEqual(moved["folder"], "The Lord of the Rings")
        self.assertEqual(moved["library_id"], identity)
        self.fixture.library.manage({
            "action": "rename-adult-folder", "folder": "The Lord of the Rings",
            "name": "Middle-earth",
        })
        renamed = self.fixture.library.adult_library()[0]
        self.assertEqual(renamed["path"], "Middle-earth/Fellowship.mkv")
        self.assertEqual(renamed["library_id"], identity)
        self.assertEqual(self.fixture.library.library()["adult_folders"], ["Middle-earth"])

        with self.assertRaisesRegex(ValueError, "Move every film"):
            self.fixture.library.manage({
                "action": "delete-adult-folder", "folder": "Middle-earth",
            })
        self.fixture.library.manage({
            "action": "move-adult", "file": renamed["path"], "folder": "",
        })
        self.fixture.library.manage({
            "action": "delete-adult-folder", "folder": "Middle-earth",
        })
        self.assertEqual(self.fixture.library.adult_folders(), [])

    def test_pin_recovery_keeps_custom_channels(self) -> None:
        custom = [{"number": 7, "name": "Nature", "folder": "nature", "aspect": "fit"}]
        self.fixture.library.write_state("channels", json.loads(json.dumps({"schema_version": 1, "channels": custom})))
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


if __name__ == "__main__":
    unittest.main()
