"""MediaCatalogue behaviour for the local library service."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from .constants import (
    EPISODE_NAME,
    REMOTE_BROWSER_EXTENSIONS,
    SAFE_NAME,
    SUPPORTED_EXTENSIONS,
)


class MediaCatalogueMixin:
    def read_state(self, kind: str) -> Any:
        database = getattr(self, "state_database", None)
        if database is None:
            raise RuntimeError("MabelTV structured state requires SQLite")
        return database.read(kind)

    def write_state(self, kind: str, value: Any) -> None:
        database = getattr(self, "state_database", None)
        if database is None:
            raise RuntimeError("MabelTV structured state requires SQLite")
        database.write(kind, value)

    def merge_state_fields(self, kind: str, values: dict[str, Any],
                           remove: tuple[str, ...] = ()) -> None:
        database = getattr(self, "state_database", None)
        if database is None:
            raise RuntimeError("MabelTV structured state requires SQLite")
        database.merge_fields(kind, values, remove)

    def save_adult_titles(self, values: dict[str, dict[str, Any]]) -> None:
        database = getattr(self, "state_database", None)
        if database is None:
            raise RuntimeError("MabelTV structured state requires SQLite")
        database.save_adult_titles(values)

    def save_adult_availability(self, title_key: str,
                                payload: dict[str, Any]) -> None:
        database = getattr(self, "state_database", None)
        if database is None:
            raise RuntimeError("MabelTV structured state requires SQLite")
        database.save_adult_availability(title_key, payload)

    def save_explore_feedback(self, values: dict[str, dict[str, Any]],
                              *, retain_since: float | None = None) -> None:
        database = getattr(self, "state_database", None)
        if database is None:
            raise RuntimeError("MabelTV structured state requires SQLite")
        database.save_explore_feedback(values, retain_since=retain_since)

    def save_adult_insights(self, value: dict[str, Any]) -> None:
        database = getattr(self, "state_database", None)
        if database is None:
            raise RuntimeError("MabelTV structured state requires SQLite")
        database.save_adult_insights(value)

    def complete_setup_state(self, channels: list[dict[str, Any]],
                             owner: dict[str, Any]) -> None:
        database = getattr(self, "state_database", None)
        if database is None:
            raise RuntimeError("MabelTV structured state requires SQLite")
        database.complete_setup(channels, owner)

    def insert_channel(self, value: dict[str, Any]) -> None:
        self.state_database.insert_channel(value)

    def update_channel(self, original_number: int, value: dict[str, Any]) -> None:
        self.state_database.update_channel(original_number, value)

    def delete_channel(self, number: int) -> None:
        self.state_database.delete_channel(number)

    def read_json(self, path: Path, fallback: Any) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            return fallback

    def write_json(self, path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + ".new")
        with temporary.open("w", encoding="utf-8") as output:
            output.write(json.dumps(value, indent=2, sort_keys=True) + "\n")
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o640)
        for attempt in range(10):
            try:
                os.replace(temporary, path)
                break
            except PermissionError:
                if attempt == 9:
                    raise
                time.sleep(0.02 * (attempt + 1))
        try:
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        except OSError:
            # Directory fsync is unavailable on some development platforms;
            # the file itself has still been atomically and durably replaced.
            pass

    @staticmethod
    def unlink_with_retry(path: Path) -> None:
        for attempt in range(10):
            try:
                path.unlink(missing_ok=True)
                return
            except PermissionError:
                if attempt == 9:
                    raise
                time.sleep(0.02 * (attempt + 1))

    def clear_superseded_upload_errors(self, channel: int, file_name: str) -> None:
        """Dismiss old errors once the owner deliberately retries that file."""
        for result_path in self.incoming.glob("*.result.json"):
            value = self.read_json(result_path, {})
            try:
                same_channel = int(value.get("channel", -1)) == channel
            except (TypeError, ValueError):
                same_channel = False
            if value.get("status") == "error" and same_channel \
                and value.get("file_name") == file_name:
                self.unlink_with_retry(result_path)

    def channels(self) -> list[dict[str, Any]]:
        return self.read_state("channels").get("channels", [])

    def channel(self, number: int) -> dict[str, Any]:
        for channel in self.channels():
            if channel.get("number") == number:
                return channel
        raise ValueError("Unknown channel")

    def safe_media_path(self, channel: dict[str, Any], file_name: str) -> Path:
        name = Path(file_name).name
        if name != file_name or not name or Path(name).suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError("That is not a supported video file")
        folder = self.media_root / str(channel["folder"])
        folder.mkdir(mode=0o750, exist_ok=True)
        return folder / name

    @staticmethod
    def normalise_adult_folder(folder_name: str) -> str:
        requested = str(folder_name or "").strip()
        name = SAFE_NAME.sub("", requested).strip(". ")
        if (not name or name in {".", ".."} or "/" in requested
                or "\\" in requested or len(name) > 80):
            raise ValueError("Enter a simple folder name")
        return name

    def adult_folder_path(self, folder_name: str, *, create: bool = False) -> Path:
        name = self.normalise_adult_folder(folder_name)
        self.adult_root.mkdir(mode=0o750, exist_ok=True)
        path = self.adult_root / name
        if path.exists() and not path.is_dir():
            raise ValueError("That folder name is already in use")
        if create:
            path.mkdir(mode=0o750, exist_ok=True)
        return path

    def safe_adult_path(self, file_name: str, *, create_folder: bool = False) -> Path:
        relative = str(file_name or "").strip().replace("\\", "/")
        parts = relative.split("/")
        if len(parts) not in {1, 2} or any(not part or part in {".", ".."}
                                           for part in parts):
            raise ValueError("That is not a supported Adult library path")
        name = parts[-1]
        if Path(name).name != name or Path(name).suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError("That is not a supported video file")
        self.adult_root.mkdir(mode=0o750, exist_ok=True)
        parent = self.adult_root
        if len(parts) == 2:
            folder = self.normalise_adult_folder(parts[0])
            if folder != parts[0]:
                raise ValueError("That Adult library folder is not valid")
            parent = self.adult_folder_path(folder, create=create_folder)
        return parent / name

    def adult_relative_path(self, path: Path) -> str:
        try:
            return path.relative_to(self.adult_root).as_posix()
        except ValueError as error:
            raise ValueError("That film is outside the Adult library") from error

    def adult_folders(self) -> list[str]:
        self.adult_root.mkdir(mode=0o750, exist_ok=True)
        return sorted(
            (item.name for item in self.adult_root.iterdir()
             if item.is_dir() and not item.name.startswith(".")),
            key=str.casefold,
        )

    def adult_media_states(self) -> dict[str, dict[str, Any]]:
        value = self.read_state("adult_media")
        return value if isinstance(value, dict) else {}

    def channel_media_states(self) -> dict[str, Any]:
        """Cached TMDB matches for MabelTV shows and film-channel titles."""
        value = self.read_state("channel_metadata")
        return value if isinstance(value, dict) else {}

    def write_channel_media_states(self, values: dict[str, Any]) -> None:
        self.write_state("channel_metadata", values)

    def channel_programme_title(self, channel_number: int, file_name: str) -> str:
        """Return the saved metadata title, falling back to the uploaded name."""
        states = self.channel_media_states()
        programmes = states.get("programmes", {}) if isinstance(states, dict) else {}
        metadata = programmes.get(
            self.channel_programme_key(channel_number, file_name), {}) \
            if isinstance(programmes, dict) else {}
        title = str(metadata.get("title") or "").strip() \
            if isinstance(metadata, dict) else ""
        return title or self.display_name(file_name)

    @staticmethod
    def channel_programme_key(channel_number: int, file_name: str) -> str:
        return f"{int(channel_number)}/{file_name}"

    def channel_programme_duration(self, channel: dict[str, Any],
                                   file_name: str) -> float:
        """Read an active channel programme duration once for the home card."""
        source = self.media_root / str(channel.get("folder", "")) / file_name
        try:
            stat = source.stat()
        except OSError:
            return 0.0
        cache_key = (str(source), int(stat.st_mtime_ns), int(stat.st_size))
        with self.channel_programme_duration_lock:
            cached = self.channel_programme_duration_cache.get(cache_key)
        if cached is not None:
            return cached
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=nw=1:nk=1", str(source)],
                check=False, capture_output=True, text=True, timeout=3,
            )
            duration = float(result.stdout.strip()) if result.returncode == 0 else 0.0
        except (OSError, subprocess.TimeoutExpired, ValueError):
            duration = 0.0
        duration = max(0.0, duration)
        with self.channel_programme_duration_lock:
            self.channel_programme_duration_cache[cache_key] = duration
        return duration

    def channel_film_resume_state(self, channel_number: int,
                                  file_name: str) -> dict[str, float]:
        """Return the shared TV/browser bookmark for a film-channel item."""
        key = self.channel_programme_key(channel_number, file_name)
        state = self.read_state("player")
        if not isinstance(state, dict):
            state = {}
        positions = state.get("channel_film_positions", {})
        durations = state.get("channel_film_durations", {})
        updates = state.get("channel_film_position_updated_utc_ms", {})
        try:
            position = float(positions.get(key, 0) or 0) \
                if isinstance(positions, dict) else 0.0
        except (TypeError, ValueError):
            position = 0.0
        try:
            duration = float(durations.get(key, 0) or 0) \
                if isinstance(durations, dict) else 0.0
        except (TypeError, ValueError):
            duration = 0.0
        try:
            updated = float(updates.get(key, 0) or 0) / 1000.0 \
                if isinstance(updates, dict) else 0.0
        except (TypeError, ValueError):
            updated = 0.0
        return {
            "position": self.normalise_resume_position(max(0.0, position),
                                                       max(0.0, duration)),
            "duration": max(0.0, duration),
            "updated": max(0.0, updated),
        }

    def channel_series_resume_state(
            self, channel_number: int,
            programmes: list[dict[str, Any]]) -> dict[str, Any]:
        """Return the episode and position currently held by a series channel."""
        available = {
            str(programme.get("name", "")): programme
            for programme in programmes
            if programme.get("name") and programme.get("enabled") is not False
        }
        fallback = next(iter(available), "")
        state = self.read_state("player")
        timelines = state.get("channel_timelines", {}) \
            if isinstance(state, dict) else {}
        timeline = timelines.get(str(channel_number), {}) \
            if isinstance(timelines, dict) else {}
        if not isinstance(timeline, dict):
            timeline = {}
        file_name = str(timeline.get("episode_name", ""))
        if file_name not in available:
            file_name = fallback
        try:
            position = max(0.0, float(timeline.get("position_seconds", 0) or 0))
        except (TypeError, ValueError):
            position = 0.0
        if file_name and position <= 0:
            positions = timeline.get("programme_positions", {})
            try:
                position = max(0.0, float(positions.get(file_name, 0) or 0)) \
                    if isinstance(positions, dict) else 0.0
            except (TypeError, ValueError):
                position = 0.0
        programme = available.get(file_name, {})
        metadata = programme.get("metadata", {}) \
            if isinstance(programme, dict) else {}
        title = str(metadata.get("title") or "").strip() \
            if isinstance(metadata, dict) else ""
        return {
            "file": file_name,
            "position": position,
            "browser_ready": programme.get("browser_ready") is not False,
            "title": title or str(programme.get("display_name", "")),
        }

    def write_adult_media_states(self, values: dict[str, dict[str, Any]]) -> None:
        self.write_state("adult_media", values)

    def set_adult_media_state(self, file_name: str, state: str,
                              message: str = "", progress: int | None = None,
                              **details: Any) -> None:
        with self.config_lock:
            values = self.adult_media_states()
            current = values.get(file_name, {})
            if not isinstance(current, dict):
                current = {}
            current.update({"state": state, "message": message, "updated": time.time()})
            if progress is None:
                current.pop("progress", None)
            else:
                current["progress"] = max(0, min(100, int(progress)))
            for key, value in details.items():
                if value is None:
                    current.pop(key, None)
                else:
                    current[key] = value
            values[file_name] = current
            self.write_adult_media_states(values)

    def remove_adult_media_state(self, file_name: str) -> None:
        with self.config_lock:
            values = self.adult_media_states()
            if file_name in values:
                values.pop(file_name, None)
                self.write_adult_media_states(values)

    def recover_adult_optimisations(self) -> None:
        with self.config_lock:
            values = self.adult_media_states()
            changed = False
            for value in values.values():
                if isinstance(value, dict) and value.get("state") in {"queued", "processing"}:
                    value["state"] = "error"
                    value["message"] = "Optimisation was interrupted. Test the film or try again."
                    value["updated"] = time.time()
                    changed = True
            if changed:
                self.write_adult_media_states(values)

    def adult_library(self) -> list[dict[str, Any]]:
        with self.config_lock:
            return self._adult_library()

    def _adult_library(self) -> list[dict[str, Any]]:
        states = self.adult_media_states()
        changed = False
        values = []
        candidates = list(self.adult_root.glob("*"))
        for folder in self.adult_folders():
            candidates.extend((self.adult_root / folder).glob("*"))
        for item in sorted(candidates,
                           key=lambda path: self.adult_relative_path(path).casefold()):
            if item.is_file() and item.suffix.lower() in SUPPORTED_EXTENSIONS:
                relative = self.adult_relative_path(item)
                state = states.get(relative, {})
                if not isinstance(state, dict):
                    state = {}
                if not state.get("library_id"):
                    state["library_id"] = uuid.uuid4().hex
                    states[relative] = state
                    changed = True
                values.append({
                    "name": item.name,
                    "path": relative,
                    "folder": "" if item.parent == self.adult_root else item.parent.name,
                    "library_id": state["library_id"],
                    "display_name": self.display_name(item.name),
                    "size": item.stat().st_size,
                    "playback_state": state.get("state", "original"),
                    "playback_message": state.get("message", ""),
                    "playback_progress": max(0, min(100, int(
                        state.get("progress", 0) or 0))),
                    "metadata": state.get("metadata", {})
                    if isinstance(state.get("metadata"), dict) else {},
                    "favourite": state.get("favourite") is True,
                    "browser_ready": item.suffix.lower() in REMOTE_BROWSER_EXTENSIONS,
                    "remote_position": self.remote_resume_position(state["library_id"], state),
                    "remote_duration": self.remote_resume_duration(
                        state["library_id"], state),
                    "remote_last_watched": self.remote_last_watched(
                        state["library_id"], state),
                })
        if changed:
            self.write_adult_media_states(states)
        return values

    def adult_optimisations(self) -> dict[str, Any]:
        """Return the tiny, frequently polled subset of Adult TV state.

        Keeping this separate from /api/library prevents an optimisation from
        rebuilding every portal view and throwing an iPhone back to the top.
        """
        states = self.adult_media_states()
        items = []
        for path, value in states.items():
            if not isinstance(value, dict):
                continue
            state = str(value.get("state", "original"))
            if state not in {"queued", "processing", "paused", "optimised", "error"}:
                continue
            items.append({
                "path": path,
                "title": self.display_name(Path(path).name),
                "state": state,
                "progress": max(0, min(100, int(value.get("progress", 0) or 0))),
                "message": str(value.get("message", "")),
                "updated": float(value.get("updated", 0) or 0),
                "started": float(value.get("started", 0) or 0),
                "eta_seconds": max(0, int(value.get("eta_seconds", 0) or 0)),
            })
        return {"items": items, "active": any(
            item["state"] in {"queued", "processing", "paused"} for item in items)}

    def adult_series_states(self) -> dict[str, Any]:
        value = self.read_state("adult_series")
        if not isinstance(value, dict):
            value = {}
        if not isinstance(value.get("series"), dict):
            value["series"] = {}
        if not isinstance(value.get("episodes"), dict):
            value["episodes"] = {}
        return value

    def write_adult_series_states(self, values: dict[str, Any]) -> None:
        values["updated"] = time.time()
        self.write_state("adult_series", values)

    @staticmethod
    def normalise_series_title(value: str) -> str:
        title = SAFE_NAME.sub("", str(value or "").strip()).strip(". ")
        if not title or len(title) > 80:
            raise ValueError("Enter a series name")
        return title

    def create_adult_series(self, title: str) -> str:
        title = self.normalise_series_title(title)
        with self.config_lock:
            states = self.adult_series_states()
            for series_id, value in states["series"].items():
                if isinstance(value, dict) and str(value.get("title", "")).casefold() == title.casefold():
                    (self.adult_series_root / series_id).mkdir(mode=0o750, exist_ok=True)
                    return series_id
            series_id = uuid.uuid4().hex
            states["series"][series_id] = {
                "title": title, "created": time.time(), "metadata": {},
            }
            (self.adult_series_root / series_id).mkdir(mode=0o750, exist_ok=True)
            self.write_adult_series_states(states)
            return series_id

    def create_adult_season(self, series_id: str, season: Any) -> int:
        """Create one explicit, empty series destination inside an existing show."""
        try:
            number = int(season)
        except (TypeError, ValueError) as error:
            raise ValueError("Choose a valid series number") from error
        if number < 1 or number > 99:
            raise ValueError("Choose a series number from 1 to 99")
        destination = self.adult_series_path(series_id, f"Season {number}")
        if destination.exists():
            raise ValueError(f"Series {number} already exists")
        destination.mkdir(mode=0o750)
        return number

    def adult_series_path(self, series_id: str, relative: str = "") -> Path:
        if not re.fullmatch(r"[a-f0-9]{32}", str(series_id)):
            raise ValueError("That Adult TV series is not valid")
        root = (self.adult_series_root / series_id).resolve()
        if not root.is_dir():
            raise ValueError("That Adult TV series no longer exists")
        relative_path = Path(str(relative or "").replace("\\", "/"))
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise ValueError("That episode path is not valid")
        candidate = root.joinpath(relative_path).resolve()
        if candidate != root and root not in candidate.parents:
            raise ValueError("That episode path is not valid")
        return candidate

    @staticmethod
    def adult_episode_identity(path: Path, ordinal: int = 0) -> dict[str, Any]:
        stem = re.sub(r"[._]+", " ", path.stem).strip()
        match = re.search(r"(?i)\bS(?:eries|eason)?\s*0*(\d{1,2})\s*E(?:pisode)?\s*0*(\d{1,3})\b", stem)
        if not match:
            match = re.search(r"(?i)\b0*(\d{1,2})x0*(\d{1,3})\b", stem)
        season = int(match.group(1)) if match else 0
        episode = int(match.group(2)) if match else max(1, ordinal)
        if not season:
            parent = re.search(r"(?i)\b(?:series|season)\s*0*(\d{1,2})\b", path.parent.name)
            season = int(parent.group(1)) if parent else 1
        title = stem
        if match:
            title = (stem[:match.start()] + " " + stem[match.end():]).strip(" .-_[]()")
        title = re.sub(
            r"(?i)\b(?:480p|720p|1080p|2160p|hdtv|web[- ]?dl|bluray|xvid|x26[45]|hevc)\b.*$",
            "", title).strip(" .-_")
        return {"season": season, "episode": episode,
                "title": title or f"Episode {episode}"}

    def adult_series_library(self) -> list[dict[str, Any]]:
        with self.config_lock:
            states = self.adult_series_states()
            changed = False
            values: list[dict[str, Any]] = []
            for series_id, series_state in sorted(
                    states["series"].items(),
                    key=lambda item: str(item[1].get("title", "")).casefold()
                    if isinstance(item[1], dict) else str(item[0])):
                if not re.fullmatch(r"[a-f0-9]{32}", str(series_id)) \
                        or not isinstance(series_state, dict):
                    continue
                root = self.adult_series_root / series_id
                if not root.is_dir():
                    continue
                files = sorted(
                    (item for item in root.rglob("*") if item.is_file()
                     and item.suffix.lower() in SUPPORTED_EXTENSIONS),
                    key=lambda item: item.relative_to(root).as_posix().casefold())
                episodes = []
                for ordinal, item in enumerate(files, 1):
                    relative = item.relative_to(root).as_posix()
                    key = f"{series_id}/{relative}"
                    episode_state = states["episodes"].get(key, {})
                    if not isinstance(episode_state, dict):
                        episode_state = {}
                    if not episode_state.get("library_id"):
                        episode_state["library_id"] = uuid.uuid4().hex
                        states["episodes"][key] = episode_state
                        changed = True
                    parsed = self.adult_episode_identity(item, ordinal)
                    metadata = episode_state.get("metadata", {})
                    if not isinstance(metadata, dict):
                        metadata = {}
                    position = self.normalise_resume_position(
                        float(episode_state.get("remote_position", 0) or 0),
                        float(episode_state.get("remote_duration", 0) or 0))
                    episodes.append({
                        "path": relative, "name": item.name,
                        "display_name": metadata.get("title") or parsed["title"],
                        "season": int(metadata.get("season_number") or parsed["season"]),
                        "episode": int(metadata.get("episode_number") or parsed["episode"]),
                        "overview": str(metadata.get("overview", "")),
                        "air_date": str(metadata.get("air_date", "")),
                        "still": str(metadata.get("still", "")),
                        "library_id": episode_state["library_id"],
                        "size": item.stat().st_size,
                        "browser_ready": self.remote_browser_ready(item),
                        "watched": episode_state.get("watched") is True,
                        "remote_position": position,
                        "remote_duration": float(episode_state.get("remote_duration", 0) or 0),
                        "remote_last_watched": float(episode_state.get("remote_last_watched", 0) or 0),
                    })
                episodes.sort(key=lambda value: (
                    value["season"], value["episode"], value["display_name"].casefold()))
                folder_seasons = {
                    int(match.group(1))
                    for item in root.iterdir() if item.is_dir()
                    for match in [re.fullmatch(r"(?i)Season\s+0*([1-9][0-9]?)", item.name)]
                    if match
                }
                seasons = sorted(folder_seasons | {
                    int(value["season"]) for value in episodes
                })
                metadata = series_state.get("metadata", {})
                values.append({
                    "id": series_id,
                    "title": str(metadata.get("title") or series_state.get("title") or "Series"),
                    "stored_title": str(series_state.get("title") or "Series"),
                    "favourite": series_state.get("favourite") is True,
                    "metadata": metadata if isinstance(metadata, dict) else {},
                    "episodes": episodes,
                    "seasons": seasons,
                    "episode_count": len(episodes),
                    "season_count": len(seasons),
                    "watched_count": sum(value["watched"] for value in episodes),
                })
            if changed:
                self.write_adult_series_states(states)
            return values

    def sync_adult_series_viewing_episodes(
            self, series_id: str, updates: dict[str, bool]) -> None:
        """Keep local episode history and the combined title view aligned."""
        if not updates:
            return
        with self.config_lock:
            states = self.adult_series_states()
            series_state = states["series"].get(series_id, {})
            if not isinstance(series_state, dict):
                return
            metadata = series_state.get("metadata", {})
            if not isinstance(metadata, dict):
                return
            try:
                key = self.adult_title_key("tv", metadata.get("tmdb_id"))
            except ValueError:
                return
            store = self.adult_viewing_store()
            current = store["titles"].get(key, {})
            if not isinstance(current, dict):
                current = {}
            episodes = current.setdefault("episodes", {})
            if not isinstance(episodes, dict):
                episodes = {}
                current["episodes"] = episodes
            now = time.time()
            for episode_key, watched in updates.items():
                episodes[episode_key] = {"watched": bool(watched), "updated": now}
            current.update({
                "media_type": "tv", "tmdb_id": int(key.split(":", 1)[1]),
                "title": str(metadata.get("title") or series_state.get("title") or "Series"),
                "year": str(metadata.get("year") or ""), "updated": now,
            })
            self.save_adult_titles({key: current})

    def set_adult_episode_watched(self, series_id: str, relative: str,
                                  watched: bool) -> dict[str, Any]:
        source = self.adult_series_path(series_id, relative)
        if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError("That episode no longer exists")
        key = f"{series_id}/{source.relative_to(self.adult_series_root / series_id).as_posix()}"
        with self.config_lock:
            states = self.adult_series_states()
            value = states["episodes"].get(key, {})
            if not isinstance(value, dict):
                value = {}
            was_watched = value.get("watched") is True
            if watched and not was_watched:
                duration = max(0.0, float(value.get("remote_duration", 0) or 0))
                position = self.normalise_resume_position(
                    float(value.get("remote_position", 0) or 0), duration)
                if position > 0:
                    value["pre_watched_resume"] = {
                        "position": position,
                        "duration": duration,
                        "last_watched": max(
                            0.0, float(value.get("remote_last_watched", 0) or 0)),
                    }
            elif not watched and was_watched:
                resume = value.pop("pre_watched_resume", {})
                if isinstance(resume, dict):
                    duration = max(0.0, float(resume.get("duration", 0) or 0))
                    position = self.normalise_resume_position(
                        float(resume.get("position", 0) or 0), duration)
                    if position > 0:
                        value["remote_position"] = position
                        value["remote_duration"] = duration
                        value["remote_last_watched"] = max(
                            0.0, float(resume.get("last_watched", 0) or 0))
            value["watched"] = bool(watched)
            value["watched_updated"] = time.time()
            if watched:
                value["remote_position"] = 0.0
                value["remote_last_watched"] = 0.0
            states["episodes"][key] = value
            self.write_adult_series_states(states)
            identity = self.adult_episode_identity(source)
            metadata = value.get("metadata", {})
            if not isinstance(metadata, dict):
                metadata = {}
            season_number = int(metadata.get("season_number") or identity["season"])
            episode_number = int(metadata.get("episode_number") or identity["episode"])
        self.sync_adult_series_viewing_episodes(
            series_id, {f"{season_number}:{episode_number}": bool(watched)})
        return {
            "ok": True, "series": series_id, "path": relative,
            "watched": bool(watched),
            "remote_position": float(value.get("remote_position", 0) or 0),
            "remote_duration": float(value.get("remote_duration", 0) or 0),
            "remote_last_watched": float(value.get("remote_last_watched", 0) or 0),
        }

    def set_adult_season_watched(self, series_id: str, season: Any,
                                 watched: bool) -> dict[str, Any]:
        """Set every local episode in one season without discarding resume history."""
        try:
            season_number = int(season)
        except (TypeError, ValueError):
            raise ValueError("Choose a valid series") from None
        if season_number < 1:
            raise ValueError("Choose a valid series")
        series = next((value for value in self.adult_series_library()
                       if value.get("id") == series_id), None)
        if not isinstance(series, dict):
            raise ValueError("That Adult TV series no longer exists")
        targets = [str(episode.get("path") or "")
                   for episode in series.get("episodes", [])
                   if int(episode.get("season", 0) or 0) == season_number]
        if not targets:
            raise ValueError("That series has no episodes")
        updated = [self.set_adult_episode_watched(series_id, relative, watched)
                   for relative in targets]
        return {
            "ok": True, "series": series_id, "season": season_number,
            "watched": bool(watched), "episodes_updated": len(targets),
            "episodes": updated,
        }

    def restart_adult_series_progress(self, series_id: str, scope: str,
                                      season: int | None = None) -> dict[str, Any]:
        """Clear watched state and resume points for one season or show."""
        root = self.adult_series_path(series_id)
        if not root.is_dir():
            raise ValueError("That TV series no longer exists")
        if scope not in {"season", "series"}:
            raise ValueError("Choose a series or complete show to restart")
        if scope == "season":
            try:
                season_number = int(season)
            except (TypeError, ValueError) as error:
                raise ValueError("Choose a series to restart") from error
            if season_number < 0:
                raise ValueError("Choose a series to restart")
        else:
            season_number = None

        prefix = f"{series_id}/"
        changed = 0
        viewing_episode_keys: set[str] = set()
        with self.config_lock:
            states = self.adult_series_states()
            for key, raw_value in list(states["episodes"].items()):
                if not str(key).startswith(prefix):
                    continue
                relative = str(key)[len(prefix):]
                source = root / relative
                if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
                    continue
                value = raw_value if isinstance(raw_value, dict) else {}
                metadata = value.get("metadata", {})
                if not isinstance(metadata, dict):
                    metadata = {}
                parsed = self.adult_episode_identity(source)
                episode_season = int(
                    metadata.get("season_number") or parsed["season"])
                if season_number is not None:
                    if episode_season != season_number:
                        continue
                value["watched"] = False
                value["watched_updated"] = time.time()
                value["remote_position"] = 0.0
                value["remote_last_watched"] = 0.0
                value.pop("pre_watched_resume", None)
                states["episodes"][key] = value
                episode_number = int(
                    metadata.get("episode_number") or parsed["episode"])
                viewing_episode_keys.add(f"{episode_season}:{episode_number}")
                changed += 1
            self.write_adult_series_states(states)
        changed = max(changed, self.reset_adult_series_viewing_progress(
            series_id, season_number, viewing_episode_keys))
        return {
            "ok": True,
            "series": series_id,
            "scope": scope,
            "season": season_number,
            "preserved_watched": False,
            "episodes_reset": changed,
        }

    def trash_adult_series_items(self, payload: dict[str, Any]) -> int:
        """Move an episode, a season, or a complete Adult TV series to the bin."""
        series_id = str(payload.get("series", ""))
        root = self.adult_series_path(series_id)
        scope = str(payload.get("scope", "episode"))
        if scope not in {"episode", "season", "series"}:
            raise ValueError("Choose an episode, series, or complete show to remove")
        with self.config_lock:
            states = self.adult_series_states()
            series_state = states["series"].get(series_id)
            if not isinstance(series_state, dict):
                raise ValueError("That Adult TV series no longer exists")
            title = str(series_state.get("metadata", {}).get("title")
                        if isinstance(series_state.get("metadata"), dict) else "") \
                or str(series_state.get("title") or "Series")
            all_files = [item for item in root.rglob("*") if item.is_file()
                         and item.suffix.lower() in SUPPORTED_EXTENSIONS]
            season_directory: Path | None = None
            if scope == "episode":
                source = self.adult_series_path(series_id, str(payload.get("file", "")))
                if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
                    raise ValueError("That episode no longer exists")
                files = [source]
            elif scope == "season":
                try:
                    season = int(payload.get("season"))
                except (TypeError, ValueError) as error:
                    raise ValueError("Choose a series to remove") from error
                episode_seasons = {
                    item["path"]: int(item["season"])
                    for value in self.adult_series_library() if value["id"] == series_id
                    for item in value["episodes"]
                }
                files = [item for item in all_files
                         if episode_seasons.get(item.relative_to(root).as_posix()) == season]
                season_directory = self.adult_series_path(
                    series_id, f"Season {season}")
                if not files and not season_directory.is_dir():
                    raise ValueError(f"Series {season} does not exist")
            else:
                files = all_files

            moved = 0
            moved_keys: list[str] = []
            for source in files:
                relative = source.relative_to(root).as_posix()
                key = f"{series_id}/{relative}"
                item_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"
                destination_dir = self.bin / item_id
                destination_dir.mkdir(mode=0o750)
                self.write_json(destination_dir / "manifest.json", {
                    "id": item_id,
                    "file_name": source.name,
                    "folder": source.parent.relative_to(self.media_root).as_posix(),
                    "channel_name": f"Adult TV · {title}",
                    "adult_series_id": series_id,
                    "adult_series_state": series_state,
                    "adult_series_episode_state": states["episodes"].get(key, {}),
                })
                try:
                    shutil.move(str(source), str(destination_dir / source.name))
                except Exception:
                    shutil.rmtree(destination_dir, ignore_errors=True)
                    raise
                moved += 1
                moved_keys.append(key)

            for key in moved_keys:
                states["episodes"].pop(key, None)
            if scope == "series":
                states["series"].pop(series_id, None)
            self.write_adult_series_states(states)
            if season_directory is not None and season_directory.is_dir() \
                    and not any(season_directory.iterdir()):
                season_directory.rmdir()
            if scope == "series":
                for directory in sorted(
                        (item for item in root.rglob("*") if item.is_dir()),
                        key=lambda item: len(item.parts), reverse=True):
                    if not any(directory.iterdir()):
                        directory.rmdir()
            if scope == "series" and root.is_dir() and not any(root.iterdir()):
                root.rmdir()
            return moved

    def upload_destination(self, metadata: dict[str, Any]) -> Path:
        if metadata.get("kind") == "adult":
            folder = str(metadata.get("folder", ""))
            relative = f"{folder}/{metadata.get('file_name', '')}" if folder \
                else str(metadata.get("file_name", ""))
            return self.safe_adult_path(relative, create_folder=bool(folder))
        if metadata.get("kind") == "adult-series":
            series_id = str(metadata.get("series_id", ""))
            season = int(metadata.get("season", 0) or 0)
            if season < 1 or season > 99:
                raise ValueError("That series upload has no valid series number")
            return self.adult_series_path(
                series_id, f"Season {season}/{metadata.get('file_name', '')}")
        channel = self.channel(int(metadata.get("channel")))
        return self.safe_media_path(channel, str(metadata.get("file_name", "")))

    def settings(self) -> dict[str, Any]:
        return self.read_state("settings")

    @staticmethod
    def parent_overlay_style(settings: dict[str, Any]) -> str:
        return "modern" if settings.get("parent_overlay_style") == "modern" else "classic"

    @staticmethod
    def tv_guide_enabled(settings: dict[str, Any]) -> bool:
        return settings.get("tv_guide_enabled") is True

    @staticmethod
    def tv_settings(settings: dict[str, Any]) -> dict[str, Any]:
        """Return the same safe, supported values offered by the TV menu."""
        volume = settings.get("volume")
        if not isinstance(volume, dict):
            volume = {}

        def choice(name: str, allowed: set[str], fallback: str) -> str:
            value = settings.get(name)
            return value if isinstance(value, str) and value in allowed else fallback

        def bounded(value: Any, fallback: int, minimum: int = 0) -> int:
            if isinstance(value, bool):
                return fallback
            try:
                return max(minimum, min(100, int(value)))
            except (TypeError, ValueError):
                return fallback

        episode_reset = settings.get("episode_reset_minutes")
        if (isinstance(episode_reset, bool) or not isinstance(episode_reset, int)
                or episode_reset not in {0, 5, 20, 60, 180}):
            episode_reset = 0

        return {
            "playback_mode": choice("playback_mode", {"continuous", "resume"}, "continuous"),
            "episode_reset_minutes": episode_reset,
            "picture_mode": choice("picture_mode", {"channel", "crop", "fit", "stretch"}, "channel"),
            "tv_border": choice("tv_border", {"slim-black", "silver-90s", "charcoal-90s", "vintage-black", "dinosaur-den", "ocean-club", "finding-nemo"}, "slim-black"),
            "crt_glass": bounded(settings.get("crt_glass"), 35),
            "video_distortion": bounded(settings.get("video_distortion"), 20),
            "display_resolution": choice("display_resolution", {"720p", "1080p", "native"}, "720p"),
            "volume_limit_enabled": volume.get("limit_enabled") is True,
            "maximum_volume": bounded(volume.get("maximum"), 60, 5),
            "sound_effects_enabled": settings.get("sound_effects_enabled") is not False,
            "scrubbing_enabled": settings.get("scrubbing_enabled") is True,
        }

    def library(self) -> dict[str, Any]:
        settings = self.settings()
        rules = settings.get("library", {})
        disabled_channels = set(rules.get("disabled_channels", []))
        disabled_programmes = rules.get("disabled_programmes", {})
        channel_media = self.channel_media_states()
        channel_metadata = channel_media.get("channels", {})
        programme_metadata = channel_media.get("programmes", {})
        stored_channel_favourites = channel_media.get("favourites", [])
        channel_favourites = set(stored_channel_favourites) \
            if isinstance(stored_channel_favourites, list) else set()
        stored_favourite_channels = channel_media.get("favourite_channels", [])
        favourite_channels = {
            int(value) for value in stored_favourite_channels
            if isinstance(value, int)
            or (isinstance(value, str) and value.isdigit())
        } if isinstance(stored_favourite_channels, list) else set()
        if not isinstance(channel_metadata, dict):
            channel_metadata = {}
        if not isinstance(programme_metadata, dict):
            programme_metadata = {}
        response = []
        for channel in self.channels():
            folder = self.media_root / str(channel["folder"])
            programmes = []
            is_film_channel = self.channel_content_type(channel) == "films"
            for item in sorted(
                    folder.glob("*") if folder.is_dir() else [],
                    key=lambda path: (
                        re.sub(r"^the\s+", "", self.display_name(path.name), flags=re.IGNORECASE).casefold(),
                        self.display_name(path.name).casefold(),
                    ) if is_film_channel else (path.name.casefold(), "")):
                if item.is_file() and item.suffix.lower() in SUPPORTED_EXTENSIONS:
                    disabled = set(disabled_programmes.get(str(channel["number"]), []))
                    programme = {
                        "name": item.name,
                        "display_name": self.display_name(item.name),
                        "enabled": item.name not in disabled,
                        "browser_ready": self.remote_browser_ready(item),
                        "metadata": programme_metadata.get(
                            self.channel_programme_key(channel["number"], item.name), {}),
                        "favourite": self.channel_programme_key(
                            channel["number"], item.name) in channel_favourites,
                    }
                    if is_film_channel:
                        resume = self.channel_film_resume_state(
                            int(channel["number"]), item.name)
                        programme.update({
                            "remote_position": resume["position"],
                            "remote_duration": resume["duration"],
                            "remote_last_watched": resume["updated"],
                        })
                    programmes.append(programme)
            series_resume = self.channel_series_resume_state(
                int(channel["number"]), programmes) if not is_film_channel else {}
            response.append({"number": channel["number"], "name": channel["name"],
                             "folder": channel["folder"],
                             "aspect": channel.get("aspect", "crop"),
                             "content_type": self.channel_content_type(channel),
                             "enabled": channel["number"] not in disabled_channels,
                             "favourite": (not is_film_channel
                                           and int(channel["number"])
                                           in favourite_channels),
                             "resume_file": series_resume.get("file", ""),
                             "resume_position": series_resume.get("position", 0),
                             "resume_browser_ready": series_resume.get(
                                 "browser_ready", True),
                             "resume_title": series_resume.get("title", ""),
                             "programmes": programmes,
                             "enabled_programmes": sum(p["enabled"] for p in programmes),
                             "metadata": channel_metadata.get(
                                 str(channel["number"]), {})})
        disk = shutil.disk_usage(self.media_root)
        owner = self.owner()
        return {
            "channels": response,
            "appearance": {
                "parent_overlay_style": self.parent_overlay_style(settings),
                "tv_guide_enabled": self.tv_guide_enabled(settings),
            },
            "tv_settings": self.tv_settings(settings),
            "remote_viewing": self.remote_settings(),
            "adult_settings": {"watchmode_availability_enabled":
                               settings.get("watchmode_availability_enabled") is not False},
            "adult_library": self.adult_library(),
            "adult_folders": self.adult_folders(),
            "adult_series": self.adult_series_library(),
            "recycle": self.recycle_items(),
            "uploads": self.upload_jobs(),
            "storage": {"free_gb": disk.free / 1024**3,
                        "used_gb": disk.used / 1024**3,
                        "total_gb": disk.total / 1024**3},
            "system": self.system_status(),
            "owner": {"name": owner.get("owner_name", "Owner"),
                      "child_name": self.tv_identity()[0],
                      "tv_name": self.tv_identity()[1],
                      "portal_pin_required": self.portal_pin_required(),
                      "pin_change_recommended": bool(owner.get("legacy_default_pin"))},
        }

    @staticmethod
    def display_name(name: str) -> str:
        stem = Path(name).stem.replace("_", " ").strip()
        match = EPISODE_NAME.match(stem)
        if match:
            return f"S{int(match.group(1)):02} E{int(match.group(2)):02} · {match.group(3).strip()}"
        return stem
