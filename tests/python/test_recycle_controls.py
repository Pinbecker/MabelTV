"""Bin snapshots can be removed without refreshing or touching active media."""
from tests.python.library_test_support import *


class RecycleControlTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.library.refresh_tv = mock.Mock()

    def tearDown(self):
        self.fixture.close()

    def add(self, identity="12345678-abcdef01"):
        directory = self.library.bin / identity
        directory.mkdir()
        (directory / "Film.mp4").write_bytes(b"deleted video")
        self.library.write_json(directory / "manifest.json", {"id":identity, "file_name":"Film.mp4", "folder":".my-tv", "channel_name":"My TV"})
        return directory

    def test_empty_only_confirmed_snapshot_preserves_new_bin_entries_and_playing_files(self):
        first = self.add()
        snapshot = self.library.recycle_items()
        self.assertGreater(snapshot[0]["bytes"], 0)
        second = self.add("12345679-abcdef02")
        playing = self.library.my_tv_root / "The Grinch.mp4"
        playing.write_bytes(b"playing file")
        self.library.manage({"action":"empty-bin", "confirmed":True, "items":snapshot})
        self.assertFalse(first.exists())
        self.assertTrue(second.exists())
        self.assertEqual(playing.read_bytes(), b"playing file")
        self.library.refresh_tv.assert_not_called()

    def test_changed_or_unconfirmed_snapshot_deletes_nothing(self):
        first = self.add()
        snapshot = self.library.recycle_items()
        with self.assertRaisesRegex(ValueError, "Confirm"):
            self.library.manage({"action":"empty-bin", "items":snapshot})
        (first / "Film.mp4").write_bytes(b"changed video")
        with self.assertRaisesRegex(ValueError, "changed"):
            self.library.manage({"action":"empty-bin", "confirmed":True, "items":snapshot})
        self.assertTrue(first.exists())
        self.library.refresh_tv.assert_not_called()

    def test_single_bin_deletion_does_not_refresh_the_tv(self):
        first = self.add()
        self.library.manage({"action":"delete", "id":first.name})
        self.assertFalse(first.exists())
        self.library.refresh_tv.assert_not_called()
