"""Atomic ordering for the private Adult TV Up Next queue."""

from __future__ import annotations

import time
from typing import Any


class ViewingQueueMixin:
    """Persist a complete queue order without exposing partial moves."""

    def adult_up_next_reorder(self, payload: dict[str, Any]) -> dict[str, Any]:
        keys = payload.get("keys", [])
        if not isinstance(keys, list) or not keys or len(keys) > 500:
            raise ValueError("Choose a valid Up Next order")
        ordered = [str(key) for key in keys]
        if len(set(ordered)) != len(ordered):
            raise ValueError("Choose each Up Next title once")
        with self.config_lock:
            store = self.adult_viewing_store()
            queued = {key for key, value in store["titles"].items()
                      if isinstance(value, dict) and value.get("up_next")}
            if set(ordered) != queued:
                raise ValueError("Up Next changed while it was being reordered")
            now = time.time()
            for rank, key in enumerate(ordered, start=1):
                store["titles"][key]["up_next_rank"] = rank
                store["titles"][key]["updated"] = now
            self.write_adult_viewing_store(store)
        return {"ok": True, "keys": ordered}
