"""SQLite-backed authoritative application state for MabelTV.

The public backend still consumes its established dictionary shapes.  This
module translates those shapes to relational tables so the HTTP API can remain
stable while SQLite owns persistence.  JSON files are accepted only by the
separate migration command; production reads and writes never fall back to
them when a database is configured.
"""

from __future__ import annotations

import json
import hashlib
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


SCHEMA_VERSION = 2

SCHEMA = r"""
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL UNIQUE,
    source_manifest_sha256 TEXT NOT NULL,
    imported_at REAL NOT NULL,
    report_json TEXT NOT NULL CHECK(json_valid(report_json))
);
CREATE TABLE IF NOT EXISTS application_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_fields (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY,
    number INTEGER NOT NULL UNIQUE CHECK(number BETWEEN 1 AND 999),
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
    folder TEXT NOT NULL UNIQUE CHECK(length(folder) > 0),
    aspect TEXT NOT NULL CHECK(aspect IN ('crop','fit','stretch')),
    content_type TEXT NOT NULL CHECK(content_type IN ('shows','films'))
);
CREATE TABLE IF NOT EXISTS player_fields (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS adult_resume (
    library_id TEXT PRIMARY KEY,
    position_seconds REAL NOT NULL DEFAULT 0 CHECK(position_seconds >= 0),
    duration_seconds REAL NOT NULL DEFAULT 0 CHECK(duration_seconds >= 0),
    updated_utc_ms INTEGER NOT NULL DEFAULT 0,
    position_present INTEGER NOT NULL CHECK(position_present IN (0,1)),
    duration_present INTEGER NOT NULL CHECK(duration_present IN (0,1)),
    updated_present INTEGER NOT NULL CHECK(updated_present IN (0,1))
);
CREATE TABLE IF NOT EXISTS channel_film_resume (
    media_key TEXT PRIMARY KEY,
    position_seconds REAL NOT NULL DEFAULT 0 CHECK(position_seconds >= 0),
    duration_seconds REAL NOT NULL DEFAULT 0 CHECK(duration_seconds >= 0),
    updated_utc_ms INTEGER NOT NULL DEFAULT 0,
    position_present INTEGER NOT NULL CHECK(position_present IN (0,1)),
    duration_present INTEGER NOT NULL CHECK(duration_present IN (0,1)),
    updated_present INTEGER NOT NULL CHECK(updated_present IN (0,1))
);
CREATE TABLE IF NOT EXISTS channel_timelines (
    channel_number INTEGER PRIMARY KEY,
    episode_index INTEGER,
    episode_name TEXT,
    position_seconds REAL NOT NULL DEFAULT 0,
    FOREIGN KEY(channel_number) REFERENCES channels(number)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS channel_programme_positions (
    channel_number INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    position_seconds REAL NOT NULL CHECK(position_seconds >= 0),
    PRIMARY KEY(channel_number, file_name),
    FOREIGN KEY(channel_number) REFERENCES channels(number)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS channel_runtime_entries (
    channel_number INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('last_left','failed')),
    file_name TEXT NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY(channel_number, kind, file_name),
    FOREIGN KEY(channel_number) REFERENCES channels(number)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS viewing_tracking (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    tracking_started REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS viewing_sessions (
    id TEXT PRIMARY KEY,
    started REAL,
    ended REAL,
    seconds REAL NOT NULL CHECK(seconds >= 0),
    surface TEXT,
    kind TEXT NOT NULL,
    item_key TEXT,
    channel_number INTEGER,
    channel_name TEXT,
    title TEXT,
    position_seconds REAL,
    media_duration_seconds REAL,
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json))
);
CREATE INDEX IF NOT EXISTS viewing_sessions_ended_idx ON viewing_sessions(ended);
CREATE INDEX IF NOT EXISTS viewing_sessions_item_idx ON viewing_sessions(item_key, ended);
CREATE TABLE IF NOT EXISTS channel_metadata (
    entity_kind TEXT NOT NULL CHECK(entity_kind IN ('channel','programme')),
    entity_key TEXT NOT NULL,
    metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
    PRIMARY KEY(entity_kind, entity_key)
);
CREATE TABLE IF NOT EXISTS channel_favourites (
    channel_number INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS programme_favourites (
    media_key TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS channel_metadata_state (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL CHECK(json_valid(value_json))
);
CREATE TABLE IF NOT EXISTS local_media (
    relative_path TEXT PRIMARY KEY,
    library_id TEXT UNIQUE,
    domain TEXT NOT NULL CHECK(domain IN ('adult','adult_episode')),
    series_id TEXT,
    state TEXT,
    message TEXT,
    progress INTEGER,
    favourite INTEGER NOT NULL DEFAULT 0 CHECK(favourite IN (0,1)),
    favourite_present INTEGER NOT NULL DEFAULT 0 CHECK(favourite_present IN (0,1)),
    watched INTEGER CHECK(watched IN (0,1)),
    watched_present INTEGER NOT NULL DEFAULT 0 CHECK(watched_present IN (0,1)),
    remote_position REAL,
    remote_duration REAL,
    remote_last_watched REAL,
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
    metadata_present INTEGER NOT NULL DEFAULT 0 CHECK(metadata_present IN (0,1)),
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json))
);
CREATE TABLE IF NOT EXISTS adult_series (
    id TEXT PRIMARY KEY,
    title TEXT,
    favourite INTEGER NOT NULL DEFAULT 0 CHECK(favourite IN (0,1)),
    favourite_present INTEGER NOT NULL DEFAULT 0 CHECK(favourite_present IN (0,1)),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
    metadata_present INTEGER NOT NULL DEFAULT 0 CHECK(metadata_present IN (0,1)),
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json))
);
CREATE TABLE IF NOT EXISTS adult_seasons (
    series_id TEXT NOT NULL,
    season_number INTEGER NOT NULL CHECK(season_number BETWEEN 1 AND 99),
    explicit INTEGER NOT NULL DEFAULT 0 CHECK(explicit IN (0,1)),
    PRIMARY KEY(series_id, season_number),
    FOREIGN KEY(series_id) REFERENCES adult_series(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS adult_titles (
    media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv')),
    tmdb_id INTEGER NOT NULL CHECK(tmdb_id > 0),
    title TEXT,
    year TEXT,
    poster_path TEXT,
    overview TEXT,
    runtime INTEGER,
    manual_state TEXT,
    series_watching INTEGER CHECK(series_watching IN (0,1)),
    viewing_updated REAL,
    series_watching_updated REAL,
    last_launched REAL,
    last_provider TEXT,
    updated REAL,
    history_present INTEGER NOT NULL DEFAULT 0 CHECK(history_present IN (0,1)),
    episodes_present INTEGER NOT NULL DEFAULT 0 CHECK(episodes_present IN (0,1)),
    watchlisted INTEGER CHECK(watchlisted IN (0,1)),
    watchlist_updated REAL,
    up_next INTEGER CHECK(up_next IN (0,1)),
    up_next_rank INTEGER,
    personal_rating INTEGER CHECK(personal_rating BETWEEN 0 AND 10),
    rating_updated REAL,
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json)),
    PRIMARY KEY(media_type, tmdb_id)
);
CREATE TABLE IF NOT EXISTS title_watch_events (
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    watched_at REAL NOT NULL,
    PRIMARY KEY(media_type, tmdb_id, ordinal),
    FOREIGN KEY(media_type, tmdb_id) REFERENCES adult_titles(media_type, tmdb_id)
        ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS watchlist_entries (
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    updated REAL,
    PRIMARY KEY(media_type, tmdb_id),
    FOREIGN KEY(media_type, tmdb_id) REFERENCES adult_titles(media_type, tmdb_id)
        ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS up_next_entries (
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    rank INTEGER NOT NULL CHECK(rank > 0),
    PRIMARY KEY(media_type, tmdb_id),
    UNIQUE(rank),
    FOREIGN KEY(media_type, tmdb_id) REFERENCES adult_titles(media_type, tmdb_id)
        ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS title_ratings (
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 10),
    updated REAL,
    PRIMARY KEY(media_type, tmdb_id),
    FOREIGN KEY(media_type, tmdb_id) REFERENCES adult_titles(media_type, tmdb_id)
        ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS title_episode_state (
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    season_number INTEGER NOT NULL CHECK(season_number > 0),
    episode_number INTEGER NOT NULL CHECK(episode_number > 0),
    watched INTEGER NOT NULL CHECK(watched IN (0,1)),
    updated REAL,
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json)),
    PRIMARY KEY(media_type, tmdb_id, season_number, episode_number),
    FOREIGN KEY(media_type, tmdb_id) REFERENCES adult_titles(media_type, tmdb_id)
        ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS explore_feedback (
    media_type TEXT NOT NULL,
    tmdb_id INTEGER NOT NULL,
    last_seen REAL NOT NULL,
    impressions INTEGER NOT NULL CHECK(impressions BETWEEN 0 AND 50),
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extra_json)),
    PRIMARY KEY(media_type, tmdb_id)
);
CREATE TABLE IF NOT EXISTS availability_cache (
    title_key TEXT PRIMARY KEY,
    checked REAL,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
CREATE TABLE IF NOT EXISTS adult_viewing_state (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL CHECK(json_valid(value_json))
);
CREATE TABLE IF NOT EXISTS adult_insights_titles (
    title_key TEXT PRIMARY KEY,
    checked REAL,
    metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json))
);
CREATE TABLE IF NOT EXISTS adult_insights_failures (
    title_key TEXT PRIMARY KEY,
    failed_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS adult_insights_state (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL CHECK(json_valid(value_json))
);
"""
REVISION_SCHEMA = r"""
CREATE TABLE state_revisions (
    domain TEXT PRIMARY KEY CHECK(domain IN (
        'library','adult_viewing','viewing_insights','adult_insights'
    )),
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
    updated_at REAL NOT NULL
)
"""
MIGRATIONS = (
    (1, "initial relational state", SCHEMA),
    (2, "portal cache revision ledger", REVISION_SCHEMA),
)
MIGRATION_CHECKSUMS = {
    version: hashlib.sha256(sql.encode("utf-8")).hexdigest()
    for version, _, sql in MIGRATIONS
}


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


class StateDatabase:
    """Translate established state documents to one relational SQLite store."""

    schema_version = SCHEMA_VERSION

    def __init__(self, path: Path, managed_paths: dict[str, Path]) -> None:
        self.path = Path(path)
        self.managed_paths = {Path(value).resolve(): key for key, value in managed_paths.items()}
        self._write_lock = threading.RLock()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=5000")
        connection.execute("PRAGMA synchronous=FULL")
        return connection

    def initialise(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = self.connect()
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript(SCHEMA)
            connection.execute(
                "INSERT OR IGNORE INTO schema_migrations VALUES(?,?,?,?)",
                (1, "initial relational state", MIGRATION_CHECKSUMS[1], time.time()),
            )
            connection.execute("PRAGMA user_version=1")
            connection.commit()
            self._upgrade_connection(connection)
        finally:
            connection.close()

    @staticmethod
    def _verify_migration_history(connection: sqlite3.Connection,
                                  version: int) -> None:
        for expected_version, _, _ in MIGRATIONS:
            if expected_version > version:
                break
            row = connection.execute(
                "SELECT checksum FROM schema_migrations WHERE version=?",
                (expected_version,),
            ).fetchone()
            if row is None or row[0] != MIGRATION_CHECKSUMS[expected_version]:
                raise RuntimeError(
                    f"MabelTV database migration {expected_version} checksum does not match")

    def _upgrade_connection(self, connection: sqlite3.Connection) -> int:
        current = int(connection.execute("PRAGMA user_version").fetchone()[0])
        if current > SCHEMA_VERSION:
            raise RuntimeError(
                f"MabelTV database schema {current} is newer than supported {SCHEMA_VERSION}")
        self._verify_migration_history(connection, current)
        for version, name, sql in MIGRATIONS:
            if version <= current:
                continue
            connection.execute("BEGIN IMMEDIATE")
            try:
                connection.execute(sql)
                connection.execute(
                    "INSERT INTO schema_migrations VALUES(?,?,?,?)",
                    (version, name, MIGRATION_CHECKSUMS[version], time.time()),
                )
                connection.execute(f"PRAGMA user_version={version}")
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            current = version
        return current

    def upgrade(self) -> dict[str, Any]:
        """Apply reviewed additive migrations to an existing database."""
        if not self.path.is_file():
            raise RuntimeError(f"MabelTV database does not exist: {self.path}")
        with self._write_lock:
            connection = self.connect()
            try:
                previous = int(connection.execute("PRAGMA user_version").fetchone()[0])
                current = self._upgrade_connection(connection)
            finally:
                connection.close()
        self.verify_ready()
        return {"ok": True, "previous_schema_version": previous,
                "schema_version": current, "upgraded": current != previous}

    def verify_ready(self) -> None:
        if not self.path.is_file():
            raise RuntimeError(f"MabelTV database does not exist: {self.path}")
        connection = self.connect()
        try:
            version = int(connection.execute("PRAGMA user_version").fetchone()[0])
            integrity = connection.execute("PRAGMA quick_check").fetchone()[0]
            foreign_keys = list(connection.execute("PRAGMA foreign_key_check"))
            self._verify_migration_history(connection, version)
        finally:
            connection.close()
        if version != SCHEMA_VERSION:
            raise RuntimeError(
                f"MabelTV database schema {version} is not supported; expected {SCHEMA_VERSION}")
        if integrity != "ok":
            raise RuntimeError(f"MabelTV database failed quick_check: {integrity}")
        if foreign_keys:
            raise RuntimeError(
                f"MabelTV database has {len(foreign_keys)} foreign-key violation(s)")

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self._write_lock:
            connection = self.connect()
            try:
                connection.execute("BEGIN IMMEDIATE")
                yield connection
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()

    def kind_for(self, path: Path) -> str | None:
        return self.managed_paths.get(Path(path).resolve())

    def read(self, kind: str) -> Any:
        db = self.connect()
        try:
            return getattr(self, f"_read_{kind}")(db)
        finally:
            db.close()

    def write(self, kind: str, value: Any) -> None:
        with self.transaction() as db:
            getattr(self, f"_write_{kind}")(db, value)
            self._bump_revisions(db, kind)

    @staticmethod
    def _revision_domains(kind: str) -> tuple[str, ...]:
        domains = {
            "channels": ("library",),
            "settings": ("library",),
            "owner": ("library",),
            "player": ("library",),
            "channel_metadata": ("library",),
            "adult_media": ("library",),
            "adult_series": ("library",),
            "adult_viewing": ("adult_viewing", "adult_insights"),
            "viewing": ("viewing_insights",),
            "adult_insights": ("adult_insights",),
        }
        return domains.get(kind, ())

    def _bump_revisions(self, db: sqlite3.Connection, kind: str) -> None:
        now = time.time()
        for domain in self._revision_domains(kind):
            db.execute(
                "INSERT INTO state_revisions(domain,revision,updated_at) VALUES(?,1,?) "
                "ON CONFLICT(domain) DO UPDATE SET "
                "revision=revision+1,updated_at=excluded.updated_at",
                (domain, now),
            )

    def bump_revision(self, domain: str) -> None:
        if domain not in {"library", "adult_viewing", "viewing_insights",
                          "adult_insights"}:
            raise ValueError(f"Unknown portal revision domain: {domain}")
        with self.transaction() as db:
            self._bump_revisions(db, {
                "library": "channels",
                "adult_viewing": "adult_viewing",
                "viewing_insights": "viewing",
                "adult_insights": "adult_insights",
            }[domain])

    def revisions(self) -> dict[str, int]:
        domains = ("library", "adult_viewing", "viewing_insights", "adult_insights")
        db = self.connect()
        try:
            rows = {row["domain"]: int(row["revision"])
                    for row in db.execute("SELECT domain,revision FROM state_revisions")}
        finally:
            db.close()
        return {domain: rows.get(domain, 0) for domain in domains}

    @staticmethod
    def _replace_kv(db: sqlite3.Connection, table: str, value: dict[str, Any]) -> None:
        now = time.time()
        db.execute(f"DELETE FROM {table}")
        db.executemany(
            f"INSERT INTO {table}(key,value_json,updated_at) VALUES(?,?,?)",
            [(str(key), _dump(saved), now) for key, saved in value.items()],
        )

    @staticmethod
    def _read_kv(db: sqlite3.Connection, table: str) -> dict[str, Any]:
        return {row["key"]: _load(row["value_json"]) for row in db.execute(
            f"SELECT key,value_json FROM {table} ORDER BY key")}

    def _read_settings(self, db: sqlite3.Connection) -> dict[str, Any]:
        return self._read_kv(db, "application_settings")

    def _write_settings(self, db: sqlite3.Connection, value: Any) -> None:
        self._replace_kv(db, "application_settings", dict(value or {}))

    def _read_owner(self, db: sqlite3.Connection) -> dict[str, Any]:
        return self._read_kv(db, "owner_fields")

    def _write_owner(self, db: sqlite3.Connection, value: Any) -> None:
        self._replace_kv(db, "owner_fields", dict(value or {}))

    @staticmethod
    def _read_channels(db: sqlite3.Connection) -> dict[str, Any]:
        rows = db.execute(
            "SELECT number,name,folder,aspect,content_type FROM channels ORDER BY number")
        return {"schema_version": 1, "channels": [dict(row) for row in rows]}

    @staticmethod
    def _write_channels(db: sqlite3.Connection, value: Any) -> None:
        rows = value.get("channels", []) if isinstance(value, dict) else []
        desired_numbers: set[int] = set()
        for row in rows:
            number = int(row["number"])
            folder = str(row["folder"])
            fields = (number, str(row["name"]), folder,
                      str(row.get("aspect", "crop")),
                      str(row.get("content_type", "shows")))
            desired_numbers.add(number)

            # Folder is the stable channel identity in the existing system.
            # Updating its number lets SQLite cascade that change to playback
            # timelines instead of deleting and recreating the channel.
            existing = db.execute(
                "SELECT id FROM channels WHERE folder = ?", (folder,)
            ).fetchone()
            if existing is not None:
                db.execute(
                    "UPDATE channels SET number=?,name=?,folder=?,aspect=?,content_type=? "
                    "WHERE id=?", (*fields, existing["id"])
                )
                continue

            existing = db.execute(
                "SELECT id FROM channels WHERE number = ?", (number,)
            ).fetchone()
            if existing is not None:
                db.execute(
                    "UPDATE channels SET number=?,name=?,folder=?,aspect=?,content_type=? "
                    "WHERE id=?", (*fields, existing["id"])
                )
                continue

            db.execute(
                "INSERT INTO channels(number,name,folder,aspect,content_type) "
                "VALUES(?,?,?,?,?)", fields
            )

        if desired_numbers:
            placeholders = ",".join("?" for _ in desired_numbers)
            db.execute(
                f"DELETE FROM channels WHERE number NOT IN ({placeholders})",
                tuple(sorted(desired_numbers)),
            )
        else:
            db.execute("DELETE FROM channels")

    @staticmethod
    def _read_player(db: sqlite3.Connection) -> dict[str, Any]:
        root = StateDatabase._read_kv(db, "player_fields")
        root.setdefault("schema_version", 4)
        for table, prefix in (("adult_resume", "adult"),
                              ("channel_film_resume", "channel_film")):
            key_name = "library_id" if table == "adult_resume" else "media_key"
            rows = list(db.execute(f"SELECT * FROM {table}"))
            root[f"{prefix}_positions"] = {row[key_name]: row["position_seconds"] for row in rows
                                             if row["position_present"]}
            root[f"{prefix}_durations"] = {row[key_name]: row["duration_seconds"] for row in rows
                                            if row["duration_present"]}
            root[f"{prefix}_position_updated_utc_ms"] = {
                row[key_name]: row["updated_utc_ms"] for row in rows if row["updated_present"]}
        timelines: dict[str, Any] = {}
        for row in db.execute("SELECT * FROM channel_timelines ORDER BY channel_number"):
            item = {"episode_index": row["episode_index"],
                    "programme_positions": {}, "programme_last_left_uptime_ms": {},
                    "failed_programmes": {}}
            if row["episode_name"] is not None:
                item["episode_name"] = row["episode_name"]
                item["position_seconds"] = row["position_seconds"]
            timelines[str(row["channel_number"])] = item
        for row in db.execute("SELECT * FROM channel_programme_positions"):
            timelines.setdefault(str(row["channel_number"]), {}) \
                .setdefault("programme_positions", {})[row["file_name"]] = row["position_seconds"]
        for row in db.execute("SELECT * FROM channel_runtime_entries"):
            field = "programme_last_left_uptime_ms" if row["kind"] == "last_left" \
                else "failed_programmes"
            timelines.setdefault(str(row["channel_number"]), {}).setdefault(field, {})[
                row["file_name"]] = row["value"]
        root["channel_timelines"] = timelines
        return root

    def _write_player(self, db: sqlite3.Connection, value: Any) -> None:
        root = dict(value or {})
        structured = {"adult_positions", "adult_durations", "adult_position_updated_utc_ms",
                      "channel_film_positions", "channel_film_durations",
                      "channel_film_position_updated_utc_ms", "channel_timelines"}
        self._replace_kv(db, "player_fields", {
            key: saved for key, saved in root.items() if key not in structured})
        for table, prefix, key_name in (("adult_resume", "adult", "library_id"),
                                        ("channel_film_resume", "channel_film", "media_key")):
            db.execute(f"DELETE FROM {table}")
            positions = root.get(f"{prefix}_positions", {})
            durations = root.get(f"{prefix}_durations", {})
            updates = root.get(f"{prefix}_position_updated_utc_ms", {})
            keys = set(positions) | set(durations) | set(updates) if all(
                isinstance(item, dict) for item in (positions, durations, updates)) else set()
            db.executemany(
                f"INSERT INTO {table}({key_name},position_seconds,duration_seconds,updated_utc_ms,position_present,duration_present,updated_present) VALUES(?,?,?,?,?,?,?)",
                [(str(key), max(0, _number(positions.get(key))),
                  max(0, _number(durations.get(key))), int(_number(updates.get(key))),
                  key in positions, key in durations, key in updates)
                 for key in keys],
            )
        db.execute("DELETE FROM channel_runtime_entries")
        db.execute("DELETE FROM channel_programme_positions")
        db.execute("DELETE FROM channel_timelines")
        for raw_number, saved in (root.get("channel_timelines", {}) or {}).items():
            if not isinstance(saved, dict):
                continue
            number = int(raw_number)
            db.execute("INSERT INTO channel_timelines VALUES(?,?,?,?)", (
                number, saved.get("episode_index"), saved.get("episode_name"),
                _number(saved.get("position_seconds"))))
            for name, position in (saved.get("programme_positions", {}) or {}).items():
                db.execute("INSERT INTO channel_programme_positions VALUES(?,?,?)",
                           (number, str(name), max(0, _number(position))))
            for field, kind in (("programme_last_left_uptime_ms", "last_left"),
                                ("failed_programmes", "failed")):
                for name, entry in (saved.get(field, {}) or {}).items():
                    db.execute("INSERT INTO channel_runtime_entries VALUES(?,?,?,?)",
                               (number, kind, str(name), _number(entry)))

    @staticmethod
    def _read_viewing(db: sqlite3.Connection) -> dict[str, Any]:
        row = db.execute("SELECT tracking_started FROM viewing_tracking WHERE id=1").fetchone()
        sessions = []
        columns = {"id", "started", "ended", "seconds", "surface", "kind", "item_key",
                   "channel_number", "channel_name", "title", "position", "media_duration"}
        for saved in db.execute("SELECT * FROM viewing_sessions ORDER BY rowid"):
            item = _load(saved["extra_json"], {})
            for key in columns:
                source = {"position": "position_seconds",
                          "media_duration": "media_duration_seconds"}.get(key, key)
                if saved[source] is not None:
                    item[key] = saved[source]
            sessions.append(item)
        return {"schema_version": 2,
                "tracking_started": row[0] if row else time.time(), "sessions": sessions}

    @staticmethod
    def _write_viewing(db: sqlite3.Connection, value: Any) -> None:
        root = value if isinstance(value, dict) else {}
        db.execute("DELETE FROM viewing_sessions")
        db.execute("INSERT OR REPLACE INTO viewing_tracking VALUES(1,?)",
                   (_number(root.get("tracking_started"), time.time()),))
        known = {"id", "started", "ended", "seconds", "surface", "kind", "item_key",
                 "channel_number", "channel_name", "title", "position", "media_duration"}
        for ordinal, item in enumerate(root.get("sessions", [])):
            if not isinstance(item, dict):
                continue
            identifier = str(item.get("id") or f"legacy-{ordinal}")
            extra = {key: saved for key, saved in item.items() if key not in known}
            db.execute("""INSERT INTO viewing_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                identifier, item.get("started"), item.get("ended"),
                max(0, _number(item.get("seconds"))), item.get("surface"),
                str(item.get("kind") or "unknown"), item.get("item_key"),
                item.get("channel_number"), item.get("channel_name"), item.get("title"),
                item.get("position"), item.get("media_duration"), _dump(extra)))

    @staticmethod
    def _read_channel_metadata(db: sqlite3.Connection) -> dict[str, Any]:
        root = {row["key"]: _load(row["value_json"]) for row in db.execute(
            "SELECT * FROM channel_metadata_state")}
        root["channels"] = {row["entity_key"]: _load(row["metadata_json"], {})
                            for row in db.execute(
                                "SELECT * FROM channel_metadata WHERE entity_kind='channel'")}
        root["programmes"] = {row["entity_key"]: _load(row["metadata_json"], {})
                              for row in db.execute(
                                  "SELECT * FROM channel_metadata WHERE entity_kind='programme'")}
        root["favourites"] = [row[0] for row in db.execute(
            "SELECT media_key FROM programme_favourites ORDER BY media_key")]
        root["favourite_channels"] = [row[0] for row in db.execute(
            "SELECT channel_number FROM channel_favourites ORDER BY channel_number")]
        return root

    @staticmethod
    def _write_channel_metadata(db: sqlite3.Connection, value: Any) -> None:
        root = value if isinstance(value, dict) else {}
        for table in ("channel_metadata", "channel_favourites", "programme_favourites",
                      "channel_metadata_state"):
            db.execute(f"DELETE FROM {table}")
        for kind in ("channels", "programmes"):
            entity = "channel" if kind == "channels" else "programme"
            db.executemany("INSERT INTO channel_metadata VALUES(?,?,?)", [
                (entity, str(key), _dump(saved))
                for key, saved in (root.get(kind, {}) or {}).items()])
        db.executemany("INSERT INTO programme_favourites VALUES(?)",
                       [(str(key),) for key in root.get("favourites", [])])
        db.executemany("INSERT INTO channel_favourites VALUES(?)",
                       [(int(key),) for key in root.get("favourite_channels", [])])
        for key, saved in root.items():
            if key not in {"channels", "programmes", "favourites", "favourite_channels"}:
                db.execute("INSERT INTO channel_metadata_state VALUES(?,?)", (key, _dump(saved)))

    @staticmethod
    def _split_media_state(path: str, saved: Any, domain: str,
                           series_id: str | None = None) -> tuple[Any, ...]:
        value = dict(saved) if isinstance(saved, dict) else {}
        known = {"library_id", "state", "message", "progress", "favourite", "watched",
                 "remote_position", "remote_duration", "remote_last_watched", "metadata"}
        extra = {key: item for key, item in value.items() if key not in known}
        return (path, value.get("library_id"), domain, series_id, value.get("state"),
                value.get("message"), value.get("progress"), bool(value.get("favourite")),
                "favourite" in value, bool(value.get("watched")) if "watched" in value else None,
                "watched" in value,
                value.get("remote_position"), value.get("remote_duration"),
                value.get("remote_last_watched"), _dump(value.get("metadata", {})),
                "metadata" in value, _dump(extra))

    @staticmethod
    def _media_state(row: sqlite3.Row) -> dict[str, Any]:
        value = _load(row["extra_json"], {})
        for key in ("library_id", "state", "message", "progress", "remote_position",
                    "remote_duration", "remote_last_watched"):
            if row[key] is not None:
                value[key] = row[key]
        if row["favourite_present"]:
            value["favourite"] = bool(row["favourite"])
        if row["watched_present"]:
            value["watched"] = bool(row["watched"])
        metadata = _load(row["metadata_json"], {})
        if row["metadata_present"]:
            value["metadata"] = metadata
        return value

    @staticmethod
    def _read_adult_media(db: sqlite3.Connection) -> dict[str, Any]:
        return {row["relative_path"]: StateDatabase._media_state(row) for row in db.execute(
            "SELECT * FROM local_media WHERE domain='adult' ORDER BY relative_path")}

    @staticmethod
    def _write_adult_media(db: sqlite3.Connection, value: Any) -> None:
        db.execute("DELETE FROM local_media WHERE domain='adult'")
        db.executemany("INSERT INTO local_media VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
            StateDatabase._split_media_state(str(path), saved, "adult")
            for path, saved in (value or {}).items()])

    @staticmethod
    def _read_adult_series(db: sqlite3.Connection) -> dict[str, Any]:
        root: dict[str, Any] = {"series": {}, "episodes": {}}
        for row in db.execute("SELECT * FROM adult_series ORDER BY id"):
            value = _load(row["extra_json"], {})
            if row["title"] is not None:
                value["title"] = row["title"]
            if row["favourite_present"]:
                value["favourite"] = bool(row["favourite"])
            metadata = _load(row["metadata_json"], {})
            if row["metadata_present"]:
                value["metadata"] = metadata
            root["series"][row["id"]] = value
        for row in db.execute("SELECT * FROM local_media WHERE domain='adult_episode'"):
            relative = row["relative_path"]
            root["episodes"][f"{row['series_id']}/{relative}"] = StateDatabase._media_state(row)
        state = {row["key"]: _load(row["value_json"]) for row in db.execute(
            "SELECT * FROM adult_viewing_state WHERE key LIKE 'series_state:%'")}
        for key, value in state.items():
            root[key.removeprefix("series_state:")] = value
        return root

    @staticmethod
    def _write_adult_series(db: sqlite3.Connection, value: Any) -> None:
        root = value if isinstance(value, dict) else {}
        db.execute("DELETE FROM local_media WHERE domain='adult_episode'")
        db.execute("DELETE FROM adult_seasons")
        db.execute("DELETE FROM adult_series")
        db.execute("DELETE FROM adult_viewing_state WHERE key LIKE 'series_state:%'")
        for series_id, saved in (root.get("series", {}) or {}).items():
            item = dict(saved) if isinstance(saved, dict) else {}
            extra = {key: entry for key, entry in item.items()
                     if key not in {"title", "favourite", "metadata"}}
            db.execute("INSERT INTO adult_series VALUES(?,?,?,?,?,?,?)", (
                str(series_id), item.get("title"), bool(item.get("favourite")),
                "favourite" in item, _dump(item.get("metadata", {})),
                "metadata" in item, _dump(extra)))
        for compound, saved in (root.get("episodes", {}) or {}).items():
            series_id, _, relative = str(compound).partition("/")
            if not relative or not db.execute(
                    "SELECT 1 FROM adult_series WHERE id=?", (series_id,)).fetchone():
                continue
            db.execute("INSERT INTO local_media VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       StateDatabase._split_media_state(
                           relative, saved, "adult_episode", series_id))
            metadata = saved.get("metadata", {}) if isinstance(saved, dict) else {}
            try:
                season = int(metadata.get("season_number", 0))
            except (TypeError, ValueError):
                season = 0
            if season > 0:
                db.execute("INSERT OR IGNORE INTO adult_seasons VALUES(?,?,0)",
                           (series_id, season))
        for key, saved in root.items():
            if key not in {"series", "episodes"}:
                db.execute("INSERT INTO adult_viewing_state VALUES(?,?)",
                           (f"series_state:{key}", _dump(saved)))

    @staticmethod
    def _title_key(media_type: str, tmdb_id: int) -> str:
        return f"{media_type}:{tmdb_id}"

    @staticmethod
    def _read_adult_viewing(db: sqlite3.Connection) -> dict[str, Any]:
        root = {row["key"]: _load(row["value_json"]) for row in db.execute(
            "SELECT * FROM adult_viewing_state WHERE key NOT LIKE 'series_state:%'")}
        titles: dict[str, Any] = {}
        for row in db.execute("SELECT * FROM adult_titles ORDER BY media_type,tmdb_id"):
            item = _load(row["extra_json"], {})
            for key in ("media_type", "tmdb_id", "title", "year", "poster_path", "overview",
                        "runtime", "manual_state", "viewing_updated", "series_watching_updated",
                        "last_launched", "last_provider", "updated"):
                if row[key] is not None:
                    item[key] = row[key]
            if row["series_watching"] is not None:
                item["series_watching"] = bool(row["series_watching"])
            key = StateDatabase._title_key(row["media_type"], row["tmdb_id"])
            if row["history_present"]:
                item["history"] = []
            if row["episodes_present"]:
                item["episodes"] = {}
            if row["watchlisted"] is not None:
                item["watchlisted"] = bool(row["watchlisted"])
            if row["watchlist_updated"] is not None:
                item["watchlist_updated"] = row["watchlist_updated"]
            if row["up_next"] is not None:
                item["up_next"] = bool(row["up_next"])
            if row["up_next_rank"] is not None:
                item["up_next_rank"] = row["up_next_rank"]
            if row["personal_rating"] is not None:
                item["personal_rating"] = row["personal_rating"]
            if row["rating_updated"] is not None:
                item["rating_updated"] = row["rating_updated"]
            titles[key] = item
        for event in db.execute(
                "SELECT media_type,tmdb_id,watched_at FROM title_watch_events "
                "ORDER BY media_type,tmdb_id,ordinal"):
            key = StateDatabase._title_key(event["media_type"], event["tmdb_id"])
            titles[key].setdefault("history", []).append(event["watched_at"])
        for episode in db.execute(
                "SELECT * FROM title_episode_state "
                "ORDER BY media_type,tmdb_id,season_number,episode_number"):
            key = StateDatabase._title_key(episode["media_type"], episode["tmdb_id"])
            saved = _load(episode["extra_json"], {})
            saved.update({"watched": bool(episode["watched"]),
                          "updated": episode["updated"]})
            titles[key].setdefault("episodes", {})[
                f"{episode['season_number']}:{episode['episode_number']}"] = saved
        root["titles"] = titles
        root["availability"] = {row["title_key"]: _load(row["payload_json"], {})
                                for row in db.execute("SELECT * FROM availability_cache")}
        root["explore"] = {}
        for row in db.execute("SELECT * FROM explore_feedback"):
            item = _load(row["extra_json"], {})
            item.update({"last_seen": row["last_seen"], "impressions": row["impressions"]})
            root["explore"][StateDatabase._title_key(row["media_type"], row["tmdb_id"])] = item
        root.setdefault("schema_version", 1)
        return root

    @staticmethod
    def _write_adult_viewing(db: sqlite3.Connection, value: Any) -> None:
        root = value if isinstance(value, dict) else {}
        for table in ("title_watch_events", "watchlist_entries", "up_next_entries",
                      "title_ratings", "title_episode_state", "adult_titles",
                      "availability_cache", "explore_feedback"):
            db.execute(f"DELETE FROM {table}")
        db.execute("DELETE FROM adult_viewing_state WHERE key NOT LIKE 'series_state:%'")
        core = {"media_type", "tmdb_id", "title", "year", "poster_path", "overview", "runtime",
                "manual_state", "series_watching", "viewing_updated", "series_watching_updated",
                "last_launched", "last_provider", "updated", "history", "episodes", "watchlisted",
                "watchlist_updated", "up_next", "up_next_rank", "personal_rating", "rating_updated"}
        queue: list[tuple[str, int, int]] = []
        for raw_key, saved in (root.get("titles", {}) or {}).items():
            item = dict(saved) if isinstance(saved, dict) else {}
            try:
                media_type, raw_id = str(raw_key).split(":", 1)
                tmdb_id = int(item.get("tmdb_id") or raw_id)
            except (TypeError, ValueError):
                continue
            if media_type not in {"movie", "tv"} or tmdb_id <= 0:
                continue
            extra = {key: entry for key, entry in item.items() if key not in core}
            db.execute("""INSERT INTO adult_titles VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                media_type, tmdb_id, item.get("title"), item.get("year"), item.get("poster_path"),
                item.get("overview"), item.get("runtime"), item.get("manual_state"),
                bool(item.get("series_watching")) if "series_watching" in item else None,
                item.get("viewing_updated"), item.get("series_watching_updated"),
                item.get("last_launched"), item.get("last_provider"), item.get("updated"),
                "history" in item, "episodes" in item,
                bool(item.get("watchlisted")) if "watchlisted" in item else None,
                item.get("watchlist_updated"),
                bool(item.get("up_next")) if "up_next" in item else None,
                item.get("up_next_rank"),
                item.get("personal_rating") if "personal_rating" in item else None,
                item.get("rating_updated"), _dump(extra)))
            for ordinal, watched_at in enumerate(item.get("history", []) or []):
                db.execute("INSERT INTO title_watch_events VALUES(?,?,?,?)",
                           (media_type, tmdb_id, ordinal, _number(watched_at)))
            if item.get("watchlisted"):
                db.execute("INSERT INTO watchlist_entries VALUES(?,?,?)",
                           (media_type, tmdb_id, item.get("watchlist_updated")))
            if item.get("up_next"):
                queue.append((media_type, tmdb_id, max(1, int(item.get("up_next_rank", 1) or 1))))
            rating = int(item.get("personal_rating", 0) or 0)
            if 1 <= rating <= 10:
                db.execute("INSERT INTO title_ratings VALUES(?,?,?,?)",
                           (media_type, tmdb_id, rating, item.get("rating_updated")))
            for episode_key, episode in (item.get("episodes", {}) or {}).items():
                try:
                    season, number = (int(part) for part in str(episode_key).split(":", 1))
                except ValueError:
                    continue
                episode = episode if isinstance(episode, dict) else {}
                extra_episode = {key: entry for key, entry in episode.items()
                                 if key not in {"watched", "updated"}}
                db.execute("INSERT INTO title_episode_state VALUES(?,?,?,?,?,?,?)", (
                    media_type, tmdb_id, season, number, bool(episode.get("watched")),
                    episode.get("updated"), _dump(extra_episode)))
        for media_type, tmdb_id, rank in queue:
            db.execute("INSERT INTO up_next_entries VALUES(?,?,?)", (media_type, tmdb_id, rank))
        for key, saved in (root.get("availability", {}) or {}).items():
            checked = saved.get("checked") if isinstance(saved, dict) else None
            db.execute("INSERT INTO availability_cache VALUES(?,?,?)",
                       (str(key), checked, _dump(saved)))
        for raw_key, saved in (root.get("explore", {}) or {}).items():
            try:
                media_type, raw_id = str(raw_key).split(":", 1)
                tmdb_id = int(raw_id)
            except ValueError:
                continue
            item = saved if isinstance(saved, dict) else {}
            extra = {key: entry for key, entry in item.items()
                     if key not in {"last_seen", "impressions"}}
            db.execute("INSERT INTO explore_feedback VALUES(?,?,?,?,?)", (
                media_type, tmdb_id, _number(item.get("last_seen")),
                max(0, min(50, int(item.get("impressions", 0) or 0))), _dump(extra)))
        for key, saved in root.items():
            if key not in {"titles", "availability", "explore"}:
                db.execute("INSERT INTO adult_viewing_state VALUES(?,?)", (key, _dump(saved)))

    @staticmethod
    def _read_adult_insights(db: sqlite3.Connection) -> dict[str, Any]:
        root = {row["key"]: _load(row["value_json"]) for row in db.execute(
            "SELECT * FROM adult_insights_state")}
        root["titles"] = {row["title_key"]: _load(row["metadata_json"], {})
                          for row in db.execute("SELECT * FROM adult_insights_titles")}
        root["failures"] = {row["title_key"]: row["failed_at"]
                            for row in db.execute("SELECT * FROM adult_insights_failures")}
        root.setdefault("schema_version", 1)
        return root

    @staticmethod
    def _write_adult_insights(db: sqlite3.Connection, value: Any) -> None:
        root = value if isinstance(value, dict) else {}
        for table in ("adult_insights_titles", "adult_insights_failures", "adult_insights_state"):
            db.execute(f"DELETE FROM {table}")
        for key, saved in (root.get("titles", {}) or {}).items():
            checked = saved.get("checked") if isinstance(saved, dict) else None
            db.execute("INSERT INTO adult_insights_titles VALUES(?,?,?)",
                       (str(key), checked, _dump(saved)))
        for key, failed in (root.get("failures", {}) or {}).items():
            db.execute("INSERT INTO adult_insights_failures VALUES(?,?)",
                       (str(key), _number(failed)))
        for key, saved in root.items():
            if key not in {"titles", "failures"}:
                db.execute("INSERT INTO adult_insights_state VALUES(?,?)", (key, _dump(saved)))

    def integrity_report(self) -> dict[str, Any]:
        db = self.connect()
        try:
            integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
            foreign_keys = [dict(row) for row in db.execute("PRAGMA foreign_key_check")]
            counts = {row[0]: db.execute(f'SELECT count(*) FROM "{row[0]}"').fetchone()[0]
                      for row in db.execute(
                          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        finally:
            db.close()
        return {"ok": integrity == "ok" and not foreign_keys,
                "schema_version": SCHEMA_VERSION, "integrity": integrity,
                "foreign_key_errors": foreign_keys, "counts": counts}
