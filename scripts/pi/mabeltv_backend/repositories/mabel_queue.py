"""The parent-managed queue for Mabel TV channel programmes."""

from __future__ import annotations

import uuid
from typing import Any


class MabelQueueRepositoryMixin:
    def mabel_queue(self) -> dict[str, Any]:
        db = self.connect()
        try:
            state = db.execute(
                "SELECT ending,active,completed,current_title "
                "FROM mabel_queue_state WHERE id=1"
            ).fetchone()
            items = [dict(row) for row in db.execute(
                "SELECT id,position,channel_number,file_name,title,artwork,channel_name "
                "FROM mabel_queue_entries ORDER BY position"
            )]
            return {"items": items, "ending": state["ending"],
                    "active": bool(state["active"]),
                    "completed": bool(state["completed"]),
                    "current_title": state["current_title"]}
        finally:
            db.close()

    def mabel_queue_change(self, action: str,
                           item: dict[str, Any] | None = None) -> dict[str, Any]:
        with self.transaction() as db:
            if action == "add":
                if item is None:
                    raise ValueError("Choose a film or episode")
                count = db.execute("SELECT COUNT(*) FROM mabel_queue_entries").fetchone()[0]
                if count >= 100:
                    raise ValueError("The queue can hold up to 100 programmes")
                position = db.execute(
                    "SELECT COALESCE(MAX(position),-1)+1 FROM mabel_queue_entries"
                ).fetchone()[0]
                db.execute(
                    "INSERT INTO mabel_queue_entries"
                    "(id,position,channel_number,file_name,title,artwork,channel_name) "
                    "VALUES(?,?,?,?,?,?,?)",
                    (str(uuid.uuid4()), position, item["channel_number"],
                     item["file_name"], item["title"], item["artwork"],
                     item["channel_name"]),
                )
                db.execute("UPDATE mabel_queue_state SET completed=0 WHERE id=1")
            elif action in {"remove", "up", "down"}:
                if item is None or not item.get("id"):
                    raise ValueError("Choose a queued programme")
                rows = [dict(row) for row in db.execute(
                    "SELECT id FROM mabel_queue_entries ORDER BY position")]
                ids = [row["id"] for row in rows]
                if item["id"] not in ids:
                    raise ValueError("That programme is no longer in the queue")
                index = ids.index(item["id"])
                if action == "remove":
                    ids.pop(index)
                    db.execute("DELETE FROM mabel_queue_entries WHERE id=?", (item["id"],))
                else:
                    other = index + (-1 if action == "up" else 1)
                    if not 0 <= other < len(ids):
                        raise ValueError("That programme cannot move any further")
                    ids[index], ids[other] = ids[other], ids[index]
                # Clear ranks before assigning the new unique order.
                db.execute("UPDATE mabel_queue_entries SET position=position+1000")
                db.executemany(
                    "UPDATE mabel_queue_entries SET position=? WHERE id=?",
                    [(position, entry_id) for position, entry_id in enumerate(ids)],
                )
            elif action == "ending":
                ending = item.get("ending") if item else None
                if ending not in {"all_done", "keep_playing"}:
                    raise ValueError("Choose how the queue ends")
                db.execute("UPDATE mabel_queue_state SET ending=? WHERE id=1", (ending,))
            elif action == "clear":
                db.execute("DELETE FROM mabel_queue_entries")
                db.execute("UPDATE mabel_queue_state SET active=0,completed=0,"
                           "current_title='' WHERE id=1")
            else:
                raise ValueError("Unknown queue action")
        return self.mabel_queue()
