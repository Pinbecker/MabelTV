"""Targeted SQLite repository for MabelTV viewing identities and sessions."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from typing import Any


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _load(value: str | None, fallback: Any = None) -> Any:
    try:
        return json.loads(value) if value is not None else fallback
    except (TypeError, ValueError):
        return fallback


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class ViewingRepositoryMixin:
    def ensure_viewing_tracking(self) -> float:
        """Return the tracking epoch, creating it once for a fresh appliance."""
        with self.transaction() as db:
            row = db.execute(
                "SELECT tracking_started FROM viewing_tracking WHERE id=1"
            ).fetchone()
            if row is not None:
                return float(row[0])
            started = time.time()
            db.execute("INSERT INTO viewing_tracking VALUES(1,?)", (started,))
            self._bump_revisions(db, "viewing")
            return started

    def ensure_viewing_items(self, values: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Resolve stable identities for the current MabelTV catalogue."""
        resolved: list[dict[str, Any]] = []
        changed = False
        with self.transaction() as db:
            for raw in values:
                try:
                    channel_number = int(raw["channel_number"])
                except (KeyError, TypeError, ValueError):
                    continue
                channel = db.execute(
                    "SELECT id,number,name FROM channels WHERE number=?",
                    (channel_number,),
                ).fetchone()
                if channel is None:
                    continue
                kind = str(raw.get("kind") or "")
                if kind not in {"channel", "film"}:
                    continue
                file_name = str(raw.get("file_name") or "").strip() if kind == "film" else None
                if kind == "film" and not file_name:
                    continue
                title = str(raw.get("title") or channel["name"] or "Untitled").strip()
                source = str(raw.get("source") or channel["name"] or "MabelTV").strip()
                current_key = f"channel:{channel_number}" if kind == "channel" \
                    else f"channel:{channel_number}:{file_name.casefold()}"
                if kind == "channel":
                    identifier = f"channel:{int(channel['id'])}"
                    existing = db.execute(
                        "SELECT * FROM viewing_items WHERE id=?", (identifier,)
                    ).fetchone()
                else:
                    existing = db.execute(
                        "SELECT * FROM viewing_items WHERE channel_id=? AND kind='film' "
                        "AND file_name=? COLLATE NOCASE",
                        (int(channel["id"]), file_name),
                    ).fetchone()
                    identifier = str(existing["id"]) if existing is not None \
                        else f"film:{uuid.uuid4().hex}"
                now = time.time()
                if existing is None:
                    db.execute(
                        "INSERT INTO viewing_items VALUES(?,?,?,?,?,?,?,?,?)",
                        (identifier, kind, int(channel["id"]), file_name, current_key,
                         title, source, now, now),
                    )
                    changed = True
                elif (existing["channel_id"] != int(channel["id"])
                      or existing["file_name"] != file_name
                      or existing["current_key"] != current_key
                      or existing["title_snapshot"] != title
                      or existing["source_snapshot"] != source):
                    db.execute(
                        "UPDATE viewing_items SET channel_id=?,file_name=?,current_key=?,"
                        "title_snapshot=?,source_snapshot=?,updated_at=? WHERE id=?",
                        (int(channel["id"]), file_name, current_key, title, source, now,
                         identifier),
                    )
                    changed = True
                resolved.append({**raw, "item_id": identifier,
                                 "item_key": current_key})
            if changed:
                self._bump_revisions(db, "viewing")
        return resolved

    def viewing_items(self) -> list[dict[str, Any]]:
        db = self.connect()
        try:
            return [dict(row) for row in db.execute("""SELECT items.*,
                channels.number AS current_channel_number
              FROM viewing_items AS items
              LEFT JOIN channels ON channels.id=items.channel_id
              ORDER BY items.kind,items.title_snapshot COLLATE NOCASE""")]
        finally:
            db.close()

    def viewing_item(self, identifier: str) -> dict[str, Any] | None:
        db = self.connect()
        try:
            row = db.execute("""SELECT items.*,
                channels.number AS current_channel_number
              FROM viewing_items AS items
              LEFT JOIN channels ON channels.id=items.channel_id
              WHERE items.id=?""", (str(identifier),)).fetchone()
            return dict(row) if row is not None else None
        finally:
            db.close()

    @staticmethod
    def _viewing_session_row(row: sqlite3.Row) -> dict[str, Any]:
        item = _load(row["extra_json"], {})
        if not isinstance(item, dict):
            item = {}
        columns = {
            "id": "id", "started": "started", "ended": "ended",
            "seconds": "seconds", "surface": "surface", "kind": "kind",
            "item_key": "item_key", "viewing_item_id": "viewing_item_id",
            "channel_number": "channel_number", "channel_name": "channel_name",
            "title": "title", "position": "position_seconds",
            "media_duration": "media_duration_seconds",
            "programme_title": "programme_title",
            "programme_file_name": "programme_file_name",
        }
        for key, source in columns.items():
            if source in row.keys() and row[source] is not None:
                item[key] = row[source]
        for source, target in (
                ("item_title", "current_title"), ("item_source", "current_source"),
                ("item_file_name", "current_file_name"),
                ("current_channel_number", "current_channel_number")):
            if source in row.keys() and row[source] is not None:
                item[target] = row[source]
        return item

    def viewing_sessions(self, *, start: float | None = None,
                         end: float | None = None, item_id: str | None = None,
                         limit: int | None = None,
                         newest_first: bool = False) -> list[dict[str, Any]]:
        """Read only sessions relevant to one range or stable item."""
        clauses = ["sessions.seconds>=?"]
        parameters: list[Any] = [120.0]
        if start is not None:
            clauses.append("COALESCE(sessions.ended,sessions.started)>=?")
            parameters.append(float(start))
        if end is not None:
            clauses.append("COALESCE(sessions.started,sessions.ended)<?")
            parameters.append(float(end))
        if item_id:
            clauses.append("sessions.viewing_item_id=?")
            parameters.append(str(item_id))
        order = "DESC" if newest_first else "ASC"
        statement = f"""SELECT sessions.*,
            items.title_snapshot AS item_title,
            items.source_snapshot AS item_source,
            items.file_name AS item_file_name,
            channels.number AS current_channel_number
          FROM viewing_sessions AS sessions
          LEFT JOIN viewing_items AS items ON items.id=sessions.viewing_item_id
          LEFT JOIN channels ON channels.id=items.channel_id
          WHERE {' AND '.join(clauses)}
          ORDER BY COALESCE(sessions.ended,sessions.started) {order}"""
        if limit is not None:
            statement += " LIMIT ?"
            parameters.append(max(1, int(limit)))
        db = self.connect()
        try:
            return [self._viewing_session_row(row)
                    for row in db.execute(statement, parameters)]
        finally:
            db.close()

    def latest_viewing_session(self, item_id: str,
                               surface: str) -> dict[str, Any] | None:
        db = self.connect()
        try:
            row = db.execute(
                "SELECT * FROM viewing_sessions WHERE viewing_item_id=? AND surface=? "
                "ORDER BY COALESCE(ended,started) DESC LIMIT 1",
                (str(item_id), str(surface)),
            ).fetchone()
            return self._viewing_session_row(row) if row is not None else None
        finally:
            db.close()

    def save_viewing_session(self, item: dict[str, Any], *, cutoff: float,
                             maximum: int) -> None:
        """Upsert one sampled session and prune history in the same transaction."""
        known = {
            "id", "started", "ended", "seconds", "surface", "kind", "item_key",
            "viewing_item_id", "channel_number", "channel_name", "title", "position",
            "media_duration", "programme_title", "programme_file_name",
        }
        extra = {key: value for key, value in item.items() if key not in known}
        with self.transaction() as db:
            db.execute("""INSERT INTO viewing_sessions(
                id,started,ended,seconds,surface,kind,item_key,channel_number,
                channel_name,title,position_seconds,media_duration_seconds,extra_json,
                viewing_item_id,programme_title,programme_file_name)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                  started=excluded.started,ended=excluded.ended,seconds=excluded.seconds,
                  surface=excluded.surface,kind=excluded.kind,item_key=excluded.item_key,
                  channel_number=excluded.channel_number,
                  channel_name=excluded.channel_name,title=excluded.title,
                  position_seconds=excluded.position_seconds,
                  media_duration_seconds=excluded.media_duration_seconds,
                  extra_json=excluded.extra_json,
                  viewing_item_id=excluded.viewing_item_id,
                  programme_title=excluded.programme_title,
                  programme_file_name=excluded.programme_file_name""", (
                    str(item["id"]), item.get("started"), item.get("ended"),
                    max(0, _number(item.get("seconds"))), item.get("surface"),
                    str(item.get("kind") or "channel"), item.get("item_key"),
                    item.get("channel_number"), item.get("channel_name"), item.get("title"),
                    item.get("position"), item.get("media_duration"), _dump(extra),
                    item.get("viewing_item_id"), item.get("programme_title"),
                    item.get("programme_file_name")))
            db.execute(
                "DELETE FROM viewing_sessions WHERE COALESCE(ended,started,0)<?",
                (float(cutoff),),
            )
            db.execute("""DELETE FROM viewing_sessions WHERE id IN (
                SELECT id FROM viewing_sessions
                ORDER BY COALESCE(ended,started,0) DESC LIMIT -1 OFFSET ?)""",
                       (max(1, int(maximum)),))
            self._bump_revisions(db, "viewing")
    def delete_viewing_sessions(self, identifiers: set[str]) -> int:
        if not identifiers:
            return 0
        placeholders = ",".join("?" for _ in identifiers)
        with self.transaction() as db:
            result = db.execute(
                f"DELETE FROM viewing_sessions WHERE id IN ({placeholders})",
                tuple(sorted(identifiers)),
            )
            deleted = int(result.rowcount)
            if deleted:
                self._bump_revisions(db, "viewing")
            return deleted

    def relocate_viewing_item(self, source_channel: int, source_name: str,
                              target_channel: int, target_name: str) -> None:
        """Keep a film's stable viewing identity across a managed move or rename."""
        with self.transaction() as db:
            source = db.execute("SELECT id FROM channels WHERE number=?",
                                (int(source_channel),)).fetchone()
            target = db.execute("SELECT id,name FROM channels WHERE number=?",
                                (int(target_channel),)).fetchone()
            if source is None or target is None:
                return
            row = db.execute(
                "SELECT id FROM viewing_items WHERE channel_id=? AND kind='film' "
                "AND file_name=? COLLATE NOCASE",
                (int(source["id"]), str(source_name)),
            ).fetchone()
            if row is None:
                return
            current_key = f"channel:{int(target_channel)}:{str(target_name).casefold()}"
            db.execute(
                "UPDATE viewing_items SET channel_id=?,file_name=?,current_key=?,"
                "source_snapshot=?,updated_at=? WHERE id=?",
                (int(target["id"]), str(target_name), current_key, str(target["name"]),
                 time.time(), str(row["id"])),
            )
            db.execute(
                "UPDATE viewing_sessions SET channel_number=?,item_key=? "
                "WHERE viewing_item_id=?",
                (int(target_channel), current_key, str(row["id"])),
            )
            self._bump_revisions(db, "viewing")
