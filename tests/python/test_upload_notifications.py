from __future__ import annotations

import io
from tests.python.library_test_support import *


class UploadNotificationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.library.complete_setup({"setup_code": "135790", "pin": "2468",
                                     "channels": mabeltv_library.DEFAULT_CHANNELS})
        self.library.upload_notice_config = self.fixture.root / "ntfy.json"
        self.config = {"enabled": True, "server": "https://ntfy.sh",
                       "topic": "isolated-unit-test-topic", "enabled_after": time.time() - 1}
        self.library.upload_notice_config.write_text(json.dumps(self.config))
        self.library.refresh_tv = lambda: True
        self.library.video_info = lambda _: {"codec_type": "video", "codec_name": "h264", "pix_fmt": "yuv420p", "width": 640, "height": 480,
                                              "avg_frame_rate": "25/1"}
        self.requests = []
        def send(request, timeout):
            self.requests.append((request, timeout))
            return io.BytesIO(b'{"event":"message","id":"acknowledged"}')
        self.library._open_url = send

    def tearDown(self):
        self.fixture.close()

    def publish(self):
        created = self.library.upload_create({"channel": 1, "file_name": "Example film.mp4", "size": 5})
        self.library.append_upload(created["id"], 0, b"video")
        self.library.conversion_queue.join()
        return created["id"]

    def test_completed_publication_notifies_destination_without_studio_cloud_completion(self):
        upload_id = self.publish()
        self.library.poll_upload_notifications()
        self.assertEqual(len(self.requests), 1)
        request, timeout = self.requests[0]
        self.assertEqual(timeout, 8)
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("Title"), "Ready on your TV")
        self.assertIn(b"Example film", request.data)
        self.assertIn(b"Kids TV", request.data)
        self.assertIn(b"iCloud archiving continues separately", request.data)
        self.assertEqual(self.library.state_database.studio_upload_notice(upload_id)["status"], "sent")

    def test_success_receipt_survives_database_reopen_and_prevents_resend(self):
        upload_id = self.publish()
        self.library.poll_upload_notifications()
        database = mabeltv_library.StateDatabase(self.fixture.database)
        self.assertEqual(database.studio_upload_notice(upload_id)["message_id"], "acknowledged")
        self.library.poll_upload_notifications()
        self.assertEqual(len(self.requests), 1)

    def test_failure_retries_later_without_changing_publication(self):
        upload_id = self.publish()
        send = self.library._open_url
        self.library._open_url = mock.Mock(side_effect=OSError("offline"))
        self.library.poll_upload_notifications()
        receipt = self.library.state_database.studio_upload_notice(upload_id)
        self.assertEqual(receipt["status"], "retry")
        self.assertTrue(self.library.upload_status(upload_id)["complete"])
        self.library._open_url = send
        self.library.poll_upload_notifications()
        self.assertEqual(self.requests, [])
        self.library.state_database.studio_save_upload_notice(upload_id, {"status": "retry", "retry_after": 0})
        self.library.poll_upload_notifications()
        self.assertEqual(len(self.requests), 1)

    def test_incomplete_failed_refresh_and_missing_destination_do_not_notify(self):
        upload_id = self.publish()
        path = self.library.incoming / (upload_id + ".result.json")
        original = self.library.read_json(path, {})
        for fields in [{"complete": False}, {"status": "refresh-error"}, {"refreshed": False}]:
            self.library.write_json(path, {**original, **fields})
            self.library.poll_upload_notifications()
            self.assertEqual(self.requests, [])
        self.library.write_json(path, original)
        self.library.upload_destination(original).unlink()
        self.library.poll_upload_notifications()
        self.assertEqual(self.requests, [])

    def test_enabling_notifications_does_not_replay_upload_history(self):
        upload_id = self.publish()
        self.config["enabled_after"] = time.time() + 1
        self.library.upload_notice_config.write_text(json.dumps(self.config))
        self.library.poll_upload_notifications()
        self.assertEqual(self.requests, [])
        self.assertEqual(self.library.state_database.studio_upload_notice(upload_id), {})

    def test_my_tv_and_series_have_specific_destination_labels(self):
        self.assertEqual(self.library.upload_notice_label({"kind": "my_tv"}), "My TV films")
        self.library.my_tv_series_states = lambda: {"series": {"show": {"title": "Example show"}}}
        self.assertEqual(self.library.upload_notice_label(
            {"kind": "my-tv-series", "series_id": "show", "season": 2}), "My TV: Example show / Season 2")

    def test_invalid_or_disabled_private_endpoint_never_sends(self):
        self.publish()
        for fields in [{"enabled": False}, {"server": "http://example.test"}, {"topic": "short"},
                       {"enabled_after": 0}]:
            self.library.upload_notice_config.write_text(json.dumps({**self.config, **fields}))
            self.library.poll_upload_notifications()
            self.assertEqual(self.requests, [])

    def test_cloud_only_completion_notifies_once_without_intermediate_or_archive_alerts(self):
        job = {"id": "c" * 32, "title": "Iron Man", "status": "active", "updated": time.time(),
               "savedCloudPath": "Films/Iron Man.mp4", "destination": {"kind": "icloud", "optimiseCloud": True}}
        self.library.state_database.studio_add("job", job)
        self.library.poll_upload_notifications()
        self.assertEqual(self.requests, [])
        self.library.state_database.studio_add("job", {**job, "status": "complete"})
        self.library.state_database.studio_add("cloudop", {"id": "d" * 32, "status": "complete",
            "archiveJob": job["id"], "updated": time.time(), "created": time.time()})
        self.library.poll_upload_notifications()
        self.library.poll_upload_notifications()
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.requests[0][0].get_header("Title"), "iCloud optimisation complete")

    def test_native_optimisation_notifies_only_after_verified_publication_and_deduplicates(self):
        file = self.library.my_tv_root / "Example.mp4"
        file.write_bytes(b"verified-video")
        operation = "a" * 32
        self.library.set_my_tv_media_state("Example.mp4", "processing", compressionOperation=operation)
        self.library.poll_upload_notifications()
        self.assertEqual(self.requests, [])
        self.library.set_my_tv_media_state("Example.mp4", "optimised", compressionOperation=operation,
                                          compressionCompleted=time.time())
        self.library.poll_upload_notifications()
        self.library.poll_upload_notifications()
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.requests[0][0].get_header("Title"), "Optimisation complete")
