#include "CoreTests.h"
#include "TestStateFixture.h"
#include "core/StateDatabase.h"
#include "core/MyTvResumeWriter.h"
#include <QDir>
#include <QFile>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>
#include <QTemporaryDir>
#include <QtTest>

void CoreTests::sqliteStateIsReadableAndWritableByNativeController()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/one")));
    QFile episode(directory.filePath(QStringLiteral("media/one/Episode.mp4")));
    QVERIFY(episode.open(QIODevice::WriteOnly));
    episode.close();
    const QString databasePath = directory.filePath(QStringLiteral("mabeltv.db"));
    const QString connectionName = QStringLiteral("state-test");
    {
        QSqlDatabase database = QSqlDatabase::addDatabase(QStringLiteral("QSQLITE"),
                                                           connectionName);
        database.setDatabaseName(databasePath);
        QVERIFY2(database.open(), qPrintable(database.lastError().text()));
        QSqlQuery query(database);
        const QStringList schema{
            QStringLiteral("CREATE TABLE application_settings(key TEXT PRIMARY KEY,value_json TEXT,updated_at REAL)"),
            QStringLiteral("CREATE TABLE player_fields(key TEXT PRIMARY KEY,value_json TEXT,updated_at REAL)"),
            QStringLiteral("CREATE TABLE my_tv_resume(library_id TEXT PRIMARY KEY,position_seconds REAL,duration_seconds REAL,updated_utc_ms INTEGER,position_present INTEGER,duration_present INTEGER,updated_present INTEGER)"),
            QStringLiteral("CREATE TABLE channel_film_resume(media_key TEXT PRIMARY KEY,position_seconds REAL,duration_seconds REAL,updated_utc_ms INTEGER,position_present INTEGER,duration_present INTEGER,updated_present INTEGER)"),
            QStringLiteral("CREATE TABLE channel_timelines(channel_number INTEGER PRIMARY KEY,episode_index INTEGER,episode_name TEXT,position_seconds REAL)"),
            QStringLiteral("CREATE TABLE channel_programme_positions(channel_number INTEGER,file_name TEXT,position_seconds REAL,PRIMARY KEY(channel_number,file_name))"),
            QStringLiteral("CREATE TABLE channel_runtime_entries(channel_number INTEGER,kind TEXT,file_name TEXT,value REAL,PRIMARY KEY(channel_number,kind,file_name))"),
            QStringLiteral("CREATE TABLE channels(number INTEGER PRIMARY KEY,name TEXT,folder TEXT,aspect TEXT,content_type TEXT)"),
            QStringLiteral("CREATE TABLE state_revisions(domain TEXT PRIMARY KEY,revision INTEGER,updated_at REAL)"),
            QStringLiteral("CREATE TABLE mabel_queue_entries(id TEXT PRIMARY KEY,position INTEGER NOT NULL UNIQUE,channel_number INTEGER NOT NULL REFERENCES channels(number),file_name TEXT NOT NULL,title TEXT NOT NULL,artwork TEXT NOT NULL DEFAULT '',channel_name TEXT NOT NULL DEFAULT '')"),
            QStringLiteral("CREATE TABLE mabel_queue_history(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT,channel_number INTEGER,file_name TEXT,title TEXT,artwork TEXT,channel_name TEXT)"),
            QStringLiteral("CREATE TABLE mabel_queue_state(id INTEGER PRIMARY KEY,ending TEXT NOT NULL DEFAULT 'all_done',active INTEGER NOT NULL DEFAULT 0,completed INTEGER NOT NULL DEFAULT 0,current_title TEXT NOT NULL DEFAULT '',current_id TEXT NOT NULL DEFAULT '',owner TEXT NOT NULL DEFAULT '',paused INTEGER NOT NULL DEFAULT 0,phase TEXT NOT NULL DEFAULT 'waiting',position_seconds REAL NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '')"),
        };
        for (const QString &statement : schema) {
            QVERIFY2(query.exec(statement), qPrintable(query.lastError().text()));
        }
        QVERIFY(query.exec(QStringLiteral("PRAGMA user_version=12")));
        QVERIFY(query.exec(QStringLiteral("INSERT INTO mabel_queue_state(id) VALUES(1)")));
        QVERIFY(query.exec(QStringLiteral(
            "INSERT INTO channels VALUES(7,'Films','one','fit','films')")));
        QVERIFY(query.exec(QStringLiteral(
            "INSERT INTO mabel_queue_entries(id,position,channel_number,file_name,title) "
            "VALUES('first',0,7,'Episode.mp4','Episode')")));
        database.close();
    }
    QSqlDatabase::removeDatabase(connectionName);

    QString error;
    const QJsonObject settings{{QStringLiteral("schema_version"), 1},
                               {QStringLiteral("display_resolution"),
                                QStringLiteral("1080p")}};
    QVERIFY2(mabeltv::state::mergeSettings(databasePath, settings, &error),
             qPrintable(error));
    QCOMPARE(mabeltv::state::settings(databasePath), settings);

    // Finishing ordinary playback claims a waiting item without starting the queue.
    const auto firstQueued = mabeltv::state::advanceMabelQueue(databasePath, false, &error);
    QVERIFY2(firstQueued.claimed, qPrintable(error));
    QCOMPARE(firstQueued.item.value(QStringLiteral("channel")).toInt(), 7);
    QCOMPARE(firstQueued.item.value(QStringLiteral("file")).toString(),
             QStringLiteral("Episode.mp4"));
    QVERIFY(mabeltv::state::markMabelQueuePlaying(databasePath, 7,
                                                QStringLiteral("Episode.mp4"), &error));
    const auto queueEnd = mabeltv::state::advanceMabelQueue(databasePath, false, &error);
    QVERIFY2(queueEnd.claimed, qPrintable(error));
    QVERIFY(queueEnd.item.isEmpty());
    QVERIFY(queueEnd.allDone);
    // An empty inactive queue must leave ordinary channel autoplay alone.
    QVERIFY(!mabeltv::state::advanceMabelQueue(databasePath, false, &error).claimed);

    const QJsonObject timeline{{QStringLiteral("episode_index"), 0},
                               {QStringLiteral("episode_name"), QStringLiteral("Episode.mp4")},
                               {QStringLiteral("position_seconds"), 12.5},
                               {QStringLiteral("programme_positions"), QJsonObject{}},
                               {QStringLiteral("programme_last_left_uptime_ms"), QJsonObject{}},
                               {QStringLiteral("failed_programmes"), QJsonObject{}}};
    const QJsonObject player{{QStringLiteral("schema_version"), 4},
                             {QStringLiteral("current_channel"), 7},
                             {QStringLiteral("my_tv_positions"), QJsonObject{}},
                             {QStringLiteral("my_tv_durations"), QJsonObject{}},
                             {QStringLiteral("my_tv_position_updated_utc_ms"), QJsonObject{}},
                             {QStringLiteral("channel_film_positions"), QJsonObject{}},
                             {QStringLiteral("channel_film_durations"), QJsonObject{}},
                             {QStringLiteral("channel_film_position_updated_utc_ms"),
                              QJsonObject{}},
                             {QStringLiteral("channel_timelines"),
                              QJsonObject{{QStringLiteral("7"), timeline}}}};
    QVERIFY2(mabeltv::state::savePlayerSnapshot(databasePath, player, &error),
             qPrintable(error));
    QCOMPARE(mabeltv::state::player(databasePath), player);
    QVERIFY2(mabeltv::state::saveMyTvResume(databasePath, QStringLiteral("film"), 1200, 7200, 1000, &error), qPrintable(error));
    QVERIFY2(mabeltv::state::saveMyTvResume(databasePath, QStringLiteral("film"), 0, 0, 2000, &error), qPrintable(error));
    const auto completed = mabeltv::state::player(databasePath);
    QCOMPARE(completed.value("my_tv_positions").toObject().value("film").toDouble(), 0.0);
    QCOMPARE(completed.value("my_tv_durations").toObject().value("film").toDouble(), 7200.0);
    QCOMPARE(completed.value("my_tv_position_updated_utc_ms").toObject().value("film").toDouble(), 2000.0);
    QCOMPARE(completed.value("channel_timelines"), player.value("channel_timelines"));
    QVERIFY(mabeltv::state::saveMyTvResume(databasePath, QStringLiteral("film"), 999, 7200, 1500, &error));
    QCOMPARE(mabeltv::state::player(databasePath).value("my_tv_positions").toObject().value("film").toDouble(), 0.0);

    const QString lockName = QStringLiteral("progress-contention-test");
    {
        auto lock = QSqlDatabase::addDatabase(QStringLiteral("QSQLITE"), lockName);
        lock.setDatabaseName(databasePath);
        QVERIFY(lock.open());
        QSqlQuery transaction(lock);
        QVERIFY(transaction.exec(QStringLiteral("BEGIN IMMEDIATE")));
        MyTvResumeWriter writer;
        QElapsedTimer latency; latency.start();
        writer.save(databasePath, QStringLiteral("film"), 123, 7200, 3000);
        writer.save(databasePath, QStringLiteral("film"), 456, 7200, 4000);
        writer.save(databasePath, QStringLiteral("film"), 0, 7200, 5000);
        QVERIFY2(latency.elapsed() < 100, "Saving progress must not wait for the database on the GUI thread");
        int ticks = 0;
        QTimer heartbeat; heartbeat.setInterval(10);
        connect(&heartbeat, &QTimer::timeout, [&ticks] { ++ticks; }); heartbeat.start();
        QTest::qWait(150);
        QVERIFY(ticks >= 5);
        QVERIFY(transaction.exec(QStringLiteral("COMMIT")));
        QTRY_COMPARE(mabeltv::state::player(databasePath).value("my_tv_position_updated_utc_ms").toObject().value("film").toDouble(), 5000.0);
        QCOMPARE(mabeltv::state::player(databasePath).value("my_tv_positions").toObject().value("film").toDouble(), 0.0);
        lock.close();
    }
    QSqlDatabase::removeDatabase(lockName);

    const QString versionTwoConnectionName = QStringLiteral("state-test-v2");
    {
        QSqlDatabase database = QSqlDatabase::addDatabase(QStringLiteral("QSQLITE"),
                                                           versionTwoConnectionName);
        database.setDatabaseName(databasePath);
        QVERIFY2(database.open(), qPrintable(database.lastError().text()));
        QSqlQuery query(database);
        QVERIFY(query.exec(QStringLiteral("PRAGMA user_version=2")));
        database.close();
    }
    QSqlDatabase::removeDatabase(versionTwoConnectionName);

    error.clear();
    QCOMPARE(mabeltv::state::settings(databasePath, &error), QJsonObject{});
    QVERIFY(error.contains(QStringLiteral("Unsupported MabelTV database schema 2")));

    const QString currentVersionConnectionName = QStringLiteral("state-test-current");
    {
        QSqlDatabase database = QSqlDatabase::addDatabase(QStringLiteral("QSQLITE"),
                                                            currentVersionConnectionName);
        database.setDatabaseName(databasePath);
        QVERIFY2(database.open(), qPrintable(database.lastError().text()));
        QSqlQuery query(database);
        QVERIFY(query.exec(QStringLiteral("PRAGMA user_version=12")));
        database.close();
    }
    QSqlDatabase::removeDatabase(currentVersionConnectionName);
    error.clear();
    QCOMPARE(mabeltv::state::settings(databasePath, &error), settings);
    QVERIFY2(error.isEmpty(), qPrintable(error));

    const ChannelLibraryResult library = ChannelLibrary::load(
        databasePath, directory.filePath(QStringLiteral("media")),
        [](const QString &) {
            return MediaInspection{true, true, 42.0, QStringLiteral("h264"), {}};
        });
    QVERIFY2(library.isValid(), qPrintable(library.error));
    QCOMPARE(library.channels.size(), 1);
    QCOMPARE(library.channels.constFirst().number, 7);
}

