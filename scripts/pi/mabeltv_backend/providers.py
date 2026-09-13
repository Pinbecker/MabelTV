"""Children's channel and local-title metadata behaviour for the local library service."""

from __future__ import annotations

import json
import math
import os
import re
import subprocess
import time
from copy import deepcopy
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request

from .constants import (
    ADULT_METADATA_CACHE_SECONDS,
    ADULT_PROVIDER_CACHE_SECONDS,
    ADULT_PROVIDER_MAX_CACHE_SECONDS,
    OPENSUBTITLES_API_BASE_URL,
    OPENSUBTITLES_USER_AGENT,
    SUBTITLE_EXTENSIONS,
    SUPPORTED_EXTENSIONS,
    TMDB_BACKDROP_IMAGE_BASE_URL,
    TMDB_BASE_URL,
    TMDB_IMAGE_BASE_URL,
    WATCHMODE_API_BASE_URL,
)


class ProviderMetadataMixin:
    @staticmethod
    def tmdb_title_query(value: str) -> tuple[str, int | None]:
        title = re.sub(r"[._]+", " ", str(value or "")).strip()
        # get_iplayer output names can end in a BBC PID plus a quality label.
        # Neither is part of the film title and both make an otherwise exact
        # TMDB search much less reliable.
        title = re.sub(
            r"\s*-\s*[a-z][a-z0-9]{7}\s+(?:original|technical)\s*$",
            "", title, flags=re.IGNORECASE).strip()
        title = re.sub(
            r"\b(?:1080p|720p|2160p|bluray|web[- ]?dl|x26[45]|hevc)\b.*$",
            "", title, flags=re.IGNORECASE).strip()
        year_match = re.search(r"\b(19\d{2}|20\d{2})\b", title)
        year = int(year_match.group(1)) if year_match else None
        if year:
            title = title.replace(str(year), "").strip(" .-()[]")
        return title, year

    def channel_film_search(self, item: Path) -> tuple[str, list[dict[str, Any]]]:
        """Return selectable TMDB matches for one MabelTV film."""
        title, year = self.tmdb_title_query(self.display_name(item.name))
        parameters: dict[str, Any] = {
            "query": title, "include_adult": "false", "language": "en-GB",
        }
        if year:
            parameters["year"] = year
        response = self.tmdb_request("search/movie", parameters)
        matches = response.get("results", []) if isinstance(response, dict) else []
        results = []
        for value in matches[:12]:
            if not isinstance(value, dict) or not value.get("id"):
                continue
            results.append({
                "id": int(value["id"]),
                "title": str(value.get("title", "")),
                "original_title": str(value.get("original_title", "")),
                "year": str(value.get("release_date", ""))[:4],
                "overview": str(value.get("overview", "")),
                "poster_path": str(value.get("poster_path") or ""),
            })
        return title, results

    def channel_film_metadata_for_id(
            self, channel: dict[str, Any], item: Path, tmdb_id: int) -> dict[str, Any]:
        """Cache one explicitly selected TMDB match for a MabelTV film."""
        number = int(channel["number"])
        details = self.tmdb_request(f"movie/{tmdb_id}", {"language": "en-GB"})
        poster_name = self.cache_channel_artwork(
            str(details.get("poster_path") or ""),
            f"mabel-film-{number}-{tmdb_id}.jpg")
        return {
            "tmdb_id": tmdb_id,
            "title": str(details.get("title") or self.display_name(item.name)),
            "overview": str(details.get("overview") or ""),
            "year": str(details.get("release_date") or "")[:4],
            "poster": poster_name,
            "updated": time.time(), "provider": "TMDB",
        }

    def channel_film_metadata(self, channel: dict[str, Any], item: Path) -> dict[str, Any] | None:
        """Find and cache the best automatic TMDB match for a bulk refresh."""
        _, matches = self.channel_film_search(item)
        match = next((value for value in matches if value.get("id")), None)
        if not isinstance(match, dict):
            return None
        tmdb_id = int(match["id"])
        return self.channel_film_metadata_for_id(channel, item, tmdb_id)

    def cache_channel_artwork(self, remote_path: str, file_name: str,
                              *, backdrop: bool = False) -> str:
        if (not remote_path or not re.fullmatch(
                r"mabel-(?:show|film)-[0-9]+-[0-9]+\.jpg", file_name)):
            return ""
        destination = self.channel_artwork_root / file_name
        try:
            base = TMDB_BACKDROP_IMAGE_BASE_URL if backdrop else TMDB_IMAGE_BASE_URL
            request = Request(base + remote_path,
                              headers={"User-Agent": "MabelTV/0.2.5"})
            with self._open_url(request, timeout=15) as response:
                data = response.read(10 * 1024 * 1024)
            temporary = destination.with_suffix(".jpg.new")
            temporary.write_bytes(data)
            os.replace(temporary, destination)
            return file_name
        except (HTTPError, URLError, TimeoutError, OSError):
            return ""

    def channel_show_search(self, channel: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
        """Return parent-selectable TMDB matches for one series channel."""
        query = str(channel.get("name", "")).strip()
        response = self.tmdb_request("search/tv", {
            "query": query, "include_adult": "false", "language": "en-GB",
        })
        matches = response.get("results", []) if isinstance(response, dict) else []
        results = []
        for value in matches[:12]:
            if not isinstance(value, dict) or not value.get("id"):
                continue
            results.append({
                "id": int(value["id"]),
                "title": str(value.get("name", "")),
                "original_title": str(value.get("original_name", "")),
                "year": str(value.get("first_air_date", ""))[:4],
                "overview": str(value.get("overview", "")),
                "poster_path": str(value.get("poster_path") or ""),
            })
        return query, results

    def channel_show_metadata_for_id(
            self, channel: dict[str, Any], tmdb_id: int) -> dict[str, Any]:
        """Cache one explicitly selected TMDB match for a series channel."""
        number = int(channel["number"])
        details = self.tmdb_request(f"tv/{tmdb_id}", {"language": "en-GB"})
        remote_art = str(details.get("backdrop_path") or details.get("poster_path") or "")
        art_name = self.cache_channel_artwork(
            remote_art, f"mabel-show-{number}-{tmdb_id}.jpg",
            backdrop=bool(details.get("backdrop_path")))
        return {
            "tmdb_id": tmdb_id,
            "title": str(details.get("name") or channel.get("name", "")),
            "overview": str(details.get("overview") or ""),
            "year": str(details.get("first_air_date") or "")[:4],
            "artwork": art_name,
            "updated": time.time(), "provider": "TMDB",
        }

    def cache_adult_series_artwork(self, remote_path: str, file_name: str,
                                   *, backdrop: bool = False) -> str:
        if not remote_path or not re.fullmatch(
                r"adult-(?:series-[a-f0-9]{32}-[0-9]+|episode-[a-f0-9]{32}-[0-9]+-[0-9]+)\.jpg",
                file_name):
            return ""
        try:
            base = TMDB_BACKDROP_IMAGE_BASE_URL if backdrop else TMDB_IMAGE_BASE_URL
            request = Request(base + remote_path,
                              headers={"User-Agent": "MabelTV/0.2.5"})
            with self._open_url(request, timeout=15) as response:
                data = response.read(10 * 1024 * 1024)
            destination = self.adult_series_artwork_root / file_name
            temporary = destination.with_suffix(".jpg.new")
            temporary.write_bytes(data)
            os.replace(temporary, destination)
            return file_name
        except (HTTPError, URLError, TimeoutError, OSError):
            return ""

    def adult_series_search(self, payload: dict[str, Any]) -> dict[str, Any]:
        series_id = str(payload.get("series", ""))
        states = self.adult_series_states()
        series = states["series"].get(series_id)
        if not isinstance(series, dict):
            raise ValueError("That Adult TV series no longer exists")
        query = str(payload.get("title") or series.get("title") or "").strip()
        response = self.tmdb_request("search/tv", {
            "query": query, "include_adult": "false", "language": "en-GB",
        })
        results = []
        for value in response.get("results", [])[:12]:
            if not isinstance(value, dict) or not value.get("id"):
                continue
            results.append({
                "id": int(value["id"]), "title": str(value.get("name", "")),
                "original_title": str(value.get("original_name", "")),
                "year": str(value.get("first_air_date", ""))[:4],
                "overview": str(value.get("overview", "")),
                "poster_path": str(value.get("poster_path") or ""),
            })
        return {"ok": True, "series": series_id, "query": query,
                "results": results}

    def adult_series_apply(self, payload: dict[str, Any]) -> dict[str, Any]:
        series_id = str(payload.get("series", ""))
        try:
            tmdb_id = int(payload.get("tmdb_id", 0))
        except (TypeError, ValueError):
            tmdb_id = 0
        if tmdb_id <= 0:
            raise ValueError("Choose a TMDB series match")
        states = self.adult_series_states()
        series = states["series"].get(series_id)
        if not isinstance(series, dict):
            raise ValueError("That Adult TV series no longer exists")
        details = self.tmdb_request(f"tv/{tmdb_id}", {"language": "en-GB"})
        poster = self.cache_adult_series_artwork(
            str(details.get("poster_path") or ""),
            f"adult-series-{series_id}-{tmdb_id}.jpg")
        backdrop = self.cache_adult_series_artwork(
            str(details.get("backdrop_path") or ""),
            f"adult-series-{series_id}-{tmdb_id}.jpg", backdrop=True) \
            if not poster else ""
        series["metadata"] = {
            "tmdb_id": tmdb_id,
            "title": str(details.get("name") or series.get("title") or "Series"),
            "overview": str(details.get("overview") or ""),
            "year": str(details.get("first_air_date") or "")[:4],
            "poster": poster or backdrop,
            "updated": time.time(), "provider": "TMDB",
        }
        root = self.adult_series_root / series_id
        files = [item for item in root.rglob("*") if item.is_file()
                 and item.suffix.lower() in SUPPORTED_EXTENSIONS]
        seasons = sorted({self.adult_episode_identity(item)["season"] for item in files})
        episode_details: dict[tuple[int, int], dict[str, Any]] = {}
        for season_number in seasons:
            response = self.tmdb_request(
                f"tv/{tmdb_id}/season/{season_number}", {"language": "en-GB"})
            for episode in response.get("episodes", []):
                if not isinstance(episode, dict):
                    continue
                number = int(episode.get("episode_number") or 0)
                if number <= 0:
                    continue
                still = self.cache_adult_series_artwork(
                    str(episode.get("still_path") or ""),
                    f"adult-episode-{series_id}-{season_number}-{number}.jpg",
                    backdrop=True)
                episode_details[(season_number, number)] = {
                    "title": str(episode.get("name") or f"Episode {number}"),
                    "overview": str(episode.get("overview") or ""),
                    "air_date": str(episode.get("air_date") or ""),
                    "season_number": season_number,
                    "episode_number": number,
                    "still": still,
                }
        episode_updates: dict[str, dict[str, Any]] = {}
        for ordinal, source in enumerate(sorted(files), 1):
            parsed = self.adult_episode_identity(source, ordinal)
            metadata = episode_details.get((parsed["season"], parsed["episode"]))
            if metadata:
                relative = source.relative_to(root).as_posix()
                episode_updates[f"{series_id}/{relative}"] = metadata
        with self.config_lock:
            latest = self.adult_series_states()
            current_series = latest["series"].get(series_id)
            if not isinstance(current_series, dict):
                raise ValueError("That Adult TV series no longer exists")
            current_series["metadata"] = series["metadata"]
            latest["series"][series_id] = current_series
            for key, metadata in episode_updates.items():
                episode_state = latest["episodes"].get(key, {})
                if not isinstance(episode_state, dict):
                    episode_state = {}
                episode_state["metadata"] = metadata
                latest["episodes"][key] = episode_state
            self.write_adult_series_states(latest)
        return {"ok": True, "series": series_id,
                "metadata": series["metadata"],
                "episodes_matched": len(episode_details)}

    def adult_series_artwork(self, name: str) -> Path:
        if not re.fullmatch(
                r"adult-(?:series-[a-f0-9]{32}-[0-9]+|episode-[a-f0-9]{32}-[0-9]+-[0-9]+)\.jpg",
                name):
            raise ValueError("Series artwork not found")
        path = self.adult_series_artwork_root / name
        if not path.is_file():
            raise ValueError("Series artwork not found")
        return path

    def refresh_channel_show_metadata(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Search or apply a parent-selected match for one series channel."""
        try:
            channel = self.channel(int(payload.get("channel", 0)))
        except (TypeError, ValueError):
            raise ValueError("Choose a valid show channel") from None
        if self.channel_content_type(channel) != "shows":
            raise ValueError("Channel metadata is only available for show channels")
        try:
            tmdb_id = int(payload.get("tmdb_id", 0))
        except (TypeError, ValueError):
            raise ValueError("Choose a TMDB match") from None
        if tmdb_id <= 0:
            query, results = self.channel_show_search(channel)
            return {"ok": True, "channel": int(channel["number"]),
                    "query": query, "results": results}

        metadata = self.channel_show_metadata_for_id(channel, tmdb_id)
        with self.config_lock:
            states = self.channel_media_states()
            channels = states.get("channels", {})
            if not isinstance(channels, dict):
                channels = {}
            channels[str(channel["number"])] = metadata
            states.update({"channels": channels, "updated": time.time()})
            self.write_channel_media_states(states)
        return {"ok": True, "channel": int(channel["number"]),
                "metadata": metadata}

    def refresh_channel_metadata(self) -> dict[str, Any]:
        """Cache one show image per series channel and posters for film channels."""
        channel_updates: dict[str, dict[str, Any]] = {}
        programme_updates: dict[str, dict[str, Any]] = {}
        updated = 0
        skipped = 0
        for channel in self.channels():
            number = int(channel["number"])
            content_type = self.channel_content_type(channel)
            if content_type != "films":
                _, matches = self.channel_show_search(channel)
                match = next((value for value in matches if value.get("id")), None)
                if not isinstance(match, dict):
                    skipped += 1
                    continue
                tmdb_id = int(match["id"])
                channel_updates[str(number)] = self.channel_show_metadata_for_id(
                    channel, tmdb_id)
                updated += 1
                continue

            folder = self.media_root / str(channel["folder"])
            candidates = sorted(
                (item for item in folder.glob("*") if item.is_file()
                 and item.suffix.lower() in SUPPORTED_EXTENSIONS),
                key=lambda path: path.name.casefold()) if folder.is_dir() else []
            for item in candidates:
                metadata = self.channel_film_metadata(channel, item)
                if metadata is None:
                    skipped += 1
                    continue
                programme_updates[self.channel_programme_key(number, item.name)] = metadata
                updated += 1
        with self.config_lock:
            states = self.channel_media_states()
            channels_state = states.get("channels", {})
            programmes_state = states.get("programmes", {})
            if not isinstance(channels_state, dict):
                channels_state = {}
            if not isinstance(programmes_state, dict):
                programmes_state = {}
            channels_state.update(channel_updates)
            programmes_state.update(programme_updates)
            states.update({"channels": channels_state, "programmes": programmes_state,
                           "updated": time.time()})
            self.write_channel_media_states(states)
        return {"ok": True, "updated": updated, "skipped": skipped}

    def refresh_channel_programme_metadata(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Search or apply a parent-selected match for one MabelTV film."""
        try:
            channel = self.channel(int(payload.get("channel", 0)))
        except (TypeError, ValueError):
            raise ValueError("Choose a valid film channel") from None
        if self.channel_content_type(channel) != "films":
            raise ValueError("Metadata refresh is only available for film channels")
        source = self.safe_media_path(channel, str(payload.get("file", "")))
        if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError("That film is no longer in this channel")
        try:
            tmdb_id = int(payload.get("tmdb_id", 0))
        except (TypeError, ValueError):
            raise ValueError("Choose a TMDB match") from None
        if tmdb_id <= 0:
            query, results = self.channel_film_search(source)
            return {"ok": True, "channel": int(channel["number"]),
                    "file": source.name, "query": query, "results": results}

        metadata = self.channel_film_metadata_for_id(channel, source, tmdb_id)
        with self.config_lock:
            states = self.channel_media_states()
            programmes = states.get("programmes", {})
            if not isinstance(programmes, dict):
                programmes = {}
            programmes[self.channel_programme_key(int(channel["number"]), source.name)] = metadata
            states.update({"programmes": programmes, "updated": time.time()})
            self.write_channel_media_states(states)
        return {"ok": True, "channel": int(channel["number"]),
                "file": source.name, "metadata": metadata}

    def channel_artwork(self, name: str) -> Path:
        if not re.fullmatch(r"mabel-(?:show|film)-[0-9]+-[0-9]+\.jpg", name):
            raise ValueError("Artwork not found")
        path = self.channel_artwork_root / name
        if not path.is_file():
            raise ValueError("Artwork not found")
        return path

    def tmdb_search(self, payload: dict[str, Any]) -> dict[str, Any]:
        file_name = str(payload.get("file", ""))
        source = self.safe_adult_path(file_name)
        if not source.is_file():
            raise ValueError("Film not found")
        title = str(payload.get("title", "")).strip()
        if not title:
            title = self.display_name(source.name)
            title = re.sub(r"[._]+", " ", title)
            title = re.sub(r"\b(?:1080p|720p|2160p|bluray|web[- ]?dl|x26[45]|hevc)\b.*$",
                           "", title, flags=re.IGNORECASE).strip()
        year_match = re.search(r"\b(19\d{2}|20\d{2})\b", title)
        year = int(year_match.group(1)) if year_match else None
        if year:
            title = title.replace(str(year), "").strip(" .-()[]")
        parameters: dict[str, Any] = {"query": title, "include_adult": "false", "language": "en-GB"}
        if year:
            parameters["year"] = year
        response = self.tmdb_request("search/movie", parameters)
        results = []
        for value in response.get("results", [])[:12]:
            results.append({
                "id": int(value.get("id", 0)), "title": str(value.get("title", "")),
                "original_title": str(value.get("original_title", "")),
                "year": str(value.get("release_date", ""))[:4],
                "overview": str(value.get("overview", "")),
                "poster_path": str(value.get("poster_path") or ""),
            })
        return {"file": file_name, "query": title, "results": results}

    def tmdb_apply(self, payload: dict[str, Any]) -> dict[str, Any]:
        file_name = str(payload.get("file", ""))
        source = self.safe_adult_path(file_name)
        if not source.is_file():
            raise ValueError("Film not found")
        tmdb_id = int(payload.get("tmdb_id", 0))
        if tmdb_id <= 0:
            raise ValueError("Choose a TMDB match")
        value = self.tmdb_request(f"movie/{tmdb_id}", {"language": "en-GB"})
        poster_path = str(value.get("poster_path") or "")
        poster_name = ""
        if poster_path:
            poster_name = f"tmdb-{tmdb_id}.jpg"
            destination = self.adult_artwork_root / poster_name
            try:
                request = Request(TMDB_IMAGE_BASE_URL + poster_path,
                                  headers={"User-Agent": "MabelTV/0.2.5"})
                with self._open_url(request, timeout=15) as response:
                    data = response.read(8 * 1024 * 1024)
                temporary = destination.with_suffix(".jpg.new")
                temporary.write_bytes(data)
                os.replace(temporary, destination)
            except (HTTPError, URLError, TimeoutError, OSError):
                poster_name = ""
        metadata = {
            "tmdb_id": tmdb_id, "title": str(value.get("title", "")),
            "original_title": str(value.get("original_title", "")),
            "year": str(value.get("release_date", ""))[:4],
            "overview": str(value.get("overview", "")),
            "runtime": int(value.get("runtime") or 0), "poster": poster_name,
            "genres": [str(item["name"]).strip() for item in value.get("genres", [])
                       if isinstance(item, dict) and item.get("name")],
            "updated": time.time(), "provider": "TMDB",
        }
        metadata["subtitles"] = self.fetch_automatic_subtitle(source, tmdb_id)
        with self.config_lock:
            states = self.adult_media_states()
            current = states.get(file_name, {})
            if not isinstance(current, dict):
                current = {}
            current["metadata"] = metadata
            states[file_name] = current
            self.write_adult_media_states(states)
        refreshed = self.refresh_tv()
        return {"ok": True, "file": file_name, "metadata": metadata,
                "refreshed": refreshed}

    def adult_artwork(self, name: str) -> Path:
        if not re.fullmatch(r"(?:tmdb-[1-9][0-9]*|adult-series-[a-f0-9]{32}-[1-9][0-9]*)\.jpg", name):
            raise ValueError("Artwork not found")
        root = self.adult_series_artwork_root if name.startswith("adult-series-") else self.adult_artwork_root
        path = root / name
        if not path.is_file():
            raise ValueError("Artwork not found")
        return path
