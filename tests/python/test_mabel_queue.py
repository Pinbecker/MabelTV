from __future__ import annotations

from tests.python.library_test_support import *
from unittest.mock import patch


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

    def queued_pair(self):
        library = self.fixture.library
        for file in ("First.mp4", "Second.mp4"):
            library.mabel_queue_action({"action": "add", "channel": 7, "file": file})
        return library.state_database, library.mabel_queue()["items"]

    def test_current_entry_is_retained_and_protected_until_completion(self):
        db, items = self.queued_pair()
        current = items[0]["id"]
        selected = db.mabel_queue_select(current, "device:test")
        self.assertEqual(len(selected["items"]), 2)
        self.assertTrue(selected["items"][0]["starting"])
        with self.assertRaisesRegex(ValueError, "not started"):
            db.mabel_queue_event("finish", "device:test", current)
        playing = db.mabel_queue_event("started", "device:test", current)
        self.assertTrue(playing["items"][0]["playing"])
        for action in ("remove", "down"):
            with self.assertRaisesRegex(ValueError, "playback controls"):
                db.mabel_queue_change(action, {"id": current})
        with self.assertRaisesRegex(ValueError, "cannot move"):
            db.mabel_queue_change("up", {"id": items[1]["id"]})
        next_state = db.mabel_queue_event("finish", "device:test", current)
        self.assertEqual([item["id"] for item in next_state["items"]], [items[1]["id"]])
        self.assertEqual(next_state["current_id"], items[1]["id"])

    def test_selected_later_entry_moves_to_first_and_preserves_waiting_items(self):
        db, items = self.queued_pair()
        state = db.mabel_queue_select(items[1]["id"], "tv")
        self.assertEqual([item["id"] for item in state["items"]], [items[1]["id"], items[0]["id"]])

    def test_failed_start_preserves_item_and_stale_owner_cannot_finish_it(self):
        db, items = self.queued_pair()
        identity = items[0]["id"]
        db.mabel_queue_select(identity, "tv")
        failed = db.mabel_queue_event("failed", "tv", identity, error="Could not open media")
        self.assertEqual(len(failed["items"]), 2)
        self.assertTrue(failed["paused"])
        self.assertEqual(failed["error"], "Could not open media")
        db.mabel_queue_select(identity, "device:new")
        db.mabel_queue_event("started", "device:new", identity)
        with self.assertRaisesRegex(ValueError, "no longer owns"):
            db.mabel_queue_event("finish", "tv", identity)
        self.assertEqual(len(db.mabel_queue()["items"]), 2)

    def test_clear_keeps_current_playback_and_does_not_trigger_all_done(self):
        db, items = self.queued_pair()
        identity = items[0]["id"]
        db.mabel_queue_select(identity, "device:test")
        db.mabel_queue_event("started", "device:test", identity)
        cleared = db.mabel_queue_change("clear")
        self.assertEqual([item["id"] for item in cleared["items"]], [identity])
        self.assertTrue(cleared["active"])
        finished = db.mabel_queue_event("finish", "device:test", identity)
        self.assertFalse(finished["completed"])
        self.assertEqual(finished["items"], [])

    def test_automatic_playback_cannot_take_over_a_paused_or_other_player_queue(self):
        db, items = self.queued_pair()
        identity = items[0]["id"]
        db.mabel_queue_select(identity, "tv")
        with self.assertRaisesRegex(ValueError, "somewhere else"):
            db.mabel_queue_select(identity, "device:other", automatic=True)
        db.mabel_queue_event("pause", "tv", identity)
        with self.assertRaisesRegex(ValueError, "paused"):
            db.mabel_queue_select(identity, "device:other", automatic=True)

    def test_device_queue_advances_with_new_stream_ownership_and_honours_ending(self):
        db, items = self.queued_pair()
        first, second = [item["id"] for item in items]
        db.mabel_queue_select(first, "device:one")
        db.mabel_queue_event("started", "device:one", first)
        db.mabel_queue_event("finish", "device:one", first)
        db.mabel_queue_select(second, "device:two", automatic=True, expected_owner="device:one")
        with self.assertRaises(ValueError):
            db.mabel_queue_event("finish", "device:one", first)
        db.mabel_queue_event("started", "device:two", second)
        done = db.mabel_queue_event("finish", "device:two", second)
        self.assertTrue(done["completed"])
        self.assertEqual(done["items"], [])

    def test_device_streams_use_queue_identity_and_late_release_cannot_pause_next_item(self):
        db, items = self.queued_pair()
        library = self.fixture.library
        db.mabel_queue_select(items[0]["id"], "tv")
        with patch.object(library, 'remote_browser_ready', return_value=True), \
             patch.object(library, 'queue_socket_command') as socket_command:
            first = library.start_remote_stream({'kind': 'channel', 'channel': 7,
                'file': 'First.mp4', 'queue_id': items[0]['id']})
            token = first['stream_url'].split('stream=')[1]
            socket_command.assert_called_once_with(b'pause-mabel-queue-transfer')
            library.mabel_queue_action({'action': 'started', 'id': items[0]['id'], 'stream': token})
            self.assertTrue(library.mabel_queue()['items'][0]['playing'])
            library.mabel_queue_action({'action': 'finish', 'id': items[0]['id'], 'stream': token})
            second = library.start_remote_stream({'kind': 'channel', 'channel': 7,
                'file': 'Second.mp4', 'queue_id': items[1]['id'],
                'queue_auto': True, 'queue_from_stream': token})
            new_token = second['stream_url'].split('stream=')[1]
            library.mabel_queue_action({'action': 'started', 'id': items[1]['id'], 'stream': new_token})
            library.remote_release(token)
            self.assertTrue(library.mabel_queue()['active'])
            self.assertEqual(library.mabel_queue()['owner'], 'device:' + new_token)

    def test_tv_connection_failure_preserves_queue_and_reports_error(self):
        db, items = self.queued_pair()
        library = self.fixture.library
        with patch.object(library, 'queue_socket_command', side_effect=ValueError('TV unavailable')):
            with self.assertRaisesRegex(ValueError, 'TV unavailable'):
                library.play_queue_on_tv(items[0]['id'])
        state = db.mabel_queue()
        self.assertEqual(len(state['items']), 2)
        self.assertTrue(state['paused'])
        self.assertEqual(state['error'], 'TV unavailable')


if __name__ == "__main__":
    unittest.main()
