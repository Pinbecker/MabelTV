from __future__ import annotations

import argparse
import importlib.util
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = PROJECT_ROOT / "scripts" / "pi" / "mabeltv-library.py"
SPEC = importlib.util.spec_from_file_location("mabeltv_library_sqlite", MODULE_PATH)
assert SPEC and SPEC.loader
mabeltv_library = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mabeltv_library)


class LibrarySqliteRuntimeTests(unittest.TestCase):
    def test_library_uses_sqlite_and_leaves_retired_json_untouched(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            media = root / "media"
            media.mkdir()
            channels_path = root / "channels.json"
            settings_path = root / "settings.json"
            owner_path = root / "owner.json"
            config_path = root / "library.conf"
            database_path = root / "mabeltv.db"
            channels = {"schema_version": 1, "channels": [{
                "number": 1, "name": "MabelTV", "folder": "mabeltv",
                "aspect": "crop", "content_type": "shows",
            }]}
            channels_path.write_text(json.dumps(channels), encoding="utf-8")
            settings_path.write_text('{"display_resolution":"720p"}', encoding="utf-8")
            owner_path.write_text(json.dumps({
                "setup_complete": True, "pin_hash": "retired",
                "pin_salt": "retired", "child_name": "Wrong",
            }), encoding="utf-8")
            config_path.write_text("MABELTV_SETUP_CODE=135790\n", encoding="utf-8")

            database = mabeltv_library.StateDatabase(database_path)
            database.initialise()
            stores = {
                "channels": channels,
                "settings": {"schema_version": 1, "display_resolution": "1080p"},
                "owner": {"schema_version": 1, "setup_complete": True,
                          "pin_hash": "database", "pin_salt": "database",
                          "child_name": "Mabel", "tv_name": "MabelTV"},
                "player": {"schema_version": 4, "standby": True},
                "viewing": {"schema_version": 2, "tracking_started": time.time(),
                            "sessions": []},
                "channel_metadata": {}, "adult_media": {},
                "adult_series": {"series": {}, "episodes": {}},
                "adult_viewing": {"schema_version": 1, "titles": {},
                                  "availability": {}, "explore": {}},
                "adult_insights": {"schema_version": 1, "titles": {}, "failures": {}},
            }
            for kind, value in stores.items():
                database.write(kind, value)

            args = argparse.Namespace(
                media_root=str(media), channels=str(channels_path),
                settings=str(settings_path), owner=str(owner_path),
                config=str(config_path), database=str(database_path),
            )
            environment = {
                "MABELTV_TMDB_ARTWORK_CACHE": str(root / "artwork-cache"),
                "MABELTV_USB_ROOT": str(root / "usb"),
            }
            with mock.patch.dict(os.environ, environment):
                library = mabeltv_library.Library(args)
            try:
                library.admin_action = lambda action: "ok"
                self.assertEqual("Mabel", library.owner()["child_name"])
                self.assertEqual("1080p", library.settings()["display_resolution"])
                library.change_tv_name({"child_name": "Alice"})
                self.assertEqual("Alice", database.read("owner")["child_name"])
                self.assertEqual("Wrong", json.loads(
                    owner_path.read_text(encoding="utf-8"))["child_name"])
            finally:
                library.close()


if __name__ == "__main__":
    unittest.main()
