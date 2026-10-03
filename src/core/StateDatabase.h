#pragma once

#include <QJsonArray>
#include <QJsonObject>
#include <QString>

namespace mabeltv::state
{
struct MabelQueueAdvance {
    bool claimed = false;
    bool allDone = false;
    QJsonObject item;
};

MabelQueueAdvance advanceMabelQueue(const QString &databasePath, bool start,
                                    QString *error = nullptr);
bool stopMabelQueue(const QString &databasePath, QString *error = nullptr);
MabelQueueAdvance previousMabelQueue(const QString &databasePath, QString *error = nullptr);
bool ownsMabelQueue(const QString &databasePath);
bool markMabelQueuePlaying(const QString &databasePath, int channel,
                          const QString &file, QString *error = nullptr);
bool saveMabelQueuePosition(const QString &databasePath, double position, QString *error = nullptr);
bool failMabelQueue(const QString &databasePath, const QString &message, QString *error = nullptr);
QJsonArray channels(const QString &databasePath, QString *error = nullptr);
QJsonObject settings(const QString &databasePath, QString *error = nullptr);
QJsonObject owner(const QString &databasePath, QString *error = nullptr);
QJsonObject player(const QString &databasePath, QString *error = nullptr);
QJsonObject channelMetadata(const QString &databasePath, QString *error = nullptr);
QJsonObject myTvMedia(const QString &databasePath, QString *error = nullptr);

bool mergeSettings(const QString &databasePath, const QJsonObject &value,
                   QString *error = nullptr);
bool savePlayerSnapshot(const QString &databasePath, const QJsonObject &value,
                        QString *error = nullptr);
} // namespace mabeltv::state
