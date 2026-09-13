from __future__ import annotations

from tests.python.library_test_support import *


class RemotePlaybackLibraryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def test_lg_remote_is_additional_mobile_control_surface(self) -> None:
        html = mabeltv_library.INDEX
        script = (PORTAL_ROOT / "js" / "lg-tv-remote.js").read_text(encoding="utf-8")
        styles = (PORTAL_ROOT / "css" / "lg-tv-remote.css").read_text(encoding="utf-8")
        service_worker = (PROJECT_ROOT / "scripts" / "pi" / "service-worker.js").read_text(
            encoding="utf-8")

        self.assertNotIn('id="openLgTvRemote"', html)
        self.assertIn('data-view-button="live"', html)
        self.assertIn('id="view-lg-tv"', html)
        self.assertIn('id="lgTrackpad"', html)
        self.assertIn('data-lg-launch="netflix"', html)
        self.assertIn('data-lg-launch="mabeltv"', html)
        self.assertIn('use two fingers to scroll', html)
        self.assertIn("pointerContacts.size > 1", script)
        self.assertIn("POINTER_INTERVAL_MS = 36", script)
        self.assertIn("available_apps", script)
        self.assertIn("grid-auto-columns: 68px", styles)
        self.assertIn("body.portal-v2 .tv-remote-dpad", PORTAL_EXPERIENCE_STYLES)
        self.assertIn("@media (max-width: 430px)", styles)
        self.assertNotIn("!important", styles)
        self.assertIn("'/portal/css/lg-tv-remote.css'", service_worker)
        self.assertIn("'/portal-app.js'", service_worker)
        self.assertIn('"lg-tv-remote.js"',
                      (PROJECT_ROOT / "scripts/pi/mabeltv_backend/portal.py").read_text(
                          encoding="utf-8"))

    def test_lg_remote_status_handles_nested_volume_and_catalogue_labels(self) -> None:
        library = self.fixture.library
        library.lg_tv_host = "192.0.2.10"
        library.lg_tv_catalog_cache = {
            "apps": [{"id": "netflix", "title": "Netflix"}],
            "inputs": [],
            "shortcuts": {"netflix": "netflix"},
        }
        library.lg_tv_catalog_updated = time.monotonic()
        session = mock.Mock()
        session.receive.side_effect = [
            {"type": "response", "payload": {"returnValue": True, "appId": "netflix"}},
            {"type": "response", "payload": {
                "returnValue": True,
                "volumeStatus": {"volume": 18, "muteStatus": True},
            }},
        ]
        with mock.patch.object(library, "lg_tv_session", return_value=session):
            status = library.lg_tv_status()

        self.assertTrue(status["connected"])
        self.assertEqual(status["app"], "Netflix")
        self.assertEqual(status["volume"], 18)
        self.assertTrue(status["muted"])
        self.assertEqual(status["available_apps"], ["netflix"])
        session.close.assert_called_once()

    def test_lg_remote_dpad_uses_reusable_pointer_socket_protocol(self) -> None:
        library = self.fixture.library
        pointer = mock.Mock()
        pointer.connection = object()
        library.lg_tv_pointer_socket = pointer

        library.lg_tv_action({"action": "up"})
        library.lg_tv_action({"action": "pointer-move", "dx": 11, "dy": -4})

        self.assertEqual(pointer.send_text.call_args_list, [
            mock.call("type:button\nname:UP\n\n"),
            mock.call("type:move\ndx:11\ndy:-4\ndown:0\n\n"),
        ])

    def test_lg_remote_media_and_volume_use_supported_ssap_actions(self) -> None:
        library = self.fixture.library
        with mock.patch.object(library, "lg_tv_request", return_value={}) as request:
            library.lg_tv_action({"action": "play"})
            library.lg_tv_action({"action": "volume-up"})
            library.lg_tv_action({"action": "mute", "mute": True})

        self.assertEqual(request.call_args_list, [
            mock.call("ssap://media.controls/play", request_id="lg-play"),
            mock.call("ssap://audio/volumeUp", None, "lg-volume-up"),
            mock.call("ssap://audio/setMute", {"mute": True}, "lg-mute"),
        ])

    def test_lg_remote_discovers_app_ids_and_mabeltv_input(self) -> None:
        library = self.fixture.library
        library.lg_tv_host = "192.0.2.10"
        session = mock.Mock()
        session.receive.side_effect = [
            {"type": "response", "payload": {
                "returnValue": True,
                "launchPoints": [{"id": "uk.bbc.custom", "title": "BBC iPlayer"}],
            }},
            {"type": "response", "payload": {
                "returnValue": True,
                "devices": [{"inputId": "HDMI_2", "appId": "external.hdmi2",
                             "label": "MabelTV"}],
            }},
            {"type": "response", "payload": {"returnValue": True}},
        ]
        with mock.patch.object(library, "lg_tv_session", return_value=session):
            result = library.lg_tv_switch_to_mabeltv()

        self.assertEqual(result["message"], "Switching to MabelTV…")
        self.assertEqual(library.lg_tv_catalog_cache["shortcuts"]["iplayer"],
                         "uk.bbc.custom")
        self.assertEqual(session.send.call_args_list[-1].args[0]["payload"],
                         {"inputId": "HDMI_2"})

    def test_lg_remote_keeps_app_catalog_when_input_listing_is_unavailable(self) -> None:
        library = self.fixture.library
        session = mock.Mock()
        session.receive.side_effect = [
            {"type": "response", "payload": {
                "returnValue": True,
                "launchPoints": [{"id": "netflix", "title": "Netflix"}],
            }},
            {"type": "error", "error": "403 forbidden"},
        ]

        catalog = library.lg_tv_catalog(session, force=True)

        self.assertTrue(catalog["apps_known"])
        self.assertFalse(catalog["inputs_known"])
        self.assertEqual(catalog["shortcuts"]["netflix"], "netflix")

    def test_netflix_tv_content_id_accepts_only_direct_netflix_titles(self) -> None:
        self.assertEqual(
            mabeltv_library.Library.netflix_content_id(
                "https://www.netflix.com/watch/81458416"),
            "m=https://www.netflix.com/watch/81458416&source_type=4")
        self.assertEqual(
            mabeltv_library.Library.netflix_content_id(
                "https://www.netflix.com/title/81458416?trackId=1"),
            "m=https://www.netflix.com/watch/81458416&source_type=4")
        with self.assertRaises(ValueError):
            mabeltv_library.Library.netflix_content_id(
                "https://www.netflix.com/search?q=Glass+Onion")

    def test_remote_stream_requires_browser_format_and_resumes_adult_film(self) -> None:
        adult = self.fixture.media / ".adult"
        adult.mkdir(parents=True, exist_ok=True)
        film = adult / "Remote Film.mp4"
        film.write_bytes(b"remote-film")
        self.fixture.library.write_state("player", json.loads('{"standby": true}'))
        item = self.fixture.library.adult_library()[0]
        started = self.fixture.library.start_remote_stream({"kind": "adult", "file": "Remote Film.mp4"})
        self.assertIn("/api/remote/media?stream=", started["stream_url"])
        self.assertIsNone(started["subtitle_url"])
        token = started["stream_url"].split("stream=", 1)[1]
        self.fixture.library.remote_save_position({"stream": token, "position": 42, "duration": 100})
        self.assertEqual(self.fixture.library.adult_library()[0]["remote_position"], 42)
        (adult / "Remote Film.en.srt").write_text("1\n00:00:01,000 --> 00:00:02,000\nHello\n", encoding="utf-8")
        with_captions = self.fixture.library.start_remote_stream({"kind": "adult", "file": "Remote Film.mp4"})
        self.assertIn("/api/remote/subtitles?stream=", with_captions["subtitle_url"])
        caption_token = with_captions["stream_url"].split("stream=", 1)[1]
        captions = self.fixture.library.remote_subtitles(caption_token).decode("utf-8")
        self.assertTrue(captions.startswith("WEBVTT"))
        self.assertEqual(item["library_id"], self.fixture.library.adult_library()[0]["library_id"])

        from_beginning = self.fixture.library.start_remote_stream({
            "kind": "adult", "file": "Remote Film.mp4", "position": 0,
        })
        self.assertEqual(from_beginning["resume_position"], 0)

    def test_film_favourites_are_shared_with_the_portal_without_refreshing_tv(self) -> None:
        channels = [{
            "number": 5, "name": "Films", "folder": "films",
            "aspect": "fit", "content_type": "films",
        }]
        self.fixture.library.write_state("channels", json.loads(json.dumps({
            "schema_version": 1, "channels": channels,
        })))
        films = self.fixture.media / "films"
        films.mkdir(parents=True)
        (films / "The Apple.mp4").write_bytes(b"film")
        (films / "Banana.mp4").write_bytes(b"film")
        (films / "A Film.mp4").write_bytes(b"film")
        adult = self.fixture.library.adult_root / "Adult Film.mp4"
        adult.write_bytes(b"adult")
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

        self.fixture.library.set_favourite({
            "kind": "adult", "file": adult.name, "enabled": True,
        })
        self.fixture.library.set_favourite({
            "kind": "channel", "channel": 5,
            "file": "The Apple.mp4", "enabled": True,
        })

        rendered = self.fixture.library.library()
        self.assertTrue(rendered["adult_library"][0]["favourite"])
        programmes = rendered["channels"][0]["programmes"]
        self.assertEqual([item["display_name"] for item in programmes],
                         ["A Film", "The Apple", "Banana"])
        self.assertTrue(programmes[1]["favourite"])
        self.fixture.library.refresh_tv.assert_not_called()

        self.fixture.library.set_favourite({
            "kind": "channel", "channel": 5,
            "file": "The Apple.mp4", "enabled": False,
        })
        self.assertFalse(self.fixture.library.library()["channels"][0]
                         ["programmes"][1]["favourite"])

    def test_series_channel_favourite_uses_saved_channel_episode_and_position(self) -> None:
        channels = [{
            "number": 2, "name": "Puffin Rock", "folder": "puffin-rock",
            "aspect": "crop", "content_type": "shows",
        }]
        self.fixture.library.write_state("channels", json.loads(json.dumps({
            "schema_version": 1, "channels": channels,
        })))
        folder = self.fixture.media / "puffin-rock"
        folder.mkdir(parents=True)
        (folder / "S01 E01 - First.mp4").write_bytes(b"first")
        (folder / "S01 E02 - Second.mp4").write_bytes(b"second")
        self.fixture.library.write_state("player", json.loads(json.dumps({
            "standby": True,
            "channel_timelines": {"2": {
                "episode_name": "S01 E02 - Second.mp4",
                "position_seconds": 193,
                "programme_positions": {"S01 E02 - Second.mp4": 193},
            }},
        })))

        self.fixture.library.set_favourite({
            "kind": "series-channel", "channel": 2, "enabled": True,
        })
        channel = self.fixture.library.library()["channels"][0]

        self.assertTrue(channel["favourite"])
        self.assertEqual(channel["resume_file"], "S01 E02 - Second.mp4")
        self.assertEqual(channel["resume_position"], 193)
        self.assertEqual(channel["resume_title"], "S01 E02 - Second")
        stream = self.fixture.library.start_remote_stream({
            "kind": "channel", "channel": 2,
            "file": channel["resume_file"], "position": channel["resume_position"],
        })
        self.assertTrue(stream["resume_enabled"])
        self.assertEqual(stream["resume_position"], 193)

        self.fixture.library.set_favourite({
            "kind": "series-channel", "channel": 2, "enabled": False,
        })
        self.assertFalse(self.fixture.library.library()["channels"][0]["favourite"])

    def test_film_channel_resume_is_shared_from_tv_to_portal_and_back(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        channels = self.fixture.library.channels()
        channels[0]["content_type"] = "films"
        self.fixture.library.write_state(
            "channels", {"schema_version": 1, "channels": channels})
        film = self.fixture.media / "kids-tv" / "Family Film.mp4"
        film.parent.mkdir(parents=True, exist_ok=True)
        film.write_bytes(b"film")
        self.fixture.library.write_state("player", json.loads(json.dumps({
            "standby": True,
            "channel_film_positions": {"1/Family Film.mp4": 1800},
            "channel_film_durations": {"1/Family Film.mp4": 7200},
            "channel_film_position_updated_utc_ms": {
                "1/Family Film.mp4": 1234000,
            },
        })))

        programme = self.fixture.library.library()["channels"][0]["programmes"][0]
        self.assertEqual(programme["remote_position"], 1800)
        self.assertEqual(programme["remote_duration"], 7200)
        self.assertEqual(programme["remote_last_watched"], 1234)
        started = self.fixture.library.start_remote_stream({
            "kind": "channel", "channel": 1, "file": "Family Film.mp4",
        })
        self.assertTrue(started["resume_enabled"])
        self.assertEqual(started["resume_position"], 1800)

        token = started["stream_url"].split("stream=", 1)[1]
        client = mock.MagicMock()
        context = mock.MagicMock()
        context.__enter__.return_value = client
        context.__exit__.return_value = False
        client.recv.return_value = b"ok\n"
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket", return_value=context):
            self.fixture.library.remote_save_position({
                "stream": token, "position": 2400, "duration": 7200,
            })
        command = json.loads(client.sendall.call_args.args[0].decode())
        self.assertEqual(command, {
            "command": "save-channel-film-position", "channel": 1,
            "file": "Family Film.mp4", "position": 2400.0,
            "duration": 7200.0,
        })

    def test_remote_stream_blocks_live_tv_unless_concurrent_mode_is_enabled(self) -> None:
        adult = self.fixture.media / ".adult"
        adult.mkdir(parents=True, exist_ok=True)
        (adult / "Film.mp4").write_bytes(b"film")
        self.fixture.library.write_state("player", json.loads('{"standby": false}'))
        with self.assertRaises(mabeltv_library.RemoteTvActiveError):
            self.fixture.library.start_remote_stream({"kind": "adult", "file": "Film.mp4"})
        self.fixture.library.manage({"action": "set-remote-simultaneous", "enabled": True})
        started = self.fixture.library.start_remote_stream({"kind": "adult", "file": "Film.mp4"})
        self.assertTrue(started["ok"])

    def test_remote_session_accepts_a_large_backward_seek(self) -> None:
        adult = self.fixture.media / ".adult"
        adult.mkdir(parents=True, exist_ok=True)
        (adult / "Film.mp4").write_bytes(b"film")
        self.fixture.library.write_state("player", json.loads(
            '{"standby": true}'))
        started = self.fixture.library.start_remote_stream({
            "kind": "adult", "file": "Film.mp4",
        })
        token = started["stream_url"].split("stream=", 1)[1]

        self.fixture.library.remote_save_position({
            "stream": token, "position": 4800, "duration": 7200,
        })
        self.fixture.library.remote_save_position({
            "stream": token, "position": 1200, "duration": 7200,
        })

        self.assertEqual(
            self.fixture.library.adult_library()[0]["remote_position"], 1200)

    def test_remote_concurrent_setting_does_not_refresh_the_tv_player(self) -> None:
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

        result = self.fixture.library.manage({
            "action": "set-remote-simultaneous", "enabled": True,
        })

        self.assertTrue(result)
        self.fixture.library.refresh_tv.assert_not_called()
        self.assertTrue(self.fixture.library.remote_settings()["allow_simultaneous"])

    def test_most_recent_adult_session_sets_next_shared_resume_position(self) -> None:
        adult = self.fixture.media / ".adult"
        adult.mkdir(parents=True, exist_ok=True)
        (adult / "Film.mp4").write_bytes(b"film")
        item = self.fixture.library.adult_library()[0]
        states = self.fixture.library.adult_media_states()
        states["Film.mp4"].update({
            "remote_position": 900,
            "remote_duration": 7200,
            "remote_last_watched": 200,
        })
        self.fixture.library.write_adult_media_states(states)
        self.fixture.library.write_state("player", json.loads(json.dumps({
            "standby": False,
            "adult_positions": {item["library_id"]: 300},
            "adult_durations": {item["library_id"]: 7200},
            "adult_position_updated_utc_ms": {item["library_id"]: 300000},
        })))

        latest_tv = self.fixture.library.adult_library()[0]
        self.assertEqual(latest_tv["remote_position"], 300)
        self.assertEqual(latest_tv["remote_last_watched"], 300)

        states = self.fixture.library.adult_media_states()
        states["Film.mp4"].update({
            "remote_position": 1200,
            "remote_last_watched": 400,
        })
        self.fixture.library.write_adult_media_states(states)
        latest_browser = self.fixture.library.adult_library()[0]
        self.assertEqual(latest_browser["remote_position"], 1200)
        self.assertEqual(latest_browser["remote_last_watched"], 400)

    def test_remote_resume_ignores_first_seconds_and_end_credits(self) -> None:
        self.assertEqual(self.fixture.library.normalise_resume_position(29, 7200), 0)
        self.assertEqual(self.fixture.library.normalise_resume_position(30, 7200), 30)
        self.assertEqual(self.fixture.library.normalise_resume_position(6900, 7200), 0)
        self.assertEqual(self.fixture.library.normalise_resume_position(6800, 7200), 6800)

    def test_starting_over_suppresses_the_stale_tv_bookmark(self) -> None:
        adult = self.fixture.media / ".adult"
        adult.mkdir(parents=True, exist_ok=True)
        (adult / "Film.mp4").write_bytes(b"film")
        item = self.fixture.library.adult_library()[0]
        self.fixture.library.write_state("player", json.loads(json.dumps({
            "standby": True, "adult_positions": {item["library_id"]: 420},
        })))
        started = self.fixture.library.start_remote_stream({"kind": "adult", "file": "Film.mp4"})
        token = started["stream_url"].split("stream=", 1)[1]
        self.fixture.library.remote_save_position({
            "stream": token, "position": 12, "duration": 7200,
        })
        self.assertEqual(self.fixture.library.adult_library()[0]["remote_position"], 0)
        self.fixture.library.write_state("player", json.loads(json.dumps({
            "standby": True, "adult_positions": {item["library_id"]: 480},
        })))
        self.assertEqual(self.fixture.library.adult_library()[0]["remote_position"], 480)
        self.fixture.library.write_state("player", json.loads(json.dumps({
            "standby": True,
            "adult_positions": {item["library_id"]: 7050},
            "adult_durations": {item["library_id"]: 7200},
        })))
        finished = self.fixture.library.adult_library()[0]
        self.assertEqual(finished["remote_position"], 0)
        self.assertEqual(finished["remote_duration"], 7200)

    def test_explicit_continue_watching_removal_clears_browser_and_tv_bookmarks(self) -> None:
        adult = self.fixture.media / ".adult"
        adult.mkdir(parents=True, exist_ok=True)
        (adult / "Film.mp4").write_bytes(b"film")
        item = self.fixture.library.adult_library()[0]
        states = self.fixture.library.adult_media_states()
        states["Film.mp4"]["remote_position"] = 900
        states["Film.mp4"]["remote_last_watched"] = 12345
        self.fixture.library.write_adult_media_states(states)
        self.fixture.library.write_state("player", json.loads(json.dumps({
            "standby": True,
            "adult_positions": {item["library_id"]: 600},
            "adult_durations": {item["library_id"]: 7200},
        })))

        self.fixture.library.remote_clear_position({
            "kind": "adult", "file": "Film.mp4",
        })

        cleared = self.fixture.library.adult_library()[0]
        self.assertEqual(cleared["remote_position"], 0)
        self.assertEqual(cleared["remote_last_watched"], 0)
        saved = self.fixture.library.adult_media_states()["Film.mp4"]
        self.assertEqual(saved["ignored_player_position"], 600)

    def test_new_remote_stream_replaces_old_without_stale_token_clearing_it(self) -> None:
        adult = self.fixture.media / ".adult"
        adult.mkdir(parents=True, exist_ok=True)
        (adult / "First.mp4").write_bytes(b"first")
        (adult / "Second.mp4").write_bytes(b"second")
        self.fixture.library.write_state("player", json.loads('{"standby": true}'))
        first = self.fixture.library.start_remote_stream({"kind": "adult", "file": "First.mp4"})
        second = self.fixture.library.start_remote_stream({"kind": "adult", "file": "Second.mp4"})
        first_token = first["stream_url"].split("stream=", 1)[1]
        second_token = second["stream_url"].split("stream=", 1)[1]
        with self.assertRaisesRegex(ValueError, "expired"):
            self.fixture.library.remote_session(first_token)
        self.assertEqual(self.fixture.library.remote_session(second_token)["title"], "Second")


if __name__ == "__main__":
    unittest.main()
