from __future__ import annotations

from tests.python.library_test_support import *


class LiveStatusResilienceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()

    def tearDown(self) -> None:
        self.fixture.close()

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
        commands = ("open-parent-menu", "open-tv-guide", "open-channel-menu", "close-overlay",
                    "restart-programme", "navigate-up", "navigate-down",
                    "navigate-left", "navigate-right", "select",
                    "toggle-subtitles", "toggle-widescreen-mode",
                    "return-to-mabeltv", "toggle-remote-lock",
                    "turn-on", "turn-off", "turn-on-mabel-only",
                    "turn-off-mabel-only")
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

    def test_live_tv_channel_picker_sends_a_validated_direct_tune(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True):
            with mock.patch.object(mabeltv_library.socket, "socket") as socket_factory:
                client = socket_factory.return_value.__enter__.return_value
                client.recv.return_value = b"ok\n"
                self.assertEqual(
                    self.fixture.library.live_tv_control({
                        "command": "tune-channel", "channel": 1,
                    }),
                    {"ok": True, "message": "Command sent"})
                client.sendall.assert_called_once_with(
                    b'{"command":"tune-channel","channel":1}\n')

        with self.assertRaisesRegex(ValueError, "Choose a channel"):
            self.fixture.library.live_tv_control({
                "command": "tune-channel", "channel": "not-a-channel",
            })

    def test_live_tv_status_reports_adult_mode_instead_of_hidden_kids_playback(self) -> None:
        self.fixture.library.live_stream.status = mock.Mock(return_value={
            "available": False, "reason": "Waiting for the TV programme",
            "channel_number": 5, "channel_name": "Films",
        })
        self.fixture.library.player_mode_status = mock.Mock(return_value={
            "mode": "adult", "playing": True,
            "programme": "The Fellowship of the Ring", "paused": True,
            "volume": 48, "muted": False, "remote_locked": True,
            "subtitles_available": True, "subtitles_visible": True,
            "playback_position": 1234.4, "playback_duration": 13680.7,
        })

        status = self.fixture.library.live_tv_status()

        self.fixture.library.live_stream.status.assert_called_once_with(
            allow_screen_without_programme=True)
        self.assertTrue(status["available"])
        self.assertNotIn("reason", status)
        self.assertTrue(status["adult_mode"])
        self.assertTrue(status["adult_playing"])
        self.assertEqual(status["programme"], "The Fellowship of the Ring")
        self.assertTrue(status["paused"])
        self.assertEqual(status["channel_name"], "Films")
        self.assertEqual(status["volume"], 48)
        self.assertFalse(status["muted"])
        self.assertTrue(status["remote_locked"])
        self.assertTrue(status["subtitles_available"])
        self.assertTrue(status["subtitles_visible"])
        self.assertEqual(status["playback_position"], 1234)
        self.assertEqual(status["playback_duration"], 13681)

    def test_live_tv_status_exposes_connected_tv_power(self) -> None:
        self.fixture.library.live_stream.status = mock.Mock(return_value={
            "available": True, "programme": "Postman Pat",
        })
        self.fixture.library.player_mode_status = mock.Mock(return_value={
            "mode": "kids", "standby": False,
            "connected_tv_available": True, "connected_tv_power": "on",
        })

        status = self.fixture.library.live_tv_status()

        self.assertTrue(status["connected_tv_available"])
        self.assertEqual(status["connected_tv_power"], "on")

    def test_live_tv_status_exposes_current_film_progress_for_home_card(self) -> None:
        self.fixture.library.live_stream.status = mock.Mock(return_value={
            "available": True, "programme": "Stick Man",
        })
        mode = {
            "mode": "kids", "standby": False,
            "connected_tv_available": True, "connected_tv_power": "on",
        }
        self.fixture.library.player_mode_status = mock.Mock(return_value=mode)
        self.fixture.library.current_tv_viewing = mock.Mock(return_value={
            "kind": "film", "position": 540.2, "media_duration": 1620.7,
        })

        status = self.fixture.library.live_tv_status()

        self.assertEqual(status["playback_position"], 540)
        self.assertEqual(status["playback_duration"], 1621)
        self.fixture.library.current_tv_viewing.assert_called_once_with(mode)

    def test_live_tv_status_exposes_current_series_progress_for_home_card(self) -> None:
        self.fixture.library.live_stream.status = mock.Mock(return_value={
            "available": True, "programme": "S01E14 · Bouncy Ball",
        })
        mode = {"mode": "kids", "standby": False}
        self.fixture.library.player_mode_status = mock.Mock(return_value=mode)
        self.fixture.library.current_tv_viewing = mock.Mock(return_value={
            "kind": "channel", "position": 180.2, "media_duration": 840.6,
        })

        status = self.fixture.library.live_tv_status()

        self.assertEqual(status["playback_position"], 180)
        self.assertEqual(status["playback_duration"], 841)
        self.fixture.library.current_tv_viewing.assert_called_once_with(mode)

    def test_portal_power_prompt_is_skipped_when_connected_tv_already_matches(self) -> None:
        self.assertIn("function connectedTvAlreadyAtTarget(state, turningOn)",
                      PORTAL_SOURCE)
        self.assertIn("await applyPortalPower(false, trigger)", PORTAL_SOURCE)
        self.assertIn('id="homeMabelTvDot"', PORTAL_SOURCE)
        self.assertIn('id="homeSpotlightProgress"', PORTAL_SOURCE)
        self.assertIn("setHomeSpotlightProgress(state)", PORTAL_SOURCE)
        self.assertIn("media?.remote_duration", PORTAL_SOURCE)
        self.assertIn("nowPlayingMeta.classList.toggle('hidden'", PORTAL_SOURCE)
        self.assertIn("background: #ff5a6e", PORTAL_STYLES)

    def test_player_mode_status_tolerates_an_unavailable_player_socket(self) -> None:
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True):
            with mock.patch.object(mabeltv_library.socket, "socket",
                                   side_effect=OSError("not ready")):
                self.assertEqual(self.fixture.library.player_mode_status(), {})

    def test_portal_error_notices_clear_automatically(self) -> None:
        portal = PORTAL_SOURCE

        self.assertIn("if (message)", portal)
        self.assertIn("bad ? 7000 : 3500", portal)
        self.assertNotIn("message.endsWith('…')", portal)
        self.assertIn("state.adult_mode ? 'ADULT TV · PRIVATE LIBRARY'", portal)

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
            database = root / "mabeltv.db"
            initialise_test_database(
                mabeltv_library.StateDatabase, database,
                json.loads(channels.read_text(encoding="utf-8")),
            )
            config = root / "library.conf"
            config.write_text("MABELTV_SETUP_CODE=135790\n", encoding="utf-8")
            with mock.patch.dict(os.environ, {
                    "MABELTV_TMDB_ARTWORK_CACHE": str(root / "tmdb-artwork-cache"),
            }):
                library = mabeltv_library.Library(argparse.Namespace(
                    media_root=str(media), channels=str(channels),
                    settings=str(settings), owner=str(root / "owner.json"),
                    config=str(config), database=str(database),
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


if __name__ == "__main__":
    unittest.main()
