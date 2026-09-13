from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_PI = PROJECT_ROOT / "scripts" / "pi"
NATIVE_DATABASE_PATH = PROJECT_ROOT / "src" / "core" / "StateDatabase.cpp"
MIGRATION_TOOL_PATH = PROJECT_ROOT / "scripts" / "pi" / "mabeltv-state-migrate.py"
sys.path.insert(0, str(SCRIPTS_PI))
from mabeltv_backend import database as database_module  # noqa: E402


class StateDatabaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.database = database_module.StateDatabase(self.root / "mabeltv.db")
        self.database.initialise()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_relational_stores_round_trip_without_field_loss(self) -> None:
        stores = {
            "channels": {"schema_version": 1, "channels": [{
                "number": 7, "name": "Films", "folder": "films",
                "aspect": "fit", "content_type": "films",
            }]},
            "settings": {"schema_version": 1, "display_resolution": "1080p",
                         "volume": {"initial": 20, "maximum": 60,
                                    "limit_enabled": True}},
            "owner": {"schema_version": 1, "setup_complete": True,
                      "pin_hash": "private", "portal_pin_required": True},
            "player": {"schema_version": 4, "current_channel": 7,
                       "adult_positions": {"film-id": 12.5},
                       "adult_durations": {"film-id": 100.0},
                       "adult_position_updated_utc_ms": {"film-id": 1234},
                       "channel_film_positions": {}, "channel_film_durations": {},
                       "channel_film_position_updated_utc_ms": {},
                       "channel_timelines": {"7": {"episode_index": 0,
                           "episode_name": "Film.mp4", "position_seconds": 5,
                           "programme_positions": {"Film.mp4": 5},
                           "programme_last_left_uptime_ms": {},
                           "failed_programmes": {}}}},
            "viewing": {"schema_version": 2, "tracking_started": 100,
                        "sessions": [{"id": "session", "started": 100,
                                      "ended": 120, "seconds": 20,
                                      "surface": "tv", "kind": "film",
                                      "item_key": "film:7/Film.mp4",
                                      "custom": "preserved"}]},
            "channel_metadata": {"channels": {"7": {"artwork": "channel.jpg"}},
                                 "programmes": {"7/Film.mp4": {"title": "Film"}},
                                 "favourites": ["7/Film.mp4"],
                                 "future_extension": "preserved",
                                 "favourite_channels": [7], "updated": 200},
            "adult_media": {"Films/Movie.mp4": {"library_id": "media-id",
                            "favourite": False, "metadata": {"tmdb_id": 10},
                            "custom": {"kept": True}}},
            "adult_series": {"schema_version": 1, "series": {"series-id": {
                "title": "Series", "favourite": False,
                "metadata": {"tmdb_id": 20}}}, "episodes": {
                "series-id/Season 1/Episode.mp4": {"library_id": "episode-id",
                    "watched": True, "metadata": {"season_number": 1,
                                                    "episode_number": 1}}}},
            "adult_viewing": {"schema_version": 1, "titles": {"movie:10": {
                "media_type": "movie", "tmdb_id": 10, "title": "Movie",
                "history": [100, 200], "watchlisted": True,
                "watchlist_updated": 200, "up_next": True, "up_next_rank": 1,
                "personal_rating": 9, "rating_updated": 201}},
                "availability": {"movie:10": {"checked": 300}},
                "explore": {"movie:11": {"last_seen": 400, "impressions": 2}}},
            "adult_insights": {"schema_version": 1,
                               "titles": {"movie:10": {"genres": ["Drama"],
                                                         "checked": 500}},
                               "failures": {"movie:11": 501}},
        }
        for kind, value in stores.items():
            self.database.write(kind, value)
            self.assertEqual(value, self.database.read(kind), kind)
        report = self.database.integrity_report()
        self.assertEqual("ok", report["integrity"])
        self.assertEqual([], report["foreign_key_errors"])

    def test_database_writes_never_touch_retired_json(self) -> None:
        settings_path = self.root / "settings.json"
        settings_path.write_text(json.dumps({"display_resolution": "720p"}))
        database = database_module.StateDatabase(self.database.path)
        database.write("settings", {"display_resolution": "1080p"})
        self.assertEqual({"display_resolution": "1080p"}, database.read("settings"))
        self.assertEqual({"display_resolution": "720p"},
                         json.loads(settings_path.read_text()))

    def test_retired_settings_are_rejected_outside_migration_tooling(self) -> None:
        current = {
            "schema_version": 1, "crt_glass": 75,
            "playback_mode": "resume", "tv_border": "vintage-black",
        }
        self.database.write("settings", current)
        with self.assertRaisesRegex(ValueError, "explicit migration tooling"):
            self.database.write("settings", {
                **current, "parent_pin": "1234", "crt_effect": "high",
            })
        with self.assertRaisesRegex(ValueError, "retired restart playback mode"):
            self.database.merge_fields("settings", {"playback_mode": "restart"})
        with self.assertRaisesRegex(ValueError, "retired TV cabinet"):
            self.database.merge_fields("settings", {"tv_border": "walnut"})
        self.assertEqual(current, self.database.read("settings"))

        connection = self.database.connect()
        try:
            with self.assertRaisesRegex(
                    database_module.sqlite3.IntegrityError,
                    "retired settings cannot become authoritative"):
                connection.execute(
                    "INSERT INTO application_settings VALUES(?,?,?)",
                    ("portal_theme", json.dumps("light"), 1.0),
                )
            with self.assertRaisesRegex(
                    database_module.sqlite3.IntegrityError,
                    "retired settings cannot become authoritative"):
                connection.execute(
                    "UPDATE application_settings SET key='crt_effect' "
                    "WHERE key='schema_version'"
                )
            with self.assertRaisesRegex(
                    database_module.sqlite3.IntegrityError,
                    "retired setting values cannot become authoritative"):
                connection.execute(
                    "INSERT INTO application_settings VALUES(?,?,?)",
                    ("playback_mode", json.dumps("restart"), 1.0),
                )
            with self.assertRaisesRegex(
                    database_module.sqlite3.IntegrityError,
                    "retired setting values cannot become authoritative"):
                connection.execute(
                    "INSERT INTO application_settings VALUES(?,?,?)",
                    ("tv_border", json.dumps("cream"), 1.0),
                )
        finally:
            connection.close()

    def test_physical_owner_recovery_exports_then_clears_sqlite_owner(self) -> None:
        owner = {
            "schema_version": 1, "setup_complete": True,
            "child_name": "Mabel", "tv_name": "MabelTV",
            "pin_hash": "private", "pin_salt": "private",
        }
        self.database.write("owner", owner)
        before_revision = self.database.revisions()["identity"]
        output = self.root / "recovery" / "owner.json"
        status_command = [
            sys.executable, str(MIGRATION_TOOL_PATH), "owner-status",
            "--database", str(self.database.path),
        ]
        self.assertEqual(0, subprocess.run(
            status_command, capture_output=True, text=True, check=False).returncode)

        result = subprocess.run(
            [sys.executable, str(MIGRATION_TOOL_PATH), "reset-owner",
             "--database", str(self.database.path), "--output", str(output)],
            check=True, capture_output=True, text=True,
        )

        report = json.loads(result.stdout)
        self.assertTrue(report["owner_cleared"])
        self.assertEqual(owner, json.loads(output.read_text(encoding="utf-8")))
        self.assertEqual({}, self.database.read("owner"))
        self.assertEqual(before_revision + 1,
                         self.database.revisions()["identity"])
        self.assertEqual(3, subprocess.run(
            status_command, capture_output=True, text=True, check=False).returncode)

    def test_channel_renumber_preserves_related_playback_state(self) -> None:
        self.database.write("channels", {"schema_version": 1, "channels": [{
            "number": 7, "name": "Films", "folder": "films",
            "aspect": "fit", "content_type": "films",
        }]})
        player = {
            "schema_version": 4,
            "channel_timelines": {"7": {
                "episode_index": 2,
                "episode_name": "Film.mp4",
                "position_seconds": 42,
                "programme_positions": {"Film.mp4": 42},
                "programme_last_left_uptime_ms": {"Film.mp4": 1000},
                "failed_programmes": {},
            }},
        }
        self.database.write("player", player)

        self.database.write("channels", {"schema_version": 1, "channels": [{
            "number": 8, "name": "Renamed Films", "folder": "films",
            "aspect": "crop", "content_type": "films",
        }]})

        migrated = self.database.read("player")
        self.assertNotIn("7", migrated["channel_timelines"])
        self.assertEqual(player["channel_timelines"]["7"],
                         migrated["channel_timelines"]["8"])

    def test_targeted_channel_renumber_moves_every_owned_relationship_atomically(self) -> None:
        self.database.write("channels", {"schema_version": 1, "channels": [
            {"number": 7, "name": "Shows", "folder": "shows",
             "aspect": "crop", "content_type": "shows"},
            {"number": 9, "name": "Films", "folder": "films",
             "aspect": "fit", "content_type": "films"},
        ]})
        self.database.write("channel_metadata", {
            "channels": {"7": {"title": "Shows"}},
            "programmes": {"7/Episode.mp4": {"title": "Episode"}},
            "favourite_channels": [7], "favourites": ["7/Episode.mp4"],
        })
        self.database.merge_fields("settings", {"library": {
            "disabled_channels": [7],
            "disabled_programmes": {"7": ["Episode.mp4"]},
        }})

        before = {
            kind: self.database.read(kind)
            for kind in ("channels", "channel_metadata", "settings")
        }
        with self.assertRaisesRegex(ValueError, "already in use"):
            self.database.update_channel(7, {
                "number": 9, "name": "Collision", "folder": "shows",
                "aspect": "crop", "content_type": "shows",
            })
        self.assertEqual(before, {
            kind: self.database.read(kind)
            for kind in ("channels", "channel_metadata", "settings")
        })

        self.database.update_channel(7, {
            "number": 8, "name": "Shows", "folder": "shows",
            "aspect": "crop", "content_type": "shows",
        })
        metadata = self.database.read("channel_metadata")
        settings = self.database.read("settings")["library"]
        self.assertIn("8", metadata["channels"])
        self.assertIn("8/Episode.mp4", metadata["programmes"])
        self.assertEqual([8], metadata["favourite_channels"])
        self.assertEqual(["8/Episode.mp4"], metadata["favourites"])
        self.assertEqual([8], settings["disabled_channels"])
        self.assertEqual({"8": ["Episode.mp4"]}, settings["disabled_programmes"])
        self.assertEqual([], self.database.integrity_report()["foreign_key_errors"])

    def test_series_episode_identity_includes_the_owning_series(self) -> None:
        value = {
            "schema_version": 1,
            "series": {
                "alpha": {"title": "Alpha", "metadata": {"tmdb_id": 101}},
                "beta": {"title": "Beta", "metadata": {"tmdb_id": 202}},
            },
            "seasons": {"alpha": [1], "beta": [1]},
            "episodes": {
                "alpha/Season 1/Episode 1.mp4": {
                    "library_id": "alpha-one", "watched": True,
                    "metadata": {"season_number": 1, "episode_number": 1},
                },
                "beta/Season 1/Episode 1.mp4": {
                    "library_id": "beta-one", "watched": False,
                    "metadata": {"season_number": 1, "episode_number": 1},
                },
            },
        }
        self.database.write("adult_series", value)
        restored = self.database.read("adult_series")
        self.assertEqual(value, restored)
        connection = self.database.connect()
        try:
            paths = [row[0] for row in connection.execute(
                "SELECT relative_path FROM local_media "
                "WHERE domain='adult_episode' ORDER BY relative_path")]
            links = [tuple(row) for row in connection.execute(
                "SELECT series_id,media_type,tmdb_id FROM adult_series_title_links "
                "ORDER BY series_id")]
        finally:
            connection.close()
        self.assertEqual([
            "alpha/Season 1/Episode 1.mp4", "beta/Season 1/Episode 1.mp4",
        ], paths)
        self.assertEqual([("alpha", "tv", 101), ("beta", "tv", 202)], links)

    def test_version_one_database_upgrades_without_rewriting_initial_migration(self) -> None:
        self.database.path.unlink()
        connection = self.database.connect()
        try:
            connection.executescript(database_module.SCHEMA)
            connection.execute(
                "INSERT INTO schema_migrations VALUES(?,?,?,?)",
                (1, "initial relational state",
                 database_module.MIGRATION_CHECKSUMS[1], 1.0),
            )
            connection.execute("PRAGMA user_version=1")
            connection.commit()
            initial_checksum = connection.execute(
                "SELECT checksum FROM schema_migrations WHERE version=1").fetchone()[0]
        finally:
            connection.close()

        report = self.database.upgrade()

        self.assertTrue(report["ok"])
        self.assertTrue(report["upgraded"])
        self.assertEqual(1, report["previous_schema_version"])
        self.assertEqual(database_module.SCHEMA_VERSION, report["schema_version"])
        connection = self.database.connect()
        try:
            self.assertEqual(initial_checksum, connection.execute(
                "SELECT checksum FROM schema_migrations WHERE version=1").fetchone()[0])
            self.assertIsNotNone(connection.execute(
                "SELECT name FROM sqlite_master WHERE name='state_revisions'").fetchone())
        finally:
            connection.close()

    def test_state_writes_advance_only_the_related_portal_revisions(self) -> None:
        self.assertEqual({
            "library": 0, "adult_viewing": 0,
            "viewing_insights": 0, "adult_insights": 0,
            "settings": 0, "identity": 0, "player": 0,
        }, self.database.revisions())

        self.database.write("settings", {"schema_version": 1})
        self.database.write("adult_viewing", {
            "schema_version": 1, "titles": {}, "availability": {}, "explore": {},
        })

        self.assertEqual({
            "library": 0, "adult_viewing": 1,
            "viewing_insights": 0, "adult_insights": 1,
            "settings": 1, "identity": 0, "player": 0,
        }, self.database.revisions())

    def test_failed_state_write_does_not_advance_a_revision(self) -> None:
        with self.assertRaises(Exception):
            self.database.write("channels", {"channels": [{
                "number": 0, "name": "Invalid", "folder": "invalid",
                "aspect": "crop", "content_type": "shows",
            }]})
        self.assertEqual(0, self.database.revisions()["library"])

    def test_native_player_accepts_the_authoritative_schema_version(self) -> None:
        source = NATIVE_DATABASE_PATH.read_text(encoding="utf-8")
        for constant in ("minimumSupportedSchemaVersion",
                         "maximumSupportedSchemaVersion"):
            match = re.search(rf"{constant}\s*=\s*(\d+)", source)
            self.assertIsNotNone(match)
            self.assertEqual(database_module.SCHEMA_VERSION, int(match.group(1)))
        documentation = (PROJECT_ROOT / "docs" / "state-database.md").read_text(
            encoding="utf-8")
        self.assertIn(
            f"Schema version {database_module.SCHEMA_VERSION} contains",
            documentation,
        )
        self.assertIn(
            f"accepts schema {database_module.SCHEMA_VERSION} only",
            documentation,
        )

    def test_adult_relationship_state_has_one_physical_owner(self) -> None:
        connection = self.database.connect()
        try:
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(adult_titles)")
            }
        finally:
            connection.close()
        self.assertTrue({
            "watchlisted", "watchlist_updated", "up_next", "up_next_rank",
            "personal_rating", "rating_updated",
        }.isdisjoint(columns))

        value = {
            "schema_version": 1,
            "titles": {
                "movie:10": {
                    "media_type": "movie", "tmdb_id": 10, "title": "Movie",
                    "watchlisted": True, "watchlist_updated": 100,
                    "up_next": True, "up_next_rank": 1,
                    "personal_rating": 8, "rating_updated": 101,
                },
            },
            "availability": {}, "explore": {},
        }
        self.database.write("adult_viewing", value)
        self.assertEqual(value, self.database.read("adult_viewing"))

    def test_adult_title_metadata_has_one_relational_owner(self) -> None:
        value = {
            "schema_version": 1,
            "titles": {
                "tv:10": {
                    "media_type": "tv", "tmdb_id": 10, "title": "Series",
                    "year": "2024", "poster_path": "/poster.jpg",
                    "overview": "A synopsis", "runtime": 47, "updated": 123,
                    "watchlisted": True,
                },
            },
            "availability": {}, "explore": {},
        }
        self.database.write("adult_viewing", value)
        self.assertEqual(value, self.database.read("adult_viewing"))

        connection = self.database.connect()
        try:
            adult_columns = {
                row["name"] for row in connection.execute(
                    "PRAGMA table_info(adult_titles)")
            }
            external = dict(connection.execute(
                "SELECT title,year,poster_path,overview,runtime,updated "
                "FROM external_titles WHERE media_type='tv' AND tmdb_id=10"
            ).fetchone())
        finally:
            connection.close()
        self.assertTrue({
            "title", "year", "poster_path", "overview", "runtime", "updated",
        }.isdisjoint(adult_columns))
        self.assertEqual({
            "title": "Series", "year": "2024", "poster_path": "/poster.jpg",
            "overview": "A synopsis", "runtime": 47, "updated": 123.0,
        }, external)

    def test_schema_upgrade_translates_retired_settings_before_removing_them(self) -> None:
        self.database.path.unlink()
        connection = self.database.connect()
        try:
            connection.executescript(database_module.SCHEMA)
            connection.executescript(database_module.MIGRATIONS[1][2])
            for version in (1, 2):
                connection.execute(
                    "INSERT INTO schema_migrations VALUES(?,?,?,?)",
                    (version, database_module.MIGRATIONS[version - 1][1],
                     database_module.MIGRATION_CHECKSUMS[version], 1.0),
                )
            for key, value in {
                "crt_effect": "high", "parent_pin": "1234",
                "playback_mode": "restart", "tv_border": "cream",
            }.items():
                connection.execute(
                    "INSERT INTO application_settings VALUES(?,?,?)",
                    (key, json.dumps(value), 1.0),
                )
            connection.execute("""
                INSERT INTO adult_titles(
                    media_type,tmdb_id,title,watchlisted,watchlist_updated,
                    up_next,up_next_rank,personal_rating,rating_updated)
                VALUES('movie',99,'Retired markers',0,123,0,7,0,456)
            """)
            connection.execute("PRAGMA user_version=2")
            connection.commit()
        finally:
            connection.close()

        report = self.database.upgrade()

        self.assertEqual({
            "crt_glass": 75,
            "playback_mode": "resume",
            "tv_border": "silver-90s",
        }, self.database.read("settings"))
        self.assertEqual({
            "adult_viewing.watchlisted_false": 1,
            "adult_viewing.watchlist_updated_without_membership": 1,
            "adult_viewing.up_next_false": 1,
            "adult_viewing.up_next_rank_without_membership": 1,
            "adult_viewing.rating_zero": 1,
            "adult_viewing.rating_updated_without_rating": 1,
        }, report["source_normalisations"])
        migrated_title = self.database.read("adult_viewing")["titles"]["movie:99"]
        for retired in (
                "watchlisted", "watchlist_updated", "up_next", "up_next_rank",
                "personal_rating", "rating_updated"):
            self.assertNotIn(retired, migrated_title)

    def test_schema_upgrade_rejects_conflicting_legacy_relationship_state(self) -> None:
        self.database.path.unlink()
        connection = self.database.connect()
        try:
            connection.executescript(database_module.SCHEMA)
            connection.executescript(database_module.MIGRATIONS[1][2])
            for version in (1, 2):
                connection.execute(
                    "INSERT INTO schema_migrations VALUES(?,?,?,?)",
                    (version, database_module.MIGRATIONS[version - 1][1],
                     database_module.MIGRATION_CHECKSUMS[version], 1.0),
                )
            connection.execute("""
                INSERT INTO adult_titles(media_type,tmdb_id,title,watchlisted)
                VALUES('movie',99,'Must survive',1)
            """)
            connection.execute("PRAGMA user_version=2")
            connection.commit()
        finally:
            connection.close()

        with self.assertRaisesRegex(
                RuntimeError, "refusing to discard a user choice"):
            self.database.upgrade()
        connection = self.database.connect()
        try:
            self.assertEqual(2, connection.execute(
                "PRAGMA user_version").fetchone()[0])
            self.assertEqual(1, connection.execute(
                "SELECT watchlisted FROM adult_titles "
                "WHERE media_type='movie' AND tmdb_id=99").fetchone()[0])
        finally:
            connection.close()

    def test_json_import_reports_and_validates_retired_setting_translations(self) -> None:
        source_root = self.root / "migration-source"
        source = {
            kind: self.database.read(kind)
            for kind in (
                "channels", "settings", "owner", "player", "viewing",
                "channel_metadata", "adult_media", "adult_series",
                "adult_viewing", "adult_insights",
            )
        }
        source["settings"] = {
            "schema_version": 1,
            "parent_pin": "1234",
            "crt_effect": "off",
            "playback_mode": "restart",
            "tv_border": "charcoal",
            "portal_theme": "light",
            "portal_design": "classic",
            "portal_palette": "tide",
        }
        source["adult_viewing"] = {
            "schema_version": 1,
            "titles": {
                "movie:99": {
                    "media_type": "movie", "tmdb_id": 99,
                    "title": "Retired markers", "watchlisted": False,
                    "watchlist_updated": 123, "up_next": False,
                    "up_next_rank": 7, "personal_rating": 0,
                    "rating_updated": 456,
                },
            },
            "availability": {}, "explore": {},
        }
        relative_stores = {
            "channels": "var/lib/mabeltv/channels.json",
            "settings": "var/lib/mabeltv/settings.json",
            "owner": "var/lib/mabeltv/owner.json",
            "player": "var/lib/mabeltv/state.json",
            "viewing": "var/lib/mabeltv/viewing-history.json",
            "channel_metadata": "srv/mabeltv/media/.mabeltv-channels.json",
            "adult_media": "srv/mabeltv/media/.adult/.mabeltv-adult.json",
            "adult_series": "srv/mabeltv/media/.adult/.mabeltv-series.json",
            "adult_viewing": "srv/mabeltv/media/.adult/.mabeltv-viewing.json",
            "adult_insights": "srv/mabeltv/media/.adult/.mabeltv-insights.json",
        }
        for kind, relative in relative_stores.items():
            path = source_root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(source[kind]), encoding="utf-8")
        target = self.root / "imported.db"
        command = [
            sys.executable, str(MIGRATION_TOOL_PATH), "import",
            "--source-root", str(source_root), "--database", str(target),
            "--source-id", "retired-json", "--manifest-sha256", "0" * 64,
        ]

        imported = subprocess.run(command, check=True, capture_output=True, text=True)

        report = json.loads(imported.stdout)
        self.assertEqual(6, len(report["source_normalisations"]))
        self.assertTrue(any(
            "adult_viewing nonmembership markers omitted" in item
            for item in report["source_normalisations"]
        ))
        migrated = database_module.StateDatabase(target)
        self.assertEqual({
            "schema_version": 1,
            "crt_glass": 0,
            "playback_mode": "resume",
            "tv_border": "charcoal-90s",
        }, migrated.read("settings"))
        migrated_title = migrated.read("adult_viewing")["titles"]["movie:99"]
        self.assertNotIn("watchlisted", migrated_title)
        self.assertNotIn("watchlist_updated", migrated_title)
        self.assertNotIn("up_next", migrated_title)
        self.assertNotIn("up_next_rank", migrated_title)
        self.assertNotIn("personal_rating", migrated_title)
        self.assertNotIn("rating_updated", migrated_title)
        validated = subprocess.run([
            sys.executable, str(MIGRATION_TOOL_PATH), "validate",
            "--source-root", str(source_root), "--database", str(target),
        ], check=True, capture_output=True, text=True)
        self.assertTrue(json.loads(validated.stdout)["ok"])

    def test_episode_media_requires_an_existing_owning_series(self) -> None:
        connection = self.database.connect()
        try:
            foreign_keys = [
                dict(row) for row in connection.execute(
                    "PRAGMA foreign_key_list(local_media)")
            ]
            self.assertTrue(any(
                item["table"] == "adult_series"
                and item["from"] == "series_id"
                and item["to"] == "id"
                for item in foreign_keys
            ))
            with self.assertRaises(database_module.sqlite3.IntegrityError):
                connection.execute(
                    "INSERT INTO local_media(relative_path,domain,series_id) "
                    "VALUES('missing/Season 1/Episode.mp4','adult_episode','missing')"
                )
        finally:
            connection.close()

    def test_adult_viewing_title_requires_its_canonical_external_title(self) -> None:
        connection = self.database.connect()
        try:
            with self.assertRaises(database_module.sqlite3.IntegrityError):
                connection.execute(
                    "INSERT INTO adult_titles(media_type,tmdb_id) VALUES('movie',99)"
                )
            connection.execute(
                "INSERT INTO external_titles(media_type,tmdb_id,title) "
                "VALUES('movie',99,'Canonical title')"
            )
            connection.execute(
                "INSERT INTO adult_titles(media_type,tmdb_id) VALUES('movie',99)"
            )
            with self.assertRaises(database_module.sqlite3.IntegrityError):
                connection.execute(
                    "DELETE FROM external_titles "
                    "WHERE media_type='movie' AND tmdb_id=99"
                )
        finally:
            connection.close()

    def test_snapshot_reconciliation_preserves_unchanged_database_rows(self) -> None:
        viewing = {
            "schema_version": 2, "tracking_started": 100,
            "sessions": [{
                "id": "stable", "started": 100, "ended": 120,
                "seconds": 20, "surface": "tv", "kind": "film",
            }],
        }
        insights = {
            "schema_version": 1,
            "titles": {"movie:1": {"checked": 100, "genres": ["Drama"]}},
            "failures": {},
        }
        self.database.write("viewing", viewing)
        self.database.write("adult_insights", insights)
        connection = self.database.connect()
        try:
            before = (
                connection.execute(
                    "SELECT rowid FROM viewing_sessions WHERE id='stable'"
                ).fetchone()[0],
                connection.execute(
                    "SELECT rowid FROM adult_insights_titles "
                    "WHERE title_key='movie:1'"
                ).fetchone()[0],
            )
        finally:
            connection.close()

        self.database.write("viewing", viewing)
        self.database.write("adult_insights", insights)
        connection = self.database.connect()
        try:
            after = (
                connection.execute(
                    "SELECT rowid FROM viewing_sessions WHERE id='stable'"
                ).fetchone()[0],
                connection.execute(
                    "SELECT rowid FROM adult_insights_titles "
                    "WHERE title_key='movie:1'"
                ).fetchone()[0],
            )
        finally:
            connection.close()
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
