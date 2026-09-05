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
    @staticmethod
    def read_json(path: Path, fallback: Any) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            return fallback

    @staticmethod
    def write_json(path: Path, value: Any) -> None:
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
        return self.read_json(self.channels_path, {}).get("channels", [])

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
        value = self.read_json(self.adult_metadata_path, {})
        return value if isinstance(value, dict) else {}

    def channel_media_states(self) -> dict[str, Any]:
        """Cached TMDB matches for MabelTV shows and film-channel titles."""
        value = self.read_json(self.channel_metadata_path, {})
        return value if isinstance(value, dict) else {}

    def write_channel_media_states(self, values: dict[str, Any]) -> None:
        self.write_json(self.channel_metadata_path, values)

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
        state = self.read_json(self.player_state_path, {})
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
        state = self.read_json(self.player_state_path, {})
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
        self.write_json(self.adult_metadata_path, values)

    def set_adult_media_state(self, file_name: str, state: str,
                              message: str = "", progress: int | None = None,
                              **details: Any) -> None:
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
        values = self.adult_media_states()
        if file_name in values:
            values.pop(file_name, None)
            self.write_adult_media_states(values)

    def recover_adult_optimisations(self) -> None:
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
        value = self.read_json(self.adult_series_state_path, {})
        if not isinstance(value, dict):
            value = {}
        if not isinstance(value.get("series"), dict):
            value["series"] = {}
        if not isinstance(value.get("episodes"), dict):
            value["episodes"] = {}
        return value

    def write_adult_series_states(self, values: dict[str, Any]) -> None:
        values["updated"] = time.time()
        self.write_json(self.adult_series_state_path, values)

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
                metadata = series_state.get("metadata", {})
                values.append({
                    "id": series_id,
                    "title": str(metadata.get("title") or series_state.get("title") or "Series"),
                    "stored_title": str(series_state.get("title") or "Series"),
                    "favourite": series_state.get("favourite") is True,
                    "metadata": metadata if isinstance(metadata, dict) else {},
                    "episodes": episodes,
                    "episode_count": len(episodes),
                    "season_count": len({value["season"] for value in episodes}),
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
            if any(updates.values()):
                current["watchlisted"] = False
            store["titles"][key] = current
            self.write_adult_viewing_store(store)

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
        """Clear watched and resume history for one season or complete show."""
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
        viewing_updates: dict[str, bool] = {}
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
                viewing_updates[f"{episode_season}:{episode_number}"] = False
                changed += 1
            self.write_adult_series_states(states)
        self.sync_adult_series_viewing_episodes(series_id, viewing_updates)
        return {
            "ok": True,
            "series": series_id,
            "scope": scope,
            "season": season_number,
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
                if not files:
                    raise ValueError(f"Series {season} has no episodes to remove")
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
        return self.read_json(self.settings_path, {"schema_version": 1})

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
            "tv_border": choice("tv_border", {"slim-black", "silver-90s", "charcoal-90s", "vintage-black"}, "slim-black"),
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
                "portal_theme": settings.get("portal_theme")
                if settings.get("portal_theme") in {"dark", "light"} else "dark",
                "portal_design": settings.get("portal_design")
                if settings.get("portal_design") in {"current", "signal", "aperture"} else "current",
                "portal_palette": settings.get("portal_palette")
                if settings.get("portal_palette") in {
                    "ember", "tide", "grove", "plum", "ochre", "mono"
                } else "ember",
            },
            "tv_settings": self.tv_settings(settings),
            "remote_viewing": self.remote_settings(),
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

    def reconcile_recycle_items(self) -> None:
        """Resolve a power loss on either side of a recycle-bin move."""
        for manifest_path in self.bin.glob("*/manifest.json"):
            item = self.read_json(manifest_path, {})
            file_name = Path(str(item.get("file_name", ""))).name
            folder = str(item.get("folder", ""))
            if not file_name or not folder:
                continue
            recycled = manifest_path.parent / file_name
            original = self.media_root / folder / file_name
            if recycled.is_file():
                # The intent record was durable before the atomic move, so a
                # crash after the move still leaves a visible restorable item.
                continue
            if original.is_file():
                # Crash/failure occurred before the move. The programme never
                # left its channel, so discard only the empty intent record.
                try:
                    shutil.rmtree(manifest_path.parent)
                except OSError as error:
                    print(f"Could not clear incomplete recycle item {manifest_path.parent}: {error}",
                          file=sys.stderr, flush=True)

    def recycle_items(self) -> list[dict[str, str]]:
        values = []
        for manifest in self.bin.glob("*/manifest.json"):
            item = self.read_json(manifest, {})
            file_name = Path(str(item.get("file_name", ""))).name
            if item.get("id") and file_name \
                and (manifest.parent / file_name).is_file():
                values.append({"id": item["id"], "display_name": self.display_name(item["file_name"]), "channel_name": item.get("channel_name", "Unknown channel")})
        return sorted(values, key=lambda value: value["id"], reverse=True)

    def update_settings(self, mutator: Any) -> None:
        with self.config_lock:
            settings = self.settings()
            library = settings.setdefault("library", {})
            library.setdefault("disabled_channels", [])
            library.setdefault("disabled_programmes", {})
            mutator(library)
            self.write_json(self.settings_path, settings)

    def update_channels(self, mutator: Any) -> None:
        with self.config_lock:
            root = self.read_json(self.channels_path, {"schema_version": 1, "channels": []})
            values = root.get("channels", [])
            mutator(values)
            root["schema_version"] = 1
            root["channels"] = self.normalise_channels(values)
            self.write_json(self.channels_path, root)

    def refresh_tv(self) -> bool:
        for attempt in range(3):
            try:
                if subprocess.run(
                        ["sudo", "-n", "/usr/local/libexec/mabeltv-library-refresh"],
                        check=False, capture_output=True, timeout=15).returncode == 0:
                    return True
            except (OSError, subprocess.TimeoutExpired):
                pass
            if attempt < 2:
                time.sleep(0.5 * (attempt + 1))
        return False

    def manage(self, payload: dict[str, Any]) -> bool:
        # Channel changes and upload admission share the same lock so a channel
        # cannot be renumbered or deleted between an upload check and creation.
        if payload.get("action") == "refresh":
            return self.refresh_tv()
        with self.config_lock:
            self._manage(payload)
        if payload.get("action") in {
                "optimise-adult", "set-portal-design", "set-portal-palette",
                "set-portal-theme", "set-remote-simultaneous",
                "create-adult-series", "trash-adult-series", "optimisation-action"}:
            # These settings belong to the portal/library service.  In
            # particular, allowing a browser stream alongside the television
            # must never refresh or otherwise disturb the TV player.
            return True
        return self.refresh_tv()

    def _manage(self, payload: dict[str, Any]) -> None:
        action = payload.get("action")
        if action == "optimisation-action":
            self.adult_optimisation_action(str(payload.get("file", "")),
                                           str(payload.get("operation", "")))
            return
        if action == "create-adult-series":
            self.create_adult_series(str(payload.get("name", "")))
            return
        if action == "trash-adult-series":
            self.trash_adult_series_items(payload)
            return
        if action == "set-parent-overlay-style":
            style = str(payload.get("style", ""))
            if style not in {"classic", "modern"}:
                raise ValueError("Choose the classic or modern parent-control design")
            settings = self.settings()
            settings["parent_overlay_style"] = style
            self.write_json(self.settings_path, settings)
            return
        if action == "set-portal-theme":
            theme = str(payload.get("theme", ""))
            if theme not in {"dark", "light"}:
                raise ValueError("Choose the light or dark portal theme")
            settings = self.settings()
            settings["portal_theme"] = theme
            self.write_json(self.settings_path, settings)
            return
        if action == "set-portal-design":
            design = str(payload.get("design", ""))
            if design not in {"current", "signal", "aperture"}:
                raise ValueError("Choose the current, Signal, or Aperture portal design")
            settings = self.settings()
            settings["portal_design"] = design
            self.write_json(self.settings_path, settings)
            return
        if action == "set-portal-palette":
            palette = str(payload.get("palette", ""))
            if palette not in {
                    "ember", "tide", "grove", "plum", "ochre", "mono"}:
                raise ValueError("Choose one of the available portal palettes")
            settings = self.settings()
            settings["portal_palette"] = palette
            self.write_json(self.settings_path, settings)
            return
        if action == "set-tv-guide-enabled":
            enabled = payload.get("enabled")
            if not isinstance(enabled, bool):
                raise ValueError("Choose whether the TV guide is on or off")
            settings = self.settings()
            settings["tv_guide_enabled"] = enabled
            self.write_json(self.settings_path, settings)
            return
        if action == "set-remote-simultaneous":
            enabled = payload.get("enabled")
            if not isinstance(enabled, bool):
                raise ValueError("Choose whether simultaneous viewing is allowed")
            settings = self.settings()
            settings["remote_allow_simultaneous"] = enabled
            self.write_json(self.settings_path, settings)
            return
        if action == "set-tv-settings":
            requested = payload.get("settings")
            if not isinstance(requested, dict):
                raise ValueError("Choose the TV settings to save")

            settings = self.settings()
            playback_mode = requested.get("playback_mode")
            picture_mode = requested.get("picture_mode")
            tv_border = requested.get("tv_border")
            display_resolution = requested.get("display_resolution")
            episode_reset_minutes = requested.get("episode_reset_minutes")
            crt_glass = requested.get("crt_glass")
            video_distortion = requested.get("video_distortion")
            maximum_volume = requested.get("maximum_volume")
            volume_limit_enabled = requested.get("volume_limit_enabled")
            sound_effects_enabled = requested.get("sound_effects_enabled")
            # An already-open, older portal page can submit the rest of the
            # form without this newer field. Retain its current value instead
            # of rejecting an otherwise valid TV-settings save.
            scrubbing_enabled = requested.get(
                "scrubbing_enabled", settings.get("scrubbing_enabled") is True)

            if playback_mode not in {"continuous", "resume"}:
                raise ValueError("Choose a playback behaviour")
            if picture_mode not in {"channel", "crop", "fit", "stretch"}:
                raise ValueError("Choose a picture mode")
            if tv_border not in {"slim-black", "silver-90s", "charcoal-90s", "vintage-black"}:
                raise ValueError("Choose a TV cabinet")
            if display_resolution not in {"720p", "1080p", "native"}:
                raise ValueError("Choose a display resolution")
            if episode_reset_minutes not in {0, 5, 20, 60, 180}:
                raise ValueError("Choose a valid episode reset time")
            if any(isinstance(value, bool) or not isinstance(value, int)
                   for value in (crt_glass, video_distortion, maximum_volume)):
                raise ValueError("TV setting values must be whole numbers")
            if not 0 <= crt_glass <= 100 or not 0 <= video_distortion <= 100:
                raise ValueError("CRT glass and distortion must be between 0 and 100")
            if not 5 <= maximum_volume <= 100:
                raise ValueError("Maximum volume must be between 5 and 100")
            if (not isinstance(volume_limit_enabled, bool)
                    or not isinstance(sound_effects_enabled, bool)
                    or not isinstance(scrubbing_enabled, bool)):
                raise ValueError("Choose whether volume limits, sound effects, and scrubbing are on")

            volume = settings.get("volume")
            if not isinstance(volume, dict):
                volume = {}
            volume["maximum"] = maximum_volume
            volume["limit_enabled"] = volume_limit_enabled
            settings.update({
                "playback_mode": playback_mode,
                "episode_reset_minutes": episode_reset_minutes,
                "picture_mode": picture_mode,
                "tv_border": tv_border,
                "crt_glass": crt_glass,
                "video_distortion": video_distortion,
                "display_resolution": display_resolution,
                "sound_effects_enabled": sound_effects_enabled,
                "scrubbing_enabled": scrubbing_enabled,
                "volume": volume,
            })
            self.write_json(self.settings_path, settings)
            return
        if action == "add-channel":
            new_channel = {
                "number": payload.get("number"),
                "name": payload.get("name"),
                "folder": payload.get("folder"),
                "aspect": payload.get("aspect", "crop"),
                "content_type": payload.get("content_type", "shows"),
            }
            def add(values: list[dict[str, Any]]) -> None:
                values.append(new_channel)
            self.update_channels(add)
            channel = self.channel(int(payload.get("number")))
            (self.media_root / str(channel["folder"])).mkdir(mode=0o750, exist_ok=True)
            return
        if action == "update-channel":
            original_number = int(payload.get("original_number"))
            new_number = int(payload.get("number", original_number))
            if new_number != original_number and any(
                    job.get("channel") == original_number
                    and job.get("status") != "refresh-error"
                    for job in self.upload_jobs()):
                raise ValueError(
                    "Finish or cancel this channel's uploads before changing its number")
            def update(values: list[dict[str, Any]]) -> None:
                for value in values:
                    if int(value.get("number", -1)) == original_number:
                        value["number"] = new_number
                        value["name"] = payload.get("name", value.get("name"))
                        value["aspect"] = payload.get("aspect", value.get("aspect", "crop"))
                        value["content_type"] = payload.get(
                            "content_type", value.get("content_type", "shows"))
                        return
                raise ValueError("Channel not found")
            with self.config_lock:
                self.update_channels(update)
                states = self.channel_media_states()
                stored_favourites = states.get("favourite_channels", [])
                favourite_channels = {
                    int(value) for value in stored_favourites
                    if isinstance(value, int)
                    or (isinstance(value, str) and value.isdigit())
                } if isinstance(stored_favourites, list) else set()
                if original_number in favourite_channels:
                    favourite_channels.discard(original_number)
                    if payload.get("content_type", "shows") == "shows":
                        favourite_channels.add(new_number)
                    states["favourite_channels"] = sorted(favourite_channels)
                    states["updated"] = time.time()
                    self.write_channel_media_states(states)
                if new_number != original_number:
                    def move_visibility(library: dict[str, Any]) -> None:
                        disabled_channels = set(library.get("disabled_channels", []))
                        if original_number in disabled_channels:
                            disabled_channels.discard(original_number)
                            disabled_channels.add(new_number)
                        library["disabled_channels"] = sorted(disabled_channels)
                        disabled = library.setdefault("disabled_programmes", {})
                        old_values = set(disabled.pop(str(original_number), []))
                        if old_values:
                            old_values.update(disabled.get(str(new_number), []))
                            disabled[str(new_number)] = sorted(old_values)
                    self.update_settings(move_visibility)
            return
        if action == "delete-channel":
            number = int(payload.get("channel"))
            channel = self.channel(number)
            if any(job.get("channel") == number and job.get("status") != "refresh-error"
                   for job in self.upload_jobs()):
                raise ValueError(
                    "Finish or cancel this channel's uploads before deleting it")
            folder = self.media_root / str(channel["folder"])
            if folder.is_dir() and any(item.is_file() and item.suffix.lower() in SUPPORTED_EXTENSIONS
                                       for item in folder.iterdir()):
                raise ValueError("Move this channel's programmes to the recycle bin before deleting it")
            for manifest_path in self.bin.glob("*/manifest.json"):
                recycled = self.read_json(manifest_path, {})
                if recycled.get("folder") == channel.get("folder"):
                    raise ValueError(
                        "Restore or permanently delete this channel's recycled programmes first")
            def delete(values: list[dict[str, Any]]) -> None:
                values[:] = [value for value in values
                             if int(value.get("number", -1)) != number]
                if not values:
                    raise ValueError("Mabel TV must keep at least one channel")
            self.update_channels(delete)
            def remove_visibility(library: dict[str, Any]) -> None:
                disabled_channels = set(library.get("disabled_channels", []))
                disabled_channels.discard(number)
                library["disabled_channels"] = sorted(disabled_channels)
                library.setdefault("disabled_programmes", {}).pop(str(number), None)
            self.update_settings(remove_visibility)
            states = self.channel_media_states()
            stored_favourites = states.get("favourite_channels", [])
            favourite_channels = {
                int(value) for value in stored_favourites
                if isinstance(value, int)
                or (isinstance(value, str) and value.isdigit())
            } if isinstance(stored_favourites, list) else set()
            if number in favourite_channels:
                favourite_channels.discard(number)
                states["favourite_channels"] = sorted(favourite_channels)
                states["updated"] = time.time()
                self.write_channel_media_states(states)
            if folder.is_dir() and not any(folder.iterdir()):
                folder.rmdir()
            return
        if action == "create-adult-folder":
            name = self.normalise_adult_folder(str(payload.get("name", "")))
            destination = self.adult_root / name
            if destination.exists():
                raise ValueError("That Adult TV folder already exists")
            destination.mkdir(mode=0o750)
            return
        if action == "rename-adult-folder":
            source = self.adult_folder_path(str(payload.get("folder", "")))
            if not source.is_dir():
                raise ValueError("Adult TV folder not found")
            new_name = self.normalise_adult_folder(str(payload.get("name", "")))
            destination = self.adult_root / new_name
            if destination.exists() and destination != source:
                raise ValueError("That Adult TV folder already exists")
            old_name = source.name
            source.rename(destination)
            states = self.adult_media_states()
            prefix = old_name + "/"
            updated = {
                (new_name + "/" + key[len(prefix):]) if key.startswith(prefix) else key: value
                for key, value in states.items()
            }
            if updated != states:
                self.write_adult_media_states(updated)
            return
        if action == "delete-adult-folder":
            folder = self.adult_folder_path(str(payload.get("folder", "")))
            if not folder.is_dir():
                raise ValueError("Adult TV folder not found")
            if any(folder.iterdir()):
                raise ValueError("Move every film out of this folder before deleting it")
            folder.rmdir()
            return
        if action == "move-adult":
            source = self.safe_adult_path(str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("Film not found")
            requested_folder = str(payload.get("folder", "")).strip()
            parent = (self.adult_folder_path(requested_folder, create=False)
                      if requested_folder else self.adult_root)
            if not parent.is_dir():
                raise ValueError("Choose an existing Adult TV folder")
            destination = parent / source.name
            if destination.exists() and destination != source:
                raise ValueError("That folder already contains a film with this name")
            if destination == source:
                return
            old_relative = self.adult_relative_path(source)
            new_relative = self.adult_relative_path(destination)
            source.rename(destination)
            states = self.adult_media_states()
            if old_relative in states:
                states[new_relative] = states.pop(old_relative)
                self.write_adult_media_states(states)
            return
        if action == "rename-adult":
            source = self.safe_adult_path(str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("Film not found")
            proposed = SAFE_NAME.sub("", str(payload.get("name", "")).strip()).strip(". ")
            if not proposed:
                raise ValueError("Enter a film name")
            destination = source.with_name(proposed + source.suffix)
            if destination.exists() and destination != source:
                raise ValueError("That name is already used in Adult mode")
            source.rename(destination)
            state = self.adult_media_states()
            old_relative = self.adult_relative_path(source)
            new_relative = self.adult_relative_path(destination)
            if old_relative in state:
                state[new_relative] = state.pop(old_relative)
                self.write_adult_media_states(state)
            return
        if action == "optimise-adult":
            self.request_adult_optimisation(str(payload.get("file", "")))
            return
        if action == "trash-adult":
            source = self.safe_adult_path(str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("Film not found")
            item_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"
            destination_dir = self.bin / item_id
            destination_dir.mkdir(mode=0o750)
            relative = self.adult_relative_path(source)
            states = self.adult_media_states()
            adult_state = states.get(relative, {})
            self.write_json(destination_dir / "manifest.json", {
                "id": item_id, "file_name": source.name,
                "folder": ".adult" + ("/" + source.parent.name
                                        if source.parent != self.adult_root else ""),
                "channel_name": "Adult mode", "adult_state": adult_state,
            })
            try:
                shutil.move(str(source), str(destination_dir / source.name))
            except Exception:
                shutil.rmtree(destination_dir, ignore_errors=True)
                raise
            self.remove_adult_media_state(relative)
            return
        if action in {"toggle-channel", "toggle-programme", "move-programme",
                      "rename", "trash"}:
            channel = self.channel(int(payload.get("channel")))
        if action == "toggle-channel":
            number = channel["number"]
            def change(library: dict[str, Any]) -> None:
                values = set(library.get("disabled_channels", [])); values.symmetric_difference_update({number}); library["disabled_channels"] = sorted(values)
            self.update_settings(change)
        elif action == "toggle-programme":
            file_name = str(payload.get("file", "")); self.safe_media_path(channel, file_name)
            def change(library: dict[str, Any]) -> None:
                key = str(channel["number"]); values = set(library["disabled_programmes"].get(key, [])); values.symmetric_difference_update({file_name}); library["disabled_programmes"][key] = sorted(values)
            self.update_settings(change)
        elif action == "move-programme":
            if self.channel_content_type(channel) != "films":
                raise ValueError("Only films can move between film channels")
            try:
                target = self.channel(int(payload.get("target_channel")))
            except (TypeError, ValueError):
                raise ValueError("Choose another film channel") from None
            if self.channel_content_type(target) != "films":
                raise ValueError("Choose another film channel")
            source_number = int(channel["number"])
            target_number = int(target["number"])
            if source_number == target_number:
                raise ValueError("Choose another film channel")
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            if not source.is_file():
                raise ValueError("Film not found")
            target_folder = self.media_root / str(target["folder"])
            target_folder.mkdir(mode=0o750, exist_ok=True)
            destination = self.safe_media_path(target, source.name)
            if destination.exists():
                raise ValueError("That film channel already contains a film with this name")
            source.rename(destination)

            def move_visibility(library: dict[str, Any]) -> None:
                disabled = library.setdefault("disabled_programmes", {})
                source_values = set(disabled.get(str(source_number), []))
                was_disabled = source.name in source_values
                source_values.discard(source.name)
                disabled[str(source_number)] = sorted(source_values)
                target_values = set(disabled.get(str(target_number), []))
                if was_disabled:
                    target_values.add(destination.name)
                disabled[str(target_number)] = sorted(target_values)
            self.update_settings(move_visibility)

            states = self.channel_media_states()
            programmes = states.get("programmes", {})
            if not isinstance(programmes, dict):
                programmes = {}
            source_key = self.channel_programme_key(source_number, source.name)
            target_key = self.channel_programme_key(target_number, destination.name)
            stored_favourites = states.get("favourites", [])
            favourites = set(stored_favourites) \
                if isinstance(stored_favourites, list) else set()
            favourite_moved = source_key in favourites
            metadata_moved = source_key in programmes
            if favourite_moved:
                favourites.discard(source_key)
                favourites.add(target_key)
            if metadata_moved:
                programmes[target_key] = programmes.pop(source_key)
            if metadata_moved or favourite_moved:
                states.update({"programmes": programmes,
                               "favourites": sorted(favourites),
                               "updated": time.time()})
                self.write_channel_media_states(states)
        elif action == "rename":
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            if not source.is_file(): raise ValueError("Programme not found")
            proposed = SAFE_NAME.sub("", str(payload.get("name", "")).strip()).strip(". ")
            if not proposed: raise ValueError("Enter a programme name")
            destination = self.safe_media_path(channel, proposed + source.suffix)
            if destination.exists() and destination != source: raise ValueError("That name is already used in this channel")
            source.rename(destination)
            def change(library: dict[str, Any]) -> None:
                key = str(channel["number"]); values = library["disabled_programmes"].get(key, []); library["disabled_programmes"][key] = [destination.name if v == source.name else v for v in values]
            self.update_settings(change)
            states = self.channel_media_states()
            programmes = states.get("programmes", {})
            old_key = self.channel_programme_key(int(channel["number"]), source.name)
            new_key = self.channel_programme_key(int(channel["number"]), destination.name)
            stored_favourites = states.get("favourites", [])
            favourites = set(stored_favourites) \
                if isinstance(stored_favourites, list) else set()
            changed = False
            if isinstance(programmes, dict) and old_key in programmes:
                programmes[new_key] = programmes.pop(old_key)
                changed = True
            if old_key in favourites:
                favourites.discard(old_key)
                favourites.add(new_key)
                changed = True
            if changed:
                states.update({"programmes": programmes,
                               "favourites": sorted(favourites),
                               "updated": time.time()})
                self.write_channel_media_states(states)
        elif action == "trash":
            source = self.safe_media_path(channel, str(payload.get("file", "")))
            if not source.is_file(): raise ValueError("Programme not found")
            item_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"; destination_dir = self.bin / item_id; destination_dir.mkdir(mode=0o750)
            # Persist recovery metadata before moving the only media copy. A
            # power loss after the move can then never make the video invisible.
            self.write_json(destination_dir / "manifest.json", {
                "id": item_id, "file_name": source.name,
                "folder": channel["folder"], "channel_name": channel["name"],
            })
            try:
                shutil.move(str(source), str(destination_dir / source.name))
            except Exception:
                shutil.rmtree(destination_dir, ignore_errors=True)
                raise
        elif action in {"restore", "delete"}:
            item_id = str(payload.get("id", "")); directory = self.bin / item_id
            if not re.fullmatch(r"\d+-[a-f0-9]{8}", item_id) or not directory.is_dir(): raise ValueError("Recycle-bin item not found")
            manifest = self.read_json(directory / "manifest.json", {})
            if action == "restore":
                folder = self.media_root / str(manifest.get("folder", "")); file_name = str(manifest.get("file_name", "")); destination = folder / Path(file_name).name
                if not manifest.get("folder") or destination.exists(): raise ValueError("Cannot restore this item because a file with that name already exists")
                adult_series_id = str(manifest.get("adult_series_id", ""))
                adult_series_state = manifest.get("adult_series_state")
                adult_series_episode_state = manifest.get("adult_series_episode_state")
                if adult_series_id:
                    series_root = self.adult_series_root / adult_series_id
                    if (not re.fullmatch(r"[a-f0-9]{32}", adult_series_id)
                            or not isinstance(adult_series_state, dict)
                            or not isinstance(adult_series_episode_state, dict)
                            or series_root == destination
                            or series_root not in destination.parents):
                        raise ValueError("Cannot restore this episode outside its Adult TV series")
                folder.mkdir(mode=0o750, exist_ok=True); shutil.move(str(directory / file_name), str(destination)); shutil.rmtree(directory)
                if (re.fullmatch(r"[a-f0-9]{32}", adult_series_id)
                        and isinstance(adult_series_state, dict)
                        and isinstance(adult_series_episode_state, dict)):
                    series_root = self.adult_series_root / adult_series_id
                    states = self.adult_series_states()
                    states["series"].setdefault(adult_series_id, adult_series_state)
                    relative = destination.relative_to(series_root).as_posix()
                    states["episodes"][f"{adult_series_id}/{relative}"] = \
                        adult_series_episode_state
                    self.write_adult_series_states(states)
                adult_state = manifest.get("adult_state")
                if str(manifest.get("folder", "")).startswith(".adult") \
                        and isinstance(adult_state, dict):
                    states = self.adult_media_states()
                    states[self.adult_relative_path(destination)] = adult_state
                    self.write_adult_media_states(states)
            else:
                shutil.rmtree(directory)
        else:
            raise ValueError("Unknown library action")
