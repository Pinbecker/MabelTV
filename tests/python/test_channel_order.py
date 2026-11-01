from __future__ import annotations

from tests.python.library_test_support import *


class ChannelOrderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.database = self.library.state_database
        self.library.refresh_tv = lambda: True
        self.library.write_state("channels", {"channels": [
            {"number": number, "name": name, "folder": name.lower(),
             "aspect": "crop", "content_type": "shows"}
            for number, name in [(1, "Alpha"), (3, "Bravo"), (8, "Charlie")]
        ]})

    def tearDown(self) -> None:
        self.fixture.close()

    def order(self, folders=("charlie", "alpha", "bravo")) -> list[dict]:
        current = {item["folder"]: item["number"] for item in self.library.channels()}
        return [{"folder": folder, "number": current[folder]} for folder in folders]

    def test_reorder_preserves_owned_state_and_stable_identities(self) -> None:
        self.database.write("channel_metadata", {
            "channels": {str(n): {"title": name} for n, name in [(1, "Alpha"), (3, "Bravo"), (8, "Charlie")]},
            "programmes": {"1/Episode.mp4": {"title": "Alpha episode"}, "8/Episode.mp4": {"title": "Charlie episode"}},
            "favourite_channels": [1, 8], "favourites": ["1/Episode.mp4", "8/Episode.mp4"],
        })
        self.database.merge_fields("settings", {"library": {
            "disabled_channels": [8], "disabled_programmes": {"1": ["Episode.mp4"], "8": ["Other.mp4"]},
        }})
        self.database.write("player", {"schema_version": 4,
            "channel_film_positions": {"1/Episode.mp4": 11, "8/Episode.mp4": 88}})
        item = self.database.ensure_viewing_items([{
            "channel_number": 1, "kind": "channel", "title": "Alpha", "source": "Alpha",
        }])[0]
        self.database.save_viewing_session({"id": "history", "item_key": item["item_key"],
            "viewing_item_id": item["item_id"], "title": "Alpha", "channel_number": 1,
            "channel_name": "Alpha", "kind": "channel", "surface": "tv", "started": 100,
            "ended": 280, "seconds": 180}, cutoff=0, maximum=50_000)
        with self.database.transaction() as db:
            ids = {row["folder"]: row["id"] for row in db.execute("SELECT * FROM channels")}
            db.execute("INSERT INTO channel_timelines VALUES(1,0,'Episode.mp4',12)")
            db.execute("INSERT INTO mabel_queue_entries VALUES('queued',0,1,'Episode.mp4','Episode','','Alpha')")
        self.library.manage({"action": "reorder-channels", "channels": self.order()})
        self.assertEqual([(c["number"], c["folder"]) for c in self.library.channels()],
                         [(1, "charlie"), (2, "alpha"), (3, "bravo")])
        metadata = self.database.read("channel_metadata")
        self.assertEqual(metadata["channels"], {"1": {"title": "Charlie"}, "2": {"title": "Alpha"}, "3": {"title": "Bravo"}})
        self.assertEqual(metadata["favourite_channels"], [1, 2])
        self.assertEqual(set(metadata["favourites"]), {"1/Episode.mp4", "2/Episode.mp4"})
        self.assertEqual(metadata["programmes"]["2/Episode.mp4"]["title"], "Alpha episode")
        self.assertEqual(self.database.read("settings")["library"], {
            "disabled_channels": [1], "disabled_programmes": {"2": ["Episode.mp4"], "1": ["Other.mp4"]}})
        self.assertEqual(self.database.read("player")["channel_film_positions"],
                         {"2/Episode.mp4": 11, "1/Episode.mp4": 88})
        self.assertEqual(self.database.viewing_item(item["item_id"])["current_key"], "channel:2")
        self.assertEqual(self.database.viewing_sessions(item_id=item["item_id"])[0]["channel_number"], 2)
        with self.database.transaction() as db:
            self.assertEqual(ids, {row["folder"]: row["id"] for row in db.execute("SELECT * FROM channels")})
            self.assertEqual(db.execute("SELECT channel_number FROM channel_timelines").fetchone()[0], 2)
            self.assertEqual(db.execute("SELECT channel_number FROM mabel_queue_entries").fetchone()[0], 2)
        self.assertEqual([], self.database.integrity_report()["foreign_key_errors"])

    def test_failure_mid_reorder_rolls_back_the_entire_transaction_and_revisions(self) -> None:
        before = self.library.channels()
        revisions = self.database.revisions()
        original = self.database._move_ordered_channel
        calls = []
        def fail_second(*args):
            calls.append(1)
            if len(calls) == 2:
                raise ValueError("Injected failure")
            return original(*args)
        with mock.patch.object(self.database, "_move_ordered_channel", side_effect=fail_second):
            with self.assertRaisesRegex(ValueError, "Injected"):
                self.library.manage({"action": "reorder-channels", "channels": self.order()})
        self.assertEqual(before, self.library.channels())
        self.assertEqual(revisions, self.database.revisions())

    def test_stale_incomplete_duplicate_or_malformed_orders_never_mutate(self) -> None:
        before = self.library.channels()
        for order in [None, [], self.order()[:-1], self.order() + self.order()[:1],
                      [{"folder": "alpha", "number": 99}, *self.order()[1:]],
                      [{"folder": [], "number": 1}]]:
            with self.subTest(order=order), self.assertRaises(ValueError):
                self.library.manage({"action": "reorder-channels", "channels": order})
            self.assertEqual(before, self.library.channels())

    def test_uploading_channels_block_renumbering(self) -> None:
        before = self.library.channels()
        with mock.patch.object(self.library, "upload_jobs", return_value=[{"channel": 8, "status": "receiving"}]):
            with self.assertRaisesRegex(ValueError, "uploads"):
                self.library.manage({"action": "reorder-channels", "channels": self.order()})
            with self.assertRaisesRegex(ValueError, "uploads"):
                self.library.manage({"action": "add-channel", "name": "Delta", "folder": "delta"})
        self.assertEqual(before, self.library.channels())

    def test_creation_appends_consecutively_and_bad_creation_rolls_back(self) -> None:
        before = self.library.channels()
        with self.assertRaisesRegex(ValueError, "folder"):
            self.library.manage({"action": "add-channel", "name": "Duplicate", "folder": "alpha"})
        self.assertEqual(before, self.library.channels())
        self.library.manage({"action": "add-channel", "name": "Delta", "folder": "delta"})
        self.assertEqual([(c["number"], c["name"]) for c in self.library.channels()],
                         [(1, "Alpha"), (2, "Bravo"), (3, "Charlie"), (4, "Delta")])
        self.assertTrue((self.fixture.media / "delta").is_dir())


if __name__ == "__main__":
    unittest.main()
