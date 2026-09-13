#include "TestStateFixture.h"

#include "core/StateDatabase.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QHash>
#include <QJsonArray>
#include <QJsonDocument>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QUuid>

#include <utility>

namespace TestStateFixture
{
QJsonObject readTestObject(const QString &path)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) return {};
    const QJsonDocument document = QJsonDocument::fromJson(file.readAll());
    return document.isObject() ? document.object() : QJsonObject{};
}
QString databaseFromJsonFixtures(const QString &channelsPath,
                                 const QString &settingsPath,
                                 const QString &statePath)
{
    const QString databasePath = QDir(QFileInfo(settingsPath).absolutePath())
                                     .filePath(QStringLiteral("mabeltv-test.db"));
    if (QFileInfo::exists(databasePath)) return databasePath;
    const QString connectionName = QUuid::createUuid().toString(QUuid::WithoutBraces);
    {
        QSqlDatabase database = QSqlDatabase::addDatabase(QStringLiteral("QSQLITE"),
                                                           connectionName);
        database.setDatabaseName(databasePath);
        if (!database.open()) return {};
        QSqlQuery query(database);
        const QStringList schema{
            QStringLiteral("CREATE TABLE application_settings(key TEXT PRIMARY KEY,value_json TEXT,updated_at REAL)"),
            QStringLiteral("CREATE TABLE owner_fields(key TEXT PRIMARY KEY,value_json TEXT,updated_at REAL)"),
            QStringLiteral("CREATE TABLE player_fields(key TEXT PRIMARY KEY,value_json TEXT,updated_at REAL)"),
            QStringLiteral("CREATE TABLE adult_resume(library_id TEXT PRIMARY KEY,position_seconds REAL,duration_seconds REAL,updated_utc_ms INTEGER,position_present INTEGER,duration_present INTEGER,updated_present INTEGER)"),
            QStringLiteral("CREATE TABLE channel_film_resume(media_key TEXT PRIMARY KEY,position_seconds REAL,duration_seconds REAL,updated_utc_ms INTEGER,position_present INTEGER,duration_present INTEGER,updated_present INTEGER)"),
            QStringLiteral("CREATE TABLE channel_timelines(channel_number INTEGER PRIMARY KEY,episode_index INTEGER,episode_name TEXT,position_seconds REAL)"),
            QStringLiteral("CREATE TABLE channel_programme_positions(channel_number INTEGER,file_name TEXT,position_seconds REAL,PRIMARY KEY(channel_number,file_name))"),
            QStringLiteral("CREATE TABLE channel_runtime_entries(channel_number INTEGER,kind TEXT,file_name TEXT,value REAL,PRIMARY KEY(channel_number,kind,file_name))"),
            QStringLiteral("CREATE TABLE channels(number INTEGER PRIMARY KEY,name TEXT,folder TEXT,aspect TEXT,content_type TEXT)"),
            QStringLiteral("CREATE TABLE state_revisions(domain TEXT PRIMARY KEY,revision INTEGER,updated_at REAL)"),
            QStringLiteral("CREATE TABLE channel_metadata(entity_kind TEXT,entity_key TEXT,metadata_json TEXT,PRIMARY KEY(entity_kind,entity_key))"),
            QStringLiteral("CREATE TABLE local_media(relative_path TEXT PRIMARY KEY,library_id TEXT,state TEXT,message TEXT,progress INTEGER,favourite INTEGER,favourite_present INTEGER,remote_position REAL,remote_duration REAL,remote_last_watched REAL,metadata_json TEXT,domain TEXT)"),
        };
        for (const QString &statement : schema) {
            if (!query.exec(statement)) return {};
        }
        if (!query.exec(QStringLiteral("PRAGMA user_version=7"))) return {};
        const QJsonArray channels = readTestObject(channelsPath)
                                        .value(QStringLiteral("channels")).toArray();
        query.prepare(QStringLiteral("INSERT INTO channels VALUES(?,?,?,?,?)"));
        for (const QJsonValue &value : channels) {
            const QJsonObject channel = value.toObject();
            query.bindValue(0, channel.value(QStringLiteral("number")).toInt());
            query.bindValue(1, channel.value(QStringLiteral("name")).toString());
            query.bindValue(2, channel.value(QStringLiteral("folder")).toString());
            query.bindValue(3, channel.value(QStringLiteral("aspect")).toString(
                                   QStringLiteral("crop")));
            query.bindValue(4, channel.value(QStringLiteral("content_type")).toString(
                                   QStringLiteral("shows")));
            if (!query.exec()) return {};
        }
        database.close();
    }
    QSqlDatabase::removeDatabase(connectionName);
    QString error;
    QJsonObject settings = readTestObject(settingsPath);
    if (!settings.contains(QStringLiteral("crt_glass"))
        && settings.contains(QStringLiteral("crt_effect"))) {
        const QString effect = settings.value(QStringLiteral("crt_effect")).toString();
        settings.insert(QStringLiteral("crt_glass"), effect == QStringLiteral("off")
            ? 0 : (effect == QStringLiteral("high") ? 75 : 35));
    }
    if (settings.value(QStringLiteral("playback_mode")).toString()
        == QStringLiteral("restart")) {
        settings.insert(QStringLiteral("playback_mode"), QStringLiteral("resume"));
    }
    const QString border = settings.value(QStringLiteral("tv_border")).toString();
    if (border == QStringLiteral("cream"))
        settings.insert(QStringLiteral("tv_border"), QStringLiteral("silver-90s"));
    else if (border == QStringLiteral("charcoal"))
        settings.insert(QStringLiteral("tv_border"), QStringLiteral("charcoal-90s"));
    else if (border == QStringLiteral("walnut"))
        settings.insert(QStringLiteral("tv_border"), QStringLiteral("vintage-black"));
    settings.remove(QStringLiteral("crt_effect"));
    settings.remove(QStringLiteral("parent_pin"));
    if (!settings.isEmpty()
        && !mabeltv::state::mergeSettings(databasePath, settings, &error)) return {};
    const QJsonObject state = readTestObject(statePath);
    if (!state.isEmpty()
        && !mabeltv::state::savePlayerSnapshot(databasePath, state, &error)) return {};
    return databasePath;
}

QHash<const TvController *, QString> testDatabases;

bool initializeController(TvController &controller,
                              const QString &channelsPath,
                              const QString &settingsPath,
                              const QString &mediaRoot,
                              const QString &statePath,
                              ChannelLibrary::MediaInspector inspector,
                              std::function<qint64()> uptimeClock,
                              const QString &databasePath)
{
    const QString testDatabase = databasePath.isEmpty()
        ? databaseFromJsonFixtures(channelsPath, settingsPath, statePath)
        : databasePath;
    testDatabases.insert(&controller, testDatabase);
    return !testDatabase.isEmpty()
        && controller.initialize(testDatabase, mediaRoot,
                                 std::move(inspector), std::move(uptimeClock));
}

QString databasePath(const TvController &controller)
{
    return testDatabases.value(&controller);
}

void seedChannelMetadata(const QString &databasePath, const QJsonObject &root)
{
    const QString connectionName = QUuid::createUuid().toString(QUuid::WithoutBraces);
    {
        QSqlDatabase database = QSqlDatabase::addDatabase(QStringLiteral("QSQLITE"),
                                                           connectionName);
        database.setDatabaseName(databasePath);
        if (database.open()) {
            QSqlQuery query(database);
            query.prepare(QStringLiteral("INSERT OR REPLACE INTO channel_metadata VALUES(?,?,?)"));
            for (const QString &kind : {QStringLiteral("channels"),
                                        QStringLiteral("programmes")}) {
                const QJsonObject values = root.value(kind).toObject();
                for (auto item = values.constBegin(); item != values.constEnd(); ++item) {
                    query.bindValue(0, kind == QStringLiteral("channels")
                                           ? QStringLiteral("channel")
                                           : QStringLiteral("programme"));
                    query.bindValue(1, item.key());
                    query.bindValue(2, QString::fromUtf8(QJsonDocument(
                        item.value().toObject()).toJson(QJsonDocument::Compact)));
                    query.exec();
                }
            }
            database.close();
        }
    }
    QSqlDatabase::removeDatabase(connectionName);
}

void seedAdultMedia(const QString &databasePath, const QJsonObject &values)
{
    const QString connectionName = QUuid::createUuid().toString(QUuid::WithoutBraces);
    {
        QSqlDatabase database = QSqlDatabase::addDatabase(QStringLiteral("QSQLITE"),
                                                           connectionName);
        database.setDatabaseName(databasePath);
        if (database.open()) {
            QSqlQuery query(database);
            query.prepare(QStringLiteral(
                "INSERT OR REPLACE INTO local_media(relative_path,library_id,"
                "favourite,favourite_present,metadata_json,domain) VALUES(?,?,0,0,?,'adult')"));
            for (auto item = values.constBegin(); item != values.constEnd(); ++item) {
                const QJsonObject saved = item.value().toObject();
                query.bindValue(0, item.key());
                query.bindValue(1, saved.value(QStringLiteral("library_id")).toString());
                query.bindValue(2, QString::fromUtf8(QJsonDocument(
                    saved.value(QStringLiteral("metadata")).toObject())
                        .toJson(QJsonDocument::Compact)));
                query.exec();
            }
            database.close();
        }
    }
    QSqlDatabase::removeDatabase(connectionName);
}
} // namespace TestStateFixture
