from __future__ import annotations

from tests.python.library_test_support import *


class UploadManagementTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def test_recycle_move_has_durable_intent_and_rolls_back_move_failure(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.refresh_tv = lambda: True
        programme = self.fixture.media / "kids-tv" / "only-copy.mp4"
        programme.write_bytes(b"video")

        def interrupted_move(source: str, destination: str) -> None:
            recycle_directory = Path(destination).parent
            self.assertTrue((recycle_directory / "manifest.json").is_file())
            raise OSError("simulated move failure")

        with mock.patch.object(mabeltv_library.shutil, "move",
                               side_effect=interrupted_move):
            with self.assertRaisesRegex(OSError, "simulated move failure"):
                self.fixture.library.manage({
                    "action": "trash", "channel": 1, "file": programme.name,
                })
        self.assertTrue(programme.is_file())
        self.assertEqual(self.fixture.library.recycle_items(), [])

        self.fixture.library.manage({
            "action": "trash", "channel": 1, "file": programme.name,
        })
        self.assertFalse(programme.exists())
        self.assertEqual(len(self.fixture.library.recycle_items()), 1)

    def test_unreadable_upload_reports_error_and_can_restart_cleanly(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.video_info = mock.Mock(
            side_effect=ValueError("Mabel TV could not find a video stream in that file"))
        created = self.fixture.library.upload_create({
            "channel": 1, "file_name": "broken.mov", "size": 5,
        })
        received = self.fixture.library.append_upload(created["id"], 0, b"nope!")
        self.assertEqual(received["status"], "validating")
        self.fixture.library.conversion_queue.join()
        state = self.fixture.library.upload_status(created["id"])
        self.assertEqual(state["status"], "error")
        self.assertFalse(state["complete"])
        self.assertFalse((self.fixture.media / ".incoming" /
                          f"{created['id']}.part").exists())
        restarted = self.fixture.library.upload_create({
            "channel": 1, "file_name": "broken.mov", "size": 5,
        })
        self.assertNotEqual(restarted["id"], created["id"])
        self.assertEqual(restarted["offset"], 0)
        self.assertFalse(any(job["id"] == created["id"]
                             for job in self.fixture.library.upload_jobs()))

        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 640, "height": 480,
            "avg_frame_rate": "25/1",
        }
        self.fixture.library.refresh_tv = lambda: True
        self.fixture.library.append_upload(restarted["id"], 0, b"valid")
        self.fixture.library.conversion_queue.join()
        self.assertTrue(self.fixture.library.upload_status(restarted["id"])["complete"])
        self.assertEqual(self.fixture.library.upload_jobs(), [])

    def test_resume_reserves_only_remaining_source_space(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        gib = 1024 ** 3
        with mock.patch.object(mabeltv_library.shutil, "disk_usage",
                               return_value=types.SimpleNamespace(free=3 * gib)):
            created = self.fixture.library.upload_create({
                "channel": 1, "file_name": "large.mov", "size": gib,
            })
        part = self.fixture.media / ".incoming" / f"{created['id']}.part"
        part.touch()
        with part.open("r+b") as stream:
            stream.truncate(gib // 4)
        with mock.patch.object(mabeltv_library.shutil, "disk_usage",
                               return_value=types.SimpleNamespace(free=int(2.3 * gib))):
            resumed = self.fixture.library.upload_create({
                "channel": 1, "file_name": "large.mov", "size": gib,
            })
        self.assertEqual(resumed["id"], created["id"])
        self.assertEqual(resumed["offset"], gib // 4)

    def test_upload_reservation_actions_and_channel_guards(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        created = self.fixture.library.upload_create({
            "channel": 1, "file_name": "waiting.mov", "size": 10,
        })
        waiting = next(job for job in self.fixture.library.upload_jobs()
                       if job["id"] == created["id"])
        self.assertEqual(waiting["offset"], 0)
        self.fixture.library.append_upload(created["id"], 0, b"12345")
        with self.assertRaisesRegex(ValueError, "already uploading"):
            self.fixture.library.upload_create({
                "channel": 1, "file_name": "waiting.mov", "size": 11,
            })
        with self.assertRaisesRegex(ValueError, "Finish or cancel"):
            self.fixture.library.manage({
                "action": "update-channel", "original_number": 1,
                "number": 9, "name": "Kids TV", "aspect": "crop",
            })
        with self.assertRaisesRegex(ValueError, "Finish or cancel"):
            self.fixture.library.manage({"action": "delete-channel", "channel": 1})
        cancelled = self.fixture.library.upload_action(created["id"], "cancel")
        self.assertIn("space was freed", cancelled["message"])
        self.assertEqual(self.fixture.library.upload_jobs(), [])

        deferred = self.fixture.library.upload_create({
            "channel": 1, "file_name": "deferred.mp4", "size": 5,
        })
        incoming = self.fixture.media / ".incoming"
        (incoming / f"{deferred['id']}.part").write_bytes(b"ready")
        deferred_meta = self.fixture.library.upload_meta(deferred["id"])
        deferred_meta.update({"status": "error", "conversion_required": False})
        self.fixture.library.write_json(
            incoming / f"{deferred['id']}.json", deferred_meta)
        # Model the narrow interval after an old worker persisted its error but
        # before it removed the job from the dedupe set.
        self.fixture.library.queued_conversions.add(deferred["id"])
        self.fixture.library.upload_action(deferred["id"], "retry")
        self.assertIn(deferred["id"], self.fixture.library.deferred_retries)
        self.fixture.library.finish_conversion_job(deferred["id"])
        self.fixture.library.conversion_queue.join()
        self.assertTrue(self.fixture.library.upload_status(deferred["id"])["complete"])

    def test_upload_queue_has_one_transfer_slot_and_can_promote_a_waiting_file(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        source = "a" * 32
        first = self.fixture.library.upload_create({
            "channel": 1, "file_name": "first.mp4", "size": 4, "source_id": source,
        })
        second = self.fixture.library.upload_create({
            "channel": 1, "file_name": "second.mp4", "size": 4, "source_id": source,
        })
        jobs = self.fixture.library.upload_jobs()
        self.assertEqual([job["id"] for job in jobs], [first["id"], second["id"]])
        self.assertEqual([job["transfer_state"] for job in jobs], ["active", "waiting"])
        with self.assertRaisesRegex(ValueError, "waiting in the queue"):
            self.fixture.library.append_upload(second["id"], 0, b"next")
        self.fixture.library.upload_action(second["id"], "start")
        self.assertEqual(self.fixture.library.upload_status(first["id"])["status"], "paused")
        self.assertEqual(self.fixture.library.upload_status(first["id"])["transfer_state"], "paused")
        self.assertEqual(self.fixture.library.upload_status(second["id"])["transfer_state"], "active")
        self.fixture.library.append_upload(second["id"], 0, b"next")

    def test_reselecting_source_files_reconnects_and_resumes_the_queue(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        old_source = "a" * 32
        new_source = "b" * 32
        first = self.fixture.library.upload_create({
            "channel": 1, "file_name": "first.mp4", "size": 8,
            "source_id": old_source,
        })
        second = self.fixture.library.upload_create({
            "channel": 1, "file_name": "second.mp4", "size": 8,
            "source_id": old_source,
        })
        self.fixture.library.append_upload(first["id"], 0, b"1234")
        self.fixture.library.upload_action(second["id"], "start")

        reconnected_first = self.fixture.library.upload_create({
            "channel": 1, "file_name": "first.mp4", "size": 8,
            "source_id": new_source,
        })
        reconnected_second = self.fixture.library.upload_create({
            "channel": 1, "file_name": "second.mp4", "size": 8,
            "source_id": new_source,
        })

        self.assertEqual(reconnected_first["id"], first["id"])
        self.assertEqual(reconnected_first["offset"], 4)
        self.assertEqual(reconnected_first["transfer_state"], "waiting")
        self.assertEqual(reconnected_second["id"], second["id"])
        self.assertEqual(reconnected_second["transfer_state"], "active")
        jobs = {job["id"]: job for job in self.fixture.library.upload_jobs()}
        self.assertEqual(jobs[first["id"]]["status"], "uploading")
        self.assertEqual(jobs[first["id"]]["source_available"], True)
        self.assertEqual(jobs[second["id"]]["source_available"], True)
        self.assertEqual(
            self.fixture.library.upload_meta(first["id"])["source_id"], new_source)

    def test_refresh_failure_is_visible_and_directly_retryable(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.video_info = lambda path: {
            "codec_type": "video", "width": 640, "height": 480,
            "avg_frame_rate": "25/1",
        }
        self.fixture.library.refresh_tv = lambda: False
        created = self.fixture.library.upload_create({
            "channel": 1, "file_name": "refresh.mp4", "size": 5,
        })
        self.fixture.library.append_upload(created["id"], 0, b"video")
        self.fixture.library.conversion_queue.join()
        state = self.fixture.library.upload_status(created["id"])
        self.assertTrue(state["complete"])
        self.assertEqual(state["status"], "refresh-error")
        job = next(job for job in self.fixture.library.upload_jobs()
                   if job["id"] == created["id"])
        self.assertTrue(job["refreshable"])

        self.fixture.library.refresh_tv = lambda: True
        self.fixture.library.upload_action(created["id"], "refresh")
        self.assertEqual(self.fixture.library.upload_status(created["id"])["status"],
                         "complete")
        self.assertEqual(self.fixture.library.upload_jobs(), [])

    def test_lost_final_response_reports_publish_states_as_processing(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        created = self.fixture.library.upload_create({
            "channel": 1, "file_name": "publishing.mp4", "size": 5,
        })
        manifest = self.fixture.media / ".incoming" / f"{created['id']}.json"
        metadata = self.fixture.library.read_json(manifest, {})
        metadata["status"] = "publishing"
        self.fixture.library.write_json(manifest, metadata)
        state = self.fixture.library.upload_status(created["id"])
        self.assertTrue(state["processing"])
        self.assertEqual(state["offset"], 5)

    def test_manage_reports_when_change_saved_but_refresh_failed(self) -> None:
        self.fixture.library.complete_setup({
            "setup_code": "135790", "pin": "2468",
            "channels": mabeltv_library.DEFAULT_CHANNELS,
        })
        self.fixture.library.refresh_tv = lambda: False
        refreshed = self.fixture.library.manage({"action": "toggle-channel", "channel": 1})
        self.assertFalse(refreshed)
        self.assertIn(1, self.fixture.library.settings()["library"]["disabled_channels"])


if __name__ == "__main__":
    unittest.main()
