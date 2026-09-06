from __future__ import annotations

import argparse
import os
import time
import unittest
from unittest import mock

try:
    from tests.python.test_library_service import LibraryFixture, mabeltv_library
except ModuleNotFoundError:
    from test_library_service import LibraryFixture, mabeltv_library


class DurableUsbTransferTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()
        self.usb_root = self.fixture.root / "usb"
        self.volume = self.usb_root / "TEST-USB"
        self.volume.mkdir(parents=True)
        self.fixture.library.usb_root = self.usb_root.resolve()
        self.fixture.library.usb_requires_mount = False
        self.fixture.library.refresh_tv = mock.Mock(return_value=True)

    def tearDown(self) -> None:
        self.fixture.close()

    def stop_usb_worker(self) -> None:
        library = self.fixture.library
        library.usb_transfer_closed.set()
        library.usb_transfer_wakeup.set()
        library.usb_transfer_worker.join(timeout=2)
        self.assertFalse(library.usb_transfer_worker.is_alive())

    def restart_library(self):
        old = self.fixture.library
        old.close()
        args = argparse.Namespace(
            media_root=str(self.fixture.media),
            channels=str(self.fixture.channels),
            settings=str(self.fixture.settings),
            owner=str(self.fixture.owner),
            config=str(self.fixture.config),
        )
        with mock.patch.dict(os.environ, {"MABELTV_USB_ROOT": str(self.usb_root)}):
            library = mabeltv_library.Library(args)
        library.admin_action = lambda action: "ok"
        library.refresh_tv = mock.Mock(return_value=True)
        self.fixture.library = library
        return library

    def wait_for_batch(self, batch_id: str) -> dict:
        result = self.fixture.library.usb_import_status(batch_id)
        deadline = time.time() + 5
        while result["status"] not in {"complete", "error"} and time.time() < deadline:
            time.sleep(0.02)
            result = self.fixture.library.usb_import_status(batch_id)
        return result

    def test_plan_resolves_folders_space_and_safe_duplicate_names(self) -> None:
        folder = self.volume / "New films"
        folder.mkdir()
        (folder / "Ocean Movie.MP4").write_bytes(b"ocean")
        self.fixture.library.adult_root.mkdir(parents=True, exist_ok=True)
        (self.fixture.library.adult_root / "Ocean Movie.mp4").write_bytes(b"existing")

        plan = self.fixture.library.usb_import_plan({
            "volume": "TEST-USB", "paths": ["New films"], "target": "adult",
        })

        self.assertEqual(plan["files_total"], 1)
        self.assertEqual(plan["bytes_total"], len(b"ocean"))
        self.assertEqual(
            plan["destination_label"],
            "Adult TV films · All films (no collection)")
        self.assertTrue(plan["enough_space"])
        self.assertEqual(plan["renames"], [{
            "from": "Ocean Movie.MP4", "to": "Ocean Movie (2).mp4",
        }])

    def test_adult_film_plan_uses_an_existing_collection(self) -> None:
        self.stop_usb_worker()
        (self.volume / "Collection Film.mp4").write_bytes(b"collection-video")
        collection = self.fixture.library.adult_root / "Science Fiction"
        collection.mkdir(parents=True)

        plan = self.fixture.library.usb_import_plan({
            "volume": "TEST-USB", "paths": ["Collection Film.mp4"],
            "target": "adult", "folder": "Science Fiction",
        })
        batch = self.fixture.library.start_usb_import({
            "volume": "TEST-USB", "paths": ["Collection Film.mp4"],
            "target": "adult", "folder": "Science Fiction",
        })
        job = next(value for value in self.fixture.library.upload_jobs()
                   if value.get("batch_id") == batch["id"])
        manifest = self.fixture.library.read_json(
            self.fixture.library.incoming / f"{job['id']}.json", {})

        self.assertEqual(plan["folder"], "Science Fiction")
        self.assertEqual(
            plan["destination_label"],
            "Adult TV films · Science Fiction collection")
        self.assertEqual(manifest["folder"], "Science Fiction")
        self.assertEqual(job["channel_name"], "Adult TV · Science Fiction")

    def test_series_plan_requires_an_existing_show_and_numbered_series(self) -> None:
        self.stop_usb_worker()
        (self.volume / "Silicon.Valley.S07E01.mp4").write_bytes(b"episode")
        series_id = self.fixture.library.create_adult_series("Silicon Valley")
        self.fixture.library.create_adult_season(series_id, 7)

        series = self.fixture.library.adult_series_library()[0]
        plan = self.fixture.library.usb_import_plan({
            "volume": "TEST-USB", "paths": ["Silicon.Valley.S07E01.mp4"],
            "target": "series", "series": series_id, "season": 7,
        })
        batch = self.fixture.library.start_usb_import({
            "volume": "TEST-USB", "paths": ["Silicon.Valley.S07E01.mp4"],
            "target": "series", "series": series_id, "season": 7,
        })
        job = next(value for value in self.fixture.library.upload_jobs()
                   if value.get("batch_id") == batch["id"])
        manifest = self.fixture.library.read_json(
            self.fixture.library.incoming / f"{job['id']}.json", {})

        self.assertEqual(series["seasons"], [7])
        self.assertEqual(series["season_count"], 1)
        self.assertEqual(plan["series"], series_id)
        self.assertEqual(plan["season"], 7)
        self.assertEqual(
            plan["destination_label"],
            "Adult TV series · Silicon Valley · Series 7")
        self.assertEqual(manifest["series_id"], series_id)
        self.assertEqual(manifest["season"], 7)
        with self.assertRaisesRegex(ValueError, "existing series"):
            self.fixture.library.usb_import_plan({
                "volume": "TEST-USB", "paths": ["Silicon.Valley.S07E01.mp4"],
                "target": "series", "series": series_id, "season": 6,
            })

    def test_empty_series_destination_is_created_and_removed_in_adult_tv(self) -> None:
        series_id = self.fixture.library.create_adult_series("Silicon Valley")
        self.fixture.library.manage({
            "action": "create-adult-season", "series": series_id, "season": 7,
        })

        self.assertEqual(
            self.fixture.library.adult_series_library()[0]["seasons"], [7])
        self.fixture.library.refresh_tv.assert_not_called()
        removed = self.fixture.library.trash_adult_series_items({
            "series": series_id, "scope": "season", "season": 7,
        })
        self.assertEqual(removed, 0)
        self.assertEqual(
            self.fixture.library.adult_series_library()[0]["seasons"], [])

    def test_usb_jobs_share_the_durable_activity_transfer_queue(self) -> None:
        self.stop_usb_worker()
        (self.volume / "USB Film.mp4").write_bytes(b"usb-video")
        browser = self.fixture.library.adult_upload_create({
            "file_name": "Browser Film.mp4", "size": 20,
        })
        batch = self.fixture.library.start_usb_import({
            "volume": "TEST-USB", "paths": ["USB Film.mp4"], "target": "adult",
        })

        activity = self.fixture.library.activity_status()
        usb_job = next(job for job in activity["uploads"]
                       if job.get("batch_id") == batch["id"])
        self.assertEqual(usb_job["source_kind"], "usb")
        self.assertEqual(usb_job["source_label"], "TEST-USB")
        self.assertEqual(usb_job["transfer_state"], "waiting")

        self.fixture.library.upload_action(usb_job["id"], "start")
        states = {job["id"]: job for job in self.fixture.library.upload_jobs()}
        self.assertEqual(states[usb_job["id"]]["transfer_state"], "active")
        self.assertEqual(states[browser["id"]]["status"], "paused")

    def test_partial_usb_copy_survives_restart_and_resumes(self) -> None:
        self.stop_usb_worker()
        content = b"durable-usb-video" * 1000
        (self.volume / "Restart Film.mp4").write_bytes(content)
        batch = self.fixture.library.start_usb_import({
            "volume": "TEST-USB", "paths": ["Restart Film.mp4"], "target": "adult",
        })
        upload_id = self.fixture.library.read_json(
            self.fixture.library.usb_import_root / f"{batch['id']}.json", {})["upload_ids"][0]
        self.fixture.library.append_upload(upload_id, 0, content[:1024])
        self.fixture.library.upload_action(upload_id, "pause")

        library = self.restart_library()
        saved = library.upload_status(upload_id)
        self.assertEqual(saved["offset"], 1024)
        self.assertEqual(saved["status"], "paused")
        self.assertEqual(saved["source_kind"], "usb")

        library.video_info = mock.Mock(return_value={
            "codec_type": "video", "width": 1280, "height": 720,
            "avg_frame_rate": "25/1",
        })
        library.upload_action(upload_id, "resume")
        result = self.wait_for_batch(batch["id"])
        self.assertEqual(result["status"], "complete")
        self.assertEqual((library.adult_root / "Restart Film.mp4").read_bytes(), content)

    def test_cancel_removes_partial_copy_but_keeps_usb_original(self) -> None:
        self.stop_usb_worker()
        content = b"keep-the-original" * 100
        source = self.volume / "Cancel Film.mp4"
        source.write_bytes(content)
        batch = self.fixture.library.start_usb_import({
            "volume": "TEST-USB", "paths": [source.name], "target": "adult",
        })
        upload_id = self.fixture.library.read_json(
            self.fixture.library.usb_import_root / f"{batch['id']}.json", {})["upload_ids"][0]
        self.fixture.library.append_upload(upload_id, 0, content[:100])

        self.fixture.library.upload_action(upload_id, "cancel")

        self.assertEqual(source.read_bytes(), content)
        self.assertFalse((self.fixture.library.incoming / f"{upload_id}.part").exists())
        self.assertFalse((self.fixture.library.incoming / f"{upload_id}.json").exists())
        self.assertFalse(any(job["id"] == upload_id
                             for job in self.fixture.library.activity_status()["uploads"]))
        self.assertEqual(self.fixture.library.usb_import_status(batch["id"])["status"], "error")


if __name__ == "__main__":
    unittest.main()
