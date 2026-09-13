from __future__ import annotations

from tests.python.library_test_support import *


class MetadataViewingLibraryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()
        self.usb_root = self.fixture.root / "usb"
        self.volume = self.usb_root / "TEST-USB"
        self.volume.mkdir(parents=True)
        self.fixture.library.usb_root = self.usb_root.resolve()
        self.fixture.library.usb_requires_mount = False
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

    def tearDown(self) -> None:
        self.fixture.close()

    def test_tmdb_search_and_apply_cache_metadata_without_exposing_key(self) -> None:
        movie = self.fixture.library.adult_root / "Fellowship of the Ring 2001.mkv"
        movie.write_bytes(b"video")
        self.fixture.library.tmdb_request = mock.Mock(side_effect=[
            {"results": [{"id": 120, "title": "The Lord of the Rings: The Fellowship of the Ring",
                           "original_title": "The Lord of the Rings: The Fellowship of the Ring",
                           "release_date": "2001-12-19", "overview": "A journey begins.",
                           "poster_path": None}]},
            {"id": 120, "title": "The Lord of the Rings: The Fellowship of the Ring",
             "original_title": "The Lord of the Rings: The Fellowship of the Ring",
             "release_date": "2001-12-19", "overview": "A journey begins.",
             "runtime": 179, "poster_path": None},
        ])
        found = self.fixture.library.tmdb_search({"file": movie.name})
        self.assertEqual(found["results"][0]["id"], 120)
        applied = self.fixture.library.tmdb_apply({"file": movie.name, "tmdb_id": 120})
        self.assertTrue(applied["refreshed"])
        film = self.fixture.library.adult_library()[0]
        self.assertEqual(film["metadata"]["runtime"], 179)
        self.assertEqual(film["metadata"]["provider"], "TMDB")
        persisted = self.fixture.library.adult_media_states()[movie.name]
        self.assertNotIn("api_key", json.dumps(persisted))

    def test_tmdb_apply_automatically_fetches_one_matching_english_subtitle(self) -> None:
        movie = self.fixture.library.adult_root / "Fellowship of the Ring 2001.mkv"
        movie.write_bytes(b"video")
        self.fixture.library.tmdb_request = mock.Mock(return_value={
            "id": 120, "title": "The Lord of the Rings: The Fellowship of the Ring",
            "original_title": "The Lord of the Rings: The Fellowship of the Ring",
            "release_date": "2001-12-19", "overview": "A journey begins.",
            "runtime": 179, "poster_path": None,
        })
        self.fixture.library.subtitle_availability = mock.Mock(return_value={"status": "missing"})
        self.fixture.library.opensubtitles_key = mock.Mock(return_value="private-consumer-key")
        self.fixture.library.opensubtitles_request = mock.Mock(side_effect=[
            {"data": [{"attributes": {"language": "en", "hearing_impaired": False,
                                          "ratings": 8.0, "download_count": 20,
                                          # OpenSubtitles commonly returns a
                                          # release name with no .srt suffix.
                                          "files": [{"file_id": 555,
                                                     "file_name": "film.en"}]}}]},
            {"link": "https://example.invalid/subtitle"},
        ])
        self.fixture.library.opensubtitles_download_bytes = mock.Mock(
            return_value=b"1\n00:00:01,000 --> 00:00:02,000\nHello.\n")

        applied = self.fixture.library.tmdb_apply({"file": movie.name, "tmdb_id": 120})

        subtitle = movie.with_name("Fellowship of the Ring 2001.en.srt")
        self.assertTrue(subtitle.is_file())
        self.assertEqual(applied["metadata"]["subtitles"]["status"], "downloaded")
        self.assertEqual(applied["metadata"]["subtitles"]["file"], subtitle.name)
        self.assertEqual(self.fixture.library.opensubtitles_request.call_args_list[0].args[0],
                         "subtitles")
        self.assertNotIn("private-consumer-key",
                         json.dumps(self.fixture.library.adult_media_states()))

    def test_tmdb_apply_keeps_existing_subtitles_and_does_not_contact_provider(self) -> None:
        movie = self.fixture.library.adult_root / "Film.mkv"
        movie.write_bytes(b"video")
        sidecar = movie.with_name("Film.en.srt")
        sidecar.write_text("1\n00:00:01,000 --> 00:00:02,000\nHello.\n", encoding="utf-8")
        self.fixture.library.tmdb_request = mock.Mock(return_value={
            "id": 120, "title": "Film", "original_title": "Film",
            "release_date": "2001-12-19", "overview": "", "runtime": 90,
            "poster_path": None,
        })
        self.fixture.library.opensubtitles_request = mock.Mock()

        applied = self.fixture.library.tmdb_apply({"file": movie.name, "tmdb_id": 120})

        self.assertEqual(applied["metadata"]["subtitles"],
                         {"status": "external", "file": sidecar.name})
        self.fixture.library.opensubtitles_request.assert_not_called()

    def test_tmdb_read_access_token_uses_bearer_header(self) -> None:
        token = "eyJ" + "a" * 8 + ".payload.signature"
        self.fixture.library.tmdb_key = mock.Mock(return_value=token)
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        response.read.return_value = b'{"results": []}'
        with mock.patch.object(mabeltv_library, "urlopen", return_value=response) as request:
            self.fixture.library.tmdb_request("search/movie", {"query": "Fellowship"})
        sent = request.call_args.args[0]
        self.assertEqual(sent.headers["Authorization"], f"Bearer {token}")
        self.assertNotIn("api_key", sent.full_url)

    def test_channel_metadata_caches_one_show_identity_and_each_film(self) -> None:
        channels = [
            {"number": 1, "name": "Puffin Rock", "folder": "shows",
             "aspect": "crop", "content_type": "shows"},
            {"number": 5, "name": "Films", "folder": "films",
             "aspect": "fit", "content_type": "films"},
        ]
        self.fixture.library.write_state("channels", json.loads(json.dumps({
            "schema_version": 1, "channels": channels,
        })))
        (self.fixture.media / "shows").mkdir(parents=True)
        (self.fixture.media / "shows" / "Episode 1.mp4").write_bytes(b"show")
        (self.fixture.media / "films").mkdir(parents=True)
        (self.fixture.media / "films" / "Cinderella 1950.mp4").write_bytes(b"film")
        self.fixture.library.tmdb_request = mock.Mock(side_effect=[
            {"results": [{"id": 100}]},
            {"id": 100, "name": "Puffin Rock", "overview": "Island adventures.",
             "first_air_date": "2015-01-01", "backdrop_path": "/show.jpg"},
            {"results": [{"id": 200}]},
            {"id": 200, "title": "Cinderella", "overview": "A timeless tale.",
             "release_date": "1950-02-15", "poster_path": "/film.jpg"},
        ])
        self.fixture.library.cache_channel_artwork = mock.Mock(
            side_effect=["mabel-show-1-100.jpg", "mabel-film-5-200.jpg"])

        result = self.fixture.library.refresh_channel_metadata()

        self.assertEqual(result, {"ok": True, "updated": 2, "skipped": 0})
        rendered = self.fixture.library.library()["channels"]
        show = next(channel for channel in rendered if channel["number"] == 1)
        films = next(channel for channel in rendered if channel["number"] == 5)
        self.assertEqual(show["metadata"]["artwork"], "mabel-show-1-100.jpg")
        self.assertEqual(show["programmes"][0]["metadata"], {})
        self.assertEqual(films["programmes"][0]["metadata"]["poster"],
                         "mabel-film-5-200.jpg")
        self.assertEqual(
            self.fixture.library.tmdb_request.call_args_list[2].args[1]["year"],
            1950)

    def test_one_show_channel_requires_a_selected_metadata_match(self) -> None:
        channels = [
            {"number": 1, "name": "Postman Pat", "folder": "postman-pat",
             "aspect": "crop", "content_type": "shows"},
            {"number": 5, "name": "Films", "folder": "films",
             "aspect": "fit", "content_type": "films"},
        ]
        self.fixture.library.write_state("channels", json.loads(json.dumps({
            "schema_version": 1, "channels": channels,
        })))
        self.fixture.library.tmdb_request = mock.Mock(side_effect=[
            {"results": [
                {"id": 101, "name": "Postman", "overview": "Wrong show.",
                 "first_air_date": "2010-01-01"},
                {"id": 102, "name": "Postman Pat", "overview": "Greendale stories.",
                 "first_air_date": "1981-09-16"},
            ]},
            {"id": 102, "name": "Postman Pat", "overview": "Greendale stories.",
             "first_air_date": "1981-09-16", "backdrop_path": "/pat.jpg"},
        ])
        self.fixture.library.cache_channel_artwork = mock.Mock(
            return_value="mabel-show-1-102.jpg")

        search = self.fixture.library.refresh_channel_show_metadata({"channel": 1})

        self.assertEqual([value["id"] for value in search["results"]], [101, 102])
        self.assertEqual(search["query"], "Postman Pat")
        self.assertEqual(
            self.fixture.library.tmdb_request.call_args_list[0].args[0], "search/tv")
        self.assertEqual(self.fixture.library.channel_media_states(), {
            "channels": {}, "programmes": {}, "favourites": [],
            "favourite_channels": [],
        })

        result = self.fixture.library.refresh_channel_show_metadata({
            "channel": 1, "tmdb_id": 102,
        })

        self.assertEqual(result["metadata"]["title"], "Postman Pat")
        self.assertEqual(result["metadata"]["artwork"], "mabel-show-1-102.jpg")
        metadata = self.fixture.library.channel_media_states()["channels"]["1"]
        self.assertEqual(metadata["tmdb_id"], 102)
        self.fixture.library.cache_channel_artwork.assert_called_once_with(
            "/pat.jpg", "mabel-show-1-102.jpg", backdrop=True)
        with self.assertRaisesRegex(ValueError, "only available for show channels"):
            self.fixture.library.refresh_channel_show_metadata({"channel": 5})

    def test_one_film_channel_programme_requires_a_selected_metadata_match(self) -> None:
        channels = [
            {"number": 1, "name": "Shows", "folder": "shows",
             "aspect": "crop", "content_type": "shows"},
            {"number": 5, "name": "Films", "folder": "films",
             "aspect": "fit", "content_type": "films"},
        ]
        self.fixture.library.write_state("channels", json.loads(json.dumps({
            "schema_version": 1, "channels": channels,
        })))
        (self.fixture.media / "shows").mkdir(parents=True)
        (self.fixture.media / "shows" / "Episode.mp4").write_bytes(b"show")
        films = self.fixture.media / "films"
        films.mkdir(parents=True)
        file_name = "Room_on_the_Broom_-__p0102qfj_original.mp4"
        (films / file_name).write_bytes(b"film")
        self.fixture.library.tmdb_request = mock.Mock(side_effect=[
            {"results": [
                {"id": 201, "title": "Wrong Room", "overview": "Not this one.",
                 "release_date": "2001-01-01"},
                {"id": 202, "title": "Room on the Broom",
                 "overview": "A magical journey.", "release_date": "2012-12-25"},
            ]},
            {"id": 202, "title": "Room on the Broom", "overview": "A magical journey.",
             "release_date": "2012-12-25", "poster_path": "/room.jpg"},
        ])
        self.fixture.library.cache_channel_artwork = mock.Mock(
            return_value="mabel-film-5-202.jpg")

        search = self.fixture.library.refresh_channel_programme_metadata({
            "channel": 5, "file": file_name,
        })

        self.assertEqual([value["id"] for value in search["results"]], [201, 202])
        self.assertEqual(
            self.fixture.library.tmdb_request.call_args_list[0].args[1]["query"],
            "Room on the Broom")
        rendered = self.fixture.library.library()["channels"]
        film_channel = next(channel for channel in rendered if channel["number"] == 5)
        self.assertEqual(film_channel["programmes"][0]["metadata"], {})

        result = self.fixture.library.refresh_channel_programme_metadata({
            "channel": 5, "file": file_name, "tmdb_id": 202,
        })

        self.assertEqual(result["metadata"]["title"], "Room on the Broom")
        rendered = self.fixture.library.library()["channels"]
        film_channel = next(channel for channel in rendered if channel["number"] == 5)
        self.assertEqual(film_channel["programmes"][0]["metadata"]["tmdb_id"], 202)
        self.assertEqual(
            self.fixture.library.channel_programme_title(5, file_name),
            "Room on the Broom")
        self.fixture.library.write_state("player", {
            "standby": False,
            "current_channel": 5,
            "playback_paused": True,
            "channel_timelines": {"5": {
                "episode_name": file_name,
                "position_seconds": 90,
            }},
        })
        live = self.fixture.library.live_stream.source()
        self.assertEqual(live["programme"], "Room on the Broom")
        with self.assertRaisesRegex(ValueError, "only available for film channels"):
            self.fixture.library.refresh_channel_programme_metadata({
                "channel": 1, "file": "Episode.mp4",
            })

    def test_film_can_move_to_another_film_channel_with_state(self) -> None:
        channels = [
            {"number": 5, "name": "Films", "folder": "films",
             "aspect": "fit", "content_type": "films"},
            {"number": 6, "name": "Christmas Films", "folder": "christmas-films",
             "aspect": "fit", "content_type": "films"},
            {"number": 7, "name": "Shows", "folder": "shows",
             "aspect": "crop", "content_type": "shows"},
        ]
        self.fixture.library.write_state("channels", json.loads(json.dumps({
            "schema_version": 1, "channels": channels,
        })))
        for channel in channels:
            (self.fixture.media / channel["folder"]).mkdir(parents=True)
        source = self.fixture.media / "films" / "The Snowman.mp4"
        source.write_bytes(b"film")
        settings = self.fixture.library.settings()
        settings.setdefault("library", {}).setdefault("disabled_programmes", {})["5"] = [source.name]
        self.fixture.library.write_state("settings", json.loads(json.dumps(settings)))
        self.fixture.library.write_channel_media_states({
            "programmes": {"5/The Snowman.mp4": {
                "tmdb_id": 13396, "title": "The Snowman", "poster": "mabel-film-5-13396.jpg",
            }}
        })
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

        self.fixture.library.manage({
            "action": "move-programme", "channel": 5,
            "target_channel": 6, "file": source.name,
        })

        self.assertFalse(source.exists())
        self.assertTrue((self.fixture.media / "christmas-films" / source.name).is_file())
        disabled = self.fixture.library.settings()["library"]["disabled_programmes"]
        self.assertNotIn(source.name, disabled["5"])
        self.assertIn(source.name, disabled["6"])
        metadata = self.fixture.library.channel_media_states()["programmes"]
        self.assertNotIn("5/The Snowman.mp4", metadata)
        self.assertEqual(metadata["6/The Snowman.mp4"]["tmdb_id"], 13396)
        with self.assertRaisesRegex(ValueError, "another film channel"):
            self.fixture.library.manage({
                "action": "move-programme", "channel": 6,
                "target_channel": 7, "file": source.name,
            })

    def test_film_rename_preserves_its_selected_metadata(self) -> None:
        channels = [{
            "number": 5, "name": "Films", "folder": "films",
            "aspect": "fit", "content_type": "films",
        }]
        self.fixture.library.write_state("channels", json.loads(json.dumps({
            "schema_version": 1, "channels": channels,
        })))
        films = self.fixture.media / "films"
        films.mkdir(parents=True)
        source = films / "Room_on_the_Broom_-__p0102qfj_original.mp4"
        source.write_bytes(b"film")
        self.fixture.library.write_channel_media_states({
            "programmes": {f"5/{source.name}": {
                "tmdb_id": 201, "title": "Room on the Broom",
                "poster": "mabel-film-5-201.jpg",
            }}
        })
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

        self.fixture.library.manage({
            "action": "rename", "channel": 5, "file": source.name,
            "name": "Room on the Broom",
        })

        renamed = films / "Room on the Broom.mp4"
        self.assertTrue(renamed.is_file())
        self.assertFalse(source.exists())
        metadata = self.fixture.library.channel_media_states()["programmes"]
        self.assertNotIn(f"5/{source.name}", metadata)
        self.assertEqual(metadata[f"5/{renamed.name}"]["tmdb_id"], 201)

    def test_adult_playback_state_updates_preserve_cached_metadata(self) -> None:
        self.fixture.library.write_adult_media_states({
            "Film.mkv": {"metadata": {"tmdb_id": 1, "title": "Film"}},
        })
        self.fixture.library.set_adult_media_state("Film.mkv", "processing")
        state = self.fixture.library.adult_media_states()["Film.mkv"]
        self.assertEqual(state["metadata"]["tmdb_id"], 1)
        self.assertEqual(state["state"], "processing")

    def test_viewing_history_joins_adjacent_samples_and_builds_summaries(self) -> None:
        now = time.time()
        activity = {
            "item_key": "channel:5:film.mp4",
            "title": "Film",
            "kind": "film",
            "surface": "tv",
            "channel_number": 5,
            "channel_name": "Films",
        }
        self.fixture.library.record_viewing(activity, 45, now - 60)
        self.fixture.library.record_viewing(activity, 30, now - 20)

        self.assertEqual(self.fixture.library.viewing_store["sessions"], [])
        self.fixture.library.record_viewing(activity, 45, now)
        self.assertEqual(len(self.fixture.library.viewing_store["sessions"]), 1)
        self.assertEqual(self.fixture.library.viewing_store["sessions"][0]["seconds"], 120)
        summary = self.fixture.library.viewing_insights(30, 0)
        self.assertEqual(summary["summary"]["sessions"], 1)
        self.assertEqual(summary["summary"]["range_seconds"], 120)
        self.assertEqual(summary["summary"]["active_days"], 1)
        self.assertEqual(summary["summary"]["unique_items"], 1)
        self.assertEqual(summary["summary"]["average_active_day_seconds"], 120)
        self.assertEqual(summary["summary"]["longest_session_seconds"], 120)
        self.assertEqual(summary["top_titles"][0]["title"], "Film")
        self.assertEqual(summary["top_films"][0]["title"], "Film")
        self.assertEqual(len(summary["time_of_day"]), 4)
        self.assertTrue(summary["timeline"])
        self.assertEqual(summary["by_surface"][0]["name"], "tv")

    def test_viewing_history_counts_remote_playback_but_rejects_seeks(self) -> None:
        session = {
            "kind": "channel", "content_kind": "episode", "title": "Episode",
            "channel": 1, "file": "Episode.mp4", "library_id": None,
        }
        self.fixture.library.write_state("channels", {
            "schema_version": 1,
            "channels": [{"number": 1, "name": "Series", "folder": "series",
                          "content_type": "shows"}],
        })
        samples = list(range(0, 121, 10)) + [500]
        with mock.patch.object(mabeltv_library.time, "monotonic",
                               side_effect=[100.0 + value for value in samples]):
            for position in samples:
                self.fixture.library.record_remote_viewing(
                    session, "token", position, 1800)

        sessions = self.fixture.library.viewing_store["sessions"]
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["seconds"], 120)
        self.assertEqual(sessions[0]["kind"], "channel")
        self.assertEqual(sessions[0]["title"], "Series")

    def test_viewing_history_joins_each_concurrent_surface_session(self) -> None:
        now = time.time()
        tv = {"item_key": "channel:5:film.mp4", "title": "Film", "kind": "film",
              "surface": "tv", "channel_number": 5, "channel_name": "Films"}
        device = {**tv, "item_key": "browser:channel:5/film.mp4",
                  "surface": "device"}
        self.fixture.library.record_viewing(tv, 60, now - 45)
        self.fixture.library.record_viewing(device, 60, now - 30)
        self.fixture.library.record_viewing(tv, 60, now - 15)
        self.fixture.library.record_viewing(device, 60, now)

        sessions = self.fixture.library.viewing_store["sessions"]
        self.assertEqual(len(sessions), 2)
        self.assertEqual(sorted(item["seconds"] for item in sessions), [120, 120])

    def test_tv_viewing_identity_handles_channels_and_adult_mode(self) -> None:
        self.fixture.library.write_state("channels", {
            "schema_version": 1,
            "channels": [{"number": 5, "name": "Films", "folder": "films",
                          "content_type": "films"}],
        })
        self.fixture.library.write_state("player", json.loads(json.dumps({
            "standby": False, "playback_paused": False, "current_channel": 5,
            "channel_timelines": {"5": {"episode_name": "The Film.mp4"}},
        })))
        self.fixture.library.player_mode_status = mock.Mock(return_value={"mode": "kids"})
        channel = self.fixture.library.current_tv_viewing()
        self.assertEqual(channel["title"], "The Film")
        self.assertEqual(channel["kind"], "film")
        self.assertEqual(channel["channel_name"], "Films")

        self.fixture.library.player_mode_status.return_value = {
            "mode": "adult", "standby": False, "playing": True,
            "paused": False, "programme": "Adult Film",
        }
        self.assertIsNone(self.fixture.library.current_tv_viewing())

    def test_viewing_history_rolls_episodes_up_to_channel_and_deletes_selected(self) -> None:
        now = time.time()
        activity = {"item_key": "channel:2", "title": "Puffin Rock",
                    "kind": "channel", "surface": "tv", "channel_number": 2,
                    "channel_name": "Puffin Rock"}
        self.fixture.library.record_viewing(activity, 60, now - 60)
        self.fixture.library.record_viewing(activity, 60, now)
        summary = self.fixture.library.viewing_insights(1, 0)
        self.assertEqual(summary["sessions"][0]["title"], "Puffin Rock")
        self.assertEqual(summary["sessions"][0]["kind"], "channel")
        session_id = summary["sessions"][0]["id"]
        result = self.fixture.library.delete_viewing_sessions({"ids": [session_id]})
        self.assertEqual(result["deleted"], 1)
        self.assertEqual(self.fixture.library.viewing_store["sessions"], [])

    def test_viewing_history_migration_removes_non_mabel_and_short_sessions(self) -> None:
        now = time.time()
        self.fixture.library.write_state("viewing", {
            "schema_version": 1,
            "tracking_started": now - 1000,
            "sessions": [
                {"kind": "adult", "seconds": 300, "ended": now,
                 "channel_number": None},
                {"kind": "usb", "seconds": 300, "ended": now,
                 "channel_number": None},
                {"kind": "episode", "seconds": 90, "ended": now,
                 "channel_number": 2, "channel_name": "Puffin Rock"},
                {"kind": "episode", "seconds": 180, "ended": now,
                 "channel_number": 2, "channel_name": "Puffin Rock",
                 "item_key": "channel:2:episode.mp4", "surface": "tv"},
            ],
        })
        store = self.fixture.library.load_viewing_store()
        self.assertEqual(len(store["sessions"]), 1)
        self.assertEqual(store["sessions"][0]["kind"], "channel")
        self.assertEqual(store["sessions"][0]["item_key"], "channel:2")
        self.assertTrue(store["sessions"][0]["id"])
        persisted = self.fixture.library.read_state("viewing")
        self.assertEqual(persisted["schema_version"], 2)
        self.assertEqual(len(persisted["sessions"]), 1)

    def test_experience_uses_shared_icons_and_clear_channel_pager(self) -> None:
        channel_script = (PORTAL_ROOT / "js" / "channel-page.js").read_text(
            encoding="utf-8")
        library_script = PORTAL_LIBRARY
        system_view = (PORTAL_ROOT / "html" / "views" / "system.html").read_text(
            encoding="utf-8")
        insights_view = (PORTAL_ROOT / "html" / "views" / "insights.html").read_text(
            encoding="utf-8")
        experience_css = (PORTAL_ROOT / "css" / "experience-library.css").read_text(
            encoding="utf-8")
        settings_css = PORTAL_EXPERIENCE_STYLES
        playback_script = PORTAL_PLAYBACK
        self.assertIn("iconName: 'signal-chevron-down'", channel_script)
        self.assertIn("programmePager", channel_script)
        self.assertNotIn('<svg viewBox="0 0 24 24"', channel_script)
        self.assertIn("body.portal-v2 .channel-page-load-more", experience_css)
        self.assertIn("color-mix(in srgb, var(--experience-accent) 48%, transparent)", experience_css)
        self.assertIn("mabelRemotePositionTimer = setInterval(saveMabelRemotePosition, 15000)",
                      playback_script)
        self.assertIn('id="openAppearanceSettings"', system_view)
        self.assertNotIn('id="experienceAccentHue"', system_view)
        self.assertNotIn('id="viewingInsights"', system_view)
        self.assertIn('data-go="usb"', system_view)
        self.assertNotIn('data-go="insights"', system_view)
        self.assertIn('id="viewingInsights"', insights_view)
        self.assertIn('/portal/icons.svg#signal-chart-column', insights_view)
        self.assertNotIn('<svg viewBox="0 0 24 24"', system_view)
        self.assertNotIn('<svg viewBox="0 0 24 24"', insights_view)
        self.assertNotIn('id="viewingDeleteSelected"', insights_view)
        self.assertNotIn("selectedViewingSessions", library_script)
        self.assertIn("bindViewingSessionSwipe", library_script)
        self.assertIn("viewing-session-delete", settings_css)
        self.assertIn("renderViewingItem", library_script)
        self.assertIn("new Chart(canvas, config)", library_script)
        self.assertNotIn("createElementNS(namespace, 'polyline')", library_script)
        self.assertIn("viewing-destinations", settings_css)
        self.assertIn("viewing-catalog-grid", settings_css)
        self.assertIn(".activity-job-top > div { min-width: 0", settings_css)
        self.assertIn(".activity-job h2 { max-width: 100%; overflow-wrap: anywhere", settings_css)
        self.assertIn('id="viewingItemDetail"', insights_view)
        self.assertIn('id="viewingItemWeekdays"', insights_view)
        self.assertIn('id="viewingDiary"', insights_view)
        self.assertIn('data-insights-tab="history"', insights_view)
        self.assertIn('id="viewingRangeControls"', insights_view)
        self.assertIn('id="viewingItemRangeSelect"', insights_view)
        self.assertIn('viewing-insights-loading hidden', insights_view)
        self.assertIn('replaceInsightsRoute(`insights/item/', library_script)
        self.assertIn("$('#viewingRangeControls')?.classList.toggle('hidden'", library_script)
        self.assertIn('viewingInsightsLoadedRange === viewingInsightsRange', library_script)
        self.assertIn('background-size: contain', settings_css)
        self.assertIn('.viewing-range.hidden { display: none; }', settings_css)


if __name__ == "__main__":
    unittest.main()
