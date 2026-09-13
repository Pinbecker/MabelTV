from __future__ import annotations

import argparse
import http.cookiejar
import importlib.util
import inspect
import json
import os
import re
import tempfile
import threading
import time
import types
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

from tests.python.sqlite_test_database import initialise_test_database


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = PROJECT_ROOT / "scripts" / "pi" / "mabeltv-library.py"
SPEC = importlib.util.spec_from_file_location("mabeltv_library", MODULE_PATH)
assert SPEC and SPEC.loader
mabeltv_library = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mabeltv_library)

PORTAL_ROOT = PROJECT_ROOT / "scripts" / "pi" / "portal"


def read_portal_files(root: str, names: tuple[str, ...]) -> str:
    return "\n".join(
        (PORTAL_ROOT / root / name).read_text(encoding="utf-8")
        for name in names
    )


CORE_SCRIPTS = (
    "foundation.js", "scroll.js", "navigation.js", "live.js", "load.js",
)
LIBRARY_SCRIPTS = (
    "adult-library.js", "usb-browser.js", "viewing-insights.js",
    "adult-insights.js", "device-status.js", "channels.js",
)
PLAYBACK_SCRIPTS = (
    "players.js", "film-library.js", "adult-series.js", "film-catalogue.js",
    "programmes.js", "downloads.js", "view.js",
)
ADULT_VIEWING_SCRIPTS = (
    "catalogue.js", "seasons.js", "details.js", "grid.js",
)
OVERLAY_PARTIALS = (
    "watch.html", "adult-library.html", "device-playback.html", "remote.html",
    "library-management.html", "adult-viewing.html",
)

PORTAL_CORE = read_portal_files("js/core", CORE_SCRIPTS)
PORTAL_LIBRARY = read_portal_files("js/library", LIBRARY_SCRIPTS)
PORTAL_PLAYBACK = read_portal_files("js/playback", PLAYBACK_SCRIPTS)
PORTAL_ADULT_VIEWING = read_portal_files(
    "js/adult-viewing", ADULT_VIEWING_SCRIPTS)
PORTAL_OVERLAY_MARKUP = read_portal_files("html/overlays", OVERLAY_PARTIALS)
PORTAL_SCRIPT = "\n".join((
    (PORTAL_ROOT / "js" / "ui-components.js").read_text(encoding="utf-8"),
    PORTAL_CORE,
    (PORTAL_ROOT / "js" / "channel-page.js").read_text(encoding="utf-8"),
    PORTAL_LIBRARY,
    PORTAL_PLAYBACK,
    PORTAL_ADULT_VIEWING,
    (PORTAL_ROOT / "js" / "actions.js").read_text(encoding="utf-8"),
    (PORTAL_ROOT / "js" / "lg-tv-remote.js").read_text(encoding="utf-8"),
))
PORTAL_STYLES = "\n".join(
    path.read_text(encoding="utf-8")
    for path in sorted((PORTAL_ROOT / "css").glob("*.css"))
)
PORTAL_EXPERIENCE_STYLES = "\n".join(
    path.read_text(encoding="utf-8")
    for path in sorted((PORTAL_ROOT / "css").glob("experience-*.css"))
    if path.name != "experience-light.css"
)
PORTAL_SOURCE = "\n".join((mabeltv_library.INDEX, PORTAL_SCRIPT, PORTAL_STYLES))


class LibraryFixture:
    def __init__(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.media = self.root / "media"
        self.channels = self.root / "channels.json"
        self.settings = self.root / "settings.json"
        self.owner = self.root / "owner.json"
        self.database = self.root / "mabeltv.db"
        self.config = self.root / "library.conf"
        self.config.write_text("MABELTV_SETUP_CODE=135790\n", encoding="utf-8")
        self.settings.write_text('{"schema_version": 1}\n', encoding="utf-8")
        initialise_test_database(mabeltv_library.StateDatabase, self.database)
        args = argparse.Namespace(
            media_root=str(self.media),
            channels=str(self.channels),
            settings=str(self.settings),
            owner=str(self.owner),
            config=str(self.config),
            database=str(self.database),
        )
        cache = {"MABELTV_TMDB_ARTWORK_CACHE": str(self.root / "tmdb-artwork-cache")}
        with mock.patch.dict(os.environ, cache):
            self.library = mabeltv_library.Library(args)
        self.library.write_state("player", {"schema_version": 4, "standby": False})
        self.library.admin_action = lambda action: "ok"

    def close(self) -> None:
        self.library.close()
        self.temporary.cleanup()
