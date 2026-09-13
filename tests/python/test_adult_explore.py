from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import sys
import threading
import time
import unittest
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts" / "pi"))

from mabeltv_backend.discovery import AdultExploreMixin
from mabeltv_backend.adult_metadata import AdultMetadataMixin


class ExploreFixture(AdultExploreMixin, AdultMetadataMixin):
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

    def adult_cached_tmdb_request(self, endpoint: str,
                                  parameters: dict[str, Any] | None = None) -> dict[str, Any]:
        self.requests.append((endpoint, dict(parameters or {})))
        if endpoint.endswith("/watch/providers"):
            identifier = int(endpoint.split("/")[1])
            provider_id = 8 if identifier in self.available_ids else 2
            return {"results": {"GB": {"flatrate": [{
                "provider_id": provider_id, "provider_name": "Included service",
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
        }

    def adult_viewing_store(self) -> dict[str, Any]:
        return deepcopy(self.store)

    def save_explore_feedback(self, values: dict[str, dict[str, Any]],
                              retain_since: float) -> None:
        del retain_since
        self.store["explore"] = deepcopy(values)

    def settings(self) -> dict[str, Any]:
        return {"watchmode_availability_enabled": self.availability_enabled}

    @staticmethod
    def adult_insights_cache() -> dict[str, Any]:
        return {"titles": {}}

    @staticmethod
    def adult_local_title_index() -> dict[str, dict[str, Any]]:
        return {"movie:11": {"kind": "film", "path": "Suggestion.mp4"}}


class AdultExploreTests(unittest.TestCase):
    def test_personal_feed_uses_varied_history_excludes_watched_and_skips_watchmode(self) -> None:
        library = ExploreFixture()

        result = library.adult_explore("for-you", "all", 1)
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

        saved = library.adult_explore_feedback({"items": [
            {"media_type": "movie", "tmdb_id": 11},
            {"media_type": "movie", "tmdb_id": 11},
            {"media_type": "bad", "tmdb_id": 0},
        ]})
        self.assertEqual(saved["recorded"], 2)
        self.assertEqual(library.store["explore"]["movie:11"]["impressions"], 2)
        library.store["explore"]["movie:11"]["last_seen"] = time.time() - 31 * 86400
        result = library.adult_explore("for-you", "all", 1)
        self.assertIn("movie:11", [value["key"] for value in result["results"]])

    def test_curated_lists_are_paginated_internally_and_parameters_are_bounded(self) -> None:
        library = ExploreFixture()

        result = library.adult_explore("1990s", "movie", 500)
        endpoint, parameters = library.requests[0]

        self.assertEqual(endpoint, "discover/movie")
        self.assertEqual(parameters["page"], 50)
        self.assertEqual(parameters["primary_release_date.gte"], "1990-01-01")
        self.assertEqual(parameters["primary_release_date.lte"], "1999-12-31")
        self.assertEqual(result["page"], 50)
        with self.assertRaisesRegex(ValueError, "valid Explore list"):
            library.adult_explore("made-up", "all", 1)

    def test_home_feed_requires_included_supported_streaming_availability(self) -> None:
        library = ExploreFixture()

        result = library.adult_explore("for-you", "all", 1, True, 8)
        keys = {value["key"] for value in result["results"]}

        self.assertEqual(keys, {"movie:11"})
        discover_parameters = [parameters for endpoint, parameters in library.requests
                               if endpoint.startswith("discover/")]
        self.assertFalse(discover_parameters)

        library.availability_enabled = False
        disabled = library.adult_explore("for-you", "all", 1, True, 8)
        self.assertEqual(disabled["results"], [])
        self.assertTrue(disabled["availability_disabled"])

    def test_personal_feed_is_steered_by_positive_ratings_not_random_history(self) -> None:
        library = ExploreFixture()
        library.store["titles"]["movie:1"]["personal_rating"] = 3
        library.store["titles"]["tv:2"]["personal_rating"] = 9

        library.adult_explore("for-you", "all", 1)
        recommendation_endpoints = [endpoint for endpoint, _ in library.requests
                                    if endpoint.endswith("/recommendations")]

        self.assertIn("tv/2/recommendations", recommendation_endpoints)
        self.assertNotIn("movie/1/recommendations", recommendation_endpoints)
        self.assertFalse(any(endpoint.startswith("discover/")
                             for endpoint, _ in library.requests))


if __name__ == "__main__":
    unittest.main()
