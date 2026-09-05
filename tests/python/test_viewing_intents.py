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

    def test_channel_films_share_one_tmdb_record_with_global_search(self) -> None:
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

        local = self.fixture.library.adult_local_title_index()["movie:603"]
        self.assertEqual(local["kind"], "channel-film")
        self.assertEqual(local["channel"], 5)
        self.assertEqual(local["file"], "The Matrix.mp4")

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
        self.assertEqual(matches[0]["local"]["kind"], "channel-film")

    def test_local_film_sheets_use_shared_viewing_intent_component(self) -> None:
        self.assertIn('id="adultTitleIntents"', PORTAL_OVERLAY_MARKUP)
        self.assertIn('id="watchFilmViewingActions"', PORTAL_OVERLAY_MARKUP)
        self.assertIn('id="watchProgrammeViewingActions"', PORTAL_OVERLAY_MARKUP)
        self.assertIn("function decorateViewingIntentActions()", PORTAL_SCRIPT)
        self.assertIn("function wireAdultTitleIntentActions", PORTAL_SCRIPT)
        self.assertIn("wireLocalFilmViewingActions(viewingActions, programme)",
                      PORTAL_SCRIPT)


if __name__ == "__main__":
    unittest.main()
