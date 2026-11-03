from __future__ import annotations

from tests.python.library_test_support import *


class PlaybackProgressTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.library.my_tv_root.mkdir(parents=True, exist_ok=True)
        (self.library.my_tv_root / "Film.mp4").write_bytes(b"film")
        self.item = self.library.my_tv_library()[0]
        self.source = {"kind": "my_tv", "file": "Film.mp4", "library_id": self.item["library_id"]}
        self.sample = {"source": self.source, "writer": "device-session-12345", "sequence": 1,
                       "position": 1500, "duration": 7200, "observed_at": time.time() - 10}

    def tearDown(self):
        self.fixture.close()

    def test_ordered_checkpoints_survive_stream_expiry_and_allow_backward_seek(self):
        self.assertTrue(self.library.my_tv_progress(self.sample)["applied"])
        self.assertFalse(self.library.my_tv_progress({**self.sample, "position": 120})["applied"])
        self.assertTrue(self.library.my_tv_progress({**self.sample, "sequence": 2,
            "position": 300, "observed_at": time.time() - 5})["applied"])
        self.assertFalse(self.library.my_tv_progress({**self.sample, "writer": "older-device-123456",
            "position": 120})["applied"])
        self.assertEqual(self.library.my_tv_library()[0]["remote_position"], 300)
        self.assertFalse(self.library.my_tv_progress(self.sample)["applied"])

    def test_completion_is_not_resurrected_by_queued_samples(self):
        self.library.my_tv_progress(self.sample)
        self.library.my_tv_progress({**self.sample, "sequence": 2, "finished": True,
            "observed_at": time.time()})
        self.library.my_tv_progress(self.sample)
        self.assertEqual(self.library.my_tv_library()[0]["remote_position"], 0)

    def test_tv_completion_and_series_progress_are_shared_by_both_clients(self):
        self.library.my_tv_progress(self.sample)
        self.library.write_state("player", {"standby": True,
            "my_tv_positions": {self.item["library_id"]: 0},
            "my_tv_position_updated_utc_ms": {self.item["library_id"]: int(time.time() * 1000)}})
        self.assertEqual(self.library.my_tv_library()[0]["remote_position"], 0)
        series_id = self.library.create_my_tv_series("Example")
        season = self.library.my_tv_series_root / series_id / "Season 1"
        season.mkdir(parents=True, exist_ok=True)
        (season / "Example S01E01.mp4").write_bytes(b"episode")
        episode = self.library.my_tv_series_library()[0]["episodes"][0]
        self.library.write_state("player", {"standby": True,
            "my_tv_positions": {episode["library_id"]: 1500},
            "my_tv_durations": {episode["library_id"]: 3600},
            "my_tv_position_updated_utc_ms": {episode["library_id"]: int(time.time() * 1000)}})
        self.assertEqual(self.library.my_tv_series_library()[0]["episodes"][0]["remote_position"], 1500)
        source = {"kind": "my-tv-series", "series": series_id, "file": episode["path"]}
        self.assertEqual(self.library.remote_source(source)[4], 1500)
        self.assertEqual(self.library.native_my_tv_playback(source)["position"], 1500)

    def test_explicit_restart_overrides_saved_resume(self):
        self.library.my_tv_progress(self.sample)
        self.library.write_state("player", {"standby": True})
        result = self.library.start_remote_stream({**self.source, "position": 0})
        self.assertEqual(result["resume_position"], 0)
        self.assertEqual(result["library_id"], self.item["library_id"])

    def test_clear_rejects_previously_queued_progress(self):
        self.library.my_tv_progress(self.sample)
        self.library.remote_clear_position(self.source)
        self.assertFalse(self.library.my_tv_progress({**self.sample, "sequence": 2})["applied"])
        self.assertEqual(self.library.my_tv_library()[0]["remote_position"], 0)

    def test_invalid_samples_do_not_mutate_state(self):
        for change in ({"position": float("nan")}, {"position": -1}, {"sequence": 0},
                       {"writer": ""}, {"observed_at": time.time() + 1000},
                       {"source": {"kind": "channel"}}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.library.my_tv_progress({**self.sample, **change})
        self.assertEqual(self.library.my_tv_library()[0]["remote_position"], 0)
