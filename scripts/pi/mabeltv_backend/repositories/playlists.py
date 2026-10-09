"""Saved playlist membership and atomic copies into the playback queue."""
from __future__ import annotations

import time
import uuid


class PlaylistsRepositoryMixin:
    def relocate_playlist_item(self, source_channel, source_name, target_channel, target_name):
        with self.transaction() as db:
            db.execute("UPDATE mabel_playlist_entries SET channel_id=(SELECT id FROM channels WHERE number=?),"
                       "file_name=? WHERE channel_id=(SELECT id FROM channels WHERE number=?) AND file_name=?",
                       (target_channel, target_name, source_channel, source_name))
            self._bump_revisions(db, "channels")

    def playlists(self):
        db = self.connect()
        try:
            result = []
            for row in db.execute("SELECT * FROM mabel_playlists ORDER BY updated DESC,id"):
                value = dict(row)
                value["repeat"] = bool(value["repeat"])
                value["items"] = [dict(item) for item in db.execute("""
                    SELECT entry.*,channels.number AS channel_number,channels.name AS channel_name
                    FROM mabel_playlist_entries AS entry JOIN channels ON channels.id=entry.channel_id
                    WHERE playlist_id=? ORDER BY position
                """, (row["id"],))]
                result.append(value)
            return result
        finally:
            db.close()

    def playlist_change(self, action, payload):
        identity = str(payload.get("id", ""))
        with self.transaction() as db:
            if action == "create":
                identity = uuid.uuid4().hex
                name = str(payload.get("name", "")).strip()
                if not 1 <= len(name) <= 80:
                    raise ValueError("Give your playlist a name, up to 80 characters")
                if db.execute("SELECT COUNT(*) FROM mabel_playlists").fetchone()[0] >= 100:
                    raise ValueError("You can save up to 100 playlists")
                db.execute("INSERT INTO mabel_playlists VALUES(?,?,?,?,?)",
                           (identity, name, 0, time.time(), time.time()))
            else:
                if not db.execute("SELECT 1 FROM mabel_playlists WHERE id=?", (identity,)).fetchone():
                    raise ValueError("Playlist not found")
                if action == "rename":
                    name = str(payload.get("name", "")).strip()
                    if not 1 <= len(name) <= 80:
                        raise ValueError("Give your playlist a name, up to 80 characters")
                    db.execute("UPDATE mabel_playlists SET name=? WHERE id=?", (name, identity))
                elif action == "repeat":
                    if not isinstance(payload.get("repeat"), bool):
                        raise ValueError("Choose whether to repeat this playlist")
                    db.execute("UPDATE mabel_playlists SET repeat=? WHERE id=?",
                               (int(payload["repeat"]), identity))
                elif action == "delete":
                    db.execute("DELETE FROM mabel_playlists WHERE id=?", (identity,))
                elif action == "add":
                    count = db.execute("SELECT COUNT(*) FROM mabel_playlist_entries WHERE playlist_id=?",
                                       (identity,)).fetchone()[0]
                    if count >= 100:
                        raise ValueError("A playlist can hold up to 100 programmes")
                    channel = db.execute("SELECT id FROM channels WHERE number=? AND content_type<>'memories'",
                                         (payload["channel"],)).fetchone()
                    if channel is None:
                        raise ValueError("Channel not found")
                    rank = db.execute("SELECT COALESCE(MAX(position),-1)+1 FROM mabel_playlist_entries WHERE playlist_id=?",
                                      (identity,)).fetchone()[0]
                    db.execute("INSERT INTO mabel_playlist_entries VALUES(?,?,?,?,?)",
                               (uuid.uuid4().hex, identity, rank, channel["id"], payload["file"]))
                elif action in ("remove", "up", "down"):
                    ids = [row[0] for row in db.execute(
                        "SELECT id FROM mabel_playlist_entries WHERE playlist_id=? ORDER BY position", (identity,))]
                    item_id = str(payload.get("item_id", ""))
                    if item_id not in ids:
                        raise ValueError("That item is no longer in the playlist")
                    index = ids.index(item_id)
                    if action == "remove":
                        ids.pop(index)
                        db.execute("DELETE FROM mabel_playlist_entries WHERE id=?", (item_id,))
                    else:
                        target = index + (-1 if action == "up" else 1)
                        if not 0 <= target < len(ids):
                            raise ValueError("That item cannot move further")
                        ids[index], ids[target] = ids[target], ids[index]
                    db.execute("UPDATE mabel_playlist_entries SET position=position+1000000 WHERE playlist_id=?", (identity,))
                    db.executemany("UPDATE mabel_playlist_entries SET position=? WHERE id=?", enumerate(ids))
                else:
                    raise ValueError("Unknown playlist action")
            db.execute("UPDATE mabel_playlists SET updated=? WHERE id=?", (time.time(), identity))
            self._bump_revisions(db, "channels")
        return identity

    def playlist_copy_to_queue(self, playlist_id, items, *, replace=False, confirmed=False):
        if not items:
            raise ValueError("Add a programme to this playlist first")
        with self.transaction() as db:
            playlist = db.execute("SELECT * FROM mabel_playlists WHERE id=?", (playlist_id,)).fetchone()
            if playlist is None:
                raise ValueError("Playlist not found")
            count = db.execute("SELECT COUNT(*) FROM mabel_queue_entries").fetchone()[0]
            if replace and count and not confirmed:
                raise ValueError("Confirm replacing the current Up Next queue")
            if len(items) + (0 if replace else count) > 100:
                raise ValueError("Up Next can hold up to 100 programmes")
            if replace:
                db.execute("UPDATE mabel_queue_state SET repeat_playlist=0 WHERE id=1")
                db.execute("DELETE FROM mabel_queue_entries")
                db.execute("DELETE FROM mabel_queue_cycle")
                db.execute("DELETE FROM mabel_queue_history")
                db.execute("UPDATE mabel_queue_state SET active=0,completed=0,current_id='',current_title='',"
                           "owner='',paused=0,phase='waiting',position_seconds=0,error='',repeat_playlist=?,"
                           "playlist_name=? WHERE id=1", (playlist["repeat"], playlist["name"]))
            rank = db.execute("SELECT COALESCE(MAX(position),-1)+1 FROM mabel_queue_entries").fetchone()[0]
            db.executemany("INSERT INTO mabel_queue_entries VALUES(?,?,?,?,?,?,?)", [
                (uuid.uuid4().hex, rank + index, item["channel_number"], item["file_name"],
                 item["title"], item["artwork"], item["channel_name"]) for index, item in enumerate(items)])
            db.execute("UPDATE mabel_queue_state SET completed=0 WHERE id=1")
            if db.execute("SELECT repeat_playlist FROM mabel_queue_state WHERE id=1").fetchone()[0]:
                db.execute("DELETE FROM mabel_queue_cycle")
                db.execute("INSERT INTO mabel_queue_cycle SELECT position,channel_number,file_name,title,artwork,channel_name "
                           "FROM mabel_queue_entries ORDER BY position")
            self._bump_revisions(db, "channels")
        return self.mabel_queue()
