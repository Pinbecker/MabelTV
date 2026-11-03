"""Authenticated device progress, independent of expiring media stream tokens."""

from __future__ import annotations

import math
import re
import time
from typing import Any


class PlaybackProgressMixin:
    def my_tv_progress(self, payload: dict[str, Any]) -> dict[str, Any]:
        source = payload.get("source")
        if not isinstance(source, dict) or source.get("kind") not in {"my_tv", "my-tv-series"}:
            raise ValueError("Choose a My TV film or episode")
        writer = str(payload.get("writer") or "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,80}", writer):
            raise ValueError("That playback session is not valid")
        try:
            sequence = int(payload["sequence"])
            position = float(payload["position"])
            duration = float(payload.get("duration") or 0)
            observed = float(payload["observed_at"])
            if (sequence < 1 or sequence > 2**53 - 1
                    or not all(math.isfinite(v) and v >= 0 for v in (position, duration, observed))
                    or observed > time.time() + 300):
                raise ValueError()
        except (KeyError, TypeError, ValueError, OverflowError):
            raise ValueError("That playback checkpoint is not valid") from None
        with self.config_lock:
            library_id = str(source.get("library_id") or "")
            if library_id:
                state = self.state_database.my_tv_progress_state(library_id)
                expected = "my_tv_episode" if source["kind"] == "my-tv-series" else "my_tv"
                if state.get("domain") != expected:
                    raise ValueError("That video is no longer in My TV")
            else:
                _kind, _path, _title, library_id, _resume = self.remote_source(source)
            if not library_id:
                raise ValueError("That video has no playback identity")
            finished = payload.get("finished") is True
            result = self.state_database.save_my_tv_progress(
                library_id, position=0.0 if finished else self.normalise_resume_position(position, duration),
                duration=duration, observed=observed, writer=writer, sequence=sequence,
                finished=finished or duration > 0 and position >= duration * .92)
        if result["applied"] and payload.get("stream"):
            try:
                token = str(payload["stream"])
                session = self.remote_session(token)
            except ValueError:
                pass  # Progress survives stream expiry and Library restarts.
            else:
                if session.get("library_id") == library_id:
                    self.record_remote_viewing(session, token, position, duration)
        return result
