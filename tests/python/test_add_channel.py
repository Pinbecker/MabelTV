from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = PROJECT_ROOT / "scripts/pi/add-channel.py"
SCRIPTS_PI = PROJECT_ROOT / "scripts/pi"


def load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


add_channel = load(SCRIPT_PATH, "mabeltv_add_channel")
sys.path.insert(0, str(SCRIPTS_PI))
from mabeltv_backend import database as database_module  # noqa: E402


class AddChannelTests(unittest.TestCase):
    def test_configure_channel_mutates_only_the_authoritative_database(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            database = database_module.StateDatabase(root / "mabeltv.db")
            database.initialise()
            database.write("channels", {"schema_version": 1, "channels": [{
                "number": 1, "name": "MabelTV", "folder": "mabeltv",
                "aspect": "crop", "content_type": "shows",
            }]})
            request = {
                "number": 2, "name": "Films", "folder": "films",
                "aspect": "fit", "content_type": "films",
            }

            self.assertTrue(add_channel.configure_channel(database, request))
            self.assertFalse(add_channel.configure_channel(database, request))
            self.assertEqual([1, 2], [
                channel["number"] for channel in database.read("channels")["channels"]
            ])
            self.assertFalse(any(root.glob("*.json")))

            changed = dict(request, name="Film Channel", aspect="crop")
            self.assertTrue(add_channel.configure_channel(database, changed))
            saved = database.read("channels")["channels"][1]
            self.assertEqual("Film Channel", saved["name"])
            self.assertEqual("crop", saved["aspect"])

    def test_folder_validation_rejects_absolute_and_parent_paths(self) -> None:
        self.assertTrue(add_channel.valid_folder("shows/classics"))
        self.assertFalse(add_channel.valid_folder("../private"))
        self.assertFalse(add_channel.valid_folder("/srv/media"))


if __name__ == "__main__":
    unittest.main()
