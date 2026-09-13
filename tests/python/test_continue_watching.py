from __future__ import annotations

import json
import unittest
from unittest import mock

try:
    from tests.python.library_test_support import LibraryFixture, mabeltv_library
except ModuleNotFoundError:
    from library_test_support import LibraryFixture, mabeltv_library


class ContinueWatchingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def test_removal_clears_adult_series_episode(self) -> None:
        series_id = self.fixture.library.create_adult_series("Ludwig")
        episode = (self.fixture.library.adult_series_root / series_id /
                   "Season 1" / "Ludwig S01E01.mp4")
        episode.parent.mkdir(parents=True, exist_ok=True)
        episode.write_bytes(b"episode")
        states = self.fixture.library.adult_series_states()
        key = f"{series_id}/Season 1/{episode.name}"
        states["episodes"][key] = {
            "library_id": "episode-1", "remote_position": 900,
            "remote_duration": 3600, "remote_last_watched": 12345,
            "pre_watched_resume": {"position": 600, "duration": 3600},
        }
        self.fixture.library.write_adult_series_states(states)

        result = self.fixture.library.remote_clear_position({
            "kind": "adult-series", "series": series_id,
            "file": f"Season 1/{episode.name}",
        })

        saved = self.fixture.library.adult_series_states()["episodes"][key]
        self.assertEqual(result["kind"], "adult-series")
        self.assertEqual(saved["remote_position"], 0)
        self.assertEqual(saved["remote_last_watched"], 0)
        self.assertNotIn("pre_watched_resume", saved)

    def test_removal_asks_player_to_clear_mabeltv_film(self) -> None:
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
        client = mock.MagicMock()
        context = mock.MagicMock()
        context.__enter__.return_value = client
        context.__exit__.return_value = False
        client.recv.return_value = b"ok\n"

        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket", return_value=context):
            result = self.fixture.library.remote_clear_position({
                "kind": "channel", "channel": 1, "file": film.name,
            })

        command = json.loads(client.sendall.call_args.args[0].decode())
        self.assertEqual(result["kind"], "channel")
        self.assertEqual(command, {
            "command": "save-channel-film-position", "channel": 1,
            "file": film.name, "position": 0.0, "duration": 0.0,
        })


if __name__ == "__main__":
    unittest.main()
