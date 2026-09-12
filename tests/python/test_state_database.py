from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = PROJECT_ROOT / "scripts" / "pi" / "mabeltv_backend" / "database.py"
SPEC = importlib.util.spec_from_file_location("mabeltv_state_database", MODULE_PATH)
assert SPEC and SPEC.loader
database_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(database_module)


class StateDatabaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.database = database_module.StateDatabase(self.root / "mabeltv.db", {})
        self.database.initialise()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_relational_stores_round_trip_without_field_loss(self) -> None:
        stores = {
            "channels": {"schema_version": 1, "channels": [{
                "number": 7, "name": "Films", "folder": "films",
                "aspect": "fit", "content_type": "films",
            }]},
            "settings": {"schema_version": 1, "display_resolution": "1080p",
                         "volume": {"initial": 20, "maximum": 60,
                                    "limit_enabled": True}},
            "owner": {"schema_version": 1, "setup_complete": True,
                      "pin_hash": "private", "portal_pin_required": True},
            "player": {"schema_version": 4, "current_channel": 7,
                       "adult_positions": {"film-id": 12.5},
                       "adult_durations": {"film-id": 100.0},
                       "adult_position_updated_utc_ms": {"film-id": 1234},
                       "channel_film_positions": {}, "channel_film_durations": {},
                       "channel_film_position_updated_utc_ms": {},
                       "channel_timelines": {"7": {"episode_index": 0,
                           "episode_name": "Film.mp4", "position_seconds": 5,
                           "programme_positions": {"Film.mp4": 5},
                           "programme_last_left_uptime_ms": {},
                           "failed_programmes": {}}}},
            "viewing": {"schema_version": 2, "tracking_started": 100,
                        "sessions": [{"id": "session", "started": 100,
                                      "ended": 120, "seconds": 20,
                                      "surface": "tv", "kind": "film",
                                      "item_key": "film:7/Film.mp4",
                                      "custom": "preserved"}]},
            "channel_metadata": {"channels": {"7": {"artwork": "channel.jpg"}},
                                 "programmes": {"7/Film.mp4": {"title": "Film"}},
                                 "favourites": ["7/Film.mp4"],
                                 "future_extension": "preserved",
                                 "favourite_channels": [7], "updated": 200},
            "adult_media": {"Films/Movie.mp4": {"library_id": "media-id",
                            "favourite": False, "metadata": {"tmdb_id": 10},
                            "custom": {"kept": True}}},
            "adult_series": {"schema_version": 1, "series": {"series-id": {
                "title": "Series", "favourite": False,
                "metadata": {"tmdb_id": 20}}}, "episodes": {
                "series-id/Season 1/Episode.mp4": {"library_id": "episode-id",
                    "watched": True, "metadata": {"season_number": 1,
                                                    "episode_number": 1}}}},
            "adult_viewing": {"schema_version": 1, "titles": {"movie:10": {
                "media_type": "movie", "tmdb_id": 10, "title": "Movie",
                "history": [100, 200], "watchlisted": True,
                "watchlist_updated": 200, "up_next": True, "up_next_rank": 1,
                "personal_rating": 9, "rating_updated": 201}},
                "availability": {"movie:10": {"checked": 300}},
                "explore": {"movie:11": {"last_seen": 400, "impressions": 2}}},
            "adult_insights": {"schema_version": 1,
                               "titles": {"movie:10": {"genres": ["Drama"],
                                                         "checked": 500}},
                               "failures": {"movie:11": 501}},
        }
        for kind, value in stores.items():
            self.database.write(kind, value)
            self.assertEqual(value, self.database.read(kind), kind)
        report = self.database.integrity_report()
        self.assertEqual("ok", report["integrity"])
        self.assertEqual([], report["foreign_key_errors"])

    def test_managed_paths_never_fall_back_to_json(self) -> None:
        settings_path = self.root / "settings.json"
        settings_path.write_text(json.dumps({"display_resolution": "720p"}))
        database = database_module.StateDatabase(
            self.database.path, {"settings": settings_path})
        database.write("settings", {"display_resolution": "1080p"})
        self.assertEqual("settings", database.kind_for(settings_path))
        self.assertEqual({"display_resolution": "1080p"}, database.read("settings"))
        self.assertEqual({"display_resolution": "720p"},
                         json.loads(settings_path.read_text()))

    def test_channel_renumber_preserves_related_playback_state(self) -> None:
        self.database.write("channels", {"schema_version": 1, "channels": [{
            "number": 7, "name": "Films", "folder": "films",
            "aspect": "fit", "content_type": "films",
        }]})
        player = {
            "schema_version": 4,
            "channel_timelines": {"7": {
                "episode_index": 2,
                "episode_name": "Film.mp4",
                "position_seconds": 42,
                "programme_positions": {"Film.mp4": 42},
                "programme_last_left_uptime_ms": {"Film.mp4": 1000},
                "failed_programmes": {},
            }},
        }
        self.database.write("player", player)

        self.database.write("channels", {"schema_version": 1, "channels": [{
            "number": 8, "name": "Renamed Films", "folder": "films",
            "aspect": "crop", "content_type": "films",
        }]})

        migrated = self.database.read("player")
        self.assertNotIn("7", migrated["channel_timelines"])
        self.assertEqual(player["channel_timelines"]["7"],
                         migrated["channel_timelines"]["8"])


if __name__ == "__main__":
    unittest.main()
