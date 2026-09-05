"""Viewing behaviour for the local library service."""

from __future__ import annotations

import os
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
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


class ViewingMixin:
    def load_viewing_store(self) -> dict[str, Any]:
        """Load the compact, private session history kept on this appliance."""
        value = self.read_json(self.viewing_history_path, {})
        sessions = value.get("sessions", []) if isinstance(value, dict) else []
        if not isinstance(sessions, list):
            sessions = []
        clean: list[dict[str, Any]] = []
        for stored in sessions:
            if not isinstance(stored, dict):
                continue
            item = dict(stored)
            try:
                watched = float(item.get("seconds", 0) or 0)
                channel_number = int(item.get("channel_number"))
            except (TypeError, ValueError):
                continue
            kind = str(item.get("kind") or "")
            if watched < VIEWING_MIN_SESSION_SECONDS or kind not in {"film", "episode", "channel"}:
                continue
            channel_name = str(item.get("channel_name") or f"Channel {channel_number}")
            if kind in {"episode", "channel"}:
                item.update({
                    "item_key": f"channel:{channel_number}",
                    "title": channel_name,
                    "kind": "channel",
                })
            item["id"] = str(item.get("id") or uuid.uuid4().hex)
            item["seconds"] = round(watched, 2)
            clean.append(item)
        try:
            started = float(value.get("tracking_started", time.time()))
        except (AttributeError, TypeError, ValueError):
            started = time.time()
        store = {
            "schema_version": 2,
            "tracking_started": max(0.0, started),
            "sessions": clean[-VIEWING_MAX_SESSIONS:],
        }
        if (not isinstance(value, dict) or value.get("schema_version") != 2
                or len(clean) != len(sessions)
                or any(not str(item.get("id") or "") for item in sessions
                       if isinstance(item, dict))):
            try:
                self.write_json(self.viewing_history_path, store)
            except OSError as error:
                print(f"Could not migrate viewing history: {error}",
                      file=sys.stderr, flush=True)
        return store

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
                self.flush_viewing_store()
            except Exception as error:
                print(f"Viewing tracker skipped a sample: {error}",
                      file=sys.stderr, flush=True)
            if self.viewing_closed.wait(VIEWING_SAMPLE_SECONDS):
                break

    def current_tv_viewing(self, mode: dict[str, Any] | None = None) -> dict[str, Any] | None:
        """Return one coarse active programme identity, never a frame timeline."""
        mode = self.player_mode_status() if mode is None else mode
        if mode.get("standby") is True:
            return None
        if mode.get("mode") == "adult":
            return None

        state = self.read_json(self.player_state_path, {})
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
        activity = {
            "item_key": f"channel:{number}:{file_name.casefold()}" if is_film
            else f"channel:{number}",
            "title": self.channel_programme_title(number, file_name)
            if is_film else channel_name,
            "kind": "film" if is_film else "channel",
            "surface": "tv",
            "channel_number": number,
            "channel_name": channel_name,
        }
        # Series channels have the same player timeline as film channels.
        if file_name:
            try:
                position = max(0.0, float(timeline.get("position_seconds", 0) or 0))
                if state.get("playback_paused") is not True:
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
        return activity

    def sample_tv_viewing(self) -> None:
        now_monotonic = time.monotonic()
        activity = self.current_tv_viewing()
        previous = self.viewing_last_tv_sample
        self.viewing_last_tv_sample = (activity, now_monotonic) if activity else None
        if not activity or not previous:
            return
        previous_activity, previous_monotonic = previous
        if previous_activity.get("item_key") != activity.get("item_key"):
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
        kind = str(session.get("kind", ""))
        if kind != "channel":
            return
        channel_number = session.get("channel")
        try:
            channel_number = int(channel_number)
            channel_name = str(self.channel(channel_number).get("name") or "MabelTV")
        except (TypeError, ValueError):
            return
        is_film = str(session.get("content_kind") or "") == "film"
        activity = {
            "item_key": f"channel:{channel_number}:{str(session.get('file') or '').casefold()}"
            if is_film else f"channel:{channel_number}",
            "title": str(session.get("title") or self.display_name(
                Path(str(session.get("source", "Video"))).name)) if is_film else channel_name,
            "kind": "film" if is_film else "channel",
            "surface": "device",
            "channel_number": channel_number,
            "channel_name": channel_name,
        }
        if is_film:
            activity.update({"position": max(0.0, position),
                             "media_duration": max(0.0, duration)})
        self.record_viewing(activity, min(advanced, elapsed), time.time())

    def record_viewing(self, activity: dict[str, Any], watched: float,
                       ended: float) -> None:
        watched = max(0.0, min(float(watched), 60.0))
        if watched < 1.0:
            return
        with self.viewing_lock:
            sessions = self.viewing_store["sessions"]
            matching = [item for item in sessions
                        if isinstance(item, dict)
                        and item.get("item_key") == activity.get("item_key")
                        and item.get("surface") == activity.get("surface")]
            previous = max(matching, key=lambda item: float(
                item.get("ended", 0) or 0), default=None)
            gap = ended - float(previous.get("ended", 0) or 0) if previous else None
            can_merge = previous is not None and gap is not None and (
                0 <= gap <= VIEWING_SESSION_GAP_SECONDS)
            if can_merge:
                previous["ended"] = ended
                previous["seconds"] = round(
                    float(previous.get("seconds", 0) or 0) + watched, 2)
                for field in ("position", "media_duration"):
                    if field in activity:
                        previous[field] = activity[field]
            else:
                pending_key = (str(activity.get("item_key") or ""),
                               str(activity.get("surface") or ""))
                pending = self.viewing_pending.get(pending_key)
                pending_gap = ended - float(pending.get("ended", 0) or 0) \
                    if pending else None
                if pending is None or pending_gap is None or not (
                        0 <= pending_gap <= VIEWING_SESSION_GAP_SECONDS):
                    pending = {
                        "id": uuid.uuid4().hex,
                        "started": ended - watched,
                        "ended": ended,
                        "seconds": round(watched, 2),
                        **activity,
                    }
                    self.viewing_pending[pending_key] = pending
                else:
                    pending["ended"] = ended
                    pending["seconds"] = round(
                        float(pending.get("seconds", 0) or 0) + watched, 2)
                    for field in ("position", "media_duration"):
                        if field in activity:
                            pending[field] = activity[field]
                if float(pending.get("seconds", 0) or 0) >= VIEWING_MIN_SESSION_SECONDS:
                    sessions.append(pending)
                    self.viewing_pending.pop(pending_key, None)
                else:
                    return
            cutoff = ended - VIEWING_RETENTION_DAYS * 86400
            self.viewing_store["sessions"] = [
                item for item in sessions
                if float(item.get("ended", 0) or 0) >= cutoff
            ][-VIEWING_MAX_SESSIONS:]
            self.viewing_dirty = True

    def flush_viewing_store(self, *, force: bool = False) -> None:
        with self.viewing_lock:
            now = time.monotonic()
            if not self.viewing_dirty or (not force and now - self.viewing_last_flush < 60):
                return
            self.write_json(self.viewing_history_path, self.viewing_store)
            self.viewing_dirty = False
            self.viewing_last_flush = now

    @staticmethod
    def viewing_duration_label(seconds: float) -> str:
        minutes = max(0, int(round(seconds / 60)))
        hours, remainder = divmod(minutes, 60)
        return f"{hours}h {remainder}m" if hours else f"{minutes}m"

    def viewing_insights(self, days: int = 30,
                         timezone_offset_minutes: int = 0) -> dict[str, Any]:
        days = days if days in {1, 7, 30, 365} else 1
        offset = max(-840, min(840, int(timezone_offset_minutes)))
        local_zone = timezone(-timedelta(minutes=offset))
        now = time.time()
        now_local = datetime.fromtimestamp(now, local_zone)
        today = now_local.date()
        with self.viewing_lock:
            sessions = [dict(item) for item in self.viewing_store["sessions"]
                        if str(item.get("kind") or "") in {"film", "channel"}
                        and float(item.get("seconds", 0) or 0)
                        >= VIEWING_MIN_SESSION_SECONDS]
            tracking_started = float(self.viewing_store["tracking_started"])

        # Insights should follow the library's current metadata and channel
        # names rather than preserving an old upload filename forever.
        film_names: dict[int, dict[str, str]] = {}
        for item in sessions:
            try:
                channel_number = int(item.get("channel_number"))
                channel = self.channel(channel_number)
            except (TypeError, ValueError):
                continue
            channel_name = str(channel.get("name") or f"Channel {channel_number}")
            item["channel_name"] = channel_name
            if str(item.get("kind") or "") == "channel":
                item["title"] = channel_name
                continue
            key_prefix = f"channel:{channel_number}:"
            item_key = str(item.get("item_key") or "")
            stored_name = item_key[len(key_prefix):] if item_key.startswith(key_prefix) else ""
            if channel_number not in film_names:
                folder = self.media_root / str(channel.get("folder") or "")
                film_names[channel_number] = {
                    path.name.casefold(): path.name for path in folder.iterdir()
                    if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
                } if folder.is_dir() else {}
            file_name = film_names[channel_number].get(stored_name.casefold())
            if file_name:
                item["title"] = self.channel_programme_title(channel_number, file_name)

        def total_since(seconds: float) -> float:
            cutoff = now - seconds
            return sum(float(item.get("seconds", 0) or 0) for item in sessions
                       if float(item.get("ended", 0) or 0) >= cutoff)

        today_start = datetime.combine(today, datetime.min.time(), local_zone).timestamp()
        if days == 1:
            selected = [item for item in sessions if datetime.fromtimestamp(
                float(item.get("ended", 0) or 0), local_zone).date() == today]
            previous = [item for item in sessions if datetime.fromtimestamp(
                float(item.get("ended", 0) or 0), local_zone).date()
                == today - timedelta(days=1)]
        else:
            selected_cutoff = now - days * 86400
            selected = [item for item in sessions
                        if float(item.get("ended", 0) or 0) >= selected_cutoff]
            previous_cutoff = now - days * 2 * 86400
            previous = [item for item in sessions
                        if previous_cutoff <= float(item.get("ended", 0) or 0)
                        < selected_cutoff]

        daily: list[dict[str, Any]] = []
        daily_span = 7 if days <= 7 else 30
        for ago in range(daily_span - 1, -1, -1):
            date = today - timedelta(days=ago)
            total = sum(float(item.get("seconds", 0) or 0) for item in sessions
                        if datetime.fromtimestamp(float(item.get("ended", 0) or 0),
                                                  local_zone).date() == date)
            daily.append({"key": date.isoformat(), "label": date.strftime("%a"),
                          "seconds": round(total)})

        weekly: list[dict[str, Any]] = []
        this_monday = today - timedelta(days=today.weekday())
        for ago in range(7, -1, -1):
            start = this_monday - timedelta(days=ago * 7)
            end = start + timedelta(days=7)
            total = sum(float(item.get("seconds", 0) or 0) for item in sessions
                        if start <= datetime.fromtimestamp(
                            float(item.get("ended", 0) or 0), local_zone).date() < end)
            weekly.append({"key": start.isoformat(),
                           "label": start.strftime("%-d %b") if os.name != "nt"
                           else start.strftime("%d %b").lstrip("0"),
                           "seconds": round(total)})

        monthly: list[dict[str, Any]] = []
        for ago in range(11, -1, -1):
            month_index = now_local.year * 12 + now_local.month - 1 - ago
            year, month_zero = divmod(month_index, 12)
            month = month_zero + 1
            total = sum(float(item.get("seconds", 0) or 0) for item in sessions
                        if (lambda value: value.year == year and value.month == month)(
                            datetime.fromtimestamp(float(item.get("ended", 0) or 0),
                                                   local_zone)))
            monthly.append({"key": f"{year:04d}-{month:02d}",
                            "label": datetime(year, month, 1).strftime("%b"),
                            "seconds": round(total)})

        time_periods = (("Overnight", 0, 6), ("Morning", 6, 12),
                        ("Afternoon", 12, 18), ("Evening", 18, 24))

        def time_breakdown(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
            result = []
            for label, first_hour, last_hour in time_periods:
                matching = [item for item in values
                            if first_hour <= datetime.fromtimestamp(float(
                                item.get("started", item.get("ended", 0)) or 0),
                                local_zone).hour < last_hour]
                result.append({
                    "name": label,
                    "label": label,
                    "seconds": round(sum(float(item.get("seconds", 0) or 0)
                                         for item in matching)),
                    "sessions": len(matching),
                })
            return result

        def hourly_breakdown(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
            result = []
            for hour in range(24):
                matching = [item for item in values if datetime.fromtimestamp(
                    float(item.get("started", item.get("ended", 0)) or 0),
                    local_zone).hour == hour]
                label = datetime(2000, 1, 1, hour).strftime("%I%p").lstrip("0").lower()
                result.append({"name": str(hour), "label": label,
                               "seconds": round(sum(float(item.get("seconds", 0) or 0)
                                                    for item in matching)),
                               "sessions": len(matching)})
            return result

        def weekday_breakdown(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
            result = []
            for weekday in range(7):
                matching = [item for item in values if datetime.fromtimestamp(
                    float(item.get("ended", 0) or 0), local_zone).weekday() == weekday]
                label = (today - timedelta(
                    days=today.weekday() - weekday)).strftime("%a")
                result.append({"name": label, "label": label,
                               "seconds": round(sum(float(item.get("seconds", 0) or 0)
                                                    for item in matching)),
                               "sessions": len(matching)})
            return result

        def item_timeline(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
            if days == 1:
                return hourly_breakdown(values)
            if days in {7, 30}:
                span = days
                result = []
                for ago in range(span - 1, -1, -1):
                    date = today - timedelta(days=ago)
                    total = sum(float(item.get("seconds", 0) or 0) for item in values
                                if datetime.fromtimestamp(float(
                                    item.get("ended", 0) or 0), local_zone).date() == date)
                    result.append({"key": date.isoformat(),
                                   "label": date.strftime("%a") if days == 7
                                   else str(date.day), "seconds": round(total)})
                return result
            result = []
            for ago in range(11, -1, -1):
                month_index = now_local.year * 12 + now_local.month - 1 - ago
                year, month_zero = divmod(month_index, 12)
                month = month_zero + 1
                total = sum(float(item.get("seconds", 0) or 0) for item in values
                            if (lambda value: value.year == year and value.month == month)(
                                datetime.fromtimestamp(float(item.get("ended", 0) or 0),
                                                       local_zone)))
                result.append({"key": f"{year:04d}-{month:02d}",
                               "label": datetime(year, month, 1).strftime("%b"),
                               "seconds": round(total)})
            return result

        time_of_day = time_breakdown(selected)
        hourly = hourly_breakdown(selected)
        weekdays = weekday_breakdown(selected)

        def grouped(field: str) -> list[dict[str, Any]]:
            totals: dict[str, float] = {}
            for item in selected:
                key = str(item.get(field) or "Other")
                totals[key] = totals.get(key, 0.0) + float(item.get("seconds", 0) or 0)
            return [{"name": key, "seconds": round(value)}
                    for key, value in sorted(totals.items(), key=lambda pair: -pair[1])]

        title_totals: dict[tuple[str, str], float] = {}
        for item in selected:
            key = (str(item.get("title") or "Untitled"),
                   str(item.get("channel_name") or "MabelTV"))
            title_totals[key] = title_totals.get(key, 0.0) + float(
                item.get("seconds", 0) or 0)
        top_titles = [{"title": key[0], "source": key[1], "seconds": round(value),
                       "duration": self.viewing_duration_label(value)}
                      for key, value in sorted(title_totals.items(), key=lambda pair: -pair[1])[:8]]

        def session_detail(item: dict[str, Any]) -> dict[str, Any]:
            ended = datetime.fromtimestamp(float(item.get("ended", 0) or 0), local_zone)
            started = datetime.fromtimestamp(float(item.get("started", 0) or 0), local_zone)
            result = {
                "id": str(item.get("id") or ""),
                "item_key": str(item.get("item_key") or
                                f"{item.get('kind')}:{item.get('title')}"),
                "title": str(item.get("title") or "Untitled"),
                "source": str(item.get("channel_name") or "MabelTV"),
                "surface": str(item.get("surface") or "tv"),
                "kind": str(item.get("kind") or "channel"),
                "channel_number": item.get("channel_number"),
                "seconds": round(float(item.get("seconds", 0) or 0)),
                "duration": self.viewing_duration_label(float(item.get("seconds", 0) or 0)),
                "started": started.isoformat(),
                "when": ended.isoformat(),
            }
            if result["kind"] == "film":
                position = max(0.0, float(item.get("position", 0) or 0))
                media_duration = max(0.0, float(item.get("media_duration", 0) or 0))
                result.update({
                    "position": round(position),
                    "media_duration": round(media_duration),
                    "progress": round(min(1.0, position / media_duration), 4)
                    if media_duration > 0 else 0,
                })
            return result

        ordered_sessions = sorted(selected, key=lambda value: float(
            value.get("ended", 0) or 0), reverse=True)
        # The viewing diary needs the complete selected-period sequence rather
        # than an arbitrary recent slice. The API's longest range is one year,
        # and the store itself remains bounded separately.
        session_details = [session_detail(item) for item in ordered_sessions[:5000]]
        recent = session_details[:8]

        active_days = len({datetime.fromtimestamp(
            float(item.get("ended", 0) or 0), local_zone).date() for item in selected})
        range_seconds = sum(float(item.get("seconds", 0) or 0) for item in selected)
        previous_seconds = sum(float(item.get("seconds", 0) or 0) for item in previous)
        unique_items = len({str(item.get("item_key") or
                                f"{item.get('kind')}:{item.get('title')}")
                            for item in selected})
        timeline = item_timeline(selected)

        grouped_items: dict[str, list[dict[str, Any]]] = {}
        for item in selected:
            key = str(item.get("item_key") or
                      f"{item.get('kind')}:{item.get('title')}")
            grouped_items.setdefault(key, []).append(item)

        def detailed_item(key: str, values: list[dict[str, Any]]) -> dict[str, Any]:
            ordered = sorted(values, key=lambda value: float(
                value.get("ended", 0) or 0))
            total = sum(float(item.get("seconds", 0) or 0) for item in values)
            active_dates = {datetime.fromtimestamp(float(
                item.get("ended", 0) or 0), local_zone).date() for item in values}
            periods = time_breakdown(values)
            item_weekdays = weekday_breakdown(values)
            film_progress = [min(1.0, max(0.0, float(
                item.get("position", 0) or 0) / float(
                    item.get("media_duration", 0) or 0))) for item in values
                if float(item.get("media_duration", 0) or 0) > 0]
            first = datetime.fromtimestamp(float(
                ordered[0].get("started", ordered[0].get("ended", 0)) or 0),
                local_zone)
            last = datetime.fromtimestamp(float(
                ordered[-1].get("ended", 0) or 0), local_zone)
            busiest_period = max(periods, key=lambda value: value["seconds"],
                                 default={"name": "Not enough data"})
            busiest_weekday = max(item_weekdays, key=lambda value: value["seconds"],
                                  default={"name": "Not enough data"})
            result = {
                "item_key": key,
                "kind": str(ordered[-1].get("kind") or "channel"),
                "title": str(ordered[-1].get("title") or "Untitled"),
                "source": str(ordered[-1].get("channel_name") or "MabelTV"),
                "channel_number": ordered[-1].get("channel_number"),
                "seconds": round(total),
                "duration": self.viewing_duration_label(total),
                "sessions": len(values),
                "active_days": len(active_dates),
                "average_session_seconds": round(total / len(values)) if values else 0,
                "average_active_day_seconds": round(total / len(active_dates))
                if active_dates else 0,
                "longest_session_seconds": round(max((float(
                    item.get("seconds", 0) or 0) for item in values), default=0)),
                "share": round(total / range_seconds, 4) if range_seconds > 0 else 0,
                "first_watched": first.isoformat(),
                "last_watched": last.isoformat(),
                "busiest_period": busiest_period["name"],
                "busiest_weekday": busiest_weekday["name"],
                "time_of_day": periods,
                "hourly": hourly_breakdown(values),
                "weekdays": item_weekdays,
                "by_surface": (lambda totals: [{"name": name, "seconds": round(value)}
                    for name, value in sorted(totals.items(), key=lambda pair: -pair[1])])(
                        {surface: sum(float(item.get("seconds", 0) or 0)
                                      for item in values
                                      if str(item.get("surface") or "tv") == surface)
                         for surface in {str(item.get("surface") or "tv")
                                         for item in values}}),
                "timeline": item_timeline(values),
            }
            if result["kind"] == "film":
                result.update({
                    "average_progress": round(sum(film_progress) / len(film_progress), 4)
                    if film_progress else 0,
                    "furthest_progress": round(max(film_progress), 4)
                    if film_progress else 0,
                    "completion_sessions": sum(1 for value in film_progress if value >= .9),
                    "progress_samples": len(film_progress),
                })
            return result

        items = sorted((detailed_item(key, values)
                        for key, values in grouped_items.items()),
                       key=lambda value: -value["seconds"])
        top_channels = [item for item in items if item["kind"] == "channel"][:8]
        top_films = [item for item in items if item["kind"] == "film"][:8]
        busiest_period = max(time_of_day, key=lambda value: value["seconds"],
                             default={"name": "—"})["name"]
        busiest_weekday = max(weekdays, key=lambda value: value["seconds"],
                              default={"name": "—"})["name"]
        return {
            "tracking_started": tracking_started,
            "range_days": days,
            "summary": {
                "today_seconds": total_since(max(1.0, now - today_start)),
                "week_seconds": total_since(7 * 86400),
                "month_seconds": total_since(30 * 86400),
                "range_seconds": range_seconds,
                "previous_range_seconds": previous_seconds,
                "average_active_day_seconds": range_seconds / active_days
                if active_days else 0,
                "longest_session_seconds": max((float(item.get("seconds", 0) or 0)
                                                for item in selected), default=0),
                "active_days": active_days,
                "sessions": len(selected),
                "unique_items": unique_items,
                "busiest_period": busiest_period,
                "busiest_weekday": busiest_weekday,
            },
            "daily": daily,
            "weekly": weekly,
            "monthly": monthly,
            "timeline": timeline,
            "time_of_day": time_of_day,
            "hourly": hourly,
            "weekdays": weekdays,
            "by_surface": grouped("surface"),
            "by_kind": grouped("kind"),
            "top_titles": top_titles,
            "top_channels": top_channels,
            "top_films": top_films,
            "items": items,
            "recent": recent,
            "sessions": session_details,
        }

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
            sessions = self.viewing_store["sessions"]
            kept = [item for item in sessions if str(item.get("id") or "") not in selected]
            deleted = len(sessions) - len(kept)
            if deleted:
                self.viewing_store["sessions"] = kept
                self.viewing_dirty = True
        self.flush_viewing_store(force=True)
        return {"ok": True, "deleted": deleted}
