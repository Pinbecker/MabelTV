"""A legacy import cannot silently restore CPU encoding on the Pi."""
from tests.python.library_test_support import *
from mabeltv_backend import size_encoding


class SizeEncodingTests(unittest.TestCase):
    def test_retired_encoder_keeps_source_and_does_not_run_a_media_tool(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.mkv"
            output = Path(directory) / "output.mp4"
            source.write_bytes(b"original")
            with mock.patch("subprocess.run", side_effect=AssertionError("Pi video encoding must not run")):
                for profile in ("balanced", "compact", "smallest"):
                    with self.assertRaisesRegex(ValueError, "Windows Studio laptop"):
                        size_encoding.encode_size_profile(None, source, output, profile, lambda *args: None)
            self.assertEqual(source.read_bytes(), b"original")
            self.assertFalse(output.exists())
