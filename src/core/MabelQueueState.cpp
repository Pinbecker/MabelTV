#include "StateDatabase.h"
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>
#include <QSqlRecord>
#include <QUuid>

namespace {
class QueueConnection {
public:
    QueueConnection(const QString &path, QString *error)
        : name(QUuid::createUuid().toString()), db(QSqlDatabase::addDatabase("QSQLITE", name)), error(error) {
        db.setDatabaseName(path);
        valid = db.open();
        if (valid) {
            run("PRAGMA foreign_keys=ON"); run("PRAGMA busy_timeout=5000");
            QSqlQuery version(db);
            valid = version.exec("PRAGMA user_version") && version.next() && version.value(0).toInt() == 11;
            if (valid) valid = run("BEGIN IMMEDIATE");
        }
        if (!valid && error) *error = "Queue database is unavailable or has an unsupported schema";
    }
    ~QueueConnection() { db.rollback(); db.close(); db = {}; QSqlDatabase::removeDatabase(name); }
    bool run(const QString &sql, const QVariantList &args = {}) {
        QSqlQuery q(db); q.prepare(sql);
        for (const auto &arg : args) q.addBindValue(arg);
        if (q.exec()) return true;
        valid = false;
        if (error) *error = q.lastError().text();
        return false;
    }
    QJsonObject row(const QString &sql, const QVariantList &args = {}) {
        QSqlQuery q(db); q.prepare(sql);
        for (const auto &arg : args) q.addBindValue(arg);
        if (!q.exec()) { valid = false; if (error) *error = q.lastError().text(); return {}; }
        if (!q.next()) return {};
        QJsonObject object;
        for (int i=0; i<q.record().count(); ++i)
            object.insert(q.record().fieldName(i), QJsonValue::fromVariant(q.value(i)));
        return object;
    }
    bool commit() { if (!valid) return false; if (db.commit()) return true; if (error) *error = db.lastError().text(); return false; }
    QString name; QSqlDatabase db; QString *error; bool valid = false;
};

mabeltv::state::MabelQueueAdvance reserve(QueueConnection &db, const QJsonObject &item) {
    mabeltv::state::MabelQueueAdvance result;
    if (item.isEmpty()) return result;
    auto state = db.row("SELECT * FROM mabel_queue_state WHERE id=1");
    const double position = state["current_id"].toString() == item["id"].toString()
        ? state["position_seconds"].toDouble() : 0;
    db.run("UPDATE mabel_queue_state SET current_id=?,current_title=?,owner='tv',phase='starting',"
           "active=0,completed=0,paused=0,position_seconds=?,error='' WHERE id=1",
           {item["id"].toString(), item["title"].toString(), position});
    result.claimed = true;
    result.item = {{"id",item["id"]}, {"channel",item["channel_number"]},
                   {"file",item["file_name"]}, {"title",item["title"]}, {"position",position}};
    return result;
}
}

namespace mabeltv::state {
MabelQueueAdvance advanceMabelQueue(const QString &path, bool start, QString *error) {
    QueueConnection db(path,error);
    if (!db.valid) return {};
    auto state = db.row("SELECT * FROM mabel_queue_state WHERE id=1");
    if (state.isEmpty() || (!state["owner"].toString().isEmpty() && state["owner"] != "tv")) return {};
    bool finished = false;
    if (!start && state["phase"] == "playing" && state["owner"] == "tv") {
        finished = true;
        const QString id = state["current_id"].toString();
        db.run("INSERT INTO mabel_queue_history(id,channel_number,file_name,title,artwork,channel_name) "
               "SELECT id,channel_number,file_name,title,artwork,channel_name FROM mabel_queue_entries WHERE id=?", {id});
        db.run("DELETE FROM mabel_queue_entries WHERE id=?", {id});
        db.run("DELETE FROM mabel_queue_history WHERE sequence NOT IN "
               "(SELECT sequence FROM mabel_queue_history ORDER BY sequence DESC LIMIT 20)");
        db.run("UPDATE mabel_queue_state SET active=0,current_id='',current_title='',phase='waiting',position_seconds=0 WHERE id=1");
    }
    if (!start && state["paused"].toInt()) {
        if (finished) db.run("UPDATE mabel_queue_state SET owner='' WHERE id=1");
        db.commit(); return {};
    }
    QJsonObject item;
    if (start && !state["current_id"].toString().isEmpty())
        item = db.row("SELECT * FROM mabel_queue_entries WHERE id=?", {state["current_id"].toString()});
    if (item.isEmpty()) item = db.row("SELECT * FROM mabel_queue_entries ORDER BY position LIMIT 1");
    MabelQueueAdvance result;
    if (!item.isEmpty()) {
        result = reserve(db,item);
    } else if (finished) {
        result.claimed = true;
        result.allDone = state["ending"] == "all_done";
        db.run("UPDATE mabel_queue_state SET active=0,completed=?,current_id='',current_title='',owner='',"
               "phase='waiting',position_seconds=0 WHERE id=1", {result.allDone ? 1 : 0});
    }
    if (!db.commit()) return {};
    return result;
}

MabelQueueAdvance previousMabelQueue(const QString &path, QString *error) {
    QueueConnection db(path,error);
    if (!db.valid) return {};
    const auto state = db.row("SELECT * FROM mabel_queue_state WHERE id=1");
    if (state["owner"] != "tv" || state["current_id"].toString().isEmpty()) return {};
    const auto previous = db.row("SELECT * FROM mabel_queue_history ORDER BY sequence DESC LIMIT 1");
    if (previous.isEmpty()) return {};
    db.run("INSERT OR IGNORE INTO mabel_queue_entries(id,position,channel_number,file_name,title,artwork,channel_name) "
           "VALUES(?,(SELECT COALESCE(MAX(position),-1)+1 FROM mabel_queue_entries),?,?,?,?,?)",
           {previous["id"].toString(), previous["channel_number"].toInt(), previous["file_name"].toString(),
            previous["title"].toString(),previous["artwork"].toString(),previous["channel_name"].toString()});
    db.run("UPDATE mabel_queue_entries SET position=position+1000");
    db.run("UPDATE mabel_queue_entries SET position=0 WHERE id=?", {previous["id"].toString()});
    QSqlQuery ranks(db.db);
    ranks.exec("SELECT id FROM mabel_queue_entries ORDER BY position");
    QStringList identities;
    while (ranks.next()) identities.append(ranks.value(0).toString());
    ranks.finish();
    db.run("UPDATE mabel_queue_entries SET position=position+1000000");
    for (int rank=0; rank<identities.size(); ++rank)
        db.run("UPDATE mabel_queue_entries SET position=? WHERE id=?", {rank,identities[rank]});
    db.run("DELETE FROM mabel_queue_history WHERE sequence=?", {previous["sequence"].toInt()});
    const auto result = reserve(db,previous);
    if (!db.commit()) return {};
    return result;
}

bool markMabelQueuePlaying(const QString &path, int channel, const QString &file, QString *error) {
    QueueConnection db(path,error);
    if (!db.valid) return false;
    db.run("UPDATE mabel_queue_state SET phase='playing',active=1,error='' WHERE id=1 AND owner='tv' "
           "AND phase='starting' AND current_id IN (SELECT id FROM mabel_queue_entries WHERE channel_number=? AND file_name=?)",
           {channel,file});
    return db.commit();
}

bool saveMabelQueuePosition(const QString &path, double position, QString *error) {
    QueueConnection db(path,error);
    if (!db.valid) return false;
    db.run("UPDATE mabel_queue_state SET position_seconds=? WHERE id=1 AND owner='tv' AND phase='playing'", {position});
    return db.commit();
}

bool stopMabelQueue(const QString &path, QString *error) {
    QueueConnection db(path,error);
    if (!db.valid) return false;
    db.run("UPDATE mabel_queue_state SET active=0,phase='waiting',paused=1,owner='' WHERE id=1 "
           "AND owner IN ('','tv') AND EXISTS(SELECT 1 FROM mabel_queue_entries)");
    return db.commit();
}

bool failMabelQueue(const QString &path, const QString &message, QString *error) {
    QueueConnection db(path,error);
    if (!db.valid) return false;
    const auto state = db.row("SELECT owner,current_id FROM mabel_queue_state WHERE id=1");
    if (state["owner"] != "tv" || state["current_id"].toString().isEmpty()) return false;
    db.run("UPDATE mabel_queue_state SET active=0,phase='waiting',paused=1,owner='',error=? WHERE id=1", {message.left(250)});
    return db.commit();
}

bool ownsMabelQueue(const QString &path) {
    QueueConnection db(path,nullptr);
    return db.valid && db.row("SELECT owner FROM mabel_queue_state WHERE id=1")["owner"] == "tv";
}
}
