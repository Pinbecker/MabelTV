from tests.python.library_test_support import *
import shutil
import subprocess
import threading


class SeekPreviewTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.video = self.library.my_tv_root / "Preview.mp4"
        self.video.write_bytes(b"video")
        self.mode = {"seek_token": "a" * 64, "seek_available": True,
                     "seek_file": str(self.video), "playback_duration": 95.0}
        self.library.player_mode_status = mock.Mock(side_effect=lambda: self.mode)
        self.library.live_tv_control = mock.Mock()

    def tearDown(self):
        worker = self.library.seek_preview_worker
        if isinstance(worker, threading.Thread):
            worker.join(timeout=20)
        self.fixture.close()

    def test_cached_strip_is_reused_and_stale_or_outside_sources_are_refused(self):
        context = self.library.seek_preview_context("a" * 64, 22)
        context["output"].parent.mkdir()
        context["output"].write_bytes(b"jpeg")
        self.assertEqual(self.library.seek_preview("a" * 64, 70), b"jpeg")
        self.assertIsNone(self.library.seek_preview_worker)
        with self.assertRaisesRegex(ValueError, "programme changed"):
            self.library.seek_preview("b" * 64, 22)
        self.mode["seek_file"] = str(self.fixture.root / "outside.mp4")
        with self.assertRaisesRegex(ValueError, "No preview"):
            self.library.seek_preview("a" * 64, 22)
        self.library.live_tv_control.assert_not_called()

    def test_fast_drag_replaces_pending_work_instead_of_spawning_decoders(self):
        self.library.seek_preview_worker = mock.Mock(is_alive=mock.Mock(return_value=True))
        self.library.seek_preview("a" * 64, 2)
        self.library.seek_preview("a" * 64, 90)
        self.assertEqual(self.library.seek_preview_pending["start"], 80)
        for value in (-1, "bad", float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                self.library.seek_preview("a" * 64, value)
        self.library.live_tv_control.assert_not_called()

    def test_playback_warms_whole_programme_and_foreground_takes_priority(self):
        self.library.seek_preview_worker = mock.Mock(is_alive=mock.Mock(return_value=True))
        self.mode["playback_position"] = 20
        self.library.warm_seek_previews(self.mode)
        self.assertEqual([item["start"] for item in self.library.seek_preview_warm_pending], [0, 80])
        self.library.seek_preview("a" * 64, 90)
        prepared = []
        def prepare(context):
            prepared.append(context["start"])
            context["output"].parent.mkdir(exist_ok=True)
            context["output"].write_bytes(b"jpeg")
        with mock.patch.object(self.library, "prepare_seek_preview", side_effect=prepare), \
                mock.patch.object(self.library, "seek_preview_too_warm", return_value=False):
            self.library.run_seek_previews()
        self.assertEqual(prepared, [80, 0])
        self.assertEqual(self.library.seek_preview("a" * 64, 10), b"jpeg")
        self.library.live_tv_control.assert_not_called()

    def test_phone_prefetch_cannot_bypass_background_temperature_and_pacing(self):
        self.library.seek_preview_worker = mock.Mock(is_alive=mock.Mock(return_value=True))
        self.assertIsNone(self.library.seek_preview("a" * 64, 10, background=True))
        self.assertIsNone(self.library.seek_preview_pending)
        self.assertEqual(len(self.library.seek_preview_warm_pending), 2)
        self.library.live_tv_control.assert_not_called()

    def test_warmup_waits_when_hot_and_replaces_queue_when_programme_changes(self):
        self.library.seek_preview_worker = mock.Mock(is_alive=mock.Mock(return_value=True))
        self.library.warm_seek_previews(self.mode)
        with mock.patch.object(self.library, "seek_preview_too_warm", return_value=True), \
                mock.patch.object(self.library, "prepare_seek_preview") as prepare:
            self.library.run_seek_previews()
        prepare.assert_not_called()
        self.assertEqual(len(self.library.seek_preview_warm_pending), 2)
        self.library.seek_preview_worker = mock.Mock(is_alive=mock.Mock(return_value=True))
        self.mode["seek_token"] = "b" * 64
        self.library.warm_seek_previews(self.mode)
        self.assertTrue(all(item["token"] == "b" * 64 for item in self.library.seek_preview_warm_pending))
        self.library.warm_seek_previews({"seek_available": False})
        self.assertEqual(self.library.seek_preview_warm_pending, [])

    def test_failed_background_preview_is_retained_for_retry_without_busy_loop(self):
        self.library.seek_preview_worker = mock.Mock(is_alive=mock.Mock(return_value=True))
        self.mode["playback_duration"] = 60
        self.library.warm_seek_previews(self.mode)
        with mock.patch.object(self.library, "seek_preview_too_warm", return_value=False), \
                mock.patch.object(self.library, "prepare_seek_preview", side_effect=ValueError("Decoder busy")) as prepare:
            self.library.run_seek_previews()
        self.assertEqual(prepare.call_count, 1)
        self.assertEqual(len(self.library.seek_preview_warm_pending), 1)
        self.assertEqual(len(self.library.seek_preview_failures), 1)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg tools required")
    def test_sparse_strip_and_short_final_strip_have_all_cells_without_touching_player(self):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
                        "-t", "95", "-c:v", "libx264", "-preset", "ultrafast", "-g", "50", str(self.video)],
                       check=True, timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for position in (0, 92):
            context = self.library.seek_preview_context("a" * 64, position)
            self.library.prepare_seek_preview(context)
            info = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "json", str(context["output"])],
                                  check=True, capture_output=True, text=True, timeout=10)
            self.assertEqual(json.loads(info.stdout)["streams"][0], {"width":2048,"height":144})
            self.assertTrue(self.library.seek_preview("a" * 64, position).startswith(b"\xff\xd8"))
        self.library.live_tv_control.assert_not_called()
