from __future__ import annotations

from copy import deepcopy
from datetime import date, timedelta
from pathlib import Path
import sys
import threading
import time
import unittest
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts" / "pi"))

from mabeltv_backend.discovery import MyTvExploreMixin
from mabeltv_backend.my_tv_metadata import MyTvMetadataMixin


class ExploreFixture(MyTvExploreMixin, MyTvMetadataMixin):
    def __init__(self) -> None:
        self.config_lock = threading.RLock()
        self.store = {"schema_version": 1, "titles": {
            "movie:1": {"media_type": "movie", "tmdb_id": 1,
                        "title": "Watched film", "manual_state": "watched",
                        "history": [1]},
            "tv:2": {"media_type": "tv", "tmdb_id": 2,
                      "title": "Watched series", "manual_state": "watched",
                      "history": [1]},
        }, "availability": {}}
        self.requests: list[tuple[str, dict[str, Any]]] = []
        self.availability_enabled = True
        self.available_ids = {11, 101, 201}

    def my_tv_cached_tmdb_request(self, endpoint: str,
                                  parameters: dict[str, Any] | None = None) -> dict[str, Any]:
        self.requests.append((endpoint, dict(parameters or {})))
        today = date.today()
        if endpoint == "discover/movie" and "release_date.gte" in (parameters or {}):
            cinema = self.title("movie", 301, 150)
            cinema["release_date"] = today.isoformat()
            digital = self.title("movie", 302, 120)
            digital["release_date"] = today.isoformat()
            return {"results": [cinema, digital]}
        if endpoint.startswith("movie/") and endpoint.endswith("/release_dates"):
            identifier = int(endpoint.split("/")[1])
            return {"results": [{"iso_3166_1": "GB", "release_dates": [{
                "release_date": today.isoformat(), "type": 3 if identifier == 301 else 4,
            }]}]}
        if endpoint == "discover/tv" and "air_date.gte" in (parameters or {}):
            new_series = self.title("tv", 401, 140)
            new_series["first_air_date"] = today.isoformat()
            returning = self.title("tv", 402, 130)
            returning["first_air_date"] = "2020-01-01"
            return {"results": [new_series, returning]}
        if endpoint == "tv/402":
            return {"seasons": [{"season_number": 2,
                                  "air_date": (today - timedelta(days=1)).isoformat()}]}
        if endpoint.endswith("/watch/providers"):
            identifier = int(endpoint.split("/")[1])
            if identifier == 301:
                return {"results": {"GB": {"rent": [{
                    "provider_id": 10, "provider_name": "Rental store",
                }]}}}
            provider_id = 8 if identifier in self.available_ids else 2
            return {"results": {"GB": {"flatrate": [{
                "provider_id": provider_id, "provider_name": "Included service",
            }], "rent": [{
                "provider_id": 10, "provider_name": "Rental store",
            }]}}}
        if endpoint.endswith("/recommendations"):
            kind = endpoint.split("/", 1)[0]
            watched_id = 1 if kind == "movie" else 2
            suggestion_id = 11 if kind == "movie" else 22
            return {"page": 1, "total_pages": 3, "results": [
                self.title(kind, watched_id, 100), self.title(kind, suggestion_id, 80),
            ]}
        kind = endpoint.rsplit("/", 1)[-1]
        base = 100 if kind == "movie" else 200
        return {"page": 1, "total_pages": 20, "results": [
            self.title(kind, base + index, 60 - index) for index in range(20)
        ]}

    @staticmethod
    def title(kind: str, identifier: int, popularity: int) -> dict[str, Any]:
        return {
            "id": identifier, "title" if kind == "movie" else "name": f"Title {identifier}",
            "release_date" if kind == "movie" else "first_air_date": "2020-01-01",
            "popularity": popularity, "vote_average": 7.5, "vote_count": 1000,
            "poster_path": f"/{identifier}.jpg",
        }

    def my_tv_viewing_store(self) -> dict[str, Any]:
        return deepcopy(self.store)

    def save_explore_feedback(self, values: dict[str, dict[str, Any]],
                              retain_since: float) -> None:
        del retain_since
        self.store["explore"] = deepcopy(values)

    def settings(self) -> dict[str, Any]:
        return {"watchmode_availability_enabled": self.availability_enabled}

    @staticmethod
    def my_tv_insights_cache() -> dict[str, Any]:
        return {"titles": {}}

    @staticmethod
    def my_tv_local_title_index() -> dict[str, dict[str, Any]]:
        return {"movie:11": {"kind": "film", "path": "Suggestion.mp4"}}


class MyTvExploreTests(unittest.TestCase):
    def test_home_feed_mixes_familiar_titles_with_unseen_blockbusters(self) -> None:
        library = ExploreFixture()
        library.store["titles"]["movie:1"]["poster_path"] = "/watched.jpg"
        library.store["titles"]["movie:3"] = {
            "media_type": "movie", "tmdb_id": 3, "title": "Saved film",
            "watchlisted": True, "poster_path": "/saved.jpg", "updated": 10,
        }
        library.store["titles"]["movie:4"] = {
            "media_type": "movie", "tmdb_id": 4, "title": "Queued film",
            "watchlisted": True, "up_next": True, "poster_path": "/queued.jpg",
        }

        result = library.my_tv_home_what_to_watch(1, 12)
        keys = [value["key"] for value in result["results"]]

        self.assertIn("movie:1", keys)
        self.assertIn("movie:3", keys)
        self.assertNotIn("movie:4", keys)
        self.assertTrue(any(key in {"movie:101", "tv:201"} for key in keys))
        self.assertTrue(result["results"][0]["viewing"])

    def test_released_this_week_includes_films_series_and_season_premieres(self) -> None:
        library = ExploreFixture()

        result = library.my_tv_released_this_week(16)
        labels = {value["key"]: value["release_label"] for value in result["results"]}

        self.assertEqual(labels["movie:301"], "New film")
        self.assertEqual(labels["tv:401"], "New series")
        self.assertEqual(labels["tv:402"], "Series 2 starts")
        releases = {value["key"]: value for value in result["results"]}
        self.assertTrue(releases["movie:301"]["cinema_only"])
        self.assertFalse(releases["movie:302"]["cinema_only"])
        self.assertFalse(releases["tv:401"]["cinema_only"])
        self.assertTrue(any(endpoint == "movie/301/release_dates"
                            for endpoint, _ in library.requests))
        self.assertTrue(any(endpoint == "movie/301/watch/providers"
                            for endpoint, _ in library.requests))
        self.assertTrue(any(endpoint == "tv/402" for endpoint, _ in library.requests))

    def test_home_availability_returns_streaming_services_once_per_title(self) -> None:
        library = ExploreFixture()
        library.store["availability"]["movie:11"] = {
            "link_schema": 3, "checked": time.time(),
            "sources": [
                {"source_id": 407, "name": "All 4", "type": "free",
                 "web_url": "https://www.channel4.com/programmes/title"},
                {"source_id": 24, "name": "Amazon", "type": "rent",
                 "web_url": "https://www.amazon.co.uk/title"},
            ],
        }

        result = library.my_tv_home_availability({"titles": [
            {"media_type": "movie", "tmdb_id": 11},
            {"media_type": "movie", "tmdb_id": 11},
            {"media_type": "tv", "tmdb_id": 22},
        ]})

        self.assertEqual([item["key"] for item in result["items"]],
                         ["movie:11", "tv:22"])
        self.assertTrue(all(item["available"] for item in result["items"]))
        self.assertTrue(all(provider["type"] == "flatrate"
                            for item in result["items"]
                            for provider in item["providers"]))
        movie = next(item for item in result["items"] if item["key"] == "movie:11")
        self.assertEqual(movie["sources"], [{
            "source_id": 407, "name": "All 4", "type": "free",
        }])
        self.assertEqual(next(item for item in result["items"]
                              if item["key"] == "tv:22")["sources"], [])

    def test_personal_feed_uses_varied_history_excludes_watched_and_skips_watchmode(self) -> None:
        library = ExploreFixture()

        result = library.my_tv_explore("for-you", "all", 1)
        keys = [value["key"] for value in result["results"]]

        self.assertNotIn("movie:1", keys)
        self.assertNotIn("tv:2", keys)
        self.assertIn("movie:11", keys)
        self.assertIn("tv:22", keys)
        self.assertTrue(next(value for value in result["results"]
                             if value["key"] == "movie:11")["on_mabeltv"])
        self.assertTrue(any(endpoint.startswith("movie/1/") for endpoint, _ in library.requests))
        self.assertTrue(any(endpoint.startswith("tv/2/") for endpoint, _ in library.requests))
        self.assertFalse(any("watch" in endpoint for endpoint, _ in library.requests))

    def test_feedback_is_weak_expiring_state_not_a_permanent_exclusion(self) -> None:
        library = ExploreFixture()

        saved = library.my_tv_explore_feedback({"items": [
            {"media_type": "movie", "tmdb_id": 11},
            {"media_type": "movie", "tmdb_id": 11},
            {"media_type": "bad", "tmdb_id": 0},
        ]})
        self.assertEqual(saved["recorded"], 2)
        self.assertEqual(library.store["explore"]["movie:11"]["impressions"], 2)
        library.store["explore"]["movie:11"]["last_seen"] = time.time() - 31 * 86400
        result = library.my_tv_explore("for-you", "all", 1)
        self.assertIn("movie:11", [value["key"] for value in result["results"]])

    def test_curated_lists_are_paginated_internally_and_parameters_are_bounded(self) -> None:
        library = ExploreFixture()

        result = library.my_tv_explore("1990s", "movie", 500)
        endpoint, parameters = library.requests[0]

        self.assertEqual(endpoint, "discover/movie")
        self.assertEqual(parameters["page"], 50)
        self.assertEqual(parameters["primary_release_date.gte"], "1990-01-01")
        self.assertEqual(parameters["primary_release_date.lte"], "1999-12-31")
        self.assertEqual(result["page"], 50)
        with self.assertRaisesRegex(ValueError, "valid Explore list"):
            library.my_tv_explore("made-up", "all", 1)

    def test_home_feed_requires_included_supported_streaming_availability(self) -> None:
        library = ExploreFixture()

        result = library.my_tv_explore("for-you", "all", 1, True, 8)
        keys = {value["key"] for value in result["results"]}

        self.assertEqual(keys, {"movie:11"})
        discover_parameters = [parameters for endpoint, parameters in library.requests
                               if endpoint.startswith("discover/")]
        self.assertFalse(discover_parameters)

        library.availability_enabled = False
        disabled = library.my_tv_explore("for-you", "all", 1, True, 8)
        self.assertEqual(disabled["results"], [])
        self.assertTrue(disabled["availability_disabled"])

    def test_personal_feed_is_steered_by_positive_ratings_not_random_history(self) -> None:
        library = ExploreFixture()
        library.store["titles"]["movie:1"]["personal_rating"] = 3
        library.store["titles"]["tv:2"]["personal_rating"] = 9

        library.my_tv_explore("for-you", "all", 1)
        recommendation_endpoints = [endpoint for endpoint, _ in library.requests
                                    if endpoint.endswith("/recommendations")]

        self.assertIn("tv/2/recommendations", recommendation_endpoints)
        self.assertNotIn("movie/1/recommendations", recommendation_endpoints)
        self.assertFalse(any(endpoint.startswith("discover/")
                             for endpoint, _ in library.requests))


if __name__ == "__main__":
    unittest.main()
