"""Atomic playback ownership and ordering for the shared Mabel TV queue."""
from __future__ import annotations
import uuid
from typing import Any

class MabelQueueRepositoryMixin:
    def mabel_queue(self) -> dict[str, Any]:
        db = self.connect()
        try:
            state = dict(db.execute("SELECT * FROM mabel_queue_state WHERE id=1").fetchone())
            state.pop("id")
            for field in ("active", "completed", "paused"):
                state[field] = bool(state[field])
            items = [dict(row) for row in db.execute("SELECT * FROM mabel_queue_entries ORDER BY position")]
            for item in items:
                item["playing"] = state["phase"] == "playing" and item["id"] == state["current_id"]
                item["starting"] = state["phase"] == "starting" and item["id"] == state["current_id"]
            return {**state, "items": items}
        finally:
            db.close()

    @staticmethod
    def _queue_order(db, ids):
        db.execute("UPDATE mabel_queue_entries SET position=position+1000000")
        db.executemany("UPDATE mabel_queue_entries SET position=? WHERE id=?",
                       [(rank, identity) for rank, identity in enumerate(ids)])

    def mabel_queue_select(self, identity: str, owner: str, *, automatic=False,
                           expected_owner="") -> dict[str, Any]:
        with self.transaction() as db:
            state = db.execute("SELECT * FROM mabel_queue_state WHERE id=1").fetchone()
            if automatic and (state["paused"] or state["owner"] not in ("", expected_owner or owner)):
                raise ValueError("The queue is paused or playing somewhere else")
            item = db.execute("SELECT * FROM mabel_queue_entries WHERE id=?", (identity,)).fetchone()
            if item is None:
                raise ValueError("That programme is no longer in the queue")
            ids = [row[0] for row in db.execute("SELECT id FROM mabel_queue_entries ORDER BY position")]
            self._queue_order(db, [identity] + [value for value in ids if value != identity])
            position = state["position_seconds"] if state["current_id"] == identity else 0
            db.execute("UPDATE mabel_queue_state SET current_id=?,current_title=?,owner=?,active=0,"
                       "completed=0,paused=0,phase='starting',position_seconds=?,error='' WHERE id=1",
                       (identity, item["title"], owner, position))
        return self.mabel_queue()

    def mabel_queue_event(self, action: str, owner: str, identity: str,
                         *, position=0.0, error="") -> dict[str, Any]:
        with self.transaction() as db:
            state = db.execute("SELECT * FROM mabel_queue_state WHERE id=1").fetchone()
            if not owner or state["owner"] != owner or state["current_id"] != identity:
                raise ValueError("This player no longer owns the queue")
            if action == "started":
                db.execute("UPDATE mabel_queue_state SET active=1,phase='playing',error='' WHERE id=1")
            elif action == "position":
                db.execute("UPDATE mabel_queue_state SET position_seconds=? WHERE id=1", (max(0, position),))
            elif action in ("pause", "failed"):
                db.execute("UPDATE mabel_queue_state SET active=0,paused=1,phase='waiting',owner='',error=? WHERE id=1",
                           (error[:250],))
            elif action == "finish":
                if state["phase"] != "playing":
                    raise ValueError("That queued programme has not started")
                db.execute("INSERT INTO mabel_queue_history(id,channel_number,file_name,title,artwork,channel_name) "
                           "SELECT id,channel_number,file_name,title,artwork,channel_name FROM mabel_queue_entries WHERE id=?",
                           (identity,))
                db.execute("DELETE FROM mabel_queue_entries WHERE id=?", (identity,))
                db.execute("DELETE FROM mabel_queue_history WHERE sequence NOT IN "
                           "(SELECT sequence FROM mabel_queue_history ORDER BY sequence DESC LIMIT 20)")
                next_item = db.execute("SELECT * FROM mabel_queue_entries ORDER BY position LIMIT 1").fetchone()
                if next_item and not state["paused"]:
                    db.execute("UPDATE mabel_queue_state SET current_id=?,current_title=?,active=0,phase='starting',"
                               "position_seconds=0,error='' WHERE id=1", (next_item["id"], next_item["title"]))
                else:
                    db.execute("UPDATE mabel_queue_state SET current_id='',current_title='',owner='',active=0,"
                               "phase='waiting',position_seconds=0,completed=? WHERE id=1",
                               (int(not state["paused"] and state["ending"] == "all_done"),))
            else:
                raise ValueError("Unknown queue playback event")
        return self.mabel_queue()

    def mabel_queue_change(self, action: str, item: dict[str, Any] | None = None) -> dict[str, Any]:
        item = item or {}
        with self.transaction() as db:
            state = db.execute("SELECT * FROM mabel_queue_state WHERE id=1").fetchone()
            ids = [row[0] for row in db.execute("SELECT id FROM mabel_queue_entries ORDER BY position")]
            if action == "add":
                if len(ids) >= 100:
                    raise ValueError("The queue can hold up to 100 programmes")
                position = db.execute("SELECT COALESCE(MAX(position),-1)+1 FROM mabel_queue_entries").fetchone()[0]
                db.execute("INSERT INTO mabel_queue_entries VALUES(?,?,?,?,?,?,?)",
                           (str(uuid.uuid4()), position, item["channel_number"], item["file_name"],
                            item["title"], item["artwork"], item["channel_name"]))
                db.execute("UPDATE mabel_queue_state SET completed=0,paused=CASE WHEN ?=0 THEN 0 ELSE paused END WHERE id=1",
                           (len(ids),))
            elif action in ("remove", "up", "down"):
                identity = str(item.get("id") or "")
                if identity not in ids:
                    raise ValueError("That programme is no longer in the queue")
                index = ids.index(identity)
                protected = state["current_id"] if state["phase"] in ("starting", "playing") else ""
                if identity == protected:
                    raise ValueError("Use playback controls for the programme playing now")
                if action == "remove":
                    ids.pop(index)
                    db.execute("DELETE FROM mabel_queue_entries WHERE id=?", (identity,))
                    if identity == state["current_id"]:
                        db.execute("UPDATE mabel_queue_state SET current_id='',current_title='',position_seconds=0 WHERE id=1")
                else:
                    other = index + (-1 if action == "up" else 1)
                    if not 0 <= other < len(ids) or ids[other] == protected:
                        raise ValueError("That programme cannot move any further")
                    ids[index], ids[other] = ids[other], ids[index]
                self._queue_order(db, ids)
            elif action == "ending":
                ending = item.get("ending")
                if ending not in ("all_done", "keep_playing"):
                    raise ValueError("Choose how the queue ends")
                db.execute("UPDATE mabel_queue_state SET ending=? WHERE id=1", (ending,))
            elif action == "clear":
                if state["phase"] == "playing":
                    db.execute("DELETE FROM mabel_queue_entries WHERE id<>?", (state["current_id"],))
                    db.execute("UPDATE mabel_queue_state SET paused=1,completed=0 WHERE id=1")
                else:
                    db.execute("DELETE FROM mabel_queue_entries")
                    db.execute("UPDATE mabel_queue_state SET active=0,completed=0,current_title='',"
                               "current_id='',owner='',paused=0,phase='waiting',position_seconds=0,error='' WHERE id=1")
            else:
                raise ValueError("Unknown queue action")
        return self.mabel_queue()
