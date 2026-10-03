from __future__ import annotations

from tests.python.library_test_support import *


class NativeMyTvTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def test_series_home_is_compact_and_selected_detail_hydrates_exact_episode(self) -> None:
        library = self.fixture.library
        series = {
            "id": "a" * 32, "title": "Example", "metadata": {
                "tmdb_id": 42, "poster": "saved-series-42.jpg"},
            "episodes": [{"season": 1, "episode": n, "path": f"S01E{n}.mp4",
                          "display_name": f"Episode {n}", "library_id": str(n),
                          "watched": n <= 5} for n in range(1, 11)],
        }
        library.my_tv_series_library = mock.Mock(return_value=[series])
        library.my_tv_library = mock.Mock(return_value=[])
        library.write_state("player", {"my_tv_positions": {"8": 300},
                                      "my_tv_durations": {"8": 1800},
                                      "my_tv_position_updated_utc_ms": {"8": 90000}})
        home = library.native_my_tv_home()
        card = home["library"][0]
        self.assertNotIn("episodes", card["local"])
        self.assertEqual(card["poster_url"], "/api/native/my-tv/local-artwork/series/saved-series-42.jpg")
        self.assertEqual(home["continue"][0]["progress"]["position"], 300)
        self.assertEqual(card["next_playable"]["number"], 8)
        library.my_tv_title_detail = mock.Mock(return_value={
            "key": "tv:42", "title": "Example", "media_type": "tv", "tmdb_id": 42})
        detail = library.native_my_tv_detail("tv", 42)
        self.assertEqual(len(detail["local_episodes"]), 10)
        self.assertTrue(detail["local_episodes"][7]["source"].endswith("S01E8.mp4"))
        self.assertEqual(detail["local_episodes"][7]["library_id"], "8")
        library.my_tv_title_season = mock.Mock(return_value={
            "key": "tv:42", "episodes": [{"number": n, "name": f"TMDB {n}"}
                                         for n in range(1, 11)]})
        season = library.native_my_tv_season(42, 1)
        self.assertEqual(season["episodes"][7]["name"], "TMDB 8")
        self.assertEqual(season["episodes"][7]["remote_position"], 300)
        self.assertEqual(season["episodes"][7]["library_id"], "8")

    def test_next_episode_uses_furthest_watched_instead_of_an_earlier_gap(self) -> None:
        library = self.fixture.library
        library._native_my_tv_episodes = {}
        card = library._native_local_title({"id": "b" * 32, "episodes": [
            {"season": 1, "episode": n, "path": f"{n}.mp4", "watched": n == 4}
            for n in range(1, 7)]}, "series")
        self.assertEqual(card["next_playable"]["number"], 5)

    def test_local_artwork_retains_metadata_names_but_rejects_traversal(self) -> None:
        library = self.fixture.library
        library.my_tv_series_artwork_root.mkdir(parents=True, exist_ok=True)
        poster = library.my_tv_series_artwork_root / "saved-series-42.jpg"
        poster.write_bytes(b"image")
        self.assertEqual(library.native_my_tv_local_artwork("series", poster.name), poster)
        for name in ("../saved-series-42.jpg", "/etc/passwd", "settings.json"):
            with self.assertRaises(ValueError):
                library.native_my_tv_local_artwork("series", name)
        with self.assertRaises(ValueError):
            library.native_my_tv_local_artwork("film", poster.name)

    def test_finished_episode_keeps_next_episode_in_continue_without_a_bookmark(self) -> None:
        library = self.fixture.library
        series = {"id": "b" * 32, "episodes": [
            {"season": 1, "episode": 1, "path": "1.mp4", "library_id": "one",
             "watched": True, "watched_updated": 100},
            {"season": 2, "episode": 1, "path": "2.mp4", "library_id": "two"}]}
        library.my_tv_series_library = mock.Mock(return_value=[series])
        library.my_tv_library = mock.Mock(return_value=[])
        home = library.native_my_tv_home()
        self.assertEqual(len(home["continue"]), 1)
        card = home["continue"][0]
        self.assertEqual(card["series_progress"]["state"], "next")
        self.assertEqual(card["progress"]["position"], 0)
        self.assertEqual(card["progress"]["updated"], 100)
        self.assertEqual(card["next_playable"]["season"], 2)
        series["episodes"][1].update(watched=True, watched_updated=200)
        home = library.native_my_tv_home()
        self.assertEqual(home["continue"], [])
        self.assertEqual(home["library"][0]["series_progress"]["state"], "complete")

    def test_episode_completion_validates_series_and_identity_before_domain_write(self) -> None:
        library = self.fixture.library
        library.my_tv_series_library = mock.Mock(return_value=[{
            "id": "series", "episodes": [{"library_id": "episode", "path": "Season 1/1.mp4"}]}])
        library.set_my_tv_episode_watched = mock.Mock(return_value={"ok": True})
        self.assertEqual(library.native_my_tv_episode_complete({
            "series_id": "series", "library_id": "episode"}), {"ok": True})
        library.set_my_tv_episode_watched.assert_called_once_with("series", "Season 1/1.mp4", True)
        for payload in ({}, {"series_id": "other", "library_id": "episode"},
                        {"series_id": "series", "library_id": "../../etc/passwd"}):
            with self.assertRaises(ValueError):
                library.native_my_tv_episode_complete(payload)
        self.assertEqual(library.set_my_tv_episode_watched.call_count, 1)

    def test_mabel_channels_keep_order_and_identity_without_private_catalogue_work(self) -> None:
        library = self.fixture.library
        library.channel_library = mock.Mock(return_value=[{
            "number": 5, "name": "Films", "folder": "Films", "enabled": True,
            "content_type": "films", "metadata": {}, "programmes": [{
                "name": "Example.mp4", "display_name": "Example", "enabled": True,
                "remote_position": 120, "remote_duration": 1800,
                "metadata": {"poster": "film-poster.jpg", "title": "Film title"}}]}, {
            "number": 1, "name": "Episodes", "folder": "Episodes", "enabled": True,
            "content_type": "episodes", "metadata": {"artwork": "channel.jpg"}, "programmes": []}])
        library.my_tv_library = mock.Mock(side_effect=AssertionError("private catalogue must not be scanned"))
        channels = library.native_my_tv_mabel_channels()["channels"]
        library.channel_library.assert_called_once_with(include_resume=False)
        self.assertEqual([value["channel_number"] for value in channels], [1, 5])
        self.assertEqual(channels[1]["poster_url"], "/api/native/my-tv/local-artwork/channel/film-poster.jpg")
        detail = library.native_my_tv_mabel_channel(5)
        library.channel_library.assert_called_with(5)
        item = detail["items"][0]
        self.assertTrue(item["borrowed"])
        self.assertEqual(item["mabel"], {"channel": 5, "file": "Example.mp4", "kind": "films"})
        self.assertEqual(item["progress"]["position"], 120)
        self.assertTrue(item["source"].endswith("/Films/Example.mp4"))
        with self.assertRaises(ValueError):
            library.native_my_tv_mabel_channel(999)

    def test_family_directory_skips_bookmarks_and_selected_channel_skips_other_folders(self) -> None:
        library = self.fixture.library
        library.channels = mock.Mock(return_value=[
            {"number": 1, "name": "Films", "folder": "films", "content_type": "films"},
            {"number": 2, "name": "Episodes", "folder": "episodes", "content_type": "episodes"}])
        for folder in ("films", "episodes"):
            (library.media_root / folder).mkdir(exist_ok=True)
            (library.media_root / folder / "S01E01.mp4").write_bytes(b"fixture")
        library.channel_film_resume_state = mock.Mock(side_effect=AssertionError("unrelated film bookmark"))
        library.channel_series_resume_state = mock.Mock(return_value={})
        self.assertEqual(len(library.native_my_tv_mabel_channels()["channels"]), 2)
        library.channel_film_resume_state.assert_not_called()
        library.channel_series_resume_state.assert_not_called()
        selected = library.native_my_tv_mabel_channel(2)
        self.assertEqual(len(selected["items"]), 1)
        self.assertEqual(selected["items"][0]["mabel"]["channel"], 2)
        library.channel_film_resume_state.assert_not_called()
        self.assertEqual(library.channel_series_resume_state.call_args.args[0], 2)
        self.assertEqual(library.channel_series_resume_state.call_count, 1)

    def test_native_search_preserves_local_artwork_and_playback_without_rescan(self) -> None:
        library = self.fixture.library
        library._native_my_tv_local_cards = {"movie:12": {
            "local": {"library_id": "film"}, "poster_url": "/local.jpg",
            "source": "file:///film.mp4", "progress": {"position": 50}}}
        library.my_tv_cached_tmdb_request = mock.Mock(return_value={"results": [{
            "media_type": "movie", "id": 12, "title": "Example"}]})
        library.my_tv_library = mock.Mock()
        item = library.native_my_tv_search("example")["results"][0]
        self.assertEqual(item["poster_url"], "/local.jpg")
        self.assertEqual(item["source"], "file:///film.mp4")
        library.my_tv_library.assert_not_called()

    def test_provider_failure_does_not_hide_other_services_or_contact_the_tv(self) -> None:
        library = self.fixture.library
        library.my_tv_title_provider_groups = mock.Mock(return_value={
            "providers": [{"name": "Netflix", "type": "flatrate"}]})
        library.my_tv_streaming_links = mock.Mock(side_effect=ValueError("Unavailable"))
        library.lg_tv_catalog_cache = {"apps_known": True, "shortcuts": {"netflix": "netflix"}}
        library.lg_tv_status = mock.Mock()
        result = library.native_my_tv_providers("movie", 42)
        self.assertEqual(result["providers"][0]["name"], "Netflix")
        self.assertEqual(result["available_apps"], ["netflix"])
        self.assertEqual(result["errors"], ["Unavailable"])
        library.lg_tv_status.assert_not_called()

    def test_service_choices_group_brands_and_keep_unsupported_services_out_of_actions(self) -> None:
        library = self.fixture.library
        result = library._native_service_choices({
            "provider_result": {"sources": [
                {"name": "Netflix", "type": "sub", "web_url": "https://www.netflix.com/title/80057281"},
                {"name": "HBO Max Amazon Channel", "type": "sub"},
                {"name": "Prime Video", "type": "sub"}]},
            "providers": [{"name": "Netflix Standard with Ads", "type": "flatrate"},
                          {"name": "MAX", "type": "flatrate"},
                          {"name": "HBO Max", "type": "flatrate"},
                          {"name": "Apple TV Amazon Channel", "type": "flatrate"},
                          {"name": "Amazon Prime Video", "type": "flatrate"},
                          {"name": "Netflix", "type": "buy"}],
            "apps_known": True, "available_apps": ["netflix", "prime"],
        })
        self.assertEqual([value["name"] for value in result["services"]], ["Netflix", "Prime Video"])
        self.assertEqual(result["services"][0]["action"], "Open title")
        self.assertEqual(result["services"][1]["action"], "Open app")
        self.assertEqual([value["name"] for value in result["other_services"]], ["Max", "Apple TV"])
        self.assertFalse(any(value["shortcut"] for value in result["other_services"]))
        self.assertEqual(result["other_services"][1]["action"], "Not installed on this TV")

    def test_invalid_netflix_destination_becomes_an_app_action(self) -> None:
        result = self.fixture.library._native_service_choices({"providers": [
            {"name": "Netflix", "type": "flatrate", "web_url": "https://example.com/80057281"}]})
        self.assertEqual(result["services"][0]["action"], "Open app")
        self.assertEqual(result["services"][0]["destination"], "")

    def test_backdrop_enrichment_is_cached_and_never_blocks_home(self) -> None:
        library = self.fixture.library
        library.my_tv_cached_tmdb_request = mock.Mock(return_value={"backdrop_path": "/wide.jpg"})
        library.my_tv_library = mock.Mock(return_value=[{"id": "film", "path": "film.mp4",
                                                       "metadata": {"tmdb_id": 12}}])
        library.my_tv_series_library = mock.Mock(return_value=[])
        self.assertEqual(library.native_my_tv_home()["library"][0]["backdrop_path"], "")
        library.my_tv_cached_tmdb_request.assert_not_called()
        for _ in range(2):
            self.assertEqual(library.native_my_tv_backdrop("movie", 12)["backdrop_path"], "/wide.jpg")
        library.my_tv_cached_tmdb_request.assert_called_once()
        self.assertEqual(library.native_my_tv_home()["library"][0]["backdrop_path"], "/wide.jpg")

    def test_native_launch_uses_canonical_brand_and_preserves_netflix_deeplink(self) -> None:
        library = self.fixture.library
        library.play_netflix_on_tv = mock.Mock(return_value={"ok": True})
        library.lg_tv_launch_shortcut = mock.Mock(return_value={"ok": True})
        payload = {"provider": "Netflix", "destination": "https://www.netflix.com/title/80057281"}
        library.native_my_tv_launch(payload)
        library.play_netflix_on_tv.assert_called_once_with(payload)
        library.native_my_tv_launch({"provider": "Apple TV Amazon Channel"})
        library.lg_tv_launch_shortcut.assert_called_once_with("appletv")
        with self.assertRaises(ValueError):
            library.native_my_tv_launch({"provider": "HBO Max Amazon Channel"})
