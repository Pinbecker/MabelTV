"""In-memory queue contract for the browser fixture only."""

from __future__ import annotations

import copy
import secrets
from typing import Any

class MabelQueueFixtureMixin:
    def reset_mabel_queue(self) -> None:
        self.queue_items: list[dict[str, Any]] = []
        self.queue_ending = "all_done"

    def mabel_queue(self) -> dict[str, Any]:
        return {"items": copy.deepcopy(self.queue_items), "ending": self.queue_ending,
                "active": False, "completed": False, "current_title": ""}

    def mabel_queue_action(self, payload: dict[str, Any]) -> dict[str, Any]:
        action = payload.get("action")
        if action == "add":
            channel = next((item for item in self.library()["channels"]
                            if item["number"] == payload.get("channel")), None)
            programme = next((item for item in channel["programmes"]
                              if item["name"] == payload.get("file")), None) if channel else None
            if not programme:
                raise ValueError("That programme is not available on TV")
            self.queue_items.append({
                "id": secrets.token_hex(8), "position": len(self.queue_items),
                "channel_number": channel["number"], "file_name": programme["name"],
                "title": programme.get("display_name", programme["name"]),
                "artwork": (programme.get("metadata") or {}).get("poster", ""),
                "channel_name": channel["name"],
            })
        elif action in ("up", "down", "remove"):
            index = next((index for index, item in enumerate(self.queue_items)
                          if item["id"] == payload.get("id")), -1)
            if index < 0:
                raise ValueError("That programme is no longer in the queue")
            if action == "remove":
                self.queue_items.pop(index)
            else:
                other = index + (-1 if action == "up" else 1)
                if not 0 <= other < len(self.queue_items):
                    raise ValueError("That programme cannot move any further")
                self.queue_items[index], self.queue_items[other] = (
                    self.queue_items[other], self.queue_items[index])
            for position, item in enumerate(self.queue_items):
                item["position"] = position
        elif action == "ending":
            if payload.get("ending") not in ("all_done", "keep_playing"):
                raise ValueError("Choose how the queue ends")
            self.queue_ending = payload["ending"]
        elif action == "clear":
            self.queue_items.clear()
        elif action == "start":
            return {"ok": True}
        else:
            raise ValueError("Unknown queue action")
        return self.mabel_queue()
