from __future__ import annotations

from tests.python.library_test_support import *


class MabelQueueTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()
        self.fixture.library.write_state("channels", {
            "schema_version": 1,
            "channels": [{"number": 7, "name": "Films", "folder": "films",
                          "aspect": "fit", "content_type": "films"}],
        })
        folder = self.fixture.media / "films"
        folder.mkdir(parents=True)
        (folder / "First.mp4").write_bytes(b"first")
        (folder / "Second.mp4").write_bytes(b"second")

    def tearDown(self) -> None:
        self.fixture.close()

    def test_add_reorder_remove_and_ending_are_persistent(self) -> None:
        library = self.fixture.library
        first = library.mabel_queue_action({"action": "add", "channel": 7,
                                            "file": "First.mp4"})
        self.assertEqual([item["title"] for item in first["items"]], ["First"])
        second = library.mabel_queue_action({"action": "add", "channel": 7,
                                             "file": "Second.mp4"})
        moved = library.mabel_queue_action({"action": "up",
                                             "id": second["items"][1]["id"]})
        self.assertEqual([item["title"] for item in moved["items"]],
                         ["Second", "First"])
        library.mabel_queue_action({"action": "ending", "ending": "keep_playing"})
        library.mabel_queue_action({"action": "remove",
                                    "id": first["items"][0]["id"]})
        self.assertEqual([item["title"] for item in library.mabel_queue()["items"]],
                         ["Second"])
        self.assertEqual(library.mabel_queue()["ending"], "keep_playing")

    def test_rejects_missing_or_disabled_programmes(self) -> None:
        library = self.fixture.library
        with self.assertRaisesRegex(ValueError, "not available"):
            library.mabel_queue_action({"action": "add", "channel": 7,
                                        "file": "Missing.mp4"})
        library.merge_state_fields("settings", {
            "library": {"disabled_programmes": {"7": ["First.mp4"]}}})
        with self.assertRaisesRegex(ValueError, "not available"):
            library.mabel_queue_action({"action": "add", "channel": 7,
                                        "file": "First.mp4"})
        self.assertEqual(library.mabel_queue()["items"], [])


if __name__ == "__main__":
    unittest.main()
