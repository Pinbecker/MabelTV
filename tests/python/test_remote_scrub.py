from tests.python.library_test_support import *


class RemoteScrubTests(unittest.TestCase):
    def setUp(self):
        self.fixture = LibraryFixture()
        self.library = self.fixture.library
        self.library.player_mode_status = mock.Mock(return_value={
            "seek_supported": True, "seek_available": True, "seek_token": "a" * 64})

    def tearDown(self):
        self.fixture.close()

    def test_seek_is_exact_and_uses_no_other_control(self):
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True), \
                mock.patch.object(mabeltv_library.socket, "socket") as factory:
            client = factory.return_value.__enter__.return_value
            client.recv.return_value = b"ok\n"
            self.library.live_tv_control({"command":"seek", "position": 1250.5, "token":"a" * 64})
            self.assertEqual(client.sendall.call_count, 1)
            self.assertEqual(json.loads(client.sendall.call_args.args[0]), {
                "command":"seek", "position":1250.5, "token":"a" * 64})

    def test_invalid_and_stale_requests_never_reach_player(self):
        with mock.patch.object(mabeltv_library.socket, "socket") as factory:
            for position in [-1, True, float("nan"), float("inf"), "23"]:
                with self.assertRaises(ValueError):
                    self.library.live_tv_control({"command":"seek", "position":position, "token":"a" * 64})
            with self.assertRaisesRegex(ValueError, "programme changed"):
                self.library.live_tv_control({"command":"seek", "position":23, "token":"b" * 64})
            self.library.player_mode_status.return_value = {}
            with self.assertRaisesRegex(ValueError, "player update"):
                self.library.live_tv_control({"command":"seek", "position":23, "token":"a" * 64})
            factory.assert_not_called()
