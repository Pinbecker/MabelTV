"""SQLite-backed authoritative application state for MabelTV.

The public backend still consumes its established dictionary shapes.  This
module translates those shapes to relational tables so the HTTP API can remain
stable while SQLite owns persistence.  JSON files are accepted only by the
separate migration command; production reads and writes never fall back to
them when a database is configured.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


from .database_schema import (
    MIGRATIONS,
    MIGRATION_CHECKSUMS,
    SCHEMA,
    SCHEMA_VERSION,
)

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


RETIRED_SETTING_KEYS = frozenset({
    "crt_effect", "parent_pin", "portal_theme", "portal_design", "portal_palette",
})
RETIRED_TV_BORDERS = frozenset({"cream", "charcoal", "walnut"})


def validate_current_settings(value: Any) -> dict[str, Any]:
    """Reject migration-era settings from ordinary production writes."""
    settings = dict(value or {})
    retired = sorted(RETIRED_SETTING_KEYS.intersection(settings))
    if retired:
        raise ValueError(
            "Retired settings are accepted only by explicit migration tooling: "
            + ", ".join(retired))
    if settings.get("playback_mode") == "restart":
        raise ValueError("The retired restart playback mode must be migrated to resume")
    if settings.get("tv_border") in RETIRED_TV_BORDERS:
        raise ValueError("The retired TV cabinet value must be migrated before writing")
    return settings


def normalise_adult_viewing(value: Any) -> tuple[dict[str, Any], dict[str, int]]:
    """Remove legacy markers whose absence has the same relational meaning.

    Watchlist and Up Next membership are represented by rows in their canonical
    child tables. The old JSON/API shape could retain explicit ``false`` flags
    and timestamps or ranks from a former membership. Those fields do not
    represent a current user choice, so normalize them to absence and report
    exactly what was removed.
    """
    root = dict(value) if isinstance(value, dict) else {}
    normalisations = {
        "watchlisted_false": 0,
        "watchlist_updated_without_membership": 0,
        "up_next_false": 0,
        "up_next_rank_without_membership": 0,
        "rating_zero": 0,
        "rating_updated_without_rating": 0,
    }
    titles: dict[str, Any] = {}
    source_titles = root.get("titles", {})
    if not isinstance(source_titles, dict):
        source_titles = {}
    for raw_key, saved in source_titles.items():
        if not isinstance(saved, dict):
            titles[str(raw_key)] = saved
            continue
        item = dict(saved)
        if not bool(item.get("watchlisted")):
            if "watchlisted" in item:
                normalisations["watchlisted_false"] += 1
            if "watchlist_updated" in item:
                normalisations["watchlist_updated_without_membership"] += 1
            item.pop("watchlisted", None)
            item.pop("watchlist_updated", None)
        if not bool(item.get("up_next")):
            if "up_next" in item:
                normalisations["up_next_false"] += 1
            if "up_next_rank" in item:
                normalisations["up_next_rank_without_membership"] += 1
            item.pop("up_next", None)
            item.pop("up_next_rank", None)
        rating = item.get("personal_rating")
        if rating == 0:
            normalisations["rating_zero"] += 1
            item.pop("personal_rating", None)
        if "rating_updated" in item and "personal_rating" not in item:
            normalisations["rating_updated_without_rating"] += 1
            item.pop("rating_updated", None)
        titles[str(raw_key)] = item
    root["titles"] = titles
    return root, {key: count for key, count in normalisations.items() if count}


class StateDatabase:
    """Own MabelTV's authoritative relational SQLite state."""

    schema_version = SCHEMA_VERSION

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._write_lock = threading.RLock()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=5000")
        connection.execute("PRAGMA synchronous=FULL")
        return connection

    @staticmethod
    def _delete_missing(db: sqlite3.Connection, table: str, column: str,
                        desired: set[Any], where: str = "",
                        parameters: tuple[Any, ...] = ()) -> None:
        """Delete rows outside a complete desired key set during aggregate import."""
        predicate = f" WHERE {where}" if where else ""
        if desired:
            placeholders = ",".join("?" for _ in desired)
            conjunction = " AND " if where else " WHERE "
            db.execute(
                f"DELETE FROM {table}{predicate}{conjunction}{column} NOT IN "
                f"({placeholders})", (*parameters, *sorted(desired)))
        else:
            db.execute(f"DELETE FROM {table}{predicate}", parameters)

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

    @staticmethod
    def _inspect_legacy_relationship_state(
            connection: sqlite3.Connection, version: int) -> dict[str, int]:
        """Validate schema 1/2 duplicate columns before retiring them.

        Explicit positive values must agree with the canonical relationship
        rows. A disagreement could lose a real user choice, so upgrades stop
        instead of selecting a source silently. Explicit false values and
        their stale metadata are semantically equivalent to no child row and
        are returned as an auditable normalization count.
        """
        if version >= 3:
            return {}
        columns = {
            row["name"] for row in connection.execute(
                "PRAGMA table_info(adult_titles)")
        }
        required = {
            "watchlisted", "watchlist_updated", "up_next", "up_next_rank",
            "personal_rating", "rating_updated",
        }
        if not required.issubset(columns):
            return {}
        mismatches = connection.execute("""
            SELECT COUNT(*)
            FROM adult_titles AS title
            LEFT JOIN watchlist_entries AS watchlist
              ON watchlist.media_type=title.media_type
             AND watchlist.tmdb_id=title.tmdb_id
            LEFT JOIN up_next_entries AS queue
              ON queue.media_type=title.media_type
             AND queue.tmdb_id=title.tmdb_id
            LEFT JOIN title_ratings AS rating
              ON rating.media_type=title.media_type
             AND rating.tmdb_id=title.tmdb_id
            WHERE (title.watchlisted=1 AND (watchlist.tmdb_id IS NULL
                       OR title.watchlist_updated IS NOT watchlist.updated))
               OR (title.watchlisted=0 AND watchlist.tmdb_id IS NOT NULL)
               OR (title.up_next=1 AND (queue.tmdb_id IS NULL
                       OR title.up_next_rank IS NOT queue.rank))
               OR (title.up_next=0 AND queue.tmdb_id IS NOT NULL)
               OR (title.personal_rating BETWEEN 1 AND 10
                   AND (rating.tmdb_id IS NULL
                        OR title.personal_rating IS NOT rating.rating
                        OR title.rating_updated IS NOT rating.updated))
               OR (title.personal_rating=0 AND rating.tmdb_id IS NOT NULL)
        """).fetchone()[0]
        if mismatches:
            raise RuntimeError(
                "MabelTV database has conflicting legacy Adult relationship "
                f"state in {mismatches} title(s); refusing to discard a user choice")
        queries = {
            "adult_viewing.watchlisted_false":
                "SELECT COUNT(*) FROM adult_titles WHERE watchlisted=0",
            "adult_viewing.watchlist_updated_without_membership":
                "SELECT COUNT(*) FROM adult_titles WHERE COALESCE(watchlisted,0)=0 "
                "AND watchlist_updated IS NOT NULL",
            "adult_viewing.up_next_false":
                "SELECT COUNT(*) FROM adult_titles WHERE up_next=0",
            "adult_viewing.up_next_rank_without_membership":
                "SELECT COUNT(*) FROM adult_titles WHERE COALESCE(up_next,0)=0 "
                "AND up_next_rank IS NOT NULL",
            "adult_viewing.rating_zero":
                "SELECT COUNT(*) FROM adult_titles WHERE personal_rating=0",
            "adult_viewing.rating_updated_without_rating":
                "SELECT COUNT(*) FROM adult_titles "
                "WHERE (personal_rating IS NULL OR personal_rating=0) "
                "AND rating_updated IS NOT NULL",
        }
        return {
            name: count for name, statement in queries.items()
            if (count := int(connection.execute(statement).fetchone()[0]))
        }

    def _upgrade_connection(
            self, connection: sqlite3.Connection) -> tuple[int, dict[str, int]]:
        current = int(connection.execute("PRAGMA user_version").fetchone()[0])
        if current > SCHEMA_VERSION:
            raise RuntimeError(
                f"MabelTV database schema {current} is newer than supported {SCHEMA_VERSION}")
        self._verify_migration_history(connection, current)
        normalisations = self._inspect_legacy_relationship_state(connection, current)
        for version, name, sql in MIGRATIONS:
            if version <= current:
                continue
            connection.execute("BEGIN IMMEDIATE")
            try:
                statement = ""
                for line in sql.splitlines(keepends=True):
                    statement += line
                    if sqlite3.complete_statement(statement):
                        connection.execute(statement)
                        statement = ""
                if statement.strip():
                    # The original v2 migration was shipped as one valid SQL
                    # statement without a trailing semicolon. Preserve its
                    # immutable checksum while accepting that legacy form.
                    if not sqlite3.complete_statement(statement + ";"):
                        raise RuntimeError(
                            f"MabelTV database migration {version} is incomplete")
                    connection.execute(statement)
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
        return current, normalisations

    def upgrade(self) -> dict[str, Any]:
        """Apply reviewed additive migrations to an existing database."""
        if not self.path.is_file():
            raise RuntimeError(f"MabelTV database does not exist: {self.path}")
        with self._write_lock:
            connection = self.connect()
            try:
                previous = int(connection.execute("PRAGMA user_version").fetchone()[0])
                current, normalisations = self._upgrade_connection(connection)
            finally:
                connection.close()
        self.verify_ready()
        return {"ok": True, "previous_schema_version": previous,
                "schema_version": current, "upgraded": current != previous,
                "source_normalisations": normalisations}

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
            "settings": ("settings",),
            "owner": ("identity",),
            "player": ("player",),
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
                          "adult_insights", "settings", "identity", "player"}:
            raise ValueError(f"Unknown portal revision domain: {domain}")
        with self.transaction() as db:
            self._bump_revisions(db, {
                "library": "channels",
                "adult_viewing": "adult_viewing",
                "viewing_insights": "viewing",
                "adult_insights": "adult_insights",
                "settings": "settings",
                "identity": "owner",
                "player": "player",
            }[domain])

    def revisions(self) -> dict[str, int]:
        domains = ("library", "adult_viewing", "viewing_insights", "adult_insights",
                   "settings", "identity", "player")
        db = self.connect()
        try:
            rows = {row["domain"]: int(row["revision"])
                    for row in db.execute("SELECT domain,revision FROM state_revisions")}
        finally:
            db.close()
        return {domain: rows.get(domain, 0) for domain in domains}

    def merge_fields(self, kind: str, values: dict[str, Any],
                     remove: tuple[str, ...] = ()) -> None:
        """Atomically update independent settings/owner/player scalar fields."""
        table = {
            "settings": "application_settings",
            "owner": "owner_fields",
            "player": "player_fields",
        }.get(kind)
        if table is None:
            raise ValueError(f"State kind does not support field updates: {kind}")
        if kind == "settings":
            values = validate_current_settings(values)
        now = time.time()
        with self.transaction() as db:
            for key in remove:
                db.execute(f"DELETE FROM {table} WHERE key=?", (str(key),))
            db.executemany(
                f"INSERT INTO {table}(key,value_json,updated_at) VALUES(?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET "
                "value_json=excluded.value_json,updated_at=excluded.updated_at",
                [(str(key), _dump(value), now) for key, value in values.items()],
            )
            self._bump_revisions(db, kind)

    def complete_setup(self, channels: list[dict[str, Any]],
                       owner: dict[str, Any]) -> None:
        """Publish first-run channel and owner state as one durable decision."""
        with self.transaction() as db:
            self._write_channels(db, {"schema_version": 1, "channels": channels})
            self._replace_kv(db, "owner_fields", owner)
            self._bump_revisions(db, "channels")
            self._bump_revisions(db, "owner")

    @staticmethod
    def _channel_fields(value: dict[str, Any]) -> tuple[int, str, str, str, str]:
        number = int(value.get("number", 0))
        name = str(value.get("name", "")).strip()
        folder = str(value.get("folder", "")).strip()
        aspect = str(value.get("aspect", "crop"))
        content_type = str(value.get("content_type", "shows"))
        if not 1 <= number <= 999:
            raise ValueError("Channel number must be between 1 and 999")
        if not 1 <= len(name) <= 60:
            raise ValueError("Channel name must be between 1 and 60 characters")
        if not folder:
            raise ValueError("Channel folder cannot be empty")
        if aspect not in {"crop", "fit", "stretch"}:
            raise ValueError("Choose a valid channel picture shape")
        if content_type not in {"shows", "films"}:
            raise ValueError("Choose shows or films for this channel")
        return number, name, folder, aspect, content_type

    def insert_channel(self, value: dict[str, Any]) -> None:
        """Create one channel without replacing unrelated channel rows."""
        fields = self._channel_fields(value)
        try:
            with self.transaction() as db:
                db.execute(
                    "INSERT INTO channels(number,name,folder,aspect,content_type) "
                    "VALUES(?,?,?,?,?)", fields)
                self._bump_revisions(db, "channels")
        except sqlite3.IntegrityError as error:
            raise ValueError("That channel number or folder is already in use") from error

    def update_channel(self, original_number: int, value: dict[str, Any]) -> None:
        """Update one channel and its number-keyed preferences atomically."""
        fields = self._channel_fields(value)
        try:
            with self.transaction() as db:
                existing = db.execute(
                    "SELECT number FROM channels WHERE number=?", (int(original_number),)
                ).fetchone()
                if existing is None:
                    raise ValueError("Channel not found")
                result = db.execute(
                    "UPDATE channels SET number=?,name=?,folder=?,aspect=?,content_type=? "
                    "WHERE number=?", (*fields, int(original_number)))
                if result.rowcount != 1:
                    raise ValueError("Channel not found")
                new_number = fields[0]
                if fields[4] != "shows":
                    db.execute("DELETE FROM channel_favourites WHERE channel_number=?",
                               (new_number,))
                settings_changed = False
                if new_number != int(original_number):
                    old_prefix = f"{int(original_number)}/"
                    new_prefix = f"{new_number}/"
                    db.execute(
                        "DELETE FROM channel_metadata WHERE entity_kind='channel' "
                        "AND entity_key=?", (str(new_number),))
                    db.execute(
                        "UPDATE channel_metadata SET entity_key=? "
                        "WHERE entity_kind='channel' AND entity_key=?",
                        (str(new_number), str(int(original_number))))
                    db.execute(
                        "DELETE FROM channel_metadata WHERE entity_kind='programme' "
                        "AND entity_key LIKE ?", (new_prefix + "%",))
                    db.execute(
                        "UPDATE channel_metadata SET entity_key=? || substr(entity_key,?) "
                        "WHERE entity_kind='programme' AND entity_key LIKE ?",
                        (new_prefix, len(old_prefix) + 1, old_prefix + "%"))
                    db.execute(
                        "DELETE FROM programme_favourites WHERE media_key LIKE ?",
                        (new_prefix + "%",))
                    db.execute(
                        "UPDATE programme_favourites SET media_key=? || substr(media_key,?) "
                        "WHERE media_key LIKE ?",
                        (new_prefix, len(old_prefix) + 1, old_prefix + "%"))
                    row = db.execute(
                        "SELECT value_json FROM application_settings WHERE key='library'"
                    ).fetchone()
                    library = _load(row[0], {}) if row is not None else {}
                    if isinstance(library, dict):
                        disabled_channels = set(library.get("disabled_channels", []))
                        if int(original_number) in disabled_channels:
                            disabled_channels.discard(int(original_number))
                            disabled_channels.add(new_number)
                            library["disabled_channels"] = sorted(disabled_channels)
                            settings_changed = True
                        disabled = library.get("disabled_programmes", {})
                        if isinstance(disabled, dict) and str(int(original_number)) in disabled:
                            moved = disabled.pop(str(int(original_number)))
                            if str(new_number) in disabled and isinstance(moved, list):
                                moved = sorted(set(moved) | set(disabled[str(new_number)]))
                            disabled[str(new_number)] = moved
                            settings_changed = True
                        if settings_changed:
                            db.execute(
                                "INSERT INTO application_settings(key,value_json,updated_at) "
                                "VALUES('library',?,?) ON CONFLICT(key) DO UPDATE SET "
                                "value_json=excluded.value_json,updated_at=excluded.updated_at",
                                (_dump(library), time.time()))
                self._bump_revisions(db, "channels")
                if settings_changed:
                    self._bump_revisions(db, "settings")
        except sqlite3.IntegrityError as error:
            raise ValueError("That channel number or folder is already in use") from error

    def delete_channel(self, number: int) -> None:
        """Delete one channel and all number-keyed preferences atomically."""
        with self.transaction() as db:
            if int(db.execute("SELECT count(*) FROM channels").fetchone()[0]) <= 1:
                raise ValueError("Mabel TV must keep at least one channel")
            result = db.execute("DELETE FROM channels WHERE number=?", (int(number),))
            if result.rowcount != 1:
                raise ValueError("Channel not found")
            prefix = f"{int(number)}/"
            db.execute(
                "DELETE FROM channel_metadata WHERE "
                "(entity_kind='channel' AND entity_key=?) OR "
                "(entity_kind='programme' AND entity_key LIKE ?)",
                (str(int(number)), prefix + "%"))
            db.execute("DELETE FROM programme_favourites WHERE media_key LIKE ?",
                       (prefix + "%",))
            settings_changed = False
            row = db.execute(
                "SELECT value_json FROM application_settings WHERE key='library'"
            ).fetchone()
            library = _load(row[0], {}) if row is not None else {}
            if isinstance(library, dict):
                disabled_channels = set(library.get("disabled_channels", []))
                if int(number) in disabled_channels:
                    disabled_channels.discard(int(number))
                    library["disabled_channels"] = sorted(disabled_channels)
                    settings_changed = True
                disabled = library.get("disabled_programmes", {})
                if isinstance(disabled, dict) and disabled.pop(str(int(number)), None) is not None:
                    settings_changed = True
                if settings_changed:
                    db.execute(
                        "INSERT INTO application_settings(key,value_json,updated_at) "
                        "VALUES('library',?,?) ON CONFLICT(key) DO UPDATE SET "
                        "value_json=excluded.value_json,updated_at=excluded.updated_at",
                        (_dump(library), time.time()))
            self._bump_revisions(db, "channels")
            if settings_changed:
                self._bump_revisions(db, "settings")

    def save_adult_titles(self, values: dict[str, dict[str, Any]]) -> None:
        """Replace only the selected Adult title aggregates in one transaction."""
        entries = []
        for key, value in values.items():
            normalised = self._normalise_adult_title(key, value)
            if normalised is not None:
                entries.append(normalised)
        if not entries:
            return
        with self.transaction() as db:
            self._replace_adult_title_children(db, entries)
            self._bump_revisions(db, "adult_viewing")

    def save_adult_availability(self, title_key: str,
                                payload: dict[str, Any]) -> None:
        with self.transaction() as db:
            db.execute(
                "INSERT INTO availability_cache(title_key,checked,payload_json) "
                "VALUES(?,?,?) ON CONFLICT(title_key) DO UPDATE SET "
                "checked=excluded.checked,payload_json=excluded.payload_json",
                (str(title_key), payload.get("checked"), _dump(payload)),
            )
            self._bump_revisions(db, "adult_viewing")

    def save_explore_feedback(self, values: dict[str, dict[str, Any]],
                              *, retain_since: float | None = None) -> None:
        with self.transaction() as db:
            if retain_since is not None:
                db.execute("DELETE FROM explore_feedback WHERE last_seen < ?",
                           (float(retain_since),))
            for raw_key, saved in values.items():
                try:
                    media_type, raw_id = str(raw_key).split(":", 1)
                    tmdb_id = int(raw_id)
                except ValueError:
                    continue
                if media_type not in {"movie", "tv"} or tmdb_id < 1:
                    continue
                item = saved if isinstance(saved, dict) else {}
                extra = {key: value for key, value in item.items()
                         if key not in {"last_seen", "impressions"}}
                db.execute(
                    "INSERT INTO explore_feedback VALUES(?,?,?,?,?) "
                    "ON CONFLICT(media_type,tmdb_id) DO UPDATE SET "
                    "last_seen=excluded.last_seen,impressions=excluded.impressions,"
                    "extra_json=excluded.extra_json",
                    (media_type, tmdb_id, _number(item.get("last_seen")),
                     max(0, min(50, int(item.get("impressions", 0) or 0))),
                     _dump(extra)),
                )
            self._bump_revisions(db, "adult_viewing")

    def save_adult_insights(self, value: dict[str, Any]) -> None:
        """Reconcile the derived insights cache without clearing valid rows."""
        with self.transaction() as db:
            self._write_adult_insights(db, value)
            self._bump_revisions(db, "adult_insights")

    @staticmethod
    def _replace_kv(db: sqlite3.Connection, table: str, value: dict[str, Any]) -> None:
        now = time.time()
        db.executemany(
            f"INSERT INTO {table}(key,value_json,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET "
            "value_json=excluded.value_json,updated_at=excluded.updated_at",
            [(str(key), _dump(saved), now) for key, saved in value.items()],
        )
        StateDatabase._delete_missing(db, table, "key", {str(key) for key in value})

    @staticmethod
    def _read_kv(db: sqlite3.Connection, table: str) -> dict[str, Any]:
        return {row["key"]: _load(row["value_json"]) for row in db.execute(
            f"SELECT key,value_json FROM {table} ORDER BY key")}

    def _read_settings(self, db: sqlite3.Connection) -> dict[str, Any]:
        return self._read_kv(db, "application_settings")

    def _write_settings(self, db: sqlite3.Connection, value: Any) -> None:
        self._replace_kv(db, "application_settings", validate_current_settings(value))

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
        db.execute("INSERT OR REPLACE INTO viewing_tracking VALUES(1,?)",
                   (_number(root.get("tracking_started"), time.time()),))
        known = {"id", "started", "ended", "seconds", "surface", "kind", "item_key",
                 "channel_number", "channel_name", "title", "position", "media_duration"}
        desired: set[str] = set()
        for ordinal, item in enumerate(root.get("sessions", [])):
            if not isinstance(item, dict):
                continue
            identifier = str(item.get("id") or f"legacy-{ordinal}")
            desired.add(identifier)
            extra = {key: saved for key, saved in item.items() if key not in known}
            db.execute("""INSERT INTO viewing_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                  started=excluded.started,ended=excluded.ended,seconds=excluded.seconds,
                  surface=excluded.surface,kind=excluded.kind,item_key=excluded.item_key,
                  channel_number=excluded.channel_number,
                  channel_name=excluded.channel_name,title=excluded.title,
                  position_seconds=excluded.position_seconds,
                  media_duration_seconds=excluded.media_duration_seconds,
                  extra_json=excluded.extra_json""", (
                identifier, item.get("started"), item.get("ended"),
                max(0, _number(item.get("seconds"))), item.get("surface"),
                str(item.get("kind") or "unknown"), item.get("item_key"),
                item.get("channel_number"), item.get("channel_name"), item.get("title"),
                item.get("position"), item.get("media_duration"), _dump(extra)))
        StateDatabase._delete_missing(db, "viewing_sessions", "id", desired)

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
        desired_metadata: dict[tuple[str, str], Any] = {}
        for kind in ("channels", "programmes"):
            entity = "channel" if kind == "channels" else "programme"
            desired_metadata.update({(entity, str(key)): saved
                                     for key, saved in (root.get(kind, {}) or {}).items()})
        for (entity, key), saved in desired_metadata.items():
            db.execute(
                "INSERT INTO channel_metadata VALUES(?,?,?) "
                "ON CONFLICT(entity_kind,entity_key) DO UPDATE SET "
                "metadata_json=excluded.metadata_json", (entity, key, _dump(saved)))
        for row in db.execute("SELECT entity_kind,entity_key FROM channel_metadata"):
            if (row["entity_kind"], row["entity_key"]) not in desired_metadata:
                db.execute("DELETE FROM channel_metadata WHERE entity_kind=? AND entity_key=?",
                           (row["entity_kind"], row["entity_key"]))

        favourite_programmes = {str(key) for key in root.get("favourites", [])}
        db.executemany("INSERT OR IGNORE INTO programme_favourites VALUES(?)",
                       [(key,) for key in favourite_programmes])
        StateDatabase._delete_missing(
            db, "programme_favourites", "media_key", favourite_programmes)
        favourite_channels = {int(key) for key in root.get("favourite_channels", [])}
        db.executemany("INSERT OR IGNORE INTO channel_favourites VALUES(?)",
                       [(key,) for key in favourite_channels])
        StateDatabase._delete_missing(
            db, "channel_favourites", "channel_number", favourite_channels)
        desired_state = {str(key): saved for key, saved in root.items()
                         if key not in {"channels", "programmes", "favourites",
                                       "favourite_channels"}}
        for key, saved in root.items():
            if key not in {"channels", "programmes", "favourites", "favourite_channels"}:
                db.execute(
                    "INSERT INTO channel_metadata_state VALUES(?,?) "
                    "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
                    (key, _dump(saved)))
        StateDatabase._delete_missing(
            db, "channel_metadata_state", "key", set(desired_state))

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
        items = value if isinstance(value, dict) else {}
        desired = {str(path) for path in items}
        StateDatabase._delete_missing(
            db, "local_media", "relative_path", desired, "domain='adult'")
        for path, saved in items.items():
            relative_path = str(path)
            db.execute(
                "INSERT INTO local_media VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(relative_path) DO UPDATE SET "
                "library_id=excluded.library_id,domain=excluded.domain,"
                "series_id=excluded.series_id,state=excluded.state,message=excluded.message,"
                "progress=excluded.progress,favourite=excluded.favourite,"
                "favourite_present=excluded.favourite_present,watched=excluded.watched,"
                "watched_present=excluded.watched_present,"
                "remote_position=excluded.remote_position,remote_duration=excluded.remote_duration,"
                "remote_last_watched=excluded.remote_last_watched,"
                "metadata_json=excluded.metadata_json,"
                "metadata_present=excluded.metadata_present,extra_json=excluded.extra_json",
                StateDatabase._split_media_state(relative_path, saved, "adult"),
            )
            metadata = saved.get("metadata", {}) if isinstance(saved, dict) else {}
            StateDatabase._sync_title_link(
                db, "local", relative_path, "movie", metadata)

    @staticmethod
    def _sync_title_link(db: sqlite3.Connection, owner: str, owner_id: str,
                         media_type: str, metadata: Any) -> None:
        table = "local_title_links" if owner == "local" else "adult_series_title_links"
        column = "relative_path" if owner == "local" else "series_id"
        db.execute(f"DELETE FROM {table} WHERE {column}=?", (owner_id,))
        if not isinstance(metadata, dict):
            return
        try:
            tmdb_id = int(metadata.get("tmdb_id", 0) or 0)
        except (TypeError, ValueError):
            return
        if tmdb_id < 1:
            return
        db.execute(
            "INSERT INTO external_titles(media_type,tmdb_id,title,year,overview,updated,"
            "poster_path,runtime) VALUES(?,?,?,?,?,?,?,?) "
            "ON CONFLICT(media_type,tmdb_id) DO UPDATE SET "
            "title=COALESCE(excluded.title,external_titles.title),"
            "year=COALESCE(excluded.year,external_titles.year),"
            "overview=COALESCE(excluded.overview,external_titles.overview),"
            "updated=COALESCE(excluded.updated,external_titles.updated),"
            "poster_path=COALESCE(excluded.poster_path,external_titles.poster_path),"
            "runtime=COALESCE(excluded.runtime,external_titles.runtime)",
            (media_type, tmdb_id, metadata.get("title"), metadata.get("year"),
             metadata.get("overview"), metadata.get("updated"),
             metadata.get("poster_path"), metadata.get("runtime")),
        )
        if owner == "local":
            db.execute(
                "INSERT INTO local_title_links(relative_path,media_type,tmdb_id) "
                "VALUES(?,?,?)",
                (owner_id, media_type, tmdb_id),
            )
        else:
            db.execute(
                "INSERT INTO adult_series_title_links(series_id,media_type,tmdb_id) "
                "VALUES(?,?,?)",
                (owner_id, media_type, tmdb_id),
            )

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
            root["episodes"][row["relative_path"]] = StateDatabase._media_state(row)
        state = {row["key"]: _load(row["value_json"]) for row in db.execute(
            "SELECT * FROM adult_viewing_state WHERE key LIKE 'series_state:%'")}
        for key, value in state.items():
            root[key.removeprefix("series_state:")] = value
        return root

    @staticmethod
    def _write_adult_series(db: sqlite3.Connection, value: Any) -> None:
        root = value if isinstance(value, dict) else {}
        series_items = root.get("series", {}) or {}
        episode_items = root.get("episodes", {}) or {}
        desired_episodes = {str(key) for key in episode_items}
        StateDatabase._delete_missing(
            db, "local_media", "relative_path", desired_episodes,
            "domain='adult_episode'")
        for series_id, saved in series_items.items():
            item = dict(saved) if isinstance(saved, dict) else {}
            extra = {key: entry for key, entry in item.items()
                     if key not in {"title", "favourite", "metadata"}}
            db.execute(
                "INSERT INTO adult_series VALUES(?,?,?,?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET title=excluded.title,"
                "favourite=excluded.favourite,favourite_present=excluded.favourite_present,"
                "metadata_json=excluded.metadata_json,"
                "metadata_present=excluded.metadata_present,extra_json=excluded.extra_json", (
                str(series_id), item.get("title"), bool(item.get("favourite")),
                "favourite" in item, _dump(item.get("metadata", {})),
                "metadata" in item, _dump(extra)))
            StateDatabase._sync_title_link(
                db, "series", str(series_id), "tv", item.get("metadata", {}))
        desired_seasons: set[tuple[str, int]] = set()
        for compound, saved in episode_items.items():
            compound = str(compound)
            series_id, _, relative = compound.partition("/")
            if not relative or not db.execute(
                    "SELECT 1 FROM adult_series WHERE id=?", (series_id,)).fetchone():
                continue
            db.execute(
                "INSERT INTO local_media VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(relative_path) DO UPDATE SET "
                "library_id=excluded.library_id,domain=excluded.domain,"
                "series_id=excluded.series_id,state=excluded.state,message=excluded.message,"
                "progress=excluded.progress,favourite=excluded.favourite,"
                "favourite_present=excluded.favourite_present,watched=excluded.watched,"
                "watched_present=excluded.watched_present,"
                "remote_position=excluded.remote_position,remote_duration=excluded.remote_duration,"
                "remote_last_watched=excluded.remote_last_watched,"
                "metadata_json=excluded.metadata_json,"
                "metadata_present=excluded.metadata_present,extra_json=excluded.extra_json",
                StateDatabase._split_media_state(
                    compound, saved, "adult_episode", series_id))
            metadata = saved.get("metadata", {}) if isinstance(saved, dict) else {}
            try:
                season = int(metadata.get("season_number", 0))
            except (TypeError, ValueError):
                season = 0
            if season > 0:
                db.execute("INSERT OR IGNORE INTO adult_seasons VALUES(?,?,0)",
                           (series_id, season))
                desired_seasons.add((series_id, season))
        for row in db.execute("SELECT series_id,season_number FROM adult_seasons"):
            if (row["series_id"], row["season_number"]) not in desired_seasons:
                db.execute("DELETE FROM adult_seasons WHERE series_id=? AND season_number=?",
                           (row["series_id"], row["season_number"]))
        StateDatabase._delete_missing(
            db, "adult_series", "id", {str(key) for key in series_items})

        desired_state = {f"series_state:{key}": saved for key, saved in root.items()
                         if key not in {"series", "episodes"}}
        for key, saved in desired_state.items():
            db.execute(
                "INSERT INTO adult_viewing_state VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
                (key, _dump(saved)))
        StateDatabase._delete_missing(
            db, "adult_viewing_state", "key", set(desired_state),
            "key LIKE 'series_state:%'")

    @staticmethod
    def _title_key(media_type: str, tmdb_id: int) -> str:
        return f"{media_type}:{tmdb_id}"

    @staticmethod
    def _read_adult_viewing(db: sqlite3.Connection) -> dict[str, Any]:
        root = {row["key"]: _load(row["value_json"]) for row in db.execute(
            "SELECT * FROM adult_viewing_state WHERE key NOT LIKE 'series_state:%'")}
        titles: dict[str, Any] = {}
        for row in db.execute("""SELECT adult_titles.*,
                external_titles.title,external_titles.year,
                external_titles.poster_path,external_titles.overview,
                external_titles.runtime,external_titles.updated
            FROM adult_titles JOIN external_titles USING(media_type,tmdb_id)
            ORDER BY media_type,tmdb_id"""):
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
            titles[key] = item
        for saved in db.execute(
                "SELECT media_type,tmdb_id,updated FROM watchlist_entries"):
            key = StateDatabase._title_key(saved["media_type"], saved["tmdb_id"])
            titles[key]["watchlisted"] = True
            if saved["updated"] is not None:
                titles[key]["watchlist_updated"] = saved["updated"]
        for saved in db.execute(
                "SELECT media_type,tmdb_id,rank FROM up_next_entries ORDER BY rank"):
            key = StateDatabase._title_key(saved["media_type"], saved["tmdb_id"])
            titles[key].update({"up_next": True, "up_next_rank": saved["rank"]})
        for saved in db.execute(
                "SELECT media_type,tmdb_id,rating,updated FROM title_ratings"):
            key = StateDatabase._title_key(saved["media_type"], saved["tmdb_id"])
            titles[key]["personal_rating"] = saved["rating"]
            if saved["updated"] is not None:
                titles[key]["rating_updated"] = saved["updated"]
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
    def _normalise_adult_title(
            raw_key: str, saved: Any) -> tuple[str, int, dict[str, Any]] | None:
        item = dict(saved) if isinstance(saved, dict) else {}
        try:
            media_type, raw_id = str(raw_key).split(":", 1)
            tmdb_id = int(item.get("tmdb_id") or raw_id)
        except (TypeError, ValueError):
            return None
        if media_type not in {"movie", "tv"} or tmdb_id <= 0:
            return None
        item.update({"media_type": media_type, "tmdb_id": tmdb_id})
        return media_type, tmdb_id, item

    @staticmethod
    def _upsert_adult_title_core(
            db: sqlite3.Connection, media_type: str, tmdb_id: int,
            item: dict[str, Any]) -> None:
        core = {
            "media_type", "tmdb_id", "title", "year", "poster_path", "overview",
            "runtime", "manual_state", "series_watching", "viewing_updated",
            "series_watching_updated", "last_launched", "last_provider", "updated",
            "history", "episodes", "watchlisted", "watchlist_updated", "up_next",
            "up_next_rank", "personal_rating", "rating_updated",
        }
        extra = {key: entry for key, entry in item.items() if key not in core}
        values = (
            media_type, tmdb_id, item.get("manual_state"),
            bool(item.get("series_watching")) if "series_watching" in item else None,
            item.get("viewing_updated"), item.get("series_watching_updated"),
            item.get("last_launched"), item.get("last_provider"),
            "history" in item, "episodes" in item, _dump(extra),
        )
        db.execute(
            "INSERT INTO external_titles(media_type,tmdb_id,title,year,overview,updated,"
            "poster_path,runtime) VALUES(?,?,?,?,?,?,?,?) "
            "ON CONFLICT(media_type,tmdb_id) DO UPDATE SET "
            "title=COALESCE(excluded.title,external_titles.title),"
            "year=COALESCE(excluded.year,external_titles.year),"
            "overview=COALESCE(excluded.overview,external_titles.overview),"
            "updated=COALESCE(excluded.updated,external_titles.updated),"
            "poster_path=COALESCE(excluded.poster_path,external_titles.poster_path),"
            "runtime=COALESCE(excluded.runtime,external_titles.runtime)",
            (media_type, tmdb_id, item.get("title"), item.get("year"),
             item.get("overview"), item.get("updated"), item.get("poster_path"),
             item.get("runtime")),
        )
        db.execute("""INSERT INTO adult_titles(
            media_type,tmdb_id,manual_state,series_watching,viewing_updated,
            series_watching_updated,last_launched,last_provider,
            history_present,episodes_present,extra_json)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(media_type,tmdb_id) DO UPDATE SET
              manual_state=excluded.manual_state,
              series_watching=excluded.series_watching,
              viewing_updated=excluded.viewing_updated,
              series_watching_updated=excluded.series_watching_updated,
              last_launched=excluded.last_launched,last_provider=excluded.last_provider,
              history_present=excluded.history_present,
              episodes_present=excluded.episodes_present,extra_json=excluded.extra_json""",
                   values)

    @staticmethod
    def _replace_adult_title_children(
            db: sqlite3.Connection,
            entries: list[tuple[str, int, dict[str, Any]]],
            *, clear_existing: bool = True) -> None:
        if clear_existing:
            for media_type, tmdb_id, _ in entries:
                identity = (media_type, tmdb_id)
                for table in ("title_watch_events", "watchlist_entries",
                              "up_next_entries", "title_ratings",
                              "title_episode_state"):
                    db.execute(
                        f"DELETE FROM {table} WHERE media_type=? AND tmdb_id=?",
                        identity,
                    )
        queue: list[tuple[str, int, int]] = []
        for media_type, tmdb_id, item in entries:
            StateDatabase._upsert_adult_title_core(db, media_type, tmdb_id, item)
            for ordinal, watched_at in enumerate(item.get("history", []) or []):
                db.execute("INSERT INTO title_watch_events VALUES(?,?,?,?)",
                           (media_type, tmdb_id, ordinal, _number(watched_at)))
            if item.get("watchlisted"):
                db.execute("INSERT INTO watchlist_entries VALUES(?,?,?)",
                           (media_type, tmdb_id, item.get("watchlist_updated")))
            if item.get("up_next"):
                queue.append((media_type, tmdb_id,
                              max(1, int(item.get("up_next_rank", 1) or 1))))
            rating = int(item.get("personal_rating", 0) or 0)
            if 1 <= rating <= 10:
                db.execute("INSERT INTO title_ratings VALUES(?,?,?,?)",
                           (media_type, tmdb_id, rating, item.get("rating_updated")))
            for episode_key, episode in (item.get("episodes", {}) or {}).items():
                try:
                    season, number = (
                        int(part) for part in str(episode_key).split(":", 1))
                except ValueError:
                    continue
                episode = episode if isinstance(episode, dict) else {}
                extra_episode = {
                    key: entry for key, entry in episode.items()
                    if key not in {"watched", "updated"}
                }
                db.execute("INSERT INTO title_episode_state VALUES(?,?,?,?,?,?,?)", (
                    media_type, tmdb_id, season, number,
                    bool(episode.get("watched")), episode.get("updated"),
                    _dump(extra_episode)))
        for media_type, tmdb_id, rank in queue:
            db.execute("INSERT INTO up_next_entries VALUES(?,?,?)",
                       (media_type, tmdb_id, rank))

    @staticmethod
    def _write_adult_viewing(db: sqlite3.Connection, value: Any) -> None:
        root, _ = normalise_adult_viewing(value)
        entries: list[tuple[str, int, dict[str, Any]]] = []
        for raw_key, saved in (root.get("titles", {}) or {}).items():
            normalised = StateDatabase._normalise_adult_title(str(raw_key), saved)
            if normalised is not None:
                entries.append(normalised)
        desired = {(media_type, tmdb_id) for media_type, tmdb_id, _ in entries}
        for row in db.execute("SELECT media_type,tmdb_id FROM adult_titles").fetchall():
            identity = (row["media_type"], row["tmdb_id"])
            if identity not in desired:
                db.execute(
                    "DELETE FROM adult_titles WHERE media_type=? AND tmdb_id=?", identity)
        StateDatabase._replace_adult_title_children(
            db, entries, clear_existing=True)
        availability_keys: set[str] = set()
        for key, saved in (root.get("availability", {}) or {}).items():
            availability_keys.add(str(key))
            checked = saved.get("checked") if isinstance(saved, dict) else None
            db.execute(
                "INSERT INTO availability_cache VALUES(?,?,?) "
                "ON CONFLICT(title_key) DO UPDATE SET "
                "checked=excluded.checked,payload_json=excluded.payload_json",
                (str(key), checked, _dump(saved)))
        StateDatabase._delete_missing(
            db, "availability_cache", "title_key", availability_keys)
        explore_keys: set[tuple[str, int]] = set()
        for raw_key, saved in (root.get("explore", {}) or {}).items():
            try:
                media_type, raw_id = str(raw_key).split(":", 1)
                tmdb_id = int(raw_id)
            except ValueError:
                continue
            explore_keys.add((media_type, tmdb_id))
            item = saved if isinstance(saved, dict) else {}
            extra = {key: entry for key, entry in item.items()
                     if key not in {"last_seen", "impressions"}}
            db.execute(
                "INSERT INTO explore_feedback VALUES(?,?,?,?,?) "
                "ON CONFLICT(media_type,tmdb_id) DO UPDATE SET "
                "last_seen=excluded.last_seen,impressions=excluded.impressions,"
                "extra_json=excluded.extra_json", (
                    media_type, tmdb_id, _number(item.get("last_seen")),
                    max(0, min(50, int(item.get("impressions", 0) or 0))),
                    _dump(extra)))
        for row in db.execute("SELECT media_type,tmdb_id FROM explore_feedback"):
            if (row["media_type"], row["tmdb_id"]) not in explore_keys:
                db.execute(
                    "DELETE FROM explore_feedback WHERE media_type=? AND tmdb_id=?",
                    (row["media_type"], row["tmdb_id"]))
        desired_state = {
            str(key): saved for key, saved in root.items()
            if key not in {"titles", "availability", "explore"}
        }
        for key, saved in root.items():
            if key not in {"titles", "availability", "explore"}:
                db.execute(
                    "INSERT INTO adult_viewing_state VALUES(?,?) "
                    "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
                    (key, _dump(saved)))
        StateDatabase._delete_missing(
            db, "adult_viewing_state", "key", set(desired_state),
            "key NOT LIKE 'series_state:%'")

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
        title_keys: set[str] = set()
        for key, saved in (root.get("titles", {}) or {}).items():
            title_keys.add(str(key))
            checked = saved.get("checked") if isinstance(saved, dict) else None
            db.execute(
                "INSERT INTO adult_insights_titles VALUES(?,?,?) "
                "ON CONFLICT(title_key) DO UPDATE SET "
                "checked=excluded.checked,metadata_json=excluded.metadata_json",
                (str(key), checked, _dump(saved)))
        StateDatabase._delete_missing(
            db, "adult_insights_titles", "title_key", title_keys)
        failure_keys: set[str] = set()
        for key, failed in (root.get("failures", {}) or {}).items():
            failure_keys.add(str(key))
            db.execute(
                "INSERT INTO adult_insights_failures VALUES(?,?) "
                "ON CONFLICT(title_key) DO UPDATE SET failed_at=excluded.failed_at",
                (str(key), _number(failed)))
        StateDatabase._delete_missing(
            db, "adult_insights_failures", "title_key", failure_keys)
        state_keys = {str(key) for key in root if key not in {"titles", "failures"}}
        for key, saved in root.items():
            if key not in {"titles", "failures"}:
                db.execute(
                    "INSERT INTO adult_insights_state VALUES(?,?) "
                    "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
                    (key, _dump(saved)))
        StateDatabase._delete_missing(
            db, "adult_insights_state", "key", state_keys)

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
