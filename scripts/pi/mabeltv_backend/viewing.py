"""Viewing capture and focused Insights APIs for the local Library service."""

from __future__ import annotations

import re
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .constants import (
    SUPPORTED_EXTENSIONS,
    VIEWING_MAX_SESSIONS,
    VIEWING_MIN_SESSION_SECONDS,
    VIEWING_RETENTION_DAYS,
    VIEWING_SAMPLE_SECONDS,
    VIEWING_SESSION_GAP_SECONDS,
)
from .viewing_analytics import (
    date_window,
    diary_payload,
    item_statistics,
    overview_payload,
    range_window,
    selected_sessions,
    session_detail,
)


class ViewingMixin:
    def start_viewing_tracker(self) -> None:
        """Start low-frequency on-TV sampling once the HTTP service is ready."""
        with self.viewing_lock:
            if self.viewing_worker and self.viewing_worker.is_alive():
                return
            self.viewing_closed.clear()
            self.viewing_worker = threading.Thread(
                target=self.run_viewing_tracker,
                name="mabeltv-viewing-history",
                daemon=True,
            )
            self.viewing_worker.start()

    def run_viewing_tracker(self) -> None:
        while not self.viewing_closed.is_set():
            try:
                self.sample_tv_viewing()
            except Exception as error:
                print(f"Viewing tracker skipped a sample: {error}",
                      file=sys.stderr, flush=True)
            if self.viewing_closed.wait(VIEWING_SAMPLE_SECONDS):
                break

    def resolve_viewing_activity(self, activity: dict[str, Any]) -> dict[str, Any]:
        """Attach the stable relational identity owned by viewing_items."""
        values = self.state_database.ensure_viewing_items([{
            "kind": activity.get("kind"),
            "channel_number": activity.get("channel_number"),
            "file_name": activity.get("programme_file_name")
            if activity.get("kind") == "film" else None,
            "title": activity.get("title"),
            "source": activity.get("channel_name"),
        }])
        if not values:
            raise ValueError("Viewing item is no longer in the MabelTV library")
        return {**activity, "viewing_item_id": values[0]["item_id"],
                "item_key": values[0]["item_key"]}

    def current_tv_viewing(self, mode: dict[str, Any] | None = None) -> dict[str, Any] | None:
        """Return one active programme with aggregate and exact programme identity."""
        mode = self.player_mode_status() if mode is None else mode
        if mode.get("standby") is True or mode.get("mode") == "adult":
            return None
        state = self.read_state("player")
        if (not isinstance(state, dict) or state.get("standby") is True
                or state.get("playback_paused") is True):
            return None
        try:
            number = int(state.get("current_channel"))
            channel = self.channel(number)
            timelines = state.get("channel_timelines", {})
            timeline = timelines.get(str(number), {}) if isinstance(timelines, dict) else {}
            file_name = str(timeline.get("episode_name", "")).strip()
        except (AttributeError, TypeError, ValueError):
            return None
        if not file_name:
            return None
        is_film = self.channel_content_type(channel) == "films"
        channel_name = str(channel.get("name") or f"Channel {number}")
        programme_title = self.channel_programme_title(number, file_name)
        activity = {
            "title": programme_title if is_film else channel_name,
            "programme_title": programme_title,
            "programme_file_name": file_name,
            "kind": "film" if is_film else "channel",
            "surface": "tv", "channel_number": number,
            "channel_name": channel_name,
        }
        try:
            position = max(0.0, float(timeline.get("position_seconds", 0) or 0))
            saved_at = float(state.get("saved_at_utc_ms", 0) or 0)
            if saved_at > 0:
                position += max(0.0, (time.time() * 1000 - saved_at) / 1000)
            key = self.channel_programme_key(number, file_name)
            durations = state.get("channel_film_durations", {})
            duration = max(0.0, float(durations.get(key, 0) or 0)) \
                if isinstance(durations, dict) else 0.0
        except (AttributeError, TypeError, ValueError):
            position, duration = 0.0, 0.0
        if duration <= 0:
            duration = self.channel_programme_duration(channel, file_name)
        activity.update({"position": position, "media_duration": duration})
        try:
            return self.resolve_viewing_activity(activity)
        except ValueError:
            return None

    @staticmethod
    def _activity_key(activity: dict[str, Any]) -> tuple[str, str, str]:
        return (str(activity.get("viewing_item_id") or ""),
                str(activity.get("surface") or ""),
                str(activity.get("programme_file_name") or "").casefold())

    def sample_tv_viewing(self) -> None:
        now_monotonic = time.monotonic()
        activity = self.current_tv_viewing()
        previous = self.viewing_last_tv_sample
        self.viewing_last_tv_sample = (activity, now_monotonic) if activity else None
        if not activity or not previous:
            return
        previous_activity, previous_monotonic = previous
        if self._activity_key(previous_activity) != self._activity_key(activity):
            return
        watched = min(30.0, max(0.0, now_monotonic - previous_monotonic))
        if watched >= 1.0:
            self.record_viewing(activity, watched, time.time())

    def record_remote_viewing(self, session: dict[str, Any], token: str,
                              position: float, duration: float = 0.0) -> None:
        """Count browser playback deltas while rejecting seeks and stale posts."""
        now_monotonic = time.monotonic()
        with self.viewing_lock:
            previous = self.viewing_remote_samples.get(token)
            self.viewing_remote_samples[token] = (position, now_monotonic)
        if not previous:
            return
        previous_position, previous_monotonic = previous
        elapsed = max(0.0, now_monotonic - previous_monotonic)
        advanced = position - previous_position
        if elapsed <= 0 or elapsed > 75 or advanced < 1 or advanced > elapsed + 6:
            return
        if str(session.get("kind", "")) != "channel":
            return
        try:
            number = int(session.get("channel"))
            channel = self.channel(number)
        except (TypeError, ValueError):
            return
        channel_name = str(channel.get("name") or "MabelTV")
        file_name = str(session.get("file") or Path(str(
            session.get("source", "Video"))).name)
        programme_title = str(session.get("title") or self.display_name(file_name))
        is_film = str(session.get("content_kind") or "") == "film"
        activity = {
            "title": programme_title if is_film else channel_name,
            "programme_title": programme_title,
            "programme_file_name": file_name,
            "kind": "film" if is_film else "channel", "surface": "device",
            "channel_number": number, "channel_name": channel_name,
            "position": max(0.0, position), "media_duration": max(0.0, duration),
        }
        try:
            resolved = self.resolve_viewing_activity(activity)
        except ValueError:
            return
        self.record_viewing(resolved, min(advanced, elapsed), time.time())

    def record_viewing(self, activity: dict[str, Any], watched: float,
                       ended: float) -> None:
        """Accumulate one qualifying session and persist only that row."""
        watched = max(0.0, min(float(watched), 60.0))
        if watched < 1.0:
            return
        if not activity.get("viewing_item_id"):
            activity = self.resolve_viewing_activity(activity)
        key = self._activity_key(activity)
        with self.viewing_lock:
            current = self.viewing_pending.get(key)
            if current is None:
                latest = self.state_database.latest_viewing_session(
                    str(activity["viewing_item_id"]), str(activity.get("surface") or "tv"))
                same_programme = latest is not None and str(
                    latest.get("programme_file_name") or "").casefold() == key[2]
                gap = ended - float(latest.get("ended", 0) or 0) if latest else None
                if same_programme and gap is not None and 0 <= gap <= VIEWING_SESSION_GAP_SECONDS:
                    current = latest
                else:
                    current = {"id": uuid.uuid4().hex, "started": ended - watched,
                               "ended": ended, "seconds": 0.0, **activity}
                self.viewing_pending[key] = current
            elif not 0 <= ended - float(current.get("ended", 0) or 0) \
                    <= VIEWING_SESSION_GAP_SECONDS:
                current = {"id": uuid.uuid4().hex, "started": ended - watched,
                           "ended": ended, "seconds": 0.0, **activity}
                self.viewing_pending[key] = current
            current["ended"] = ended
            current["seconds"] = round(float(current.get("seconds", 0) or 0) + watched, 2)
            for field in ("position", "media_duration", "programme_title"):
                if field in activity:
                    current[field] = activity[field]
            if float(current["seconds"]) < VIEWING_MIN_SESSION_SECONDS:
                return
            saved = dict(current)
        self.state_database.save_viewing_session(
            saved, cutoff=ended - VIEWING_RETENTION_DAYS * 86400,
            maximum=VIEWING_MAX_SESSIONS)

    def current_viewing_catalogue(self) -> list[dict[str, Any]]:
        """Return current MabelTV catalogue entries with stable Insights IDs."""
        states = self.channel_media_states()
        channel_metadata = states.get("channels", {}) if isinstance(states, dict) else {}
        programme_metadata = states.get("programmes", {}) if isinstance(states, dict) else {}
        entries: list[dict[str, Any]] = []
        for channel in self.channels():
            number = int(channel["number"])
            source = str(channel.get("name") or f"Channel {number}")
            if self.channel_content_type(channel) != "films":
                metadata = channel_metadata.get(str(number), {}) \
                    if isinstance(channel_metadata, dict) else {}
                entries.append({"kind": "channel", "channel_number": number,
                                "title": source, "source": "MabelTV series channel",
                                "file_name": None,
                                "artwork": str(metadata.get("artwork") or "")
                                if isinstance(metadata, dict) else "", "available": True})
                continue
            folder = self.media_root / str(channel.get("folder") or "")
            paths = sorted((path for path in folder.iterdir()
                            if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS),
                           key=lambda path: (re.sub(
                               r"^the\s+", "", self.display_name(path.name),
                               flags=re.IGNORECASE).casefold(), path.name.casefold())) \
                if folder.is_dir() else []
            for path in paths:
                key = self.channel_programme_key(number, path.name)
                metadata = programme_metadata.get(key, {}) \
                    if isinstance(programme_metadata, dict) else {}
                entries.append({"kind": "film", "channel_number": number,
                                "file_name": path.name,
                                "title": str(metadata.get("title") or self.display_name(path.name))
                                if isinstance(metadata, dict) else self.display_name(path.name),
                                "source": source,
                                "artwork": str(metadata.get("poster") or "")
                                if isinstance(metadata, dict) else "", "available": True})
        return self.state_database.ensure_viewing_items(entries)

    def viewing_catalogue_map(self) -> dict[str, dict[str, Any]]:
        current = {str(item["item_id"]): item for item in self.current_viewing_catalogue()}
        for stored in self.state_database.viewing_items():
            identifier = str(stored["id"])
            if identifier in current:
                continue
            current[identifier] = {
                "item_id": identifier, "item_key": stored.get("current_key"),
                "kind": stored["kind"], "title": stored["title_snapshot"],
                "source": stored["source_snapshot"],
                "channel_number": stored.get("current_channel_number"),
                "file_name": stored.get("file_name"), "artwork": "",
                "available": False,
            }
        return current

    def viewing_overview(self, days: int = 7, timezone_offset_minutes: int = 0,
                         timezone_name: str | None = None) -> dict[str, Any]:
        now = time.time()
        window = range_window(days, timezone_offset_minutes, now, timezone_name)
        sessions = self.state_database.viewing_sessions(
            start=window["previous_start"], end=window["end"])
        result = overview_payload(sessions, self.viewing_tracking_started, days,
                                  timezone_offset_minutes, now, timezone_name)
        catalogue = self.viewing_catalogue_map()
        for item in result["highlights"]:
            item["artwork"] = catalogue.get(item["item_id"], {}).get("artwork", "")
        current = [item for item in catalogue.values() if item.get("available")]
        result["catalogue"] = {
            "channels": sum(item.get("kind") == "channel" for item in current),
            "films": sum(item.get("kind") == "film" for item in current),
            "channel_artwork": [item["artwork"] for item in current
                                if item.get("kind") == "channel" and item.get("artwork")][:3],
            "film_artwork": [item["artwork"] for item in current
                             if item.get("kind") == "film" and item.get("artwork")][:3],
        }
        return result

    def viewing_catalogue_insights(self) -> dict[str, Any]:
        catalogue = self.viewing_catalogue_map()
        sessions = self.state_database.viewing_sessions()
        grouped: dict[str, list[dict[str, Any]]] = {}
        for session in sessions:
            grouped.setdefault(str(session.get("viewing_item_id") or ""), []).append(session)
        items = []
        for identifier, metadata in catalogue.items():
            values = grouped.get(identifier, [])
            total = sum(float(item.get("seconds", 0) or 0) for item in values)
            ordered = sorted(values, key=lambda item: float(item.get("ended", 0) or 0))
            progress = [min(1.0, max(0.0, float(item.get("position", 0) or 0) /
                                    float(item.get("media_duration", 0) or 0)))
                        for item in values if float(item.get("media_duration", 0) or 0) > 0]
            items.append({**metadata, "seconds": round(total), "sessions": len(values),
                          "first_watched": ordered[0].get("started") if ordered else None,
                          "last_watched": ordered[-1].get("ended") if ordered else None,
                          "furthest_progress": max(progress, default=0)})
        return {"tracking_started": self.viewing_tracking_started,
                "scope": "all-history", "items": items}

    def viewing_item_insight(self, item_id: str, days: int = 0,
                             timezone_offset_minutes: int = 0,
                             timezone_name: str | None = None) -> dict[str, Any]:
        catalogue = self.viewing_catalogue_map()
        metadata = catalogue.get(str(item_id))
        if metadata is None:
            raise ValueError("That viewing item no longer exists")
        now = time.time()
        window = range_window(days, timezone_offset_minutes, now, timezone_name)
        lifetime = self.state_database.viewing_sessions(item_id=str(item_id))
        result = item_statistics(metadata, lifetime, window, lifetime)
        all_sessions = self.state_database.viewing_sessions(
            start=window["start"], end=window["end"])
        range_total = sum(float(item["range_seconds"]) for item in selected_sessions(
            all_sessions, window["start"], window["end"]))
        result["share"] = round(float(result["seconds"]) / range_total, 4) \
            if range_total > 0 else 0
        selected = selected_sessions(lifetime, window["start"], window["end"])
        result["history"] = [session_detail(item, window["zone"], window["start"],
                                            window["end"])
                             for item in reversed(selected[-5000:])]
        return {"tracking_started": self.viewing_tracking_started,
                "range_days": days, "range_label": window["label"], "item": result}

    def viewing_diary(self, value: str,
                      timezone_offset_minutes: int = 0,
                      timezone_name: str | None = None) -> dict[str, Any]:
        now = time.time()
        window = date_window(value, timezone_offset_minutes, now, timezone_name)
        sessions = self.state_database.viewing_sessions(
            start=window["start"], end=window["end"])
        return diary_payload(sessions, self.viewing_catalogue_map(), value,
                             timezone_offset_minutes, now, timezone_name)

    def delete_viewing_sessions(self, payload: dict[str, Any]) -> dict[str, Any]:
        raw_ids = payload.get("ids", [])
        if not isinstance(raw_ids, list):
            raise ValueError("Choose the viewing sessions to delete")
        selected = {str(value).strip() for value in raw_ids if str(value).strip()}
        if not selected:
            raise ValueError("Choose at least one viewing session")
        if len(selected) > VIEWING_MAX_SESSIONS:
            raise ValueError("Too many viewing sessions were selected")
        with self.viewing_lock:
            self.viewing_pending = {
                key: value for key, value in self.viewing_pending.items()
                if str(value.get("id") or "") not in selected}
        return {"ok": True,
                "deleted": self.state_database.delete_viewing_sessions(selected)}
