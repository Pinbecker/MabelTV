"""Pure calendar-aware aggregation for MabelTV viewing insights."""

from __future__ import annotations

import calendar
from datetime import date, datetime, time as clock_time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


TIME_PERIODS = (("Overnight", 0, 6), ("Morning", 6, 12),
                ("Afternoon", 12, 18), ("Evening", 18, 24))


def local_timezone(offset_minutes: int) -> timezone:
    offset = max(-840, min(840, int(offset_minutes)))
    return timezone(-timedelta(minutes=offset))


def viewing_timezone(name: str | None, offset_minutes: int):
    """Prefer the browser's calendar-aware zone, retaining an offset fallback."""
    if name:
        try:
            return ZoneInfo(str(name))
        except (ValueError, ZoneInfoNotFoundError):
            pass
    return local_timezone(offset_minutes)


def _month_start(value: date, delta: int) -> date:
    index = value.year * 12 + value.month - 1 + delta
    year, zero_month = divmod(index, 12)
    return date(year, zero_month + 1, 1)


def _midnight(value: date, zone: timezone) -> datetime:
    return datetime.combine(value, clock_time.min, zone)


def range_window(days: int, offset_minutes: int, now: float,
                 timezone_name: str | None = None) -> dict[str, Any]:
    """Return explicit local-calendar boundaries for a dashboard/item range."""
    if days not in {0, 1, 7, 30, 365}:
        days = 7
    zone = viewing_timezone(timezone_name, offset_minutes)
    current = datetime.fromtimestamp(now, zone)
    today = current.date()
    if days == 0:
        return {"days": 0, "label": "All history", "zone": zone,
                "start": None, "end": now, "previous_start": None,
                "previous_end": None, "today": today}
    if days == 365:
        start_date = _month_start(today, -11)
        previous_start_date = _month_start(start_date, -12)
        label = "Last 12 months"
    else:
        start_date = today - timedelta(days=days - 1)
        previous_start_date = start_date - timedelta(days=days)
        label = {1: "Today", 7: "Last 7 days", 30: "Last 30 days"}[days]
    return {
        "days": days, "label": label, "zone": zone,
        "start": _midnight(start_date, zone).timestamp(), "end": now,
        "previous_start": _midnight(previous_start_date, zone).timestamp(),
        "previous_end": _midnight(start_date, zone).timestamp(), "today": today,
    }


def date_window(value: str, offset_minutes: int, now: float,
                timezone_name: str | None = None) -> dict[str, Any]:
    zone = viewing_timezone(timezone_name, offset_minutes)
    today = datetime.fromtimestamp(now, zone).date()
    try:
        selected = date.fromisoformat(str(value))
    except ValueError:
        selected = today
    if selected > today:
        selected = today
    start = _midnight(selected, zone)
    end = start + timedelta(days=1)
    return {"date": selected, "today": today, "zone": zone,
            "start": start.timestamp(), "end": end.timestamp()}


def _bounds(session: dict[str, Any]) -> tuple[float, float, float]:
    seconds = max(0.0, float(session.get("seconds", 0) or 0))
    ended = float(session.get("ended", session.get("started", 0)) or 0)
    started = float(session.get("started", ended - seconds) or 0)
    if ended < started:
        started, ended = ended, started
    if ended <= started:
        ended = started + max(seconds, 1.0)
    return started, ended, seconds


def overlap_seconds(session: dict[str, Any], start: float | None,
                    end: float | None) -> float:
    session_start, session_end, seconds = _bounds(session)
    overlap_start = max(session_start, start) if start is not None else session_start
    overlap_end = min(session_end, end) if end is not None else session_end
    if overlap_end <= overlap_start:
        return 0.0
    elapsed = max(1.0, session_end - session_start)
    return seconds * min(1.0, (overlap_end - overlap_start) / elapsed)


def selected_sessions(sessions: list[dict[str, Any]], start: float | None,
                      end: float | None) -> list[dict[str, Any]]:
    values = []
    for session in sessions:
        allocated = overlap_seconds(session, start, end)
        if allocated <= 0:
            continue
        values.append({**session, "range_seconds": allocated})
    return values


def _bucket_total(sessions: list[dict[str, Any]], start: datetime,
                  end: datetime) -> float:
    return sum(overlap_seconds(item, start.timestamp(), end.timestamp())
               for item in sessions)


def _calendar_days(start: datetime, end: datetime) -> list[date]:
    values = []
    current = start.date()
    final = end.date()
    while current <= final:
        values.append(current)
        current += timedelta(days=1)
    return values


def time_breakdown(sessions: list[dict[str, Any]], start: float | None,
                   end: float, zone: timezone) -> list[dict[str, Any]]:
    totals = {label: 0.0 for label, _, _ in TIME_PERIODS}
    counts = {label: set() for label, _, _ in TIME_PERIODS}
    for item in selected_sessions(sessions, start, end):
        item_start, item_end, _ = _bounds(item)
        clipped_start = max(item_start, start) if start is not None else item_start
        clipped_end = min(item_end, end)
        days = _calendar_days(datetime.fromtimestamp(clipped_start, zone),
                              datetime.fromtimestamp(clipped_end, zone))
        for day in days:
            for label, first_hour, last_hour in TIME_PERIODS:
                bucket_start = datetime.combine(day, clock_time(first_hour), zone)
                bucket_end = datetime.combine(day + timedelta(days=1), clock_time.min, zone) \
                    if last_hour == 24 else datetime.combine(day, clock_time(last_hour), zone)
                allocated = overlap_seconds(item, max(clipped_start, bucket_start.timestamp()),
                                            min(clipped_end, bucket_end.timestamp()))
                if allocated > 0:
                    totals[label] += allocated
                    counts[label].add(str(item.get("id") or id(item)))
    return [{"name": label, "label": label, "seconds": round(totals[label]),
             "sessions": len(counts[label])} for label, _, _ in TIME_PERIODS]


def hourly_breakdown(sessions: list[dict[str, Any]], start: float | None,
                     end: float, zone: timezone) -> list[dict[str, Any]]:
    totals = [0.0] * 24
    counts = [set() for _ in range(24)]
    for item in selected_sessions(sessions, start, end):
        item_start, item_end, _ = _bounds(item)
        clipped_start = max(item_start, start) if start is not None else item_start
        clipped_end = min(item_end, end)
        for day in _calendar_days(datetime.fromtimestamp(clipped_start, zone),
                                  datetime.fromtimestamp(clipped_end, zone)):
            for hour in range(24):
                bucket_start = datetime.combine(day, clock_time(hour), zone)
                bucket_end = datetime.combine(day, clock_time(hour + 1), zone) \
                    if hour < 23 else _midnight(day + timedelta(days=1), zone)
                allocated = overlap_seconds(item, bucket_start.timestamp(), bucket_end.timestamp())
                if allocated > 0:
                    totals[hour] += allocated
                    counts[hour].add(str(item.get("id") or id(item)))
    return [{"name": str(hour),
             "label": datetime(2000, 1, 1, hour).strftime("%I%p").lstrip("0").lower(),
             "seconds": round(totals[hour]), "sessions": len(counts[hour])}
            for hour in range(24)]


def weekday_breakdown(sessions: list[dict[str, Any]], start: float | None,
                      end: float, zone: timezone) -> list[dict[str, Any]]:
    totals = [0.0] * 7
    counts = [set() for _ in range(7)]
    for item in selected_sessions(sessions, start, end):
        item_start, item_end, _ = _bounds(item)
        clipped_start = max(item_start, start) if start is not None else item_start
        clipped_end = min(item_end, end)
        for day in _calendar_days(datetime.fromtimestamp(clipped_start, zone),
                                  datetime.fromtimestamp(clipped_end, zone)):
            bucket_start = _midnight(day, zone)
            bucket_end = _midnight(day + timedelta(days=1), zone)
            weekday = day.weekday()
            allocated = overlap_seconds(item, bucket_start.timestamp(), bucket_end.timestamp())
            if allocated > 0:
                totals[weekday] += allocated
                counts[weekday].add(str(item.get("id") or id(item)))
    labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    return [{"name": label, "label": label, "seconds": round(totals[index]),
             "sessions": len(counts[index])} for index, label in enumerate(labels)]


def timeline(sessions: list[dict[str, Any]], window: dict[str, Any]) -> list[dict[str, Any]]:
    zone = window["zone"]
    days = window["days"]
    end = datetime.fromtimestamp(window["end"], zone)
    if days == 1:
        return hourly_breakdown(sessions, window["start"], window["end"], zone)
    if days in {7, 30}:
        first = datetime.fromtimestamp(window["start"], zone).date()
        values = []
        for index in range(days):
            day = first + timedelta(days=index)
            bucket_start = _midnight(day, zone)
            bucket_end = bucket_start + timedelta(days=1)
            values.append({"key": day.isoformat(),
                           "label": day.strftime("%a") if days == 7 else str(day.day),
                           "seconds": round(_bucket_total(sessions, bucket_start, bucket_end))})
        return values
    if days == 365:
        first = datetime.fromtimestamp(window["start"], zone).date()
        values = []
        for index in range(12):
            month = _month_start(first, index)
            next_month = _month_start(month, 1)
            values.append({"key": month.strftime("%Y-%m"),
                           "label": month.strftime("%b"),
                           "seconds": round(_bucket_total(
                               sessions, _midnight(month, zone),
                               _midnight(next_month, zone)))})
        return values
    first_values = [_bounds(item)[0] for item in sessions]
    first = datetime.fromtimestamp(min(first_values, default=window["end"]), zone).date()
    months = max(1, (end.year - first.year) * 12 + end.month - first.month + 1)
    return [{"key": (month := _month_start(first, index)).strftime("%Y-%m"),
             "label": month.strftime("%b %Y"),
             "seconds": round(_bucket_total(sessions, _midnight(month, zone),
                                              _midnight(_month_start(month, 1), zone)))}
            for index in range(months)]


def session_detail(item: dict[str, Any], zone: timezone,
                   start: float | None = None, end: float | None = None) -> dict[str, Any]:
    started, ended, _ = _bounds(item)
    seconds = overlap_seconds(item, start, end)
    aggregate_title = str(item.get("current_title") or item.get("title") or "Untitled")
    programme_title = str(item.get("programme_title") or "").strip()
    result = {
        "id": str(item.get("id") or ""),
        "item_id": str(item.get("viewing_item_id") or item.get("item_key") or ""),
        "title": programme_title or aggregate_title,
        "item_title": aggregate_title,
        "source": str(item.get("current_source") or item.get("channel_name") or "TV"),
        "surface": str(item.get("surface") or "tv"),
        "kind": str(item.get("kind") or "channel"),
        "channel_number": item.get("current_channel_number", item.get("channel_number")),
        "seconds": round(seconds),
        "started": datetime.fromtimestamp(started, zone).isoformat(),
        "when": datetime.fromtimestamp(ended, zone).isoformat(),
    }
    if result["kind"] == "film":
        position = max(0.0, float(item.get("position", 0) or 0))
        duration = max(0.0, float(item.get("media_duration", 0) or 0))
        result.update({"position": round(position), "media_duration": round(duration),
                       "progress": round(min(1.0, position / duration), 4)
                       if duration > 0 else 0})
    return result


def item_statistics(metadata: dict[str, Any], sessions: list[dict[str, Any]],
                    window: dict[str, Any], lifetime: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    selected = selected_sessions(sessions, window["start"], window["end"])
    lifetime = lifetime if lifetime is not None else sessions
    zone = window["zone"]
    total = sum(float(item["range_seconds"]) for item in selected)
    dates = set()
    for item in selected:
        item_start, item_end, _ = _bounds(item)
        clipped_start = max(item_start, window["start"]) \
            if window["start"] is not None else item_start
        clipped_end = min(item_end, window["end"])
        for day in _calendar_days(datetime.fromtimestamp(clipped_start, zone),
                                  datetime.fromtimestamp(clipped_end, zone)):
            if overlap_seconds(item, _midnight(day, zone).timestamp(),
                               _midnight(day + timedelta(days=1), zone).timestamp()) > 0:
                dates.add(day)
    periods = time_breakdown(sessions, window["start"], window["end"], zone)
    weekdays = weekday_breakdown(sessions, window["start"], window["end"], zone)
    progress = [min(1.0, max(0.0, float(item.get("position", 0) or 0) /
                            float(item.get("media_duration", 0) or 0)))
                for item in selected if float(item.get("media_duration", 0) or 0) > 0]
    lifetime_ordered = sorted(lifetime, key=lambda item: _bounds(item)[0])
    busiest = max(periods, key=lambda value: value["seconds"])["name"] \
        if any(value["seconds"] > 0 for value in periods) else "—"
    result = {
        **metadata, "seconds": round(total), "sessions": len(selected),
        "active_days": len(dates),
        "average_session_seconds": round(total / len(selected)) if selected else 0,
        "longest_session_seconds": round(max(
            (float(item["range_seconds"]) for item in selected), default=0)),
        "busiest_period": busiest,
        "first_watched": datetime.fromtimestamp(_bounds(lifetime_ordered[0])[0], zone).isoformat()
        if lifetime_ordered else "",
        "last_watched": datetime.fromtimestamp(_bounds(lifetime_ordered[-1])[1], zone).isoformat()
        if lifetime_ordered else "",
        "time_of_day": periods,
        "hourly": hourly_breakdown(sessions, window["start"], window["end"], zone),
        "weekdays": weekdays,
        "by_surface": [],
        "timeline": timeline(sessions, window),
    }
    surfaces: dict[str, float] = {}
    for item in selected:
        surface = str(item.get("surface") or "tv")
        surfaces[surface] = surfaces.get(surface, 0.0) + float(item["range_seconds"])
    result["by_surface"] = [{"name": key, "seconds": round(value)}
                            for key, value in sorted(surfaces.items(),
                                                     key=lambda pair: -pair[1])]
    if result.get("kind") == "film":
        result.update({"average_progress": round(sum(progress) / len(progress), 4)
                       if progress else 0,
                       "furthest_progress": round(max(progress), 4) if progress else 0,
                       "completion_sessions": sum(1 for value in progress if value >= .9),
                       "progress_samples": len(progress)})
    return result


def overview_payload(sessions: list[dict[str, Any]], tracking_started: float,
                     days: int, offset_minutes: int, now: float,
                     timezone_name: str | None = None) -> dict[str, Any]:
    window = range_window(days, offset_minutes, now, timezone_name)
    selected = selected_sessions(sessions, window["start"], window["end"])
    previous = selected_sessions(sessions, window["previous_start"], window["previous_end"])
    zone = window["zone"]
    periods = time_breakdown(sessions, window["start"], window["end"], zone)
    weekdays = weekday_breakdown(sessions, window["start"], window["end"], zone)
    total = sum(float(item["range_seconds"]) for item in selected)
    previous_total = sum(float(item["range_seconds"]) for item in previous)
    active_days = sum(1 for day in _calendar_days(
        datetime.fromtimestamp(window["start"], zone),
        datetime.fromtimestamp(window["end"], zone))
        if _bucket_total(sessions, _midnight(day, zone),
                         _midnight(day + timedelta(days=1), zone)) > 0)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in selected:
        grouped.setdefault(str(item.get("viewing_item_id") or item.get("item_key") or ""), []).append(item)
    highlights = []
    for identifier, values in grouped.items():
        seconds = sum(float(value["range_seconds"]) for value in values)
        latest = values[-1]
        highlights.append({"item_id": identifier,
                           "kind": str(latest.get("kind") or "channel"),
                           "title": str(latest.get("current_title") or latest.get("title") or "Untitled"),
                           "source": str(latest.get("current_source") or latest.get("channel_name") or "TV"),
                           "channel_number": latest.get("current_channel_number",
                                                        latest.get("channel_number")),
                           "seconds": round(seconds)})
    highlights.sort(key=lambda item: -item["seconds"])
    busiest = max(periods, key=lambda value: value["seconds"])["name"] \
        if any(value["seconds"] > 0 for value in periods) else "—"
    busiest_weekday = max(weekdays, key=lambda value: value["seconds"])["name"] \
        if any(value["seconds"] > 0 for value in weekdays) else "—"
    return {
        "tracking_started": tracking_started, "range_days": days,
        "range_label": window["label"],
        "summary": {"range_seconds": round(total),
                    "previous_range_seconds": round(previous_total),
                    "average_active_day_seconds": total / active_days if active_days else 0,
                    "longest_session_seconds": round(max(
                        (float(item["range_seconds"]) for item in selected), default=0)),
                    "active_days": active_days, "sessions": len(selected),
                    "unique_items": len(grouped), "busiest_period": busiest,
                    "busiest_weekday": busiest_weekday},
        "timeline": timeline(sessions, window), "time_of_day": periods,
        "highlights": highlights[:8],
    }


def diary_payload(sessions: list[dict[str, Any]], catalogue: dict[str, dict[str, Any]],
                  value: str, offset_minutes: int, now: float,
                  timezone_name: str | None = None) -> dict[str, Any]:
    window = date_window(value, offset_minutes, now, timezone_name)
    zone = window["zone"]
    periods = []
    for label, first_hour, last_hour in TIME_PERIODS:
        bucket_start = datetime.combine(window["date"], clock_time(first_hour), zone)
        bucket_end = datetime.combine(window["date"] + timedelta(days=1), clock_time.min, zone) \
            if last_hour == 24 else datetime.combine(window["date"], clock_time(last_hour), zone)
        matching = [item for item in sessions
                    if overlap_seconds(item, bucket_start.timestamp(), bucket_end.timestamp()) > 0]
        entries = []
        for item in matching:
            detail = session_detail(item, zone, bucket_start.timestamp(), bucket_end.timestamp())
            metadata = catalogue.get(detail["item_id"], {})
            detail["artwork"] = metadata.get("artwork", "")
            entries.append(detail)
        periods.append({"name": label,
                        "seconds": round(sum(item["seconds"] for item in entries)),
                        "sessions": len(entries), "entries": entries})
    selected = window["date"]
    return {"date": selected.isoformat(),
            "label": "Today" if selected == window["today"]
            else f"{selected.strftime('%A')} {selected.day} {selected.strftime('%B')}",
            "is_today": selected == window["today"],
            "previous_date": (selected - timedelta(days=1)).isoformat(),
            "next_date": (selected + timedelta(days=1)).isoformat()
            if selected < window["today"] else None,
            "periods": periods}
