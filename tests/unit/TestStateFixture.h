#pragma once

#include "core/TvController.h"

#include <QJsonObject>
#include <QString>

namespace TestStateFixture
{
QString databaseFromJsonFixtures(const QString &channelsPath,
                                 const QString &settingsPath,
                                 const QString &statePath);
bool initializeController(TvController &controller,
                          const QString &channelsPath,
                          const QString &settingsPath,
                          const QString &mediaRoot,
                          const QString &statePath,
                          ChannelLibrary::MediaInspector inspector = {},
                          std::function<qint64()> uptimeClock = {},
                          const QString &databasePath = {});
QString databasePath(const TvController &controller);
void seedChannelMetadata(const QString &databasePath, const QJsonObject &root);
void seedAdultMedia(const QString &databasePath, const QJsonObject &values);
} // namespace TestStateFixture
