from __future__ import annotations

import unittest
from pathlib import Path
from unittest import mock

from tests.python.test_library_service import LibraryFixture, mabeltv_library


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class AdultHandoffTests(unittest.TestCase):
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
                    "command": "continue-in-adult-mode",
                })

        self.assertEqual(result, {"ok": True, "message": "Command sent"})
        client.sendall.assert_called_once_with(b"continue-in-adult-mode\n")

    def test_live_status_exposes_native_handoff_availability(self) -> None:
        self.fixture.library.live_stream.status = mock.Mock(return_value={
            "available": True, "programme": "Snowy Adventure",
        })
        self.fixture.library.player_mode_status = mock.Mock(return_value={
            "mode": "kids", "standby": False,
            "adult_handoff_available": True,
        })

        status = self.fixture.library.live_tv_status()

        self.assertTrue(status["adult_handoff_available"])

    def test_native_handoff_stops_the_child_decoder_before_resuming_borderless(self) -> None:
        main = (PROJECT_ROOT / "qml/Main.qml").read_text(encoding="utf-8")
        television = (PROJECT_ROOT / "qml/TelevisionScreen.qml").read_text(
            encoding="utf-8")
        adult = (PROJECT_ROOT / "qml/AdultModeOverlay.qml").read_text(
            encoding="utf-8")
        native = (PROJECT_ROOT / "src/app/main.cpp").read_text(encoding="utf-8")

        self.assertIn('command === "continue-in-adult-mode"', main)
        self.assertIn("pendingExternalPosition = position", main)
        self.assertIn("enterAdultMode()", main)
        self.assertIn("openingAdultMode = true\n        player.stop()", main)
        self.assertIn("adultMode.openExternal(source, title, position)", television)
        self.assertIn("adultPlayer.play(source, Math.max(0, Number(startPosition) || 0))",
                      adult)
        self.assertIn('QStringLiteral("continue-in-adult-mode")', native)
        self.assertIn('QStringLiteral("adult_handoff_available")', native)


if __name__ == "__main__":
    unittest.main()
