"""Unit tests for the private Alexa-to-local-control boundary."""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "integrations/alexa/mabeltv_alexa_bridge.py"
SPEC = importlib.util.spec_from_file_location("mabeltv_alexa_bridge", MODULE_PATH)
assert SPEC and SPEC.loader
bridge = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bridge
SPEC.loader.exec_module(bridge)


class FakeControl:
    def __init__(self):
        self.commands = []

    def send(self, command):
        self.commands.append(command)


class AlexaBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / "mabeltv.db"
        import sqlite3
        connection = sqlite3.connect(self.database)
        try:
            connection.execute("CREATE TABLE channels (number INTEGER, name TEXT)")
            connection.executemany("INSERT INTO channels VALUES (?, ?)", [
                (1, "Postman Pat"), (4, "Waffle the Wonder Dog"), (9, "Zog"),
            ])
            connection.commit()
        finally:
            connection.close()
        self.control = FakeControl()
        self.dispatcher = bridge.AlexaCommandDispatcher(
            self.control, bridge.ChannelResolver(self.database))

    def tearDown(self):
        self.temp.cleanup()

    def test_resolves_channel_number_name_and_word(self):
        resolver = bridge.ChannelResolver(self.database)
        self.assertEqual(resolver.resolve("channel 4"), (4, "Waffle the Wonder Dog"))
        self.assertEqual(resolver.resolve("four"), (4, "Waffle the Wonder Dog"))
        self.assertEqual(resolver.resolve("postman pat"), (1, "Postman Pat"))

    def test_tune_and_play_channel_use_validated_json_controls(self):
        self.assertEqual(self.dispatcher.dispatch({"action": "tune", "channel": "Zog"}),
                         "channel:9:Zog")
        self.assertEqual(self.dispatcher.dispatch({"action": "play", "title": "Postman Pat"}),
                         "channel:1:Postman Pat")
        self.assertEqual(self.control.commands, [
            {"command": "tune-channel", "channel": 9},
            {"command": "tune-channel", "channel": 1},
        ])

    def test_play_non_channel_opens_my_tv_and_enters_its_search(self):
        self.assertEqual(self.dispatcher.dispatch({"action": "play", "title": "Gilmore Girls"}),
                         "search:Gilmore Girls")
        self.assertEqual(self.control.commands, [
            "enter-my-tv-mode",
            {"command": "text-input", "text": "Gilmore Girls"},
        ])

    def test_only_mapped_controls_are_accepted(self):
        self.assertEqual(self.dispatcher.dispatch({"action": "open_my_tv"}), "open_my_tv")
        self.assertEqual(self.control.commands, ["enter-my-tv-mode"])
        with self.assertRaisesRegex(bridge.CommandError, "not supported"):
            self.dispatcher.dispatch({"action": "arbitrary-command"})
