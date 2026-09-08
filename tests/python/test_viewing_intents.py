from __future__ import annotations

import json
import unittest

try:
    from tests.python.test_library_service import (
        LibraryFixture,
        PORTAL_OVERLAY_MARKUP,
        PORTAL_SCRIPT,
    )
except ModuleNotFoundError:
    from test_library_service import (
        LibraryFixture,
        PORTAL_OVERLAY_MARKUP,
        PORTAL_SCRIPT,
    )


class ViewingIntentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def test_channel_films_are_separate_from_adult_tv_viewing(self) -> None:
        self.fixture.channels.write_text(json.dumps({
            "schema_version": 1,
            "channels": [{"number": 5, "name": "Films", "folder": "films",
                          "aspect": "fit", "content_type": "films"}],
        }), encoding="utf-8")
        films = self.fixture.media / "films"
        films.mkdir(parents=True)
        (films / "The Matrix.mp4").write_bytes(b"film")
        states = self.fixture.library.channel_media_states()
        states["programmes"] = {"5/The Matrix.mp4": {
            "tmdb_id": 603, "title": "The Matrix", "year": "1999",
            "poster": "mabel-film-5-603.jpg",
        }}
        self.fixture.library.write_channel_media_states(states)
        self.fixture.library.player_state_path = self.fixture.root / "player-state.json"
        self.fixture.library.player_state_path.write_text(json.dumps({
            "channel_film_positions": {"5/The Matrix.mp4": 1200},
            "channel_film_durations": {"5/The Matrix.mp4": 8100},
        }), encoding="utf-8")

        self.assertNotIn("movie:603", self.fixture.library.adult_local_title_index())
        self.assertFalse(any(item["key"] == "movie:603"
                             for item in self.fixture.library.adult_viewing()["items"]))

        self.fixture.library.adult_viewing_update({
            "action": "watchlist", "enabled": True,
            "media_type": "movie", "tmdb_id": 603,
            "title": "The Matrix", "year": "1999",
        })
        saved = self.fixture.library.adult_viewing_update({
            "action": "up_next", "enabled": True,
            "media_type": "movie", "tmdb_id": 603,
            "title": "The Matrix", "year": "1999",
        })
        self.assertTrue(saved["viewing"]["watchlisted"])
        self.assertTrue(saved["viewing"]["up_next"])
        matches = [item for item in self.fixture.library.adult_viewing()["items"]
                   if item["key"] == "movie:603"]
        self.assertEqual(len(matches), 1)
        self.assertFalse(matches[0]["on_mabeltv"])
        self.assertIsNone(matches[0]["local"])

        store = self.fixture.library.adult_viewing_store()
        store["titles"]["movie:603"]["local_progress"] = {
            "kind": "channel-film", "position": 1200,
        }
        self.fixture.library.write_adult_viewing_store(store)
        migrated = next(item for item in self.fixture.library.adult_viewing()["items"]
                        if item["key"] == "movie:603")
        self.assertNotIn("local_progress", migrated)
        self.assertTrue(migrated["watchlisted"])

        adult_copy = self.fixture.library.adult_root / "Films" / "The Matrix 4K.mkv"
        adult_copy.parent.mkdir(parents=True)
        adult_copy.write_bytes(b"adult-film")
        self.fixture.library.adult_library()
        adult_states = self.fixture.library.adult_media_states()
        adult_states["Films/The Matrix 4K.mkv"]["metadata"] = {
            "tmdb_id": 603, "title": "The Matrix", "year": "1999",
        }
        self.fixture.library.write_adult_media_states(adult_states)
        local_adult = self.fixture.library.adult_local_title_index()["movie:603"]
        self.assertEqual(local_adult["kind"], "film")
        self.assertEqual(local_adult["path"], "Films/The Matrix 4K.mkv")

    def test_only_adult_film_sheets_use_shared_viewing_intent_component(self) -> None:
        self.assertIn('id="adultTitleIntents"', PORTAL_OVERLAY_MARKUP)
        self.assertIn('id="watchFilmViewingActions"', PORTAL_OVERLAY_MARKUP)
        self.assertIn('id="watchProgrammeViewingActions"', PORTAL_OVERLAY_MARKUP)
        self.assertIn("function decorateViewingIntentActions()", PORTAL_SCRIPT)
        self.assertIn("function wireAdultTitleIntentActions", PORTAL_SCRIPT)
        self.assertNotIn("wireLocalFilmViewingActions(viewingActions, programme)",
                         PORTAL_SCRIPT)
        self.assertIn("wireLocalFilmViewingActions(viewingActions, film)",
                      PORTAL_SCRIPT)

    def test_part_watched_series_is_a_progress_fact_not_a_list_intent(self) -> None:
        title = {"media_type": "tv", "tmdb_id": 243360, "title": "Ludwig"}
        self.fixture.library.adult_viewing_update(
            title | {"action": "watched"})
        saved = self.fixture.library.adult_viewing_update(
            title | {"action": "part_watched"})["viewing"]

        self.assertEqual(saved["manual_state"], "part_watched")
        self.assertFalse(saved.get("watchlisted", False))
        self.assertFalse(saved.get("up_next", False))
        self.assertFalse(saved.get("series_watching", False))
        self.assertEqual(saved.get("history"), [])

    def test_empty_series_container_is_not_on_mabeltv(self) -> None:
        series_id = self.fixture.library.create_adult_series("Ludwig")
        states = self.fixture.library.adult_series_states()
        states["series"][series_id]["metadata"] = {
            "tmdb_id": 243360, "title": "Ludwig",
        }
        self.fixture.library.write_adult_series_states(states)

        self.assertNotIn("tv:243360", self.fixture.library.adult_local_title_index())

    def test_series_restart_clears_all_progress_but_preserves_manual_lists(self) -> None:
        series_id = self.fixture.library.create_adult_series("Ludwig")
        root = self.fixture.library.adult_series_root / series_id / "Season 1"
        root.mkdir()
        episode = root / "Ludwig.S01E01.mp4"
        episode.write_bytes(b"episode")
        self.fixture.library.adult_series_library()
        states = self.fixture.library.adult_series_states()
        states["series"][series_id]["metadata"] = {
            "tmdb_id": 243360, "title": "Ludwig",
        }
        saved_episode = next(iter(states["episodes"].values()))
        saved_episode.update({"watched": True, "remote_position": 420.0,
                              "remote_last_watched": 1234.0})
        self.fixture.library.write_adult_series_states(states)
        store = self.fixture.library.adult_viewing_store()
        store["titles"]["tv:243360"] = {
            "media_type": "tv", "tmdb_id": 243360, "title": "Ludwig",
            "manual_state": "watched", "history": [1234.0],
            "episodes": {
                "1:1": {"watched": True}, "2:1": {"watched": True},
            },
            "watchlisted": True, "up_next": True, "series_watching": True,
        }
        self.fixture.library.write_adult_viewing_store(store)

        result = self.fixture.library.restart_adult_series_progress(series_id, "series")
        refreshed = self.fixture.library.adult_series_library()[0]["episodes"][0]
        viewing = self.fixture.library.adult_viewing_store()["titles"]["tv:243360"]

        self.assertFalse(result["preserved_watched"])
        self.assertEqual(result["episodes_reset"], 2)
        self.assertFalse(refreshed["watched"])
        self.assertEqual(refreshed["remote_position"], 0)
        self.assertEqual(refreshed["remote_last_watched"], 0)
        self.assertTrue(all(not episode["watched"]
                            for episode in viewing["episodes"].values()))
        self.assertEqual(viewing["manual_state"], "not_watched")
        self.assertEqual(viewing["history"], [])
        self.assertTrue(viewing["watchlisted"])
        self.assertTrue(viewing["up_next"])
        self.assertTrue(viewing["series_watching"])


if __name__ == "__main__":
    unittest.main()
