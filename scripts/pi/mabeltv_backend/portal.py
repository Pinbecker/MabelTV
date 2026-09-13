"""Server-side assembly for portal documents shipped in one atomic release."""

import re
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent

PORTAL_APP_SOURCES = (
    "ui-components.js",
    "core/foundation.js",
    "core/scroll.js",
    "core/navigation.js",
    "core/live.js",
    "core/load.js",
    "channel-page.js",
    "library/adult-library.js",
    "library/usb-browser.js",
    "library/viewing-insights.js",
    "library/adult-insights.js",
    "library/device-status.js",
    "library/channels.js",
    "playback/players.js",
    "playback/film-library.js",
    "playback/adult-series.js",
    "playback/film-catalogue.js",
    "playback/programmes.js",
    "playback/downloads.js",
    "playback/view.js",
    "adult-viewing/catalogue.js",
    "adult-viewing/seasons.js",
    "adult-viewing/details.js",
    "adult-viewing/up-next-order.js",
    "adult-viewing/person.js",
    "adult-viewing/explore.js",
    "adult-viewing/grid.js",
    "adult-viewing/home.js",
    "adult-viewing/filmography.js",
    "adult-viewing/rating.js",
    "actions.js",
    "lg-tv-remote.js",
)

PORTAL_INCLUDE = re.compile(
    r"^[ \t]*<!-- portal-include:([A-Za-z0-9_./-]+\.html) -->[ \t]*$",
    re.MULTILINE,
)


def load_portal_document(index_path: Path) -> str:
    """Assemble the portal from private server-side HTML partials."""
    portal_root = (index_path.parent / "portal").resolve()
    document = index_path.read_text(encoding="utf-8")
    for _ in range(8):
        if not PORTAL_INCLUDE.search(document):
            return document

        def include(match: re.Match[str]) -> str:
            candidate = (portal_root / match.group(1)).resolve()
            if portal_root not in candidate.parents or not candidate.is_file():
                raise OSError(f"Portal include is unavailable: {match.group(1)}")
            return candidate.read_text(encoding="utf-8").rstrip()

        document = PORTAL_INCLUDE.sub(include, document)
    raise OSError("Portal includes are nested too deeply")


def load_portal_app_script(*, private_scope: bool = True) -> str:
    """Assemble ordered portal modules, private in every shipped release.

    The browser fixture may request the unscoped form so its white-box tests can
    instrument lexical bindings without adding test hooks to production code.
    """
    root = (SERVICE_ROOT / "portal" / "js").resolve()
    sources = []
    for relative in PORTAL_APP_SOURCES:
        candidate = (root / relative).resolve()
        if root not in candidate.parents or not candidate.is_file():
            raise OSError(f"Portal script is unavailable: {relative}")
        sources.append(f"\n/* {relative} */\n{candidate.read_text(encoding='utf-8').rstrip()}\n")
    body = "'use strict'\n" + "".join(sources)
    return "(() => {\n" + body + "})()\n" if private_scope else body


def load_index() -> str:
    """Load the installed portal, failing startup if its release is incomplete."""
    return load_portal_document(SERVICE_ROOT / "mabeltv-library.html")


INDEX = load_index()
PORTAL_APP_SCRIPT = load_portal_app_script()


def load_watch_page() -> str:
    """Load the installed remote player as part of the same atomic release."""
    return (SERVICE_ROOT / "mabeltv-watch.html").read_text(encoding="utf-8")


WATCH_PAGE = load_watch_page()
