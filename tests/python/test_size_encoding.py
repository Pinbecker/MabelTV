"""Exercise size targets and publication safety using isolated real media."""
from tests.python.library_test_support import *
import shutil
import subprocess
from mabeltv_backend import size_encoding
from mabeltv_backend.compression import POLICY


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg required")
class SizeEncodingTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.addCleanup(self.fixture.close)
        self.library = self.fixture.library
        self.library.cpu_temperature_c = lambda: 30
        self.source = self.library.my_tv_root / "Original.mkv"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
                        "-f", "lavfi", "-i", "sine=frequency=440", "-t", "3", "-c:v", "ffv1", "-c:a", "pcm_s16le",
                        str(self.source)], check=True, capture_output=True)
        self.original = self.source.read_bytes()

    def test_profiles_are_playable_smaller_and_not_encoded_twice_during_upload(self):
        sizes = []
        for profile in POLICY["profiles"]:
            output = self.library.my_tv_root / (profile["id"] + ".mp4")
            progress = []
            self.assertTrue(size_encoding.encode_size_profile(self.library, self.source, output, profile["id"],
                lambda percent, _message: progress.append(percent)))
            info = size_encoding.probe(output)
            self.assertTrue(size_encoding.fast_start(output))
            self.assertEqual(info["streams"][0]["codec_name"], "h264")
            self.assertLessEqual(output.stat().st_size, len(self.original) * profile["sourceFraction"])
            sizes.append(output.stat().st_size)
            self.assertEqual(progress, sorted(progress))
            subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(output), "-f", "null", os.devnull],
                           check=True, capture_output=True)
            upload = self.library.incoming / (profile["id"] + ".part")
            shutil.copyfile(output, upload)
            published = self.library.my_tv_root / (profile["id"] + "-published.mp4")
            with mock.patch.object(size_encoding, "run_encoder", side_effect=AssertionError("encoded twice")):
                self.assertFalse(size_encoding.encode_size_profile(self.library, upload, published, profile["id"]))
            self.assertEqual(published.read_bytes(), output.read_bytes())
            self.assertFalse(upload.exists())
        self.assertGreater(sizes[0], sizes[1])
        self.assertGreater(sizes[1], sizes[2])
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_encoder_failure_keeps_original_and_removes_only_its_partial_files(self):
        destination = self.source.with_suffix(".mp4")
        unrelated = self.library.incoming / "other-job.part"
        unrelated.write_bytes(b"keep")
        def interrupted(_library, _source, command, *_args):
            if command[-1] != os.devnull:
                Path(command[-1]).write_bytes(b"unfinished")
            raise ValueError("interrupted")
        with mock.patch.object(size_encoding, "run_encoder", side_effect=interrupted):
            with self.assertRaisesRegex(ValueError, "interrupted"):
                size_encoding.encode_size_profile(self.library, self.source, destination, "compact")
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertFalse(destination.exists())
        self.assertEqual(list(self.library.incoming.glob("*.optimising.mp4")), [])
        self.assertEqual(unrelated.read_bytes(), b"keep")


class SelectedUploadProfileTests(unittest.TestCase):
    def test_upload_reconnect_keeps_the_profile_and_rejects_a_different_choice(self):
        fixture = LibraryFixture()
        self.addCleanup(fixture.close)
        library = fixture.library
        library.complete_setup({"setup_code": "135790", "pin": "2468", "channels": mabeltv_library.DEFAULT_CHANNELS})
        payload = {"channel": 1, "file_name": "Example.mkv", "size": 1000000, "compression": "smallest"}
        created = library.upload_create(payload)
        resumed = library.upload_create(payload)
        self.assertEqual(resumed["id"], created["id"])
        self.assertEqual(library.upload_meta(created["id"])["compression"], "smallest")
        with self.assertRaisesRegex(ValueError, "different compression"):
            library.upload_create({**payload, "compression": "balanced"})
        self.assertEqual(library.upload_meta(created["id"])["compression"], "smallest")
