from __future__ import annotations

import os
import sys
import tempfile
import threading
import unittest
from email.message import Message
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts" / "pi"))

from mabeltv_backend import artwork  # noqa: E402


class Response:
    def __init__(self, content: bytes, content_type: str = "image/jpeg") -> None:
        self.content = content
        self.headers = Message()
        self.headers["Content-Type"] = content_type

    def __enter__(self) -> "Response":
        return self

    def __exit__(self, *_: object) -> None:
        pass

    def read(self, limit: int) -> bytes:
        return self.content[:limit]


class Library(artwork.ArtworkProxyMixin):
    def __init__(self, root: Path) -> None:
        self.tmdb_artwork_cache_root = root
        self.tmdb_artwork_prune_lock = threading.Lock()
        self.tmdb_artwork_last_prune = 0.0


class ArtworkProxyTests(unittest.TestCase):
    def test_fetches_once_then_reuses_the_atomic_disk_cache(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            library = Library(Path(temporary))
            with mock.patch.object(
                    artwork, "urlopen", return_value=Response(b"poster-bytes")) as fetch:
                first = library.tmdb_artwork("w342", "poster-12.jpg")
                second = library.tmdb_artwork("w342", "poster-12.jpg")

            self.assertEqual(first, second)
            self.assertEqual(first.read_bytes(), b"poster-bytes")
            self.assertEqual(fetch.call_count, 1)
            self.assertFalse(list(Path(temporary).rglob("*.tmp")))

    def test_rejects_traversal_unknown_sizes_and_non_images(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            library = Library(Path(temporary))
            for size, name in (("small", "poster.jpg"), ("w342", "../owner.json"),
                               ("w342", "poster.svg")):
                with self.subTest(size=size, name=name):
                    with self.assertRaisesRegex(ValueError, "Invalid TMDB artwork path"):
                        library.tmdb_artwork(size, name)
            with mock.patch.object(
                    artwork, "urlopen", return_value=Response(b"not-an-image", "text/html")):
                with self.assertRaisesRegex(ValueError, "invalid artwork response"):
                    library.tmdb_artwork("w500", "poster.jpg")

    def test_pruning_removes_oldest_files_when_the_limit_is_reached(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            library = Library(Path(temporary))
            folder = Path(temporary) / "w185"
            folder.mkdir()
            oldest = folder / "old.jpg"
            newest = folder / "new.jpg"
            oldest.write_bytes(b"old")
            newest.write_bytes(b"new")
            os.utime(oldest, (1, 1))
            os.utime(newest, (2, 2))
            with mock.patch.object(artwork, "TMDB_ARTWORK_CACHE_MAX_FILES", 1):
                library.prune_tmdb_artwork_cache(force=True)
            self.assertFalse(oldest.exists())
            self.assertTrue(newest.exists())


if __name__ == "__main__":
    unittest.main()
