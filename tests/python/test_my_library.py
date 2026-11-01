from __future__ import annotations

from tests.python.library_test_support import *


class MyLibraryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()
        self.library = self.fixture.library

    def tearDown(self) -> None:
        self.fixture.close()

    def add_film(self, name="First.mp4", tmdb_id=11):
        path = self.library.my_tv_root / name
        path.write_bytes(b"film")
        states = self.library.my_tv_media_states()
        states[name] = {"library_id": name, "added_at": 123,
                        "metadata": {"tmdb_id": tmdb_id, "title": name}}
        self.library.write_my_tv_media_states(states)
        return path

    def test_local_collection_metadata_never_fetches_providers_or_other_parts(self):
        self.add_film()
        self.library.tmdb_request = mock.Mock(return_value={
            "release_date": "2001-11-16", "genres": [{"name": "Fantasy"}],
            "belongs_to_collection": {"id": 99, "name": "Magic Collection"}})
        self.library.my_tv_title_provider_groups = mock.Mock()
        before = self.library.my_tv_viewing_store()
        first = self.library.my_tv_library_metadata("movie", 11)
        self.assertEqual(first["collection"], {"tmdb_id": 99, "name": "Magic Collection"})
        self.assertEqual(first["genres"], ["Fantasy"])
        self.assertEqual(first["year"], "2001")
        self.assertNotIn("parts", first)
        self.assertEqual(self.library.my_tv_library_metadata("movie", 11), first)
        self.library.tmdb_request.assert_called_once_with("movie/11", {"language": "en-GB"})
        self.library.my_tv_title_provider_groups.assert_not_called()
        self.assertEqual(self.library.my_tv_viewing_store(), before)

    def test_nonlocal_and_removed_titles_are_rejected_without_network_requests(self):
        path = self.add_film()
        path.unlink()
        self.library.tmdb_request = mock.Mock()
        for media_type, identifier in [("movie", 11), ("movie", 100), ("tv", 11)]:
            with self.assertRaisesRegex(ValueError, "not in My Library"):
                self.library.my_tv_library_metadata(media_type, identifier)
        self.library.tmdb_request.assert_not_called()

    def test_missing_metadata_remains_in_inventory_with_arrival_time(self):
        self.add_film()
        (self.library.my_tv_root / "Unmatched.mp4").write_bytes(b"film")
        items = {item["name"]: item for item in self.library.my_tv_library()}
        self.assertEqual(items["First.mp4"]["added_at"], 123)
        self.assertGreater(items["Unmatched.mp4"]["added_at"], 0)
        self.assertEqual(items["Unmatched.mp4"]["metadata"], {})
        saved = self.library.my_tv_media_states()["Unmatched.mp4"]["added_at"]
        self.assertEqual(self.library.my_tv_library()[1]["added_at"], saved)

    def test_collection_free_movie_and_upstream_failure_preserve_inventory(self):
        self.add_film()
        self.library.tmdb_request = mock.Mock(return_value={"genres": []})
        self.assertIsNone(self.library.my_tv_library_metadata("movie", 11)["collection"])
        self.library._my_tv_tmdb_cache = {}
        self.library.tmdb_request.side_effect = ValueError("Offline")
        with self.assertRaisesRegex(ValueError, "Offline"):
            self.library.my_tv_library_metadata("movie", 11)
        self.assertEqual(len(self.library.my_tv_library()), 1)

    def test_series_requires_local_episodes_and_does_not_form_film_collections(self):
        series = self.library.create_my_tv_series("Local Show")
        states = self.library.my_tv_series_states()
        states["series"][series]["metadata"] = {"tmdb_id": 55}
        self.library.write_my_tv_series_states(states)
        self.library.tmdb_request = mock.Mock(return_value={
            "first_air_date": "2020-01-01", "genres": [{"name": "Drama"}],
            "belongs_to_collection": {"id": 99, "name": "Not a film"}})
        with self.assertRaisesRegex(ValueError, "not in My Library"):
            self.library.my_tv_library_metadata("tv", 55)
        root = self.library.my_tv_series_root / series / "Season 1"
        root.mkdir(exist_ok=True)
        (root / "Episode 1.mp4").write_bytes(b"episode")
        result = self.library.my_tv_library_metadata("tv", 55)
        self.assertEqual(result["genres"], ["Drama"])
        self.assertIsNone(result["collection"])
        self.assertGreater(self.library.my_tv_series_library()[0]["added_at"], 0)
