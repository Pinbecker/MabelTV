from __future__ import annotations

import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts" / "pi"))

from mabeltv_backend.adult_insights import AdultInsightsMixin
from mabeltv_backend.database import StateDatabase
try:
    from tests.python.sqlite_test_database import initialise_test_database
except ModuleNotFoundError:
    from sqlite_test_database import initialise_test_database


class InsightLibrary(AdultInsightsMixin):
    def __init__(self, root: Path) -> None:
        self.adult_insights_path = root / "insights.json"
        self.config_lock = threading.RLock()
        self.adult_insights_lock = threading.Lock()
        self.adult_insights_closed = threading.Event()
        self.adult_insights_worker = None
        self.requests: list[tuple[str, dict]] = []
        self.state_database = StateDatabase(root / "mabeltv.db")
        initialise_test_database(StateDatabase, root / "mabeltv.db")
        self.store = {"titles": {
            "movie:1": {"media_type": "movie", "tmdb_id": 1, "title": "One",
                        "year": "1998", "manual_state": "watched",
                        "personal_rating": 9, "poster_path": "/one.jpg"},
            "tv:2": {"media_type": "tv", "tmdb_id": 2, "title": "Two",
                     "year": "2012", "manual_state": "watched",
                     "personal_rating": 7, "poster_path": "/two.jpg"},
            "movie:3": {"media_type": "movie", "tmdb_id": 3, "title": "Three",
                        "year": "2020", "manual_state": "not_watched"},
        }}

    def read_state(self, kind: str):
        return self.state_database.read(kind)

    def write_state(self, kind: str, value) -> None:
        self.state_database.write(kind, value)

    def save_adult_insights(self, value) -> None:
        self.state_database.save_adult_insights(value)

    def adult_viewing_store(self):
        return self.store

    @staticmethod
    def tmdb_key() -> str:
        return "test-key"

    def tmdb_request(self, endpoint: str, parameters: dict):
        self.requests.append((endpoint, parameters))
        movie = endpoint.startswith("movie/")
        return {
            "genres": [{"name": "Drama"}, {"name": "Comedy" if movie else "Drama"}],
            "original_language": "en", "production_countries": [{"name": "United Kingdom"}],
            "created_by": [] if movie else [{"id": 22, "name": "Series Creator"}],
            "credits": {
                "cast": [{"id": 10, "name": "Shared Actor", "profile_path": "/actor.jpg"}],
                "crew": [{"id": 20, "name": "Film Director", "job": "Director"}],
            },
        }


class AdultInsightsTests(unittest.TestCase):
    def test_payload_uses_release_eras_and_never_watched_timestamps(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            library = InsightLibrary(Path(temporary))
            library.enrich_adult_insights()
            payload = library.adult_insights()

        self.assertEqual(payload["summary"]["watched"], 2)
        self.assertEqual(payload["summary"]["average_rating"], 8.0)
        self.assertEqual([value["label"] for value in payload["decades"]],
                         ["1990s", "2010s"])
        self.assertNotIn("timeline", payload)
        self.assertNotIn("watched_at", json.dumps(payload))

    def test_enrichment_uses_tmdb_title_details_without_provider_requests(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            library = InsightLibrary(Path(temporary))
            library.enrich_adult_insights()
            cache = library.adult_insights_cache()
            payload = library.adult_insights_payload(
                {key: value for key, value in library.store["titles"].items()
                 if library.adult_insights_watched(value)}, cache)

        self.assertEqual([request[0] for request in library.requests], ["movie/1", "tv/2"])
        self.assertTrue(all(request[1] == {
            "language": "en-GB", "append_to_response": "credits"}
                            for request in library.requests))
        self.assertEqual(payload["genres"][0]["label"], "Drama")
        self.assertEqual(payload["actors"][0]["name"], "Shared Actor")
        self.assertEqual({value["name"] for value in payload["creative"]},
                         {"Film Director", "Series Creator"})
        self.assertEqual(payload["titles"][0]["genres"], ["Drama", "Comedy"])
        self.assertEqual(payload["titles"][0]["countries"], ["United Kingdom"])
        self.assertEqual(payload["titles"][0]["cast_ids"], [10])
        self.assertEqual(payload["titles"][1]["creative_ids"], [22])


if __name__ == "__main__":
    unittest.main()
