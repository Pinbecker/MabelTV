from __future__ import annotations

import unittest
from pathlib import Path
from unittest import mock

try:
    from tests.python.library_test_support import LibraryFixture, mabeltv_library
except ModuleNotFoundError:
    from library_test_support import LibraryFixture, mabeltv_library


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class MyTvHandoffTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = LibraryFixture()

    def tearDown(self) -> None:
        self.fixture.close()

    def test_remote_command_is_forwarded_to_the_native_player(self) -> None:
        with mock.patch.object(mabeltv_library.socket, "AF_UNIX", 1, create=True):
            with mock.patch.object(mabeltv_library.socket, "socket") as socket_factory:
                client = socket_factory.return_value.__enter__.return_value
                client.recv.return_value = b"ok\n"
                result = self.fixture.library.live_tv_control({
                    "command": "continue-in-my-tv-mode",
                })

        self.assertEqual(result, {"ok": True, "message": "Command sent"})
        client.sendall.assert_called_once_with(b"continue-in-my-tv-mode\n")

    def test_live_status_exposes_native_handoff_availability(self) -> None:
        self.fixture.library.live_stream.status = mock.Mock(return_value={
            "available": True, "programme": "Snowy Adventure",
        })
        self.fixture.library.player_mode_status = mock.Mock(return_value={
            "mode": "kids", "standby": False,
            "my_tv_handoff_available": True,
        })

        status = self.fixture.library.live_tv_status()

        self.assertTrue(status["my_tv_handoff_available"])

    def test_native_handoff_stops_the_child_decoder_before_resuming_borderless(self) -> None:
        main = (PROJECT_ROOT / "qml/Main.qml").read_text(encoding="utf-8")
        television = (PROJECT_ROOT / "qml/TelevisionScreen.qml").read_text(
            encoding="utf-8")
        my_tv = (PROJECT_ROOT / "qml/MyTvModeOverlay.qml").read_text(
            encoding="utf-8")
        native = "\n".join(
            (PROJECT_ROOT / path).read_text(encoding="utf-8")
            for path in ("src/app/main.cpp", "src/ipc/PortalControlServer.cpp")
        )

        self.assertIn('command === "continue-in-my-tv-mode"', main)
        self.assertIn("pendingExternalPosition = position", main)
        self.assertIn("enterMyTvMode()", main)
        self.assertIn("openingMyTvMode = true\n        player.stop()", main)
        self.assertIn("myTvMode.openExternal(source, title, position)", television)
        self.assertIn("myTvPlayer.play(source, Math.max(0, Number(startPosition) || 0))",
                      my_tv)
        self.assertIn('QStringLiteral("continue-in-my-tv-mode")', native)
        self.assertIn('QStringLiteral("my_tv_handoff_available")', native)


if __name__ == "__main__":
    unittest.main()
