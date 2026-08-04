#pragma once

#include "MediaIndex.h"

#include <QString>
#include <QStringList>
#include <QVector>

#include <functional>

struct Episode
{
    QString path;
    double durationSeconds = 0.0;
};

struct Channel
{
    int number = 0;
    QString name;
    QString folder;
    QString aspectMode = QStringLiteral("crop");
    QVector<Episode> episodes;
};

struct ChannelLibraryResult
{
    QVector<Channel> channels;
    QStringList warnings;
    QString error;

    [[nodiscard]] bool isValid() const { return error.isEmpty(); }
};

class ChannelLibrary
{
public:
    using MediaInspector = std::function<MediaInspection(const QString &)>;

    static ChannelLibraryResult load(const QString &configurationPath,
                                     const QString &mediaRoot,
                                     MediaInspector mediaInspector = {});
};
