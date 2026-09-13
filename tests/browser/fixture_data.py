from __future__ import annotations

from typing import Any

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
