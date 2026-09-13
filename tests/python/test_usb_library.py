from __future__ import annotations

from tests.python.library_test_support import *


class UsbLibraryTests(unittest.TestCase):
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

    def test_interrupted_usb_copy_is_removed_from_private_staging(self) -> None:
        partial = self.fixture.library.incoming / ("usb-" + "a" * 32 + "-0.part")
        partial.write_bytes(b"unfinished")
        self.fixture.library.cleanup_stale_temporary_files()
        self.assertFalse(partial.exists())

    def test_usb_hard_disk_is_offered_even_when_not_marked_removable(self) -> None:
        block_devices = {"blockdevices": [{
            "name": "sda", "path": "/dev/sda", "type": "disk", "tran": "usb",
            "rm": False, "mountpoints": [], "children": [{
                "name": "sda1", "path": "/dev/sda1", "type": "part",
                "pkname": "sda", "uuid": "WD-USB", "label": "My Passport",
                "fstype": "ntfs", "size": 2_000_000_000_000, "mountpoints": [],
            }],
        }]}
        completed = types.SimpleNamespace(stdout=json.dumps(block_devices))
        self.fixture.library.usb_requires_mount = True
        with mock.patch.object(mabeltv_library.subprocess, "run", return_value=completed):
            result = self.fixture.library.usb_volumes()
        self.assertEqual(result["volumes"][0]["device"], "/dev/sda1")
        self.assertEqual(result["volumes"][0]["label"], "My Passport")

    def test_usb_drive_sleeps_after_one_idle_minute_without_disappearing(self) -> None:
        library = self.fixture.library
        library.usb_idle_seconds = 60
        library.usb_last_activity["TEST-USB"] = 100
        with mock.patch.object(library, "usb_busy_reason", return_value=None), \
                mock.patch.object(library, "_run_usb_helper",
                                  return_value="The USB drive is sleeping.") as helper:
            library.usb_power_tick(now=161)
        helper.assert_called_once_with("usb-sleep", "")
        self.assertIn("TEST-USB", library.usb_sleeping)
        volume = library.usb_volumes()["volumes"][0]
        self.assertTrue(volume["sleeping"])
        self.assertTrue(volume["mounted"])

    def test_usb_activity_postpones_automatic_sleep(self) -> None:
        library = self.fixture.library
        movie = self.volume / "Still Playing.mp4"
        movie.write_bytes(b"browser-ready")
        library.write_state("player", json.loads('{"standby": true}'))
        library.start_remote_stream({
            "kind": "usb", "volume": "TEST-USB", "file": movie.name,
        })
        library.usb_idle_seconds = 60
        library.usb_last_activity["TEST-USB"] = 100
        with mock.patch.object(library, "_run_usb_helper") as helper:
            library.usb_power_tick(now=161)
        helper.assert_not_called()
        self.assertNotIn("TEST-USB", library.usb_sleeping)
        self.assertGreater(library.usb_last_activity["TEST-USB"], 161)

    def test_usb_import_postpones_automatic_sleep(self) -> None:
        library = self.fixture.library
        import_id = "a" * 32
        library.write_json(library.incoming / f"{import_id}.json", {
            "id": import_id,
            "source_kind": "usb",
            "source_volume": "TEST-USB",
            "status": "copying",
            "size": 8,
        })
        library.usb_idle_seconds = 60
        library.usb_last_activity["TEST-USB"] = 100
        with mock.patch.object(library, "_run_usb_helper") as helper:
            library.usb_power_tick(now=161)
        helper.assert_not_called()
        self.assertNotIn("TEST-USB", library.usb_sleeping)

    def test_usb_use_wakes_and_mounts_a_sleeping_drive(self) -> None:
        library = self.fixture.library
        library.usb_requires_mount = True
        with mock.patch.object(library, "usb_mount_path",
                               side_effect=[ValueError("sleeping"), self.volume.resolve()]), \
                mock.patch.object(library, "_usb_volume",
                                  return_value={"id": "TEST-USB", "device": "/dev/sda1"}), \
                mock.patch.object(library, "usb_mount") as mount:
            root = library.usb_ensure_awake("TEST-USB")
        mount.assert_called_once_with("/dev/sda1")
        self.assertEqual(root, self.volume.resolve())

    def test_full_eject_works_while_drive_is_sleeping(self) -> None:
        library = self.fixture.library
        library.usb_sleeping.add("TEST-USB")
        with mock.patch.object(library, "_usb_volume", return_value={
                "id": "TEST-USB", "device": "/dev/sda1", "mounted": False,
        }), mock.patch.object(library, "usb_busy_reason", return_value=None), \
                mock.patch.object(library, "_run_usb_helper",
                                  return_value="The USB drive can now be unplugged safely.") as helper:
            result = library.usb_eject("TEST-USB")
        helper.assert_called_once_with("usb-eject", "/dev/sda1")
        self.assertTrue(result["ok"])
        self.assertNotIn("TEST-USB", library.usb_sleeping)

    def test_usb_portal_distinguishes_sleep_from_full_eject(self) -> None:
        self.assertIn("Sleeps after 1 idle minute", PORTAL_SOURCE)
        self.assertIn("volume.sleeping ? 'Wake & open'", PORTAL_SOURCE)
        self.assertIn('id="usbEjectSheet"', PORTAL_SOURCE)
        self.assertIn("You will need to unplug and reconnect it", PORTAL_SOURCE)
        self.assertNotIn("confirm('Safely eject this USB drive?", PORTAL_SOURCE)

    def test_usb_system_disk_is_never_offered(self) -> None:
        block_devices = {"blockdevices": [{
            "name": "sda", "path": "/dev/sda", "type": "disk", "tran": "usb",
            "rm": False, "mountpoints": [], "children": [{
                "name": "sda2", "path": "/dev/sda2", "type": "part",
                "pkname": "sda", "uuid": "ROOT", "fstype": "ext4",
                "size": 64_000_000_000, "mountpoints": ["/"],
            }],
        }]}
        completed = types.SimpleNamespace(stdout=json.dumps(block_devices))
        self.fixture.library.usb_requires_mount = True
        with mock.patch.object(mabeltv_library.subprocess, "run", return_value=completed):
            result = self.fixture.library.usb_volumes()
        self.assertEqual(result["volumes"], [])

    def test_usb_browser_only_exposes_video_files_and_safe_relative_paths(self) -> None:
        (self.volume / "Films").mkdir()
        (self.volume / "$RECYCLE.BIN").mkdir()
        (self.volume / "System Volume Information").mkdir()
        (self.volume / "Films" / "Movie.mkv").write_bytes(b"video")
        (self.volume / "notes.txt").write_text("private", encoding="utf-8")
        listing = self.fixture.library.usb_browse("TEST-USB")
        self.assertEqual([(item["name"], item["type"]) for item in listing["entries"]],
                         [("Films", "folder")])
        films = self.fixture.library.usb_browse("TEST-USB", "Films")
        self.assertEqual(films["entries"][0]["path"], "Films/Movie.mkv")
        self.assertFalse(films["entries"][0]["browser_ready"])
        with self.assertRaisesRegex(ValueError, "path"):
            self.fixture.library.usb_browse("TEST-USB", "../")

    def test_usb_browser_stream_uses_resolved_mounted_media(self) -> None:
        movie = self.volume / "Phone Movie.mp4"
        movie.write_bytes(b"browser-ready")
        self.fixture.library.write_state("player", json.loads('{"standby": true}'))
        started = self.fixture.library.start_remote_stream({
            "kind": "usb", "volume": "TEST-USB", "file": "Phone Movie.mp4",
        })
        token = started["stream_url"].split("stream=", 1)[1]
        session = self.fixture.library.remote_session(token)
        self.assertEqual(session["kind"], "usb")
        self.assertEqual(session["source"], movie.resolve())
        self.assertEqual(started["resume_position"], 0)
        with self.assertRaisesRegex(ValueError, "path"):
            self.fixture.library.start_remote_stream({
                "kind": "usb", "volume": "TEST-USB", "file": "../outside.mp4",
            })

    def test_incompatible_usb_video_gets_scoped_vlc_stream(self) -> None:
        movie = self.volume / "Legacy Episode.avi"
        movie.write_bytes(b"legacy-video")
        started = self.fixture.library.start_external_stream({
            "kind": "usb", "volume": "TEST-USB", "file": "Legacy Episode.avi",
        })
        self.assertIn("/api/external/media?", started["stream_url"])
        self.assertEqual(started["title"], "Legacy Episode")
        session = self.fixture.library.external_stream_session(started["stream"])
        self.assertEqual(session["source"], movie.resolve())
        self.fixture.library.release_external_stream(started["stream"])
        with self.assertRaisesRegex(ValueError, "expired"):
            self.fixture.library.external_stream_session(started["stream"])

    def test_browser_ready_usb_video_can_start_private_offline_download(self) -> None:
        movie = self.volume / "Phone Movie.mp4"
        movie.write_bytes(b"phone-ready")
        with mock.patch.object(self.fixture.library, "offline_media_profile",
                               return_value="direct"):
            started = self.fixture.library.start_offline_download({
                "kind": "usb", "volume": "TEST-USB", "file": "Phone Movie.mp4",
            })
        self.assertEqual(started["status"], "ready")
        self.assertIn("/api/offline/media?", started["stream_url"])
        self.assertEqual(started["size"], len(b"phone-ready"))

    def test_webm_is_converted_for_dependable_iphone_offline_playback(self) -> None:
        inspected = types.SimpleNamespace(
            returncode=0,
            stdout=json.dumps({"streams": [
                {"codec_type": "video", "codec_name": "vp9"},
                {"codec_type": "audio", "codec_name": "opus"},
            ]}),
        )
        with mock.patch.object(mabeltv_library.subprocess, "run", return_value=inspected):
            profile = self.fixture.library.offline_media_profile(self.volume / "Episode.webm")
        self.assertEqual(profile, "convert")

    def test_incompatible_usb_download_is_queued_for_browser_preparation(self) -> None:
        movie = self.volume / "Legacy Episode.avi"
        movie.write_bytes(b"legacy-video")
        with mock.patch.object(self.fixture.library, "offline_media_profile",
                               return_value="repack"), \
                mock.patch.object(mabeltv_library.threading, "Thread") as thread:
            queued = self.fixture.library.start_offline_download({
                "kind": "usb", "volume": "TEST-USB", "file": "Legacy Episode.avi",
            })
        self.assertEqual(queued["status"], "queued")
        self.assertEqual(queued["preparation"], "repack")
        thread.assert_called_once()

    def test_incompatible_usb_conversion_uses_dedicated_fast_offline_path(self) -> None:
        movie = self.volume / "Legacy Episode.avi"
        movie.write_bytes(b"legacy-video")
        with mock.patch.object(self.fixture.library, "offline_media_profile",
                               return_value="convert"), \
                mock.patch.object(mabeltv_library.threading, "Thread"):
            queued = self.fixture.library.start_offline_download({
                "kind": "usb", "volume": "TEST-USB", "file": "Legacy Episode.avi",
            })
        with mock.patch.object(self.fixture.library, "_convert_for_offline_playback") as convert:
            convert.side_effect = lambda _source, destination, _job: destination.write_bytes(b"ready")
            self.fixture.library._run_offline_preparation(queued["id"])
        convert.assert_called_once()
        ready = self.fixture.library.offline_preparation_status(queued["id"])
        self.assertEqual(ready["status"], "ready")
        self.assertEqual(ready["size"], len(b"ready"))

    def test_offline_conversion_is_fast_reports_progress_and_never_upscales(self) -> None:
        source = inspect.getsource(self.fixture.library._convert_for_offline_playback)
        self.assertIn("min(1280,iw)", source)
        self.assertIn("min(720,ih)", source)
        self.assertIn('"ultrafast"', source)
        self.assertIn('"-progress", "pipe:1"', source)
        self.assertIn("Converting for offline playback · {percent}%", source)

    def test_usb_eject_is_blocked_during_browser_stream(self) -> None:
        movie = self.volume / "Phone Movie.mp4"
        movie.write_bytes(b"browser-ready")
        self.fixture.library.write_state("player", json.loads('{"standby": true}'))
        self.fixture.library.start_remote_stream({
            "kind": "usb", "volume": "TEST-USB", "file": "Phone Movie.mp4",
        })
        with self.assertRaisesRegex(ValueError, "Stop watching"):
            self.fixture.library.usb_eject("TEST-USB")

    def test_usb_folder_import_copies_atomically_into_adult_library(self) -> None:
        folder = self.volume / "Films"
        folder.mkdir()
        (folder / "One.mp4").write_bytes(b"one" * 1000)
        (folder / "Two.mkv").write_bytes(b"two" * 1000)
        (folder / "ignore.txt").write_text("no", encoding="utf-8")
        self.fixture.library.video_info = mock.Mock(return_value={
            "codec_type": "video", "width": 1280, "height": 720,
            "avg_frame_rate": "25/1",
        })
        job = self.fixture.library.start_usb_import({
            "volume": "TEST-USB", "paths": ["Films"], "target": "adult",
        })
        deadline = time.time() + 5
        result = job
        while result["status"] not in {"complete", "error"} and time.time() < deadline:
            time.sleep(0.02)
            result = self.fixture.library.usb_import_status(job["id"])
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["files_done"], 2)
        self.assertEqual((self.fixture.library.adult_root / "One.mp4").read_bytes(),
                         b"one" * 1000)
        self.assertFalse(any(self.fixture.library.adult_root.glob("*.part")))
        self.assertEqual(self.fixture.library.video_info.call_count, 2)
        self.assertEqual(self.fixture.library.refresh_tv.call_count, 2)

    def test_usb_series_import_preserves_season_folders_without_refreshing_tv(self) -> None:
        season = self.volume / "Silicon Valley" / "Season 1"
        season.mkdir(parents=True)
        episode = season / "Silicon.Valley.S01E06.720p.HDTV.x264.mkv"
        episode.write_bytes(b"episode" * 1000)
        self.fixture.library.video_info = mock.Mock(return_value={
            "codec_type": "video", "width": 1280, "height": 720,
            "avg_frame_rate": "25/1",
        })

        series_id = self.fixture.library.create_adult_series("Silicon Valley")
        self.fixture.library.create_adult_season(series_id, 1)
        job = self.fixture.library.start_usb_import({
            "volume": "TEST-USB",
            "paths": ["Silicon Valley/Season 1"],
            "target": "series",
            "series": series_id,
            "season": 1,
        })
        deadline = time.time() + 5
        result = job
        while result["status"] not in {"complete", "error"} and time.time() < deadline:
            time.sleep(0.02)
            result = self.fixture.library.usb_import_status(job["id"])

        self.assertEqual(result["status"], "complete")
        imported = (self.fixture.library.adult_series_root / result["series"] /
                    "Season 1" / episode.name)
        self.assertEqual(imported.read_bytes(), b"episode" * 1000)
        self.fixture.library.video_info.assert_called_once()
        self.fixture.library.refresh_tv.assert_not_called()
        series = self.fixture.library.adult_series_library()[0]
        self.assertEqual(series["episodes"][0]["season"], 1)
        self.assertEqual(series["episodes"][0]["episode"], 6)

    def test_usb_direct_play_sends_only_resolved_mounted_media(self) -> None:
        movie = self.volume / "Movie.mp4"
        movie.write_bytes(b"video")
        client = mock.MagicMock()
        context = mock.MagicMock()
        context.__enter__.return_value = client
        context.__exit__.return_value = False
        client.recv.return_value = b"ok\n"
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket", return_value=context):
            result = self.fixture.library.usb_play("TEST-USB", "Movie.mp4")
        sent = json.loads(client.sendall.call_args.args[0].decode())
        self.assertEqual(sent["command"], "play-external")
        self.assertEqual(Path(sent["path"]), movie.resolve())
        self.assertTrue(result["ok"])

    def test_portal_play_on_tv_resolves_channel_and_adult_library_items(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        channel_movie = self.fixture.media / "kids-tv" / "Episode.mp4"
        channel_movie.parent.mkdir(parents=True, exist_ok=True)
        channel_movie.write_bytes(b"video")
        adult_movie = self.fixture.library.adult_root / "Films" / "Film.mkv"
        adult_movie.parent.mkdir(parents=True, exist_ok=True)
        adult_movie.write_bytes(b"film")
        self.fixture.library.adult_library()
        adult_states = self.fixture.library.adult_media_states()
        adult_states["Films/Film.mkv"].update({
            "remote_position": 842.5,
            "remote_duration": 7200,
            "remote_last_watched": 200,
        })
        self.fixture.library.write_adult_media_states(adult_states)
        client = mock.MagicMock()
        context = mock.MagicMock()
        context.__enter__.return_value = client
        context.__exit__.return_value = False
        client.recv.return_value = b"ok\n"
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket", return_value=context), \
                mock.patch.object(mabeltv_library.time, "sleep") as sleep:
            channel_result = self.fixture.library.play_on_tv({
                "kind": "channel", "channel": 1, "file": "Episode.mp4",
            })
            adult_result = self.fixture.library.play_on_tv({
                "kind": "adult", "file": "Films/Film.mkv",
            })
        channel_command = json.loads(client.sendall.call_args_list[0].args[0].decode())
        adult_command = json.loads(client.sendall.call_args_list[1].args[0].decode())
        self.assertEqual(channel_command,
                         {"command": "play-programme", "channel": 1, "file": "Episode.mp4"})
        self.assertEqual(adult_command,
                         {"command": "play-adult-film", "file": "Films/Film.mkv",
                          "position": 842.5})
        self.assertTrue(channel_result["ok"])
        self.assertTrue(adult_result["ok"])
        sleep.assert_not_called()

        channels = self.fixture.library.channels()
        channels[0]["content_type"] = "films"
        self.fixture.library.write_state(
            "channels", {"schema_version": 1, "channels": channels})
        self.fixture.library.write_state("player", json.loads(json.dumps({
            "standby": False,
            "channel_film_positions": {"1/Episode.mp4": 1800},
            "channel_film_durations": {"1/Episode.mp4": 7200},
            "channel_film_position_updated_utc_ms": {"1/Episode.mp4": 1000},
        })))
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket", return_value=context), \
                mock.patch.object(mabeltv_library.time, "sleep") as sleep:
            film_channel_result = self.fixture.library.play_on_tv({
                "kind": "channel", "channel": 1, "file": "Episode.mp4",
            })
        film_commands = [call.args[0].decode().strip()
                         for call in client.sendall.call_args_list[-2:]]
        self.assertEqual(json.loads(film_commands[0]),
                         {"command": "play-programme", "channel": 1,
                          "file": "Episode.mp4", "position": 1800.0})
        self.assertEqual(film_commands[1], "select")
        sleep.assert_called_once_with(0.8)
        self.assertTrue(film_channel_result["ok"])

        with self.assertRaisesRegex(ValueError, "no longer"):
            self.fixture.library.play_on_tv({
                "kind": "adult", "file": "Films/Missing.mkv",
            })

    def test_portal_play_on_tv_treats_a_sent_command_as_accepted_if_ack_is_late(self) -> None:
        adult_movie = self.fixture.library.adult_root / "Passengers (2016).mp4"
        adult_movie.write_bytes(b"film")
        client = mock.MagicMock()
        context = mock.MagicMock()
        context.__enter__.return_value = client
        context.__exit__.return_value = False
        client.recv.side_effect = mabeltv_library.socket.timeout("late acknowledgement")

        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket", return_value=context):
            result = self.fixture.library.play_on_tv({
                "kind": "adult", "file": adult_movie.name,
            })

        self.assertTrue(result["ok"])
        self.assertEqual(result["message"], "Starting Passengers (2016) on Mabel TV")
        client.sendall.assert_called_once()

    def test_portal_play_on_tv_wakes_standby_and_honours_start_position(self) -> None:
        adult_movie = self.fixture.library.adult_root / "Film.mp4"
        adult_movie.write_bytes(b"film")
        self.fixture.library.write_state("player", json.loads(json.dumps({
            "standby": True,
        })))
        client = mock.MagicMock()
        context = mock.MagicMock()
        context.__enter__.return_value = client
        context.__exit__.return_value = False
        client.recv.return_value = b"ok\n"
        self.fixture.library.live_tv_control = mock.Mock(
            return_value={"ok": True, "message": "Command sent"})

        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket", return_value=context):
            result = self.fixture.library.play_on_tv({
                "kind": "adult", "file": adult_movie.name, "position": 0,
            })

        self.fixture.library.live_tv_control.assert_called_once_with({
            "command": "turn-on",
        })
        command = json.loads(client.sendall.call_args.args[0].decode())
        self.assertEqual(command, {
            "command": "play-adult-film", "file": adult_movie.name,
            "position": 0.0,
        })
        self.assertTrue(result["ok"])
        self.assertEqual(result["message"],
                         "Turned on Mabel TV and playing Film")

    def test_portal_play_on_tv_still_reports_a_real_connection_failure(self) -> None:
        adult_movie = self.fixture.library.adult_root / "Film.mp4"
        adult_movie.write_bytes(b"film")
        client = mock.MagicMock()
        context = mock.MagicMock()
        context.__enter__.return_value = client
        context.__exit__.return_value = False
        client.connect.side_effect = OSError("player unavailable")

        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket", return_value=context), \
                self.assertRaisesRegex(ValueError, "not ready to start"):
            self.fixture.library.play_on_tv({
                "kind": "adult", "file": adult_movie.name,
            })


if __name__ == "__main__":
    unittest.main()
