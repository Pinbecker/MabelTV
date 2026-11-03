"""Ordered, targeted My TV progress writes in the existing SQLite media owner."""

from __future__ import annotations

import json
from contextlib import closing
from typing import Any


class PlaybackRepositoryMixin:
    def my_tv_progress_state(self, library_id: str) -> dict[str, Any]:
        with closing(self.connect()) as db:
            row = db.execute("SELECT domain,remote_position,remote_duration,remote_last_watched "
                             "FROM local_media WHERE library_id=?", (library_id,)).fetchone()
            return dict(row) if row else {}

    def save_my_tv_progress(self, library_id: str, *, position: float, duration: float,
                            observed: float, writer: str, sequence: int,
                            finished: bool = False) -> dict[str, Any]:
        with self.transaction() as db:
            row = db.execute("SELECT * FROM local_media WHERE library_id=?",
                             (library_id,)).fetchone()
            if row is None:
                raise ValueError("That video is no longer in My TV")
            extra = json.loads(row["extra_json"] or "{}")
            if observed <= float(extra.get("progress_cleared_at", 0)):
                return {"ok": True, "applied": False}
            writers = extra.get("playback_writers", {})
            previous = writers.get(writer, {})
            if sequence <= int(previous.get("sequence", 0)):
                return {"ok": True, "applied": False}
            # Arrival order is not watch order: a queued phone sample must not
            # replace a later seek, completion or another device's checkpoint.
            if observed < float(row["remote_last_watched"] or 0):
                return {"ok": True, "applied": False}
            writers[writer] = {"sequence": sequence, "observed": observed}
            extra["playback_writers"] = dict(sorted(writers.items(),
                key=lambda pair: float(pair[1].get("observed", 0)), reverse=True)[:16])
            if position == 0:
                native = db.execute("SELECT position_seconds FROM my_tv_resume WHERE library_id=?",
                                    (library_id,)).fetchone()
                extra["ignored_player_position"] = float(native[0]) if native else 0.0
            else:
                extra.pop("ignored_player_position", None)
            db.execute(
                "UPDATE local_media SET remote_position=?,remote_duration=?,remote_last_watched=?,"
                "extra_json=?,watched=CASE WHEN ? THEN 1 ELSE watched END,"
                "watched_present=CASE WHEN ? THEN 1 ELSE watched_present END WHERE library_id=?",
                (position, duration or float(row["remote_duration"] or 0), observed,
                 json.dumps(extra, separators=(",", ":")),
                 finished and row["domain"] == "my_tv_episode",
                 finished and row["domain"] == "my_tv_episode", library_id))
            self._bump_revisions(db, "my_tv_media")
        return {"ok": True, "applied": True}
