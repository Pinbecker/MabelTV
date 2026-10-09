"""Pure, bounded composition plans shared by the TV and device memory players."""
from __future__ import annotations

from datetime import datetime


def _frame(x, y, width, height, tilt=0, direction=1):
    return dict(x=x, y=y, width=width, height=height, tilt=tilt, direction=direction)


def _frames(layout, count, portrait=False):
    if count == 1:
        return [_frame(.02, .025, .96, .95)]
    if count == 2:
        if portrait:
            return [_frame(.025, .025, .95, .455, -.35), _frame(.025, .52, .95, .455, .35, -1)]
        return [_frame(.02, .025, .465, .95, -.35), _frame(.515, .025, .465, .95, .35, -1)]
    if count == 3:
        if portrait or layout == "panorama-feature":
            return [_frame(.02, .02, .96, .57), _frame(.02, .62, .465, .36, -.35), _frame(.515, .62, .465, .36, .35, -1)]
        if layout == "triptych":
            return [_frame(.015, .025, .305, .95, -.35), _frame(.3475, .025, .305, .95), _frame(.68, .025, .305, .95, .35, -1)]
        return [_frame(.02, .025, .60, .95), _frame(.65, .025, .33, .455, .35, -1), _frame(.65, .52, .33, .455, -.35)]
    return []


def _caption(items):
    dates = []
    for item in items:
        try:
            captured = item.get("captured") or item.get("created")
            dates.append(datetime.fromtimestamp(captured) if captured else
                         datetime.fromisoformat(str(item.get("captured_at", "")).replace("Z", "+00:00")))
        except (ValueError, TypeError):
            return ""
    if dates and all((date.year, date.month) == (dates[0].year, dates[0].month) for date in dates):
        return dates[0].strftime("%B %Y")
    return ""


def memory_compositions(items, photo_seconds):
    """Use each item once, with one short video and at most two photos per scene."""
    scenes = []
    index = photo_index = 0
    sizes = (2, 1, 3, 2, 1, 2, 3, 2)
    transitions = ("reveal", "rise", "glide", "dissolve")
    while index < len(items):
        first = items[index]
        group = []
        # Videos get a companion photo where possible, including when they
        # follow a photo. Two simultaneous decoders are never required.
        limit = max(2, sizes[photo_index % len(sizes)]) if first["kind"] == "video" else sizes[photo_index % len(sizes)]
        while index < len(items) and len(group) < limit:
            if items[index]["kind"] == "video" and any(item["kind"] == "video" for item in group):
                break
            group.append(items[index])
            index += 1
        count = len(group)
        portraits = sum(int(item.get("height", 0)) > int(item.get("width", 0)) for item in group)
        layout = ("spotlight" if count == 1 else "duet" if count == 2 and portraits > 0 else
                  "panorama" if count == 2 else "triptych" if count == 3 and portraits == 3 else
                  "panorama-feature" if count == 3 and portraits == 0 else "feature")
        video_index = next((position for position, item in enumerate(group) if item["kind"] == "video"), -1)
        seconds = round(float(photo_seconds) * (1 + .16 * (count - 1)), 2)
        clip_start = 0
        if video_index >= 0:
            duration = max(0, float(group[video_index].get("duration", 0) or 0))
            seconds = min(10, max(5, float(photo_seconds) * .8))
            if duration:
                seconds = min(seconds, duration)
                clip_start = min(max(0, duration - seconds), duration * .18)
        scenes.append(dict(kind="video" if video_index >= 0 else "photo", items=group, title=first["title"], layout=layout,
                           seconds=round(seconds, 2), clip_start=round(clip_start, 2), video_index=video_index,
                           transition=transitions[photo_index % len(transitions)],
                           frames=_frames(layout, count), portrait_frames=_frames(layout, count, True),
                           caption=_caption(group), composition_version=2))
        photo_index += 1
    return scenes
