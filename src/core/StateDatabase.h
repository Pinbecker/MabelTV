#pragma once

#include <QJsonArray>
#include <QJsonObject>
#include <QString>

namespace mabeltv::state
{
QJsonArray channels(const QString &databasePath, QString *error = nullptr);
QJsonObject settings(const QString &databasePath, QString *error = nullptr);
QJsonObject owner(const QString &databasePath, QString *error = nullptr);
QJsonObject player(const QString &databasePath, QString *error = nullptr);
QJsonObject channelMetadata(const QString &databasePath, QString *error = nullptr);
QJsonObject adultMedia(const QString &databasePath, QString *error = nullptr);

bool replaceSettings(const QString &databasePath, const QJsonObject &value,
                     QString *error = nullptr);
bool replacePlayer(const QString &databasePath, const QJsonObject &value,
                   QString *error = nullptr);
} // namespace mabeltv::state
