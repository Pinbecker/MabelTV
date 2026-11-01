from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor
from tests.python.library_test_support import *


class StudioTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.database = self.library.state_database
        self.library.studio_cloud_files = [
            {"id": "a" * 24, "name": "Film.mkv", "path": "Films/Film.mkv", "folder": "Films", "bytes": 100,
             "modified": "2026-01-01", "kind": "video", "extension": ".mkv"},
            {"id": "b" * 24, "name": "Film.en.srt", "path": "Films/Film.en.srt", "folder": "Films", "bytes": 50,
             "modified": "2026-01-01", "kind": "file", "extension": ".srt"}]

    def tearDown(self):
        self.fixture.close()

    def add(self, destination=None):
        return self.library.studio_add_jobs({"sources": [{"type": "cloud", "id": "a" * 24}],
                                             "destination": destination or {"kind": "film"}})["ids"][0]

    def poll(self, worker="1" * 32, **extra):
        return self.library.studio_worker_poll({"id": worker, "name": "Laptop", **extra})

    def test_queue_survives_settings_replacement_and_database_reopen(self):
        identity = self.add()
        self.assertNotIn("studio.job." + identity, self.library.settings())
        self.library.write_state("settings", {"volume": {"maximum": 60}})
        reopened = type(self.database)(self.fixture.database)
        self.assertEqual(reopened.studio_records("job")[0]["id"], identity)
        self.assertEqual(self.library.studio_status()["jobs"][0]["displayStatus"], "Queued")
        self.assertEqual([], reopened.integrity_report()["foreign_key_errors"])

    def test_two_workers_cannot_claim_the_same_job_and_stale_progress_is_rejected(self):
        identity = self.add()
        with ThreadPoolExecutor(max_workers=2) as pool:
            replies = list(pool.map(self.poll, ["1" * 32, "2" * 32]))
        winners = [r["job"] for r in replies if r["job"]]
        self.assertEqual(len(winners), 1)
        claim = winners[0]
        self.assertEqual(claim["id"], identity)
        wrong = self.poll("3" * 32, active={"id": identity, "claim": claim["claim"], "status": "complete"})
        self.assertIsNone(wrong["acknowledged"])
        self.assertEqual(self.database.studio_records("job")[0]["status"], "active")

    def test_cancel_and_pause_cannot_be_overwritten_by_late_completion(self):
        identity = self.add()
        claim = self.poll()["job"]
        self.library.studio_job_action({"id": identity, "action": "pause"})
        reply = self.poll(active={"id": identity, "claim": claim["claim"], "status": "complete", "percent": 100})
        self.assertEqual(reply["acknowledged"]["command"], "pause")
        self.assertEqual(self.database.studio_records("job")[0]["status"], "paused")
        self.library.studio_job_action({"id": identity, "action": "resume"})
        new = self.poll()["job"]
        self.assertNotEqual(new["claim"], claim["claim"])
        self.library.studio_job_action({"id": identity, "action": "cancel"})
        self.poll(active={"id": identity, "claim": new["claim"], "status": "complete"})
        self.assertEqual(self.database.studio_records("job")[0]["status"], "cancelled")

    def test_expired_lease_is_recoverable_and_old_claim_loses_ownership(self):
        identity = self.add()
        old = self.poll()["job"]
        future = time.time() + 100
        with mock.patch("mabeltv_backend.repositories.studio.time.time", return_value=future):
            new = self.poll("2" * 32)["job"]
        self.assertEqual(new["id"], identity)
        self.assertNotEqual(new["claim"], old["claim"])
        self.assertIsNone(self.poll(active={"id": identity, "claim": old["claim"], "percent": 99})["acknowledged"])

    def test_queue_deduplicates_concurrent_requests_and_validates_whole_batch(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            ids = list(pool.map(lambda _: self.add(), range(2)))
        self.assertEqual(ids[0], ids[1])
        self.assertEqual(len(self.database.studio_records("job")), 1)
        before = self.database.studio_records("job")
        with self.assertRaises(ValueError):
            self.library.studio_add_jobs({"sources": [{"type": "cloud", "id": "b" * 24}, {"type": "file", "path": "/etc/passwd"}],
                                          "destination": {"kind": "film"}})
        self.assertEqual(before, self.database.studio_records("job"))

    def test_search_waits_offline_then_returns_worker_result_and_cached_request(self):
        request = self.library.studio_request({"query": "Ludwig"})
        self.assertEqual(request["status"], "queued")
        claimed = self.poll()["requests"][0]
        self.poll(responses=[{"id": claimed["id"], "claim": claimed["claim"], "result": {"items": [{"pid": "m0000001"}]}}])
        result = self.library.studio_request_status(request["id"])
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["result"]["items"][0]["pid"], "m0000001")
        self.assertNotIn("claim", result)
        self.assertEqual(self.library.studio_request({"query": "ludwig"})["id"], request["id"])

    def test_catalogue_filters_and_sidecars_and_failure_preserves_previous_snapshot(self):
        result = self.library.studio_cloud_catalogue({"kind": ["video"], "q": ["film"]})
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(self.library.studio_cloud_item("a" * 24)["subtitles"][0]["path"], "Films/Film.en.srt")
        before = list(self.library.studio_cloud_files)
        with mock.patch.object(self.library, "_studio_rclone", side_effect=ValueError("offline")):
            self.library._studio_cloud_scan()
        self.assertEqual(before, self.library.studio_cloud_files)
        self.assertIn("last catalogue", self.library.studio_cloud_error)

    def test_catalogue_scan_rejects_paths_outside_media(self):
        with mock.patch.object(self.library, "_studio_rclone", return_value=[
            {"Path": "Films/Film.mkv", "Size": 12}, {"Path": "../secrets", "Size": 2}, {"Path": "/etc/passwd", "Size": 2}]):
            self.library._studio_cloud_scan()
        self.assertEqual([i["path"] for i in self.library.studio_cloud_files], ["Films/Film.mkv"])
        self.assertTrue((self.library.studio_cache / "icloud-catalogue.json").is_file())

    def test_cloud_series_group_seasons_and_never_list_episodes_as_root_titles(self):
        self.library.studio_cloud_files = [{**self.library.studio_cloud_files[0], "id": str(index), "name": name,
            "path": f"TV/Example/Season {season:02}/{name}", "folder": f"TV/Example/Season {season:02}"}
            for index, (season, name) in enumerate([(0, "Example - S00E01.mp4"), (1, "Example - S01E01.mp4"), (1, "Example - S01E02.mp4")])]
        self.library.studio_cloud_files.append({**self.library.studio_cloud_files[1], "path": "TV/Example/Season 01/Example.en.srt", "name": "Example.en.srt", "extension": ".srt", "kind": "file"})
        result = self.library.studio_cloud_catalogue({"kind": ["video"]})
        self.assertEqual(result["total"], 1)
        series = result["items"][0]
        self.assertEqual((series["name"], series["episode_count"], series["season_count"]), ("Example", 3, 2))
        episodes = self.library.studio_cloud_catalogue({"series": [series["id"]]})["items"]
        self.assertEqual([i["series"] for i in episodes], [0, 1, 1])
        self.assertEqual(len(episodes), 3)

    def test_subtitles_bind_to_confirmed_publication_and_reject_invalid_input(self):
        video = self.library.my_tv_root / "Published.mp4"
        video.write_bytes(b"video")
        srt = "1\n00:00:00,000 --> 00:00:01,000\nHello\n"
        payload = {"upload": "a" * 32, "data": base64.b64encode(srt.encode()).decode(), "language": "en"}
        with mock.patch.object(self.library, "upload_status", return_value={"complete": False}):
            with self.assertRaises(ValueError):
                self.library.studio_subtitle(payload)
        with mock.patch.object(self.library, "upload_status", return_value={"complete": True, "kind": "my_tv", "file_name": video.name}):
            self.assertTrue(self.library.studio_subtitle(payload)["ok"])
            self.assertEqual(video.with_suffix(".en.srt").read_text(), srt)
            for changes in [{"language": "../bad"}, {"data": "not base64"}]:
                with self.assertRaises(ValueError):
                    self.library.studio_subtitle({**payload, **changes})

    def test_series_batches_preserve_seasons_including_specials_and_upload_destination(self):
        base = self.library.studio_cloud_files[0]
        self.library.studio_cloud_files = [{**base, "id": str(season), "path": f"TV/Example/Season {season}/S{season:02}E01.mp4", "name": f"S{season:02}E01.mp4"} for season in [0, 1]]
        self.library.studio_add_jobs({"sources": [{"type": "cloud", "id": "0"}, {"type": "cloud", "id": "1"}],
            "destination": {"kind": "series", "name": "Example", "season": 0, "preserveSeasons": True}})
        self.assertEqual(sorted(j["destination"]["season"] for j in self.database.studio_records("job")), [0, 1])
        series = self.library.create_my_tv_series("Example")
        self.library.create_my_tv_season(series, 0)
        self.assertIn(0, self.library.my_tv_series_library()[0]["seasons"])
        created = self.library.my_tv_series_upload_create({"series": series, "season": 0, "file_name": "S00E01.mp4", "size": 100})
        reserved = self.library.upload_status(created["id"])
        self.assertEqual(self.library.upload_destination(reserved).parent.name, "Season 0")

    def test_cloud_delete_requires_confirmation_and_never_accepts_drive_root(self):
        payload = {"action": "delete", "items": [{"path": "Media/Films/Film.mkv", "bytes": 100}]}
        with self.assertRaisesRegex(ValueError, "Confirm"):
            self.library.studio_cloud_operation(payload)
        self.assertEqual(self.database.studio_records("cloudop"), [])
        with self.assertRaises(ValueError):
            self.library.studio_cloud_operation({**payload, "confirmed": True, "items": [{"path": "/"}]})
        with self.assertRaises(ValueError):
            self.library.studio_cloud_operation({**payload, "confirmed": True, "items": [{"path": "../secrets"}]})

    def delete_selection(self):
        item = self.library.studio_cloud_files[0]
        return {key: item.get(key, "") for key in ("id", "bytes", "modified", "remoteId")}

    def test_confirmed_cloud_delete_removes_only_frozen_video_and_subtitles(self):
        self.library.studio_cloud_operation({"action": "delete", "confirmed": True, "items": [self.delete_selection()]})
        def stat(path):
            return {"Size": 50 if path.endswith(".srt") else 100, "ModTime": "2026-01-01", "IsDir": False}
        with mock.patch.object(self.library, "_studio_cloud_stat", side_effect=stat), \
             mock.patch.object(self.library, "_studio_cloud_stat_optional", return_value=None), \
             mock.patch.object(self.library, "_studio_cloud_command") as command:
            self.library.studio_cloud_operations_step()
        self.assertEqual(command.call_args_list, [mock.call(["deletefile", "mabeltv_icloud:Media/Films/Film.mkv"]),
            mock.call(["deletefile", "mabeltv_icloud:Media/Films/Film.en.srt"])])
        self.assertEqual(self.database.studio_records("cloudop")[0]["status"], "complete")
        self.assertEqual(self.library.studio_cloud_files, [])

    def test_changed_cloud_file_is_never_deleted(self):
        self.library.studio_cloud_operation({"action": "delete", "confirmed": True, "items": [self.delete_selection()]})
        with mock.patch.object(self.library, "_studio_cloud_stat", return_value={"Size": 101, "IsDir": False}), \
             mock.patch.object(self.library, "_studio_cloud_command") as command:
            self.library.studio_cloud_operations_step()
        command.assert_not_called()
        self.assertEqual(self.database.studio_records("cloudop")[0]["status"], "failed")

    def test_folder_actions_and_non_media_and_stale_selection_are_rejected(self):
        for action in ["rename", "move", "mkdir", "purge"]:
            with self.assertRaises(ValueError):
                self.library.studio_cloud_operation({"action": action, "confirmed": True, "items": [self.delete_selection()]})
        for selection in [{**self.delete_selection(), "bytes": 101}, {"id": "b" * 24}, {"path": "Media"}]:
            with self.assertRaises(ValueError):
                self.library.studio_cloud_operation({"action": "delete", "confirmed": True, "items": [selection]})
        self.assertEqual(self.database.studio_records("cloudop"), [])

    def test_legacy_queued_folder_operation_is_retired_without_mutation(self):
        self.database.studio_add("cloudop", {"id": "old", "action": "move", "status": "queued", "items": [], "created": 1})
        with mock.patch.object(self.library, "_studio_cloud_command") as command:
            self.library.studio_cloud_operations_step()
        command.assert_not_called()
        self.assertEqual(self.database.studio_records("cloudop")[0]["status"], "failed")

    def test_offline_search_queue_is_bounded_without_losing_pending_requests(self):
        for index in range(20):
            self.library.studio_request({"query": f"Programme {index}"})
        with self.assertRaisesRegex(ValueError, "too many"):
            self.library.studio_request({"query": "One more"})
        self.assertEqual(len(self.database.studio_records("request")), 20)

    def test_studio_commands_do_not_send_player_commands_or_refresh(self):
        self.library.refresh_tv = mock.Mock()
        settings_revision = self.database.revisions()["settings"]
        self.add()
        self.poll()
        self.library.studio_request({"query": "Ludwig"})
        self.library.refresh_tv.assert_not_called()
        self.assertEqual(self.database.revisions()["settings"], settings_revision)


if __name__ == "__main__":
    unittest.main()
