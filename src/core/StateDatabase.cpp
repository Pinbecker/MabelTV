#include "StateDatabase.h"

#include <QDateTime>
#include <QJsonDocument>
#include <QSet>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>
#include <QUuid>

namespace
{
    constexpr int minimumSupportedSchemaVersion = 7;
    constexpr int maximumSupportedSchemaVersion = 7;

class Connection
{
public:
    explicit Connection(const QString &path)
        : m_name(QStringLiteral("mabeltv-%1").arg(QUuid::createUuid().toString(QUuid::Id128)))
        , m_database(QSqlDatabase::addDatabase(QStringLiteral("QSQLITE"), m_name))
    {
        m_database.setDatabaseName(path);
        if (m_database.open()) {
            QSqlQuery query(m_database);
            query.exec(QStringLiteral("PRAGMA foreign_keys=ON"));
            query.exec(QStringLiteral("PRAGMA busy_timeout=5000"));
            query.exec(QStringLiteral("PRAGMA synchronous=FULL"));
        }
    }
    ~Connection()
    {
        m_database.close();
        m_database = QSqlDatabase();
        QSqlDatabase::removeDatabase(m_name);
    }
    QSqlDatabase &database() { return m_database; }
private:
    QString m_name;
    QSqlDatabase m_database;
};

QJsonValue parseValue(const QString &json)
{
    const QJsonDocument document = QJsonDocument::fromJson(
        QStringLiteral("[%1]").arg(json).toUtf8());
    return document.isArray() && !document.array().isEmpty()
        ? document.array().first() : QJsonValue();
}

QString serialise(const QJsonValue &value)
{
    const QByteArray json = QJsonDocument(QJsonArray{value}).toJson(QJsonDocument::Compact);
    return QString::fromUtf8(json.mid(1, json.size() - 2));
}

void setError(QString *target, const QString &value)
{
    if (target) *target = value;
}

bool ready(Connection &connection, QString *error)
{
    if (!connection.database().isOpen()) {
        setError(error, connection.database().lastError().text());
        return false;
    }
    QSqlQuery version(connection.database());
    if (!version.exec(QStringLiteral("PRAGMA user_version")) || !version.next()) {
        setError(error, version.lastError().text());
        return false;
    }
    const int schemaVersion = version.value(0).toInt();
    if (schemaVersion < minimumSupportedSchemaVersion
        || schemaVersion > maximumSupportedSchemaVersion) {
        setError(error, QStringLiteral("Unsupported MabelTV database schema %1")
                            .arg(schemaVersion));
        return false;
    }
    return true;
}

bool run(QSqlQuery &query, const QString &sql, QString *error)
{
    if (query.exec(sql)) return true;
    setError(error, query.lastError().text());
    return false;
}

QJsonObject keyValues(const QString &path, const QString &table, QString *error)
{
    Connection connection(path);
    QJsonObject result;
    if (!ready(connection, error)) return result;
    QSqlQuery query(connection.database());
    if (!run(query, QStringLiteral("SELECT key,value_json FROM %1 ORDER BY key").arg(table),
             error)) return {};
    while (query.next()) {
        result.insert(query.value(0).toString(), parseValue(query.value(1).toString()));
    }
    return result;
}

bool mergeKeyValues(const QString &path, const QString &table,
                    const QString &revisionDomain,
                    const QJsonObject &value, QString *error)
{
    Connection connection(path);
    if (!ready(connection, error)) return false;
    QSqlDatabase &database = connection.database();
    if (!database.transaction()) {
        setError(error, database.lastError().text());
        return false;
    }
    QSqlQuery insert(database);
    insert.prepare(QStringLiteral(
        "INSERT INTO %1(key,value_json,updated_at) VALUES(?,?,?) "
        "ON CONFLICT(key) DO UPDATE SET "
        "value_json=excluded.value_json,updated_at=excluded.updated_at").arg(table));
    const double now = QDateTime::currentMSecsSinceEpoch() / 1000.0;
    for (auto item = value.constBegin(); item != value.constEnd(); ++item) {
        insert.bindValue(0, item.key());
        insert.bindValue(1, serialise(item.value()));
        insert.bindValue(2, now);
        if (!insert.exec()) {
            database.rollback(); setError(error, insert.lastError().text()); return false;
        }
    }
    QSqlQuery revision(database);
    revision.prepare(QStringLiteral(
        "INSERT INTO state_revisions(domain,revision,updated_at) VALUES(?,1,?) "
        "ON CONFLICT(domain) DO UPDATE SET "
        "revision=revision+1,updated_at=excluded.updated_at"));
    revision.addBindValue(revisionDomain);
    revision.addBindValue(now);
    if (!revision.exec()) {
        database.rollback(); setError(error, revision.lastError().text()); return false;
    }
    if (!database.commit()) {
        setError(error, database.lastError().text()); return false;
    }
    return true;
}
} // namespace

namespace mabeltv::state
{
QJsonArray channels(const QString &path, QString *error)
{
    Connection connection(path);
    QJsonArray result;
    if (!ready(connection, error)) return result;
    QSqlQuery query(connection.database());
    if (!run(query, QStringLiteral(
            "SELECT number,name,folder,aspect,content_type FROM channels ORDER BY number"),
             error)) return {};
    while (query.next()) {
        result.append(QJsonObject{{QStringLiteral("number"), query.value(0).toInt()},
                                  {QStringLiteral("name"), query.value(1).toString()},
                                  {QStringLiteral("folder"), query.value(2).toString()},
                                  {QStringLiteral("aspect"), query.value(3).toString()},
                                  {QStringLiteral("content_type"), query.value(4).toString()}});
    }
    return result;
}

QJsonObject settings(const QString &path, QString *error)
{
    return keyValues(path, QStringLiteral("application_settings"), error);
}

QJsonObject owner(const QString &path, QString *error)
{
    return keyValues(path, QStringLiteral("owner_fields"), error);
}

QJsonObject player(const QString &path, QString *error)
{
    Connection connection(path);
    if (!ready(connection, error)) return {};
    QSqlDatabase &database = connection.database();
    QJsonObject root;
    QSqlQuery fields(database);
    if (!run(fields, QStringLiteral("SELECT key,value_json FROM player_fields"), error)) return {};
    while (fields.next()) {
        root.insert(fields.value(0).toString(), parseValue(fields.value(1).toString()));
    }
    root.insert(QStringLiteral("schema_version"), 4);
    const auto addResumes = [&database, &root, error](const QString &table,
                                                       const QString &keyColumn,
                                                       const QString &prefix) {
        QJsonObject positions, durations, updates;
        QSqlQuery query(database);
        if (!run(query, QStringLiteral(
                "SELECT %1,position_seconds,duration_seconds,updated_utc_ms,"
                "position_present,duration_present,updated_present FROM %2")
                .arg(keyColumn, table), error)) return false;
        while (query.next()) {
            const QString key = query.value(0).toString();
            if (query.value(4).toBool()) positions.insert(key, query.value(1).toDouble());
            if (query.value(5).toBool()) durations.insert(key, query.value(2).toDouble());
            if (query.value(6).toBool()) updates.insert(key, query.value(3).toDouble());
        }
        root.insert(prefix + QStringLiteral("_positions"), positions);
        root.insert(prefix + QStringLiteral("_durations"), durations);
        root.insert(prefix + QStringLiteral("_position_updated_utc_ms"), updates);
        return true;
    };
    if (!addResumes(QStringLiteral("adult_resume"), QStringLiteral("library_id"),
                    QStringLiteral("adult"))
        || !addResumes(QStringLiteral("channel_film_resume"), QStringLiteral("media_key"),
                       QStringLiteral("channel_film"))) return {};
    QJsonObject timelines;
    QSqlQuery timeline(database);
    if (!run(timeline, QStringLiteral(
            "SELECT channel_number,episode_index,episode_name,position_seconds FROM channel_timelines"),
             error)) return {};
    while (timeline.next()) {
        QJsonObject value{{QStringLiteral("episode_index"), timeline.value(1).toInt()},
                          {QStringLiteral("programme_positions"), QJsonObject{}},
                          {QStringLiteral("programme_last_left_uptime_ms"), QJsonObject{}},
                          {QStringLiteral("failed_programmes"), QJsonObject{}}};
        if (!timeline.value(2).isNull()) {
            value.insert(QStringLiteral("episode_name"), timeline.value(2).toString());
            value.insert(QStringLiteral("position_seconds"), timeline.value(3).toDouble());
        }
        timelines.insert(timeline.value(0).toString(), value);
    }
    QSqlQuery positions(database);
    if (!run(positions, QStringLiteral(
            "SELECT channel_number,file_name,position_seconds FROM channel_programme_positions"),
             error)) return {};
    while (positions.next()) {
        const QString number = positions.value(0).toString();
        QJsonObject value = timelines.value(number).toObject();
        QJsonObject entries = value.value(QStringLiteral("programme_positions")).toObject();
        entries.insert(positions.value(1).toString(), positions.value(2).toDouble());
        value.insert(QStringLiteral("programme_positions"), entries);
        timelines.insert(number, value);
    }
    QSqlQuery runtime(database);
    if (!run(runtime, QStringLiteral(
            "SELECT channel_number,kind,file_name,value FROM channel_runtime_entries"), error)) return {};
    while (runtime.next()) {
        const QString number = runtime.value(0).toString();
        const QString field = runtime.value(1).toString() == QStringLiteral("last_left")
            ? QStringLiteral("programme_last_left_uptime_ms") : QStringLiteral("failed_programmes");
        QJsonObject value = timelines.value(number).toObject();
        QJsonObject entries = value.value(field).toObject();
        entries.insert(runtime.value(2).toString(), runtime.value(3).toDouble());
        value.insert(field, entries);
        timelines.insert(number, value);
    }
    root.insert(QStringLiteral("channel_timelines"), timelines);
    return root;
}

QJsonObject channelMetadata(const QString &path, QString *error)
{
    Connection connection(path);
    if (!ready(connection, error)) return {};
    QJsonObject channelsRoot, programmesRoot;
    QSqlQuery query(connection.database());
    if (!run(query, QStringLiteral(
            "SELECT entity_kind,entity_key,metadata_json FROM channel_metadata"), error)) return {};
    while (query.next()) {
        QJsonObject &target = query.value(0).toString() == QStringLiteral("channel")
            ? channelsRoot : programmesRoot;
        target.insert(query.value(1).toString(), parseValue(query.value(2).toString()).toObject());
    }
    return QJsonObject{{QStringLiteral("channels"), channelsRoot},
                       {QStringLiteral("programmes"), programmesRoot}};
}

QJsonObject adultMedia(const QString &path, QString *error)
{
    Connection connection(path);
    if (!ready(connection, error)) return {};
    QSqlQuery query(connection.database());
    if (!run(query, QStringLiteral(
            "SELECT relative_path,library_id,state,message,progress,favourite,favourite_present,"
            "remote_position,remote_duration,remote_last_watched,metadata_json "
            "FROM local_media WHERE domain='adult'"), error)) return {};
    QJsonObject root;
    while (query.next()) {
        QJsonObject value;
        if (!query.value(1).isNull()) value.insert(QStringLiteral("library_id"), query.value(1).toString());
        if (!query.value(2).isNull()) value.insert(QStringLiteral("state"), query.value(2).toString());
        if (!query.value(3).isNull()) value.insert(QStringLiteral("message"), query.value(3).toString());
        if (!query.value(4).isNull()) value.insert(QStringLiteral("progress"), query.value(4).toInt());
        if (query.value(6).toBool()) value.insert(QStringLiteral("favourite"), query.value(5).toBool());
        if (!query.value(7).isNull()) value.insert(QStringLiteral("remote_position"), query.value(7).toDouble());
        if (!query.value(8).isNull()) value.insert(QStringLiteral("remote_duration"), query.value(8).toDouble());
        if (!query.value(9).isNull()) value.insert(QStringLiteral("remote_last_watched"), query.value(9).toDouble());
        value.insert(QStringLiteral("metadata"), parseValue(query.value(10).toString()).toObject());
        root.insert(query.value(0).toString(), value);
    }
    return root;
}

bool mergeSettings(const QString &path, const QJsonObject &value, QString *error)
{
    return mergeKeyValues(path, QStringLiteral("application_settings"),
                          QStringLiteral("settings"), value, error);
}

bool savePlayerSnapshot(const QString &path, const QJsonObject &value, QString *error)
{
    Connection connection(path);
    if (!ready(connection, error)) return false;
    QSqlDatabase &database = connection.database();
    if (!database.transaction()) {
        setError(error, database.lastError().text());
        return false;
    }
    const auto fail = [&database, error](const QSqlQuery &query) {
        database.rollback();
        setError(error, query.lastError().text());
        return false;
    };
    const QStringList tables{QStringLiteral("player_fields"), QStringLiteral("adult_resume"),
                             QStringLiteral("channel_film_resume"),
                             QStringLiteral("channel_runtime_entries"),
                             QStringLiteral("channel_programme_positions"),
                             QStringLiteral("channel_timelines")};
    for (const QString &table : tables) {
        QSqlQuery clear(database);
        if (!clear.exec(QStringLiteral("DELETE FROM %1").arg(table))) return fail(clear);
    }
    const QSet<QString> structured{
        QStringLiteral("adult_positions"), QStringLiteral("adult_durations"),
        QStringLiteral("adult_position_updated_utc_ms"),
        QStringLiteral("channel_film_positions"), QStringLiteral("channel_film_durations"),
        QStringLiteral("channel_film_position_updated_utc_ms"),
        QStringLiteral("channel_timelines")};
    QSqlQuery field(database);
    field.prepare(QStringLiteral("INSERT INTO player_fields VALUES(?,?,?)"));
    const double now = QDateTime::currentMSecsSinceEpoch() / 1000.0;
    for (auto item = value.constBegin(); item != value.constEnd(); ++item) {
        if (structured.contains(item.key())) continue;
        field.bindValue(0, item.key());
        field.bindValue(1, serialise(item.value()));
        field.bindValue(2, now);
        if (!field.exec()) return fail(field);
    }
    const auto saveResumes = [&database, &value, &fail](const QString &table,
                                                         const QString &prefix) {
        const QJsonObject positions = value.value(prefix + QStringLiteral("_positions")).toObject();
        const QJsonObject durations = value.value(prefix + QStringLiteral("_durations")).toObject();
        const QJsonObject updates = value.value(
            prefix + QStringLiteral("_position_updated_utc_ms")).toObject();
        QSet<QString> keys;
        for (const QString &key : positions.keys()) keys.insert(key);
        for (const QString &key : durations.keys()) keys.insert(key);
        for (const QString &key : updates.keys()) keys.insert(key);
        QSqlQuery query(database);
        query.prepare(QStringLiteral("INSERT INTO %1 VALUES(?,?,?,?,?,?,?)").arg(table));
        for (const QString &key : keys) {
            query.bindValue(0, key);
            query.bindValue(1, positions.value(key).toDouble());
            query.bindValue(2, durations.value(key).toDouble());
            query.bindValue(3, updates.value(key).toDouble());
            query.bindValue(4, positions.contains(key));
            query.bindValue(5, durations.contains(key));
            query.bindValue(6, updates.contains(key));
            if (!query.exec()) return fail(query);
        }
        return true;
    };
    if (!saveResumes(QStringLiteral("adult_resume"), QStringLiteral("adult"))
        || !saveResumes(QStringLiteral("channel_film_resume"),
                        QStringLiteral("channel_film"))) return false;
    const QJsonObject timelines = value.value(QStringLiteral("channel_timelines")).toObject();
    for (auto item = timelines.constBegin(); item != timelines.constEnd(); ++item) {
        bool valid = false;
        const int number = item.key().toInt(&valid);
        if (!valid) continue;
        const QJsonObject saved = item.value().toObject();
        QSqlQuery timeline(database);
        timeline.prepare(QStringLiteral("INSERT INTO channel_timelines VALUES(?,?,?,?)"));
        timeline.addBindValue(number);
        timeline.addBindValue(saved.value(QStringLiteral("episode_index")).toInt());
        timeline.addBindValue(saved.contains(QStringLiteral("episode_name"))
            ? QVariant(saved.value(QStringLiteral("episode_name")).toString()) : QVariant());
        timeline.addBindValue(saved.value(QStringLiteral("position_seconds")).toDouble());
        if (!timeline.exec()) return fail(timeline);
        const auto saveEntries = [&database, &saved, &fail, number](
                                     const QString &fieldName, const QString &kind) {
            QSqlQuery query(database);
            query.prepare(kind == QStringLiteral("position")
                ? QStringLiteral("INSERT INTO channel_programme_positions VALUES(?,?,?)")
                : QStringLiteral("INSERT INTO channel_runtime_entries VALUES(?,?,?,?)"));
            const QJsonObject entries = saved.value(fieldName).toObject();
            for (auto entry = entries.constBegin(); entry != entries.constEnd(); ++entry) {
                query.bindValue(0, number);
                int offset = 1;
                if (kind != QStringLiteral("position")) query.bindValue(offset++, kind);
                query.bindValue(offset++, entry.key());
                query.bindValue(offset, entry.value().toDouble());
                if (!query.exec()) return fail(query);
            }
            return true;
        };
        if (!saveEntries(QStringLiteral("programme_positions"), QStringLiteral("position"))
            || !saveEntries(QStringLiteral("programme_last_left_uptime_ms"),
                            QStringLiteral("last_left"))
            || !saveEntries(QStringLiteral("failed_programmes"), QStringLiteral("failed"))) {
            return false;
        }
    }
    QSqlQuery revision(database);
    revision.prepare(QStringLiteral(
        "INSERT INTO state_revisions(domain,revision,updated_at) VALUES('player',1,?) "
        "ON CONFLICT(domain) DO UPDATE SET "
        "revision=revision+1,updated_at=excluded.updated_at"));
    revision.addBindValue(now);
    if (!revision.exec()) return fail(revision);
    if (!database.commit()) {
        setError(error, database.lastError().text());
        return false;
    }
    return true;
}

} // namespace mabeltv::state
