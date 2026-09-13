from __future__ import annotations

import sys
import tempfile
import threading
import unittest
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts" / "pi"))

from mabeltv_backend.adult_metadata import AdultMetadataMixin  # noqa: E402
from mabeltv_backend.provider_transport import ProviderTransportMixin  # noqa: E402
from mabeltv_backend.http import Handler  # noqa: E402
from mabeltv_backend.media import MediaCatalogueMixin  # noqa: E402
from mabeltv_backend.management import ManagementMixin  # noqa: E402
from mabeltv_backend.database import StateDatabase  # noqa: E402
try:  # noqa: E402
    from tests.python.sqlite_test_database import initialise_test_database
except ModuleNotFoundError:  # noqa: E402
    from sqlite_test_database import initialise_test_database


class CatalogueFixture(AdultMetadataMixin, ProviderTransportMixin):
    def __init__(self) -> None:
        self.config_lock = threading.RLock()
        self.requests: list[tuple[str, dict[str, Any]]] = []

    def tmdb_request(self, endpoint: str,
                     parameters: dict[str, Any] | None = None) -> dict[str, Any]:
        self.requests.append((endpoint, parameters or {}))
        if endpoint == "search/multi":
            return {"results": [{
                "id": 1892, "media_type": "person", "name": "Jane Director",
                "profile_path": "/jane.jpg", "known_for_department": "Directing",
            }]}
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
                    "crew": [{"id": 3, "name": "Andrew Stanton", "job": "Director",
                              "profile_path": "/stanton.jpg"}],
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
                "created_by": [{"id": 8, "name": "Example Creator",
                                "profile_path": "/creator.jpg"}],
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
                    {"id": 200, "media_type": "tv", "name": "Late Night Fixture",
                     "first_air_date": "2015-01-01", "character": "Self - Guest",
                     "genre_ids": [10767], "popularity": 300, "vote_count": 500},
                    {"id": 201, "media_type": "movie", "title": "Archive Fixture",
                     "release_date": "2025-01-01", "character": "Self (archive footage)",
                     "genre_ids": [99], "popularity": 100, "vote_count": 30000},
                    {"id": 12, "media_type": "movie", "title": "Finding Nemo",
                     "release_date": "2003-05-30", "character": "Marlin",
                     "popularity": 30, "vote_count": 19000},
                    {"id": 99, "media_type": "tv", "name": "A Series",
                     "first_air_date": "2021-01-01", "character": "Lead",
                     "popularity": 20, "vote_count": 200},
                ]},
            }
        if endpoint == "person/3":
            return {
                "id": 3, "name": "Andrew Stanton",
                "known_for_department": "Directing",
                "combined_credits": {"cast": [], "crew": [
                    {"id": 12, "media_type": "movie", "title": "Finding Nemo",
                     "release_date": "2003-05-30", "job": "Director",
                     "department": "Directing", "vote_count": 19000},
                    {"id": 13, "media_type": "movie", "title": "Writing Only",
                     "release_date": "2008-01-01", "job": "Screenplay",
                     "department": "Writing", "vote_count": 5000},
                ]},
            }
        raise AssertionError(endpoint)

    @staticmethod
    def adult_local_title_index() -> dict[str, dict[str, Any]]:
        return {"movie:127380": {"kind": "film", "path": "Finding Dory.mp4"}}

    @staticmethod
    def adult_library() -> list[dict[str, Any]]:
        return []

    @staticmethod
    def adult_viewing_store() -> dict[str, Any]:
        return {"schema_version": 1, "titles": {}, "availability": {}}

    @staticmethod
    def settings() -> dict[str, Any]:
        return {"schema_version": 1}


class AvailabilitySettingsFixture(MediaCatalogueMixin, ManagementMixin):
    def __init__(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.config_lock = threading.RLock()
        self.settings_path = Path("settings.json")
        self.database_path = Path(self.temporary.name) / "mabeltv.db"
        initialise_test_database(StateDatabase, self.database_path)
        self.state_database = StateDatabase(self.database_path)

    def settings(self) -> dict[str, Any]:
        return self.read_state("settings")

    def __del__(self) -> None:
        self.temporary.cleanup()


class AdultTitleEnrichmentTests(unittest.TestCase):
    def test_discovery_includes_people_without_title_viewing_state(self) -> None:
        found = CatalogueFixture().adult_discovery("Jane")

        self.assertEqual(found["results"], [{
            "key": "person:1892", "media_type": "person", "tmdb_id": 1892,
            "title": "Jane Director", "name": "Jane Director",
            "profile_path": "/jane.jpg", "known_for_department": "Directing",
        }])

    def test_watchmode_availability_setting_defaults_on_and_persists_off(self) -> None:
        library = AvailabilitySettingsFixture()

        self.assertNotEqual(library.settings().get("watchmode_availability_enabled"), False)
        self.assertTrue(library.manage({"action": "set-watchmode-availability",
                                        "enabled": False}))
        self.assertFalse(library.settings()["watchmode_availability_enabled"])

    def test_movie_detail_normalises_and_caches_franchise_cast_and_director(self) -> None:
        library = CatalogueFixture()

        detail = library.adult_title_detail("movie", 12)
        repeated = library.adult_title_detail("movie", 12)

        self.assertEqual(detail["release_date"], "2003-10-10")
        self.assertEqual(detail["rating"], 7.8)
        self.assertEqual(detail["directors"], ["Andrew Stanton"])
        self.assertEqual(detail["creative_leads"], [{
            "tmdb_id": 3, "name": "Andrew Stanton", "role": "Director",
            "profile_path": "/stanton.jpg",
        }])
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
        self.assertEqual(detail["creative_leads"][0]["role"], "Creator")
        self.assertEqual(detail["creative_leads"][0]["profile_path"], "/creator.jpg")
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
        self.assertEqual([item["title"] for item in detail["filmography"]],
                         ["A Series", "Finding Nemo"])
        self.assertEqual(repeated, detail)
        self.assertEqual([endpoint for endpoint, _ in library.requests].count(
            "person/1"), 1)

    def test_person_detail_uses_the_creative_department_for_directors(self) -> None:
        detail = CatalogueFixture().adult_person_detail(3)

        self.assertEqual([item["title"] for item in detail["filmography"]],
                         ["Finding Nemo"])
        self.assertEqual(detail["filmography"][0]["character"], "Director")
        self.assertEqual([item["title"] for item in detail["known_for"]],
                         ["Finding Nemo"])

    def test_person_credit_ranking_rejects_guest_and_archive_appearances(self) -> None:
        meaningful = {"media_type": "movie", "character": "Alfred", "genre_ids": [18],
                      "vote_count": 20000, "popularity": 30, "order": 2}
        guest = {"media_type": "tv", "character": "Self - Guest",
                 "genre_ids": [10767], "vote_count": 500, "popularity": 300}
        archive = {"media_type": "movie", "character": "Self (archive footage)",
                   "genre_ids": [99], "vote_count": 30000, "popularity": 90}

        self.assertIsNotNone(CatalogueFixture.adult_person_credit_score(meaningful))
        self.assertIsNone(CatalogueFixture.adult_person_credit_score(guest))
        self.assertIsNone(CatalogueFixture.adult_person_credit_score(archive))

    def test_disabled_availability_skips_tmdb_providers_and_watchmode(self) -> None:
        class DisabledCatalogue(CatalogueFixture):
            @staticmethod
            def settings() -> dict[str, Any]:
                return {"watchmode_availability_enabled": False}

        library = DisabledCatalogue()
        detail = library.adult_title_detail("movie", 12)
        links = library.adult_streaming_links("movie", 12)

        self.assertFalse(detail["availability_enabled"])
        self.assertEqual(detail["providers"], [])
        self.assertNotIn("movie/12/watch/providers",
                         [endpoint for endpoint, _ in library.requests])
        self.assertTrue(links["disabled"])

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
