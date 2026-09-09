from __future__ import annotations

import argparse
import copy
import importlib.util
import secrets
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = PROJECT_ROOT / "scripts" / "pi" / "mabeltv-library.py"
SPEC = importlib.util.spec_from_file_location("mabeltv_browser_library", MODULE_PATH)
assert SPEC and SPEC.loader
mabeltv_library = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mabeltv_library)


def film(title: str, index: int, favourite: bool = False) -> dict[str, Any]:
    position = 420 + index * 173
    return {
        "name": f"{title}.mp4",
        "display_name": title,
        "enabled": True,
        "browser_ready": True,
        "favourite": favourite,
        "remote_position": position,
        "remote_duration": 6_600,
        "remote_last_watched": 2_000_000_000 - index,
        "metadata": {
            "tmdb_id": 1000 + index,
            "title": title,
            "year": str(1990 + index),
            "overview": f"A deterministic fixture entry for {title}.",
        },
    }


def episode(title: str) -> dict[str, Any]:
    return {
        "name": f"{title}.mp4",
        "display_name": title,
        "enabled": True,
        "browser_ready": True,
        "favourite": False,
        "metadata": {"title": title},
    }


FILMS = [
    film("Snowy Adventure", 0, True),
    film("Ocean Friends", 1, True),
    film("The Gruffalo Trail", 2),
    film("Woodland Story", 3),
    film("Moonlight Express", 4),
    film("The Toymaker", 5),
    film("Castle Mystery", 6),
    film("The Last Dragon", 7),
]


LIBRARY_PAYLOAD: dict[str, Any] = {
    "channels": [
        {
            "number": 1,
            "name": "Family Films",
            "folder": "Family Films",
            "aspect": "crop",
            "content_type": "films",
            "enabled": True,
            "favourite": False,
            "resume_file": "",
            "resume_position": 0,
            "resume_browser_ready": True,
            "resume_title": "",
            "programmes": FILMS,
            "enabled_programmes": len(FILMS),
            "metadata": {},
        },
        {
            "number": 3,
            "name": "Little Explorers",
            "folder": "Little Explorers",
            "aspect": "crop",
            "content_type": "shows",
            "enabled": True,
            "favourite": True,
            "resume_file": "The Garden.mp4",
            "resume_position": 210,
            "resume_browser_ready": True,
            "resume_title": "The Garden",
            "programmes": [episode("The Garden"), episode("The Picnic")],
            "enabled_programmes": 2,
            "metadata": {
                "title": "Little Explorers",
                "overview": "Friendly adventures made for the browser fixture.",
            },
        },
        {
            "number": 4,
            "name": "Waffle Pup",
            "folder": "Waffle Pup",
            "aspect": "crop",
            "content_type": "shows",
            "enabled": True,
            "favourite": True,
            "resume_file": "First Day.mp4",
            "resume_position": 95,
            "resume_browser_ready": True,
            "resume_title": "First Day",
            "programmes": [episode("First Day"), episode("The New Ball")],
            "enabled_programmes": 2,
            "metadata": {
                "title": "Waffle Pup",
                "overview": "A second stable series used to exercise horizontal rails.",
            },
        },
    ],
    "appearance": {
        "parent_overlay_style": "classic",
        "tv_guide_enabled": False,
        "portal_theme": "dark",
        "portal_design": "current",
        "portal_palette": "ember",
    },
    "tv_settings": {
        "playback_mode": "continuous",
        "episode_reset_minutes": 0,
        "picture_mode": "channel",
        "tv_border": "slim-black",
        "crt_glass": 35,
        "video_distortion": 20,
        "display_resolution": "720p",
        "volume_limit_enabled": True,
        "maximum_volume": 60,
        "sound_effects_enabled": True,
        "scrubbing_enabled": False,
    },
    "remote_viewing": {"allow_simultaneous": False},
    "adult_settings": {"watchmode_availability_enabled": True},
    "adult_library": [],
    "adult_folders": [],
    "adult_series": [],
    "recycle": [],
    "uploads": [],
    "storage": {"free_gb": 278.0, "used_gb": 172.0, "total_gb": 469.0},
    "system": {
        "healthy": True,
        "player": "running",
        "media_worker": "running",
        "temperature_c": 47.2,
        "currently_throttled": False,
        "historical_throttle": False,
        "uptime_seconds": 756_000,
        "version": "0.2.5-test",
        "device_name": "MabelTV Fixture",
        "warnings": [],
    },
    "owner": {
        "name": "Fixture Parent",
        "child_name": "Mabel",
        "tv_name": "MabelTV",
        "portal_pin_required": False,
        "pin_change_recommended": False,
    },
}


LIVE_PAYLOAD: dict[str, Any] = {
    "available": False,
    "standby": True,
    "reason": "The TV is off",
    "adult_mode": False,
    "paused": False,
    "muted": False,
    "volume": 60,
    "remote_locked": False,
    "subtitles_available": False,
    "subtitles_visible": False,
    "widescreen_available": False,
    "widescreen_enabled": False,
    "adult_handoff_available": False,
    "connected_tv_available": True,
    "connected_tv_power": "standby",
    "channel_number": 1,
    "channel_name": "Family Films",
    "programme": "Nothing playing",
}


class FixtureLibrary:
    def __init__(self) -> None:
        self.pin_required = False
        self.sessions: set[str] = set()
        self.viewing_titles: dict[str, dict[str, Any]] = {}

    def start_viewing_tracker(self) -> None:
        pass

    def configured(self) -> bool:
        return True

    def portal_pin_required(self) -> bool:
        return self.pin_required

    def public_setup(self) -> dict[str, Any]:
        return {
            "configured": True,
            "device_name": "MabelTV Fixture",
            "product_name": "Mabel TV",
            "tv_name": "MabelTV",
            "portal_pin_required": self.pin_required,
            "setup_code_required": True,
            "default_channels": [],
            "recovering_owner": False,
        }

    def library(self) -> dict[str, Any]:
        payload = copy.deepcopy(LIBRARY_PAYLOAD)
        payload["owner"]["portal_pin_required"] = self.pin_required
        return payload

    def live_tv_status(self) -> dict[str, Any]:
        return copy.deepcopy(LIVE_PAYLOAD)

    def live_status(self) -> dict[str, Any]:
        return {
            "uploads": [],
            "storage": copy.deepcopy(LIBRARY_PAYLOAD["storage"]),
            "system": copy.deepcopy(LIBRARY_PAYLOAD["system"]),
        }

    def usb_volumes(self) -> dict[str, Any]:
        return {"volumes": [], "imports": []}

    def stop_live_tv(self) -> dict[str, Any]:
        return {"ok": True}

    def tmdb_status(self) -> dict[str, Any]:
        return {"configured": False, "watchmode_configured": False}

    def activity_status(self) -> dict[str, Any]:
        return {
            "uploads": [], "optimisations": [], "temperature_c": 47.2,
            "temperature_warning": False, "active": False,
        }

    def lg_tv_status(self) -> dict[str, Any]:
        return {
            "configured": True, "connected": True, "power": "on",
            "app": "Live TV", "app_id": "com.webos.app.livetv",
            "input": "Live TV", "volume": 18, "muted": False,
            "catalog_known": True, "available_apps": ["netflix"],
        }

    def viewing_insights(self, days: int, timezone_offset: int) -> dict[str, Any]:
        summary = {
            "today_seconds": 0, "week_seconds": 0, "month_seconds": 0,
            "range_seconds": 0, "previous_range_seconds": 0,
            "average_active_day_seconds": 0, "longest_session_seconds": 0,
            "active_days": 0, "sessions": 0, "unique_items": 0,
            "busiest_period": "Overnight", "busiest_weekday": "Mon",
        }
        return {
            "tracking_started": 2_000_000_000, "range_days": days,
            "summary": summary, "daily": [], "weekly": [], "monthly": [],
            "timeline": [], "time_of_day": [], "hourly": [], "weekdays": [],
            "by_surface": [], "by_kind": [], "top_titles": [],
            "top_channels": [], "top_films": [], "items": [],
            "recent": [], "sessions": [],
        }

    def adult_viewing(self) -> dict[str, Any]:
        return {"items": [copy.deepcopy(value) for value in self.viewing_titles.values()],
                "watchmode_configured": False, "region": "GB"}

    def adult_explore(self, list_id: str, media_type: str, page: Any) -> dict[str, Any]:
        page_number = int(page)
        kinds = ["movie", "tv"] if media_type == "all" else [media_type]
        results = []
        for index in range(24):
            kind = kinds[index % len(kinds)]
            identifier = page_number * 1000 + index + 1
            results.append({
                "key": f"{kind}:{identifier}", "media_type": kind,
                "tmdb_id": identifier, "title": f"Explore title {identifier}",
                "year": str(2026 - index % 20),
                "poster_path": f"/explore-{identifier}.jpg",
                "overview": "A deterministic Explore suggestion.",
                "on_mabeltv": False, "local": None,
                "viewing": copy.deepcopy(self.viewing_titles.get(f"{kind}:{identifier}", {})),
            })
        lists = [{"id": "for-you", "label": "Best guesses for you",
                  "kicker": "Your history, balanced with a few wildcards"},
                 {"id": "popular", "label": "Popular right now",
                  "kicker": "A broad place to start"}]
        selected = next((value for value in lists if value["id"] == list_id), lists[0])
        results = [value for value in results if self.viewing_titles.get(
            value["key"], {}).get("manual_state") != "watched"]
        return {"list": selected, "lists": lists, "media_type": media_type,
                "page": page_number, "has_more": page_number < 3,
                "results": results, "region": "GB"}

    def adult_explore_feedback(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True, "recorded": len(payload.get("items", []))}

    def adult_title_detail(self, media_type: str, tmdb_id: Any) -> dict[str, Any]:
        identifier = int(tmdb_id)
        local = identifier == 6001
        return {
            "key": f"{media_type}:{identifier}", "media_type": media_type,
            "tmdb_id": identifier,
            "title": "Fixture Series" if local else "Foundation",
            "overview": "Series details opened successfully.",
            "seasons": [
                {"number": 1, "name": "Series 1", "episodes": 3,
                 "watched_count": 0, "poster_path": ""},
                {"number": 2, "name": "Series 2", "episodes": 2,
                 "watched_count": 0, "poster_path": ""},
            ],
            "providers": [], "on_mabeltv": local, "viewing": {},
            "local": {"kind": "series", "series": "fixture-series"}
            if local else None,
        }

    def adult_title_season(self, tmdb_id: Any, season_number: Any) -> dict[str, Any]:
        identifier = int(tmdb_id)
        season = int(season_number)
        count = 3 if season == 1 else 2
        return {
            "key": f"tv:{identifier}", "season": season,
            "name": f"Series {season}", "overview": "Official fixture episodes.",
            "poster_path": "", "episodes": [{
                "number": episode_number,
                "name": f"Official episode {episode_number}",
                "air_date": f"2026-01-0{episode_number}", "runtime": 48,
                "overview": "", "still_path": "", "watched": False,
            } for episode_number in range(1, count + 1)],
        }

    def adult_streaming_links(self, media_type: str, tmdb_id: Any,
                              refresh: bool = False) -> dict[str, Any]:
        return {"key": f"{media_type}:{int(tmdb_id)}", "sources": []}

    def adult_viewing_update(self, payload: dict[str, Any]) -> dict[str, Any]:
        key = f"{payload['media_type']}:{int(payload['tmdb_id'])}"
        current = self.viewing_titles.setdefault(key, {
            "key": key, "media_type": payload["media_type"],
            "tmdb_id": int(payload["tmdb_id"]), "title": payload.get("title", ""),
        })
        action = payload.get("action")
        if action == "watchlist":
            current["watchlisted"] = bool(payload.get("enabled", True))
        elif action == "up_next":
            current["up_next"] = bool(payload.get("enabled", True))
        elif action == "watching":
            current["series_watching"] = bool(payload.get("enabled", True))
        elif action == "watched":
            current.update({"manual_state": "watched", "history": [2_000_000_000]})
        elif action == "part_watched":
            current.update({"manual_state": "part_watched", "history": []})
        elif action == "not_watched":
            current.update({"manual_state": "not_watched", "history": []})
        return {"ok": True, "key": key, "viewing": copy.deepcopy(current)}

    def login_allowed(self, address: str) -> bool:
        return True

    def record_login_failure(self, address: str) -> None:
        pass

    def clear_login_failures(self, address: str) -> None:
        pass

    def verify_pin(self, pin: str) -> bool:
        return pin == "2468"

    def create_session(self) -> str:
        token = secrets.token_urlsafe(24)
        self.sessions.add(token)
        return token

    def valid_session(self, token: str | None) -> bool:
        return bool(token and token in self.sessions)

    def revoke_session(self, token: str | None) -> None:
        if token:
            self.sessions.discard(token)


class FixtureHandler(mabeltv_library.Handler):
    def handle(self) -> None:
        try:
            super().handle()
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # Browser contexts routinely discard their pooled keep-alive
            # sockets when each isolated test closes.
            pass

    def end_headers(self) -> None:
        # The production service deliberately closes ordinary asset requests
        # because it sits behind a small upstream connection pool. The browser
        # contract loads the portal afresh hundreds of times on one Windows
        # runner; closing every asset connection exhausts its ephemeral client
        # ports late in the suite. Keep fixture connections persistent so the
        # test transport models a browser-facing HTTP/1.1 server.
        BaseHTTPRequestHandler.end_headers(self)

    def do_GET(self) -> None:
        if self.path in ("/api/adult/series/artwork/bright.svg",
                         "/api/adult/series/artwork/dark.svg"):
            colour = "#101820" if self.path.endswith("dark.svg") else "#ffffff"
            artwork = (f'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">'
                       f'<rect width="600" height="400" fill="{colour}"/></svg>').encode()
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml")
            self.send_header("Content-Length", str(len(artwork)))
            self.end_headers()
            self.wfile.write(artwork)
            return
        if self.path.startswith("/__fixture/pin-required"):
            self.server.library.pin_required = "value=1" in self.path
            self.json(200, {"required": self.server.library.pin_required})
            return
        super().do_GET()


def main() -> None:
    parser = argparse.ArgumentParser(description="Deterministic MabelTV portal fixture")
    parser.add_argument("--port", type=int, default=4178)
    args = parser.parse_args()
    server = mabeltv_library.LibraryServer(("127.0.0.1", args.port), FixtureLibrary())
    server.RequestHandlerClass = FixtureHandler
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
