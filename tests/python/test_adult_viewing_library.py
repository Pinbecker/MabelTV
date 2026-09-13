from __future__ import annotations

from tests.python.library_test_support import *


class AdultViewingLibraryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def test_adult_discovery_merges_local_titles_and_keeps_viewing_facts_separate(self) -> None:
        film = self.fixture.library.adult_root / "The Matrix.mp4"
        film.write_bytes(b"film")
        states = self.fixture.library.adult_media_states()
        states["The Matrix.mp4"] = {"library_id": "a" * 32, "metadata": {
            "tmdb_id": 603, "title": "The Matrix", "year": "1999",
        }}
        self.fixture.library.write_adult_media_states(states)
        self.fixture.library.tmdb_request = mock.Mock(return_value={"results": [{
            "id": 603, "media_type": "movie", "title": "The Matrix",
            "release_date": "1999-03-31", "overview": "Reality is a system.",
            "poster_path": "/matrix.jpg",
        }]})

        found = self.fixture.library.adult_discovery("Matrix")
        self.assertTrue(found["results"][0]["on_mabeltv"])
        title = found["results"][0]
        saved = self.fixture.library.adult_viewing_update(
            title | {"action": "watchlist", "enabled": True})
        saved = self.fixture.library.adult_viewing_update(
            title | {"action": "up_next", "enabled": True})
        saved = self.fixture.library.adult_viewing_update(
            title | {"action": "part_watched"})
        self.assertTrue(saved["viewing"]["watchlisted"])
        self.assertTrue(saved["viewing"]["up_next"])
        self.assertEqual(saved["viewing"]["manual_state"], "part_watched")
        saved = self.fixture.library.adult_viewing_update(
            title | {"action": "watched"})
        self.assertTrue(saved["viewing"]["watchlisted"])
        self.assertTrue(saved["viewing"]["up_next"])
        self.assertEqual(len(saved["viewing"]["history"]), 1)
        saved = self.fixture.library.adult_viewing_update(
            title | {"action": "not_watched"})
        self.assertTrue(saved["viewing"]["watchlisted"])
        self.assertTrue(saved["viewing"]["up_next"])
        self.assertEqual(len(saved["viewing"]["history"]), 0)

    def test_watchmode_links_are_validated_cached_and_expire_before_thirty_days(self) -> None:
        self.fixture.library.watchmode_request = mock.Mock(return_value=[
            {"source_id": 203, "name": "Netflix", "type": "sub", "region": "GB",
             "web_url": "https://netflix.com/watch/1",
             "ios_url": "nflx://www.netflix.com/watch/1",
             "android_url": "https://netflix.com/watch/1"},
            {"source_id": 409, "name": "BBC iPlayer", "type": "free", "region": "GB",
             "web_url": "http://www.bbc.co.uk/iplayer/episode/m0022wzs",
             "ios_url": "Deeplinks available for paid plans only."},
            {"name": "Bad", "type": "free", "web_url": "javascript:alert(1)"},
        ])
        first = self.fixture.library.adult_streaming_links("movie", 603)
        second = self.fixture.library.adult_streaming_links("movie", 603)
        self.assertEqual([item["name"] for item in first["sources"]], ["Netflix", "BBC iPlayer"])
        self.assertEqual(first["sources"][0]["source_id"], 203)
        self.assertEqual(first["sources"][0]["ios_url"], "nflx://www.netflix.com/watch/1")
        self.assertEqual(first["sources"][1]["web_url"],
                         "https://www.bbc.co.uk/iplayer/episode/m0022wzs")
        self.assertEqual(first["sources"][1]["ios_url"], "")
        self.assertEqual(first["link_schema"], 3)
        self.assertEqual(first, second)
        self.fixture.library.watchmode_request.assert_called_once()
        store = self.fixture.library.adult_viewing_store()
        store["availability"]["movie:999"] = {
            "checked": time.time() - 30 * 24 * 60 * 60, "sources": [],
        }
        self.fixture.library.write_state("adult_viewing", store)
        self.assertNotIn("movie:999", self.fixture.library.adult_viewing_store()["availability"])

    def test_tv_episode_watches_are_saved_per_season_and_episode(self) -> None:
        self.fixture.library.tmdb_request = mock.Mock(return_value={
            "name": "Season 1", "poster_path": "/season.jpg",
            "overview": "The first year in Stars Hollow.", "episodes": [
                {"episode_number": 1, "name": "Pilot", "air_date": "2000-01-01",
                 "runtime": 44, "overview": "Rory starts a new school.",
                 "still_path": "/pilot.jpg"},
                {"episode_number": 2, "name": "Second", "air_date": "2000-01-08",
                 "runtime": 44, "still_path": "/second.jpg"},
            ],
        })
        saved = self.fixture.library.adult_viewing_update({
            "media_type": "tv", "tmdb_id": 4586, "title": "Gilmore Girls",
            "action": "episode_watched", "season": 1, "episode": 2, "watched": True,
        })
        self.assertTrue(saved["viewing"]["episodes"]["1:2"]["watched"])
        season = self.fixture.library.adult_title_season(4586, 1)
        self.assertFalse(season["episodes"][0]["watched"])
        self.assertTrue(season["episodes"][1]["watched"])
        self.assertEqual(season["poster_path"], "/season.jpg")
        self.assertEqual(season["episodes"][0]["still_path"], "/pilot.jpg")
        self.assertEqual(season["episodes"][0]["air_date"], "2000-01-01")
        self.assertEqual(season["episodes"][0]["overview"],
                         "Rory starts a new school.")
        saved = self.fixture.library.adult_viewing_update({
            "media_type": "tv", "tmdb_id": 4586, "title": "Gilmore Girls",
            "action": "watchlist", "enabled": True,
        })
        self.assertTrue(saved["viewing"]["watchlisted"])

        saved = self.fixture.library.adult_viewing_update({
            "media_type": "tv", "tmdb_id": 4586, "title": "Gilmore Girls",
            "action": "season_watched", "season": 1, "episode_count": 2,
            "watched": True,
        })
        self.assertTrue(saved["viewing"]["episodes"]["1:1"]["watched"])
        self.assertTrue(saved["viewing"]["episodes"]["1:2"]["watched"])
        saved = self.fixture.library.adult_viewing_update({
            "media_type": "tv", "tmdb_id": 4586, "title": "Gilmore Girls",
            "action": "watching", "enabled": True,
        })
        self.assertTrue(saved["viewing"]["series_watching"])
        self.assertFalse(saved["viewing"].get("up_next", False))
        self.assertNotIn("series_watching_mode", saved["viewing"])
        saved = self.fixture.library.adult_viewing_update({
            "media_type": "tv", "tmdb_id": 4586, "title": "Gilmore Girls",
            "action": "episode_watched", "season": 1, "episode": 1,
            "watched": False,
        })
        self.assertFalse(saved["viewing"]["episodes"]["1:1"]["watched"])
        season = self.fixture.library.adult_title_season(4586, 1)
        self.assertFalse(season["episodes"][0]["watched"])
        self.assertNotIn("rewatch_watched", season["episodes"][1])

        saved = self.fixture.library.adult_viewing_update({
            "media_type": "tv", "tmdb_id": 4586, "title": "Gilmore Girls",
            "action": "watched",
        })
        self.assertTrue(saved["viewing"]["series_watching"])
        self.assertTrue(saved["viewing"]["watchlisted"])
        saved = self.fixture.library.adult_viewing_update({
            "media_type": "tv", "tmdb_id": 4586, "title": "Gilmore Girls",
            "action": "watching", "enabled": False,
        })
        self.assertFalse(saved["viewing"]["series_watching"])

    def test_combined_series_view_merges_and_syncs_local_episode_history(self) -> None:
        series_id = self.fixture.library.create_adult_series("Severance")
        root = self.fixture.library.adult_series_root / series_id / "Season 1"
        root.mkdir()
        first = root / "Severance S01E01.mp4"
        second = root / "Severance S01E02.mp4"
        first.write_bytes(b"episode-one")
        second.write_bytes(b"episode-two")
        states = self.fixture.library.adult_series_states()
        states["series"][series_id]["metadata"] = {
            "tmdb_id": 95396, "title": "Severance", "year": "2022",
        }
        states["episodes"][f"{series_id}/Season 1/{first.name}"] = {
            "watched": True, "metadata": {"season_number": 1, "episode_number": 1},
        }
        states["episodes"][f"{series_id}/Season 1/{second.name}"] = {
            "watched": False, "metadata": {"season_number": 1, "episode_number": 2},
        }
        self.fixture.library.write_adult_series_states(states)

        def tmdb(path: str, _parameters: dict | None = None) -> dict:
            if path == "tv/95396":
                return {
                    "id": 95396, "name": "Severance", "first_air_date": "2022-02-18",
                    "seasons": [
                        {"season_number": 1, "name": "Series 1", "episode_count": 2},
                        {"season_number": 2, "name": "Series 2", "episode_count": 2},
                    ],
                }
            if path == "tv/95396/watch/providers":
                return {"results": {"GB": {}}}
            if path == "tv/95396/season/1":
                return {"name": "Series 1", "episodes": [
                    {"episode_number": 1, "name": "Good News About Hell"},
                    {"episode_number": 2, "name": "Half Loop"},
                ]}
            raise AssertionError(path)

        self.fixture.library.tmdb_request = mock.Mock(side_effect=tmdb)
        detail = self.fixture.library.adult_title_detail("tv", 95396)
        self.assertTrue(detail["on_mabeltv"])
        self.assertEqual(detail["seasons"][0]["watched_count"], 1)
        self.assertEqual(
            (detail["next_episode"]["season"], detail["next_episode"]["episode"]),
            (1, 2))
        season = self.fixture.library.adult_title_season(95396, 1)
        self.assertTrue(season["episodes"][0]["watched"])

        self.fixture.library.adult_viewing_update({
            "media_type": "tv", "tmdb_id": 95396, "title": "Severance",
            "action": "episode_watched", "season": 1, "episode": 2,
            "watched": True,
        })
        local = self.fixture.library.adult_series_library()[0]
        self.assertTrue(all(episode["watched"] for episode in local["episodes"]))
        detail = self.fixture.library.adult_title_detail("tv", 95396)
        self.assertEqual(
            (detail["next_episode"]["season"], detail["next_episode"]["episode"]),
            (2, 1))

        self.fixture.library.set_adult_episode_watched(
            series_id, f"Season 1/{first.name}", False)
        viewing = self.fixture.library.adult_viewing_store()["titles"]["tv:95396"]
        self.assertFalse(viewing["episodes"]["1:1"]["watched"])

    def test_next_episode_continues_after_furthest_watched_episode(self) -> None:
        episodes = [
            {"season": 1, "episode": 1, "watched": False},
            {"season": 1, "episode": 2, "watched": False},
            *({"season": 12, "episode": number, "watched": number <= 8}
              for number in range(1, 11)),
        ]
        next_episode = self.fixture.library.adult_next_episode_after_progress(episodes)
        self.assertIsNotNone(next_episode)
        self.assertEqual((next_episode["season"], next_episode["episode"]), (12, 9))

    def test_adult_viewing_removes_a_stale_cleared_film_bookmark(self) -> None:
        store = self.fixture.library.adult_viewing_store()
        store["titles"]["movie:120"] = {
            "media_type": "movie", "tmdb_id": 120,
            "title": "The Fellowship of the Ring",
            "local_progress": {"kind": "film", "path": "Film.mp4", "position": 1719},
        }
        self.fixture.library.write_state("adult_viewing", store)
        self.fixture.library.adult_local_title_index = mock.Mock(return_value={
            "movie:120": {
                "kind": "film", "path": "Film.mp4", "title": "The Fellowship of the Ring",
                "position": 0, "duration": 7200,
            },
        })

        item = self.fixture.library.adult_viewing()["items"][0]

        self.assertNotIn("local_progress", item)

    def test_tv_title_detail_includes_season_artwork_and_watched_counts(self) -> None:
        store = self.fixture.library.adult_viewing_store()
        store["titles"]["tv:4586"] = {
            "episodes": {"1:2": {"watched": True}},
            "rewatch": True,
            "rewatch_episodes": {"1:1": {"watched": True}},
            "series_watching": True,
            "series_watching_mode": "rewatch",
        }
        self.fixture.library.write_state("adult_viewing", store)

        def tmdb(path: str, _parameters: dict | None = None) -> dict:
            if path == "tv/4586":
                return {
                    "id": 4586, "name": "Gilmore Girls",
                    "first_air_date": "2000-10-05", "episode_run_time": [44],
                    "genres": [{"name": "Drama"}], "seasons": [{
                        "season_number": 1, "name": "Season 1", "episode_count": 21,
                        "poster_path": "/season-one.jpg", "air_date": "2000-10-05",
                        "overview": "The first season.",
                    }],
                }
            if path == "tv/4586/watch/providers":
                return {"results": {"GB": {}}}
            raise AssertionError(path)

        self.fixture.library.tmdb_request = mock.Mock(side_effect=tmdb)
        detail = self.fixture.library.adult_title_detail("tv", 4586)
        self.assertEqual(detail["seasons"][0]["poster_path"], "/season-one.jpg")
        self.assertEqual(detail["seasons"][0]["watched_count"], 1)
        self.assertEqual(detail["next_episode"]["episode"], 3)
        self.assertNotIn("rewatch", detail["next_episode"])
        self.assertNotIn("rewatch", detail["viewing"])
        self.assertNotIn("rewatch_episodes", detail["viewing"])

    def test_adult_viewing_portal_is_modular_private_and_mobile_safe(self) -> None:
        self.assertIn('id="adultMyViewing"', PORTAL_SOURCE)
        self.assertIn('id="view-adult-viewing"', PORTAL_SOURCE)
        self.assertIn('id="adultTitleSheet"', PORTAL_SOURCE)
        self.assertIn('id="adultTitleSeasonSheet"', PORTAL_SOURCE)
        self.assertIn('class="adult-series-seasons"', PORTAL_SOURCE)
        self.assertIn("Search anything", PORTAL_SOURCE)
        self.assertIn("adult-search-mode", PORTAL_SOURCE)
        self.assertNotIn('data-viewing-tab="rewatch"', PORTAL_SOURCE)
        self.assertNotIn("Add to Rewatch", PORTAL_SOURCE)
        self.assertIn("Moves it out of Watchlist and Up Next", PORTAL_SOURCE)
        self.assertIn("adultTitleOpenRevision", PORTAL_SOURCE)
        self.assertIn("wireAdultSeasonBulkButton", PORTAL_SOURCE)
        self.assertIn('id="adultTitleNextEpisode"', PORTAL_SOURCE)
        self.assertNotIn("adultWatchConfirmSheet", PORTAL_SOURCE)
        self.assertNotIn("Did you watch", PORTAL_SOURCE)
        self.assertIn("Metadata from TMDB. Streaming availability from JustWatch", PORTAL_SOURCE)
        self.assertIn("window.location.assign(destination)", PORTAL_SOURCE)
        self.assertIn("episode_watched", PORTAL_SOURCE)
        self.assertIn("episode.still_path", PORTAL_SOURCE)
        self.assertIn("provider-mabeltv", PORTAL_SOURCE)
        self.assertIn("includedByBrand", PORTAL_SOURCE)
        self.assertIn("['flatrate', 'free', 'ads']", PORTAL_SOURCE)
        self.assertIn("['sub', 'free', 'tve', 'ads']", PORTAL_SOURCE)
        self.assertIn("adultProviderPlatform", PORTAL_SOURCE)
        self.assertIn("watchmodeIds", PORTAL_SOURCE)
        self.assertIn("adultProviderDestination", PORTAL_SOURCE)
        self.assertIn("adultNetflixLaunchSheet", PORTAL_SOURCE)
        self.assertIn('id="adultEpisodeLaunchSheet"', PORTAL_SOURCE)
        self.assertIn("openAdultEpisodeDestination", PORTAL_SOURCE)
        self.assertIn("findLocalAdultEpisode", PORTAL_SOURCE)
        self.assertIn("Keep this title in your manual Watchlist", PORTAL_SOURCE)
        self.assertIn("nextLocalEpisodeAfterProgress", PORTAL_SOURCE)
        self.assertIn("adultEpisodeAirDate", PORTAL_SOURCE)
        self.assertIn("localEpisodeAirDate", PORTAL_SOURCE)
        self.assertNotIn("Remove ${item.title} from Watching", PORTAL_SOURCE)
        self.assertNotIn("Correct watched status", PORTAL_SOURCE)
        self.assertIn("compactFilm || compactSeries ? 'Watched'", PORTAL_SOURCE)
        self.assertIn('id="adultSeriesMoreSheet"', PORTAL_SOURCE)
        self.assertNotIn("Manage MabelTV episodes", PORTAL_SOURCE)
        self.assertIn("Available on MabelTV", PORTAL_SOURCE)
        self.assertIn("openAdultSeriesViewing", PORTAL_SOURCE)
        self.assertIn("adultSearchKeyboardWasOpen", PORTAL_SOURCE)
        self.assertIn("top: calc(54px + env(safe-area-inset-top))", PORTAL_SOURCE)
        self.assertNotIn("input.scrollIntoView({ block: 'start' })", PORTAL_SOURCE)
        self.assertIn("item.media_type === 'tv' && item.series_watching !== true", PORTAL_SOURCE)
        self.assertIn("openView('adult-home'", PORTAL_SOURCE)
        self.assertNotIn('data-viewing-filter="streaming"', PORTAL_SOURCE)
        self.assertNotIn('data-viewing-filter="recent"', PORTAL_SOURCE)
        self.assertNotIn('data-viewing-filter="short"', PORTAL_SOURCE)
        self.assertIn("/api/adult/netflix/play-tv", PORTAL_SOURCE)
        self.assertIn("Play on this device", PORTAL_SOURCE)
        self.assertIn("Play on TV", PORTAL_SOURCE)
        self.assertIn("https://www.bbc.co.uk/iplayer/search?q=", PORTAL_SOURCE)
        self.assertIn("adultProviderBrands.forEach", PORTAL_SOURCE)
        self.assertNotIn("source?.url || detail.provider_link", PORTAL_SOURCE)
        provider_assets = PORTAL_ROOT / "assets" / "providers"
        for asset in (
            "netflix-app.jpg", "prime-video-app.jpg", "disney-plus-app.jpg",
            "now-app.jpg",
            "sky-go-app.jpg", "bbc-iplayer-app.jpg", "channel-4-app.jpg",
            "itvx-app.jpg", "paramount-plus-app.jpg", "apple-tv-app.jpg",
        ):
            self.assertGreater((provider_assets / asset).stat().st_size, 10_000)
        viewing_css = (PORTAL_ROOT / "css" / "experience-viewing.css").read_text(
            encoding="utf-8")
        self.assertIn("grid-template-columns: minmax(0, 1fr)", viewing_css)
        self.assertIn("@media (max-width: 640px)", viewing_css)
        self.assertIn("min-height: 0", viewing_css)
        self.assertIn("overflow-x: hidden", viewing_css)
        self.assertIn("grid-template-columns: 77px minmax(0, 1fr) 76px", viewing_css)
        self.assertNotIn("!important", viewing_css)


if __name__ == "__main__":
    unittest.main()
