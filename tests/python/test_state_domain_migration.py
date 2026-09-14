from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts" / "pi"))
from mabeltv_backend import database as database_module  # noqa: E402


class StateDomainMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.database = database_module.StateDatabase(
            Path(self.temporary.name) / "mabeltv.db")
        self.database.initialise()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_schema_eight_to_nine_renames_my_tv_state_without_data_loss(self) -> None:
        self.database.path.unlink()
        connection = self.database.connect()
        try:
            for version, description, sql in database_module.MIGRATIONS[:8]:
                connection.executescript(sql)
                connection.execute(
                    "INSERT INTO schema_migrations VALUES(?,?,?,?)",
                    (version, description,
                     database_module.MIGRATION_CHECKSUMS[version], 1.0),
                )
                connection.execute(f"PRAGMA user_version={version}")
            connection.execute(
                "INSERT INTO external_titles(media_type,tmdb_id,title,updated) "
                "VALUES('movie',42,'Kept film',1)"
            )
            connection.execute(
                "INSERT INTO adult_titles(media_type,tmdb_id,manual_state,extra_json) "
                "VALUES('movie',42,'watched','{}')"
            )
            connection.execute(
                "INSERT INTO adult_series(id,title,favourite,favourite_present,"
                "metadata_json,metadata_present,extra_json) "
                "VALUES('series-1','Kept series',1,1,'{}',1,'{}')"
            )
            connection.execute(
                "INSERT INTO adult_seasons(series_id,season_number,explicit) "
                "VALUES('series-1',2,1)"
            )
            connection.execute(
                "INSERT INTO adult_resume VALUES('film-1',12.5,100,1234,1,1,1)"
            )
            connection.execute(
                "INSERT INTO local_media(relative_path,library_id,domain,series_id,"
                "state,message,progress,favourite,favourite_present,watched,"
                "watched_present,remote_position,remote_duration,remote_last_watched,"
                "metadata_json,metadata_present,extra_json) VALUES("
                "'Films/Kept.mp4','film-1','adult',NULL,'ready','',100,0,0,1,1,"
                "12.5,100,1234,'{}',1,'{}')"
            )
            connection.execute(
                "INSERT INTO state_revisions VALUES('adult_viewing',7,1)"
            )
            connection.execute(
                "INSERT INTO application_settings VALUES("
                "'adult_provider_badges_enabled','true',1)"
            )
            connection.execute(
                "INSERT INTO viewing_items VALUES("
                "'adult:movie:42','film',NULL,'Kept.mp4','adult:movie:42',"
                "'Kept film','Adult library',1,1)"
            )
            connection.execute(
                "INSERT INTO viewing_sessions VALUES("
                "'session-1',1,2,1,'adult','adult','adult:movie:42',NULL,"
                "'Adult library','Kept film',1,100,'{}','adult:movie:42',NULL,NULL)"
            )
            connection.commit()
        finally:
            connection.close()

        report = self.database.upgrade()

        self.assertEqual(9, report["schema_version"])
        connection = self.database.connect()
        try:
            self.assertEqual("watched", connection.execute(
                "SELECT manual_state FROM my_tv_titles "
                "WHERE media_type='movie' AND tmdb_id=42").fetchone()[0])
            self.assertEqual("Kept series", connection.execute(
                "SELECT title FROM my_tv_series WHERE id='series-1'").fetchone()[0])
            self.assertEqual(2, connection.execute(
                "SELECT season_number FROM my_tv_seasons "
                "WHERE series_id='series-1'").fetchone()[0])
            self.assertEqual("my_tv", connection.execute(
                "SELECT domain FROM local_media WHERE library_id='film-1'").fetchone()[0])
            self.assertEqual("my_tv_viewing", connection.execute(
                "SELECT domain FROM state_revisions WHERE revision=7").fetchone()[0])
            self.assertEqual("my_tv_provider_badges_enabled", connection.execute(
                "SELECT key FROM application_settings "
                "WHERE key='my_tv_provider_badges_enabled'").fetchone()[0])
            item = connection.execute(
                "SELECT current_key,source_snapshot FROM viewing_items "
                "WHERE id='adult:movie:42'").fetchone()
            self.assertEqual(("my_tv:movie:42", "My TV library"), tuple(item))
            session = connection.execute(
                "SELECT surface,kind,item_key,channel_name FROM viewing_sessions "
                "WHERE id='session-1'").fetchone()
            self.assertEqual(
                ("my_tv", "my_tv", "my_tv:movie:42", "My TV library"),
                tuple(session),
            )
            self.assertEqual("ok", connection.execute(
                "PRAGMA integrity_check").fetchone()[0])
            self.assertEqual([], connection.execute(
                "PRAGMA foreign_key_check").fetchall())
        finally:
            connection.close()


