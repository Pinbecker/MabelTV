"""Authoritative catalogue, listening progress and memory-channel preferences."""
from __future__ import annotations

import re
import time
import uuid


class FamilyMediaRepositoryMixin:
    def family_catalogue(self, channel=None):
        db = self.connect()
        try:
            assets = [dict(row) for row in db.execute("""
                SELECT asset.*,channels.number AS channel_number
                FROM family_assets AS asset LEFT JOIN channels ON channels.id=asset.channel_id
                WHERE (? IS NULL OR channels.number=?) ORDER BY captured,created,id
            """, (channel, channel))]
            stories = [dict(row) for row in db.execute("SELECT * FROM storytime_items")]
            now = time.time()
            for story in stories:
                if now - story["updated"] >= 3600:
                    story["position_seconds"] = 0
            # Listening progress must never move a book to another shelf slot.
            stories.sort(key=lambda story: (
                re.sub(r"^(?:the|a)\s+", "", story["title"].strip(), flags=re.IGNORECASE).casefold(),
                story["title"].casefold(), story["id"]))
            settings = [dict(row) for row in db.execute("""
                SELECT settings.*,channels.number AS channel_number FROM memory_channel_settings AS settings
                JOIN channels ON channels.id=settings.channel_id
            """)]
            return {"assets": assets, "stories": stories, "memory_settings": settings}
        finally:
            db.close()

    def family_asset(self, identity):
        db = self.connect()
        try:
            row = db.execute("SELECT * FROM family_assets WHERE id=?", (identity,)).fetchone()
            if row is None:
                raise ValueError("Family media not found")
            return dict(row)
        finally:
            db.close()

    def family_asset_create(self, payload):
        identity = uuid.uuid4().hex
        with self.transaction() as db:
            channel_id = None
            if payload.get("channel") is not None:
                channel = db.execute("SELECT id FROM channels WHERE number=? AND content_type='memories'",
                                     (int(payload["channel"]),)).fetchone()
                if channel is None:
                    raise ValueError("Choose a Photos & Videos channel")
                channel_id = channel["id"]
            db.execute("""INSERT INTO family_assets(id,channel_id,kind,title,original_name,source_path,created,upload_id)
                       VALUES(?,?,?,?,?,?,?,?)""", (identity, channel_id, payload["kind"], payload["title"],
                       payload["original_name"], payload["source_path"], time.time(), payload["upload_id"]))
            if payload.get("story_id"):
                column = "audio_id" if payload["kind"] == "audio" else "image_id"
                if payload["kind"] not in ("audio", "illustration"):
                    raise ValueError("Choose story audio or an illustration")
                if db.execute(f"UPDATE storytime_items SET {column}=?,position_seconds=CASE WHEN ?='audio' THEN 0 "
                              "ELSE position_seconds END,updated=CASE WHEN ?='audio' THEN ? ELSE updated END WHERE id=?",
                              (identity, payload["kind"], payload["kind"], time.time(), payload["story_id"])).rowcount != 1:
                    raise ValueError("Story not found")
            self._bump_revisions(db, "channels")
        return identity

    def family_asset_update(self, identity, **fields):
        allowed = {"prepared_path", "artwork_path", "width", "height", "duration", "captured", "status", "error"}
        if not fields or fields.keys() - allowed:
            raise ValueError("Invalid family-media update")
        with self.transaction() as db:
            db.execute("UPDATE family_assets SET " + ",".join(key + "=?" for key in fields) + " WHERE id=?",
                       (*fields.values(), identity))
            self._bump_revisions(db, "channels")

    def storytime_change(self, action, payload):
        identity = str(payload.get("id", ""))
        with self.transaction() as db:
            if action == "create":
                title = str(payload.get("title", "")).strip()
                if not 1 <= len(title) <= 160:
                    raise ValueError("Give this story a title, up to 160 characters")
                identity = uuid.uuid4().hex
                db.execute("INSERT INTO storytime_items(id,title,updated) VALUES(?,?,?)",
                           (identity, title, time.time()))
            elif action == "rename":
                title = str(payload.get("title", "")).strip()
                if not 1 <= len(title) <= 160:
                    raise ValueError("Give this story a title, up to 160 characters")
                if db.execute("UPDATE storytime_items SET title=? WHERE id=?",
                              (title, identity)).rowcount != 1:
                    raise ValueError("Story not found")
            elif action == "progress":
                position = float(payload.get("position", 0))
                import math
                if not math.isfinite(position) or not 0 <= position <= 86400:
                    raise ValueError("Invalid listening position")
                # Paused heartbeat/close saves must not keep an old bookmark alive.
                if not db.execute("UPDATE storytime_items SET position_seconds=?,updated=? WHERE id=? AND position_seconds<>?",
                                  (position, time.time(), identity, position)).rowcount:
                    return identity
            elif action == "delete":
                db.execute("DELETE FROM storytime_items WHERE id=?", (identity,))
            else:
                raise ValueError("Unknown story action")
            self._bump_revisions(db, "channels")
        return identity

    def memory_settings_save(self, channel, payload):
        ordering = str(payload.get("ordering", "shuffle"))
        seconds = int(payload.get("photo_seconds", 10))
        volume = int(payload.get("music_volume", 25))
        music_id = payload.get("music_id") or None
        if ordering not in ("shuffle", "ordered") or not 5 <= seconds <= 30 or not 0 <= volume <= 100:
            raise ValueError("Choose valid memory playback settings")
        with self.transaction() as db:
            row = db.execute("SELECT id FROM channels WHERE number=? AND content_type='memories'", (channel,)).fetchone()
            if not row:
                raise ValueError("Choose a Photos & Videos channel")
            if music_id and not db.execute("SELECT 1 FROM family_assets WHERE id=? AND kind='music' AND status='ready'",
                                           (music_id,)).fetchone():
                raise ValueError("Choose ready background music")
            db.execute("INSERT INTO memory_channel_settings VALUES(?,?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET "
                       "ordering=excluded.ordering,photo_seconds=excluded.photo_seconds,music_id=excluded.music_id,"
                       "music_volume=excluded.music_volume", (row["id"], ordering, seconds, music_id, volume))
            self._bump_revisions(db, "channels")

    def family_asset_delete(self, identity):
        with self.transaction() as db:
            row = db.execute("SELECT status FROM family_assets WHERE id=?", (identity,)).fetchone()
            if not row or row["status"] in ("uploading", "processing"):
                raise ValueError("Finish or cancel this upload before removing it")
            db.execute("DELETE FROM family_assets WHERE id=?", (identity,))
            self._bump_revisions(db, "channels")
