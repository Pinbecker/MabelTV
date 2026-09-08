from __future__ import annotations

import sys
import threading
import unittest
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts" / "pi"))

from mabeltv_backend.providers import ProviderMetadataMixin  # noqa: E402
from mabeltv_backend.http import Handler  # noqa: E402


class CatalogueFixture(ProviderMetadataMixin):
    def __init__(self) -> None:
        self.config_lock = threading.RLock()
        self.requests: list[tuple[str, dict[str, Any]]] = []

    def tmdb_request(self, endpoint: str,
                     parameters: dict[str, Any] | None = None) -> dict[str, Any]:
        self.requests.append((endpoint, parameters or {}))
        if endpoint == "movie/12":
            return {
                "id": 12, "title": "Finding Nemo", "release_date": "2003-05-30",
                "runtime": 100, "vote_average": 7.8, "vote_count": 19000,
                "genres": [{"name": "Animation"}],
                "release_dates": {"results": [{
                    "iso_3166_1": "GB", "release_dates": [
                        {"type": 4, "release_date": "2003-12-01T00:00:00.000Z"},
                        {"type": 3, "release_date": "2003-10-10T00:00:00.000Z"},
                    ],
                }]},
                "belongs_to_collection": {"id": 137697, "name": "Finding Nemo Collection"},
                "credits": {
                    "cast": [
                        {"id": 1, "name": "Albert Brooks", "character": "Marlin",
                         "profile_path": "/albert.jpg", "order": 0},
                        {"id": 2, "name": "Ellen DeGeneres", "character": "Dory",
                         "profile_path": "/ellen.jpg", "order": 1},
                    ],
                    "crew": [{"id": 3, "name": "Andrew Stanton", "job": "Director"}],
                },
            }
        if endpoint == "movie/12/watch/providers":
            return {"results": {"GB": {
                "flatrate": [{"provider_id": 337, "provider_name": "Disney+"}],
                "rent": [{"provider_id": 2, "provider_name": "Apple TV"}],
            }}}
        if endpoint == "collection/137697":
            return {"id": 137697, "name": "Finding Nemo Collection", "parts": [
                {"id": 127380, "title": "Finding Dory", "release_date": "2016-06-16",
                 "poster_path": "/dory.jpg"},
                {"id": 12, "title": "Finding Nemo", "release_date": "2003-05-30",
                 "poster_path": "/nemo.jpg"},
            ]}
        if endpoint == "tv/77":
            return {
                "id": 77, "name": "Fixture Show", "first_air_date": "2020-01-02",
                "last_air_date": "2022-03-04", "vote_average": 8.2,
                "vote_count": 400, "episode_run_time": [48],
                "created_by": [{"id": 8, "name": "Example Creator"}],
                "credits": {"cast": [{
                    "id": 9, "name": "Example Actor", "character": "Lead",
                    "profile_path": "/actor.jpg", "order": 0,
                }]},
                "seasons": [{"season_number": 1, "name": "Series 1",
                             "episode_count": 2}],
            }
        if endpoint == "tv/77/watch/providers":
            return {"results": {"GB": {}}}
        if endpoint == "person/1":
            return {
                "id": 1, "name": "Albert Brooks", "known_for_department": "Acting",
                "birthday": "1947-07-22", "place_of_birth": "Beverly Hills, California",
                "profile_path": "/albert.jpg", "biography": "An actor and filmmaker.",
                "combined_credits": {"cast": [
                    {"id": 12, "media_type": "movie", "title": "Finding Nemo",
                     "release_date": "2003-05-30", "character": "Marlin",
                     "popularity": 30, "vote_count": 19000},
                    {"id": 99, "media_type": "tv", "name": "A Series",
                     "first_air_date": "2021-01-01", "character": "Lead",
                     "popularity": 20, "vote_count": 200},
                ]},
            }
        raise AssertionError(endpoint)

    @staticmethod
    def adult_local_title_index() -> dict[str, dict[str, Any]]:
        return {"movie:127380": {"kind": "film", "path": "Finding Dory.mp4"}}

    @staticmethod
    def adult_viewing_store() -> dict[str, Any]:
        return {"schema_version": 1, "titles": {}, "availability": {}}


class AdultTitleEnrichmentTests(unittest.TestCase):
    def test_movie_detail_normalises_and_caches_franchise_cast_and_director(self) -> None:
        library = CatalogueFixture()

        detail = library.adult_title_detail("movie", 12)
        repeated = library.adult_title_detail("movie", 12)

        self.assertEqual(detail["release_date"], "2003-10-10")
        self.assertEqual(detail["rating"], 7.8)
        self.assertEqual(detail["directors"], ["Andrew Stanton"])
        self.assertEqual(detail["cast"][0]["character"], "Marlin")
        self.assertEqual(detail["collection"]["name"], "Finding Nemo Collection")
        self.assertEqual([part["title"] for part in detail["collection"]["parts"]],
                         ["Finding Nemo", "Finding Dory"])
        self.assertTrue(detail["collection"]["parts"][1]["on_mabeltv"])
        self.assertEqual(repeated["collection"], detail["collection"])
        self.assertEqual([endpoint for endpoint, _ in library.requests].count("movie/12"), 1)
        self.assertEqual([endpoint for endpoint, _ in library.requests].count(
            "movie/12/watch/providers"), 1)
        self.assertEqual([endpoint for endpoint, _ in library.requests].count(
            "collection/137697"), 1)

    def test_tv_detail_uses_exact_air_dates_creator_rating_and_cast(self) -> None:
        detail = CatalogueFixture().adult_title_detail("tv", 77)

        self.assertEqual(detail["first_air_date"], "2020-01-02")
        self.assertEqual(detail["last_air_date"], "2022-03-04")
        self.assertEqual(detail["directors"], ["Example Creator"])
        self.assertEqual(detail["rating"], 8.2)
        self.assertEqual(detail["cast"][0]["name"], "Example Actor")
        self.assertIsNone(detail["collection"])

    def test_watchmode_offers_keep_safe_prices_and_each_quality(self) -> None:
        values = CatalogueFixture.normalise_watchmode_sources([
            {"source_id": 349, "name": "AppleTV", "type": "rent", "region": "GB",
             "format": "SD", "price": 3.49, "web_url": "http://tv.apple.com/film"},
            {"source_id": 349, "name": "AppleTV", "type": "rent", "region": "GB",
             "format": "4K", "price": 4.99, "web_url": "https://tv.apple.com/film"},
            {"source_id": 24, "name": "Bad", "type": "buy", "price": -1,
             "web_url": "javascript:alert(1)"},
        ])

        self.assertEqual(len(values), 2)
        self.assertEqual([offer["format"] for offer in values], ["SD", "4K"])
        self.assertEqual([offer["price"] for offer in values], [3.49, 4.99])
        self.assertEqual(values[0]["web_url"], "https://tv.apple.com/film")

    def test_person_detail_is_lazy_cacheable_and_keeps_ranked_credits(self) -> None:
        library = CatalogueFixture()

        detail = library.adult_person_detail(1)
        repeated = library.adult_person_detail(1)

        self.assertEqual(detail["name"], "Albert Brooks")
        self.assertEqual(detail["birthday"], "1947-07-22")
        self.assertEqual([item["title"] for item in detail["known_for"]],
                         ["Finding Nemo", "A Series"])
        self.assertEqual(detail["known_for"][0]["character"], "Marlin")
        self.assertEqual(repeated, detail)
        self.assertEqual([endpoint for endpoint, _ in library.requests].count(
            "person/1"), 1)

    def test_security_policy_allows_only_the_two_metadata_image_hosts(self) -> None:
        class HeaderRecorder:
            def __init__(self) -> None:
                self.headers: dict[str, str] = {}

            def send_header(self, name: str, value: str) -> None:
                self.headers[name] = value

        recorder = HeaderRecorder()
        Handler.security_headers(recorder)  # type: ignore[arg-type]

        policy = recorder.headers["Content-Security-Policy"]
        self.assertIn("img-src 'self' data: https://image.tmdb.org ", policy)
        self.assertIn("https://cdn.watchmode.com;", policy)
        self.assertNotIn("img-src *", policy)


if __name__ == "__main__":
    unittest.main()
