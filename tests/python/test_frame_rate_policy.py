from tests.python.library_test_support import *
from mabeltv_backend.compression import compression_estimate, output_frame_rate


class FrameRatePolicyTests(unittest.TestCase):
    def test_estimates_preserve_source_frames_and_account_for_interlaced_fields(self):
        facts = {"width": 1920, "height": 1080, "duration": 7200, "hasAudio": True}
        estimate = lambda fps: compression_estimate(3_500_000_000, "compact", {**facts, "fps": fps})
        self.assertGreater(estimate(50)["estimatedBytes"], estimate(30)["estimatedBytes"])
        self.assertFalse(estimate(30)["risky"])
        self.assertTrue(estimate(50)["risky"])
        self.assertEqual(compression_estimate(3_500_000_000, "compact", {**facts, "fps": 25, "interlaced": True}), estimate(50))
        with self.assertRaises(ValueError):
            output_frame_rate({"fps": 120})

    def test_prepared_high_frame_rate_uploads_publish_without_laptop_reprocessing(self):
        fixture = LibraryFixture()
        self.addCleanup(fixture.close)
        library = fixture.library
        library.complete_setup({"setup_code": "135790", "pin": "2468", "channels": mabeltv_library.DEFAULT_CHANNELS})
        library.refresh_tv = lambda: True
        library.studio_prepare_upload = mock.Mock(side_effect=AssertionError("Prepared video must not loop back to Studio"))
        for target, width, height, fps, level in [("mabel", 1280, 720, 50, 41), ("film", 1920, 1080, 50, 42), ("film", 1920, 1080, 60, 42)]:
            library.video_info = lambda _, w=width, h=height, f=fps, l=level: {"codec_name": "h264", "pix_fmt": "yuv420p", "width": w, "height": h, "avg_frame_rate": f"{f}/1", "level": l, "field_order": "progressive", "audio_streams": [{"codec_name": "aac", "channels": 2}]}
            payload = {"file_name": f"cadence-{target}-{fps}.mp4", "size": 5}
            created = library.upload_create({**payload, "channel": 1}) if target == "mabel" else library.my_tv_upload_create(payload)
            library.append_upload(created["id"], 0, b"video")
            library.conversion_queue.join()
            self.assertTrue(library.upload_status(created["id"])["complete"])
        library.studio_prepare_upload.assert_not_called()

    def test_existing_pi_optimisation_accepts_a_50fps_laptop_return(self):
        fixture = LibraryFixture()
        self.addCleanup(fixture.close)
        library = fixture.library
        source = library.my_tv_root / "Motion.mp4"
        source.write_bytes(b"original" * 1000)
        library.request_my_tv_optimisation(source.name)
        job = library.studio_worker_poll({"id": "a" * 32, "capabilities": ["intel-policy-v2", "compression-presets"]})["job"]
        returned = library.studio_pi_return({"job": job["id"], "claim": job["claim"], "size": 1000, "source_id": "a" * 32})
        upload = returned["id"]
        (library.incoming / (upload + ".part")).write_bytes(b"p" * 1000)
        stream = {"codec_name": "h264", "pix_fmt": "yuv420p", "width": 1920, "height": 1080, "avg_frame_rate": "50/1", "level": 42}
        library.video_info = lambda _: {**stream, "avg_frame_rate": "120/1"}
        with self.assertRaisesRegex(ValueError, "compatible"):
            library.studio_pi_publish_replacement(upload, library.upload_meta(upload))
        self.assertEqual(source.read_bytes(), b"original" * 1000)
        library.video_info = lambda _: stream
        self.assertTrue(library.studio_pi_publish_replacement(upload, library.upload_meta(upload))["complete"])
        self.assertEqual(source.read_bytes(), b"p" * 1000)
