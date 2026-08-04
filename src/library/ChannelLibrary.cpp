#include "ChannelLibrary.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSet>

#include <algorithm>

namespace
{
const QSet<QString> supportedExtensions{
    QStringLiteral("mp4"),
    QStringLiteral("m4v"),
    QStringLiteral("mkv"),
    QStringLiteral("mov"),
    QStringLiteral("webm"),
    QStringLiteral("avi"),
    QStringLiteral("mpg"),
    QStringLiteral("mpeg"),
};

bool isSafeRelativeFolder(const QString &folder)
{
    const QString clean = QDir::cleanPath(folder);
    return !clean.isEmpty() && !QDir::isAbsolutePath(clean) && clean != QStringLiteral("..")
           && !clean.startsWith(QStringLiteral("../"))
           && !clean.startsWith(QStringLiteral("..\\"));
}

QString normaliseAspectMode(QString mode)
{
    mode = mode.trimmed().toLower();
    if (mode == QStringLiteral("fit") || mode == QStringLiteral("stretch")) {
        return mode;
    }
    return QStringLiteral("crop");
}
} // namespace

ChannelLibraryResult ChannelLibrary::load(const QString &configurationPath,
                                          const QString &mediaRoot,
                                          MediaInspector mediaInspector)
{
    ChannelLibraryResult result;
    QFile configuration(configurationPath);
    if (!configuration.open(QIODevice::ReadOnly)) {
        result.error = QStringLiteral("Could not open channel configuration: %1")
                           .arg(QDir::toNativeSeparators(configurationPath));
        return result;
    }

    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(configuration.readAll(), &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        result.error = QStringLiteral("Invalid channel configuration: %1").arg(parseError.errorString());
        return result;
    }

    const QJsonObject root = document.object();
    if (root.value(QStringLiteral("schema_version")).toInt() != 1) {
        result.error = QStringLiteral("Unsupported channels.json schema version");
        return result;
    }

    const QJsonArray configuredChannels = root.value(QStringLiteral("channels")).toArray();
    if (configuredChannels.isEmpty()) {
        result.error = QStringLiteral("No channels are configured");
        return result;
    }

    MediaIndex uncachedIndex;
    if (!mediaInspector) {
        mediaInspector = [&uncachedIndex](const QString &path) { return uncachedIndex.inspect(path); };
    }

    QSet<int> usedNumbers;
    const QDir mediaDirectory(QFileInfo(mediaRoot).absoluteFilePath());

    for (const QJsonValue &value : configuredChannels) {
        if (!value.isObject()) {
            result.warnings.append(QStringLiteral("Ignored a channel entry that was not an object"));
            continue;
        }

        const QJsonObject object = value.toObject();
        Channel channel;
        channel.number = object.value(QStringLiteral("number")).toInt(-1);
        channel.name = object.value(QStringLiteral("name")).toString().trimmed();
        channel.folder = object.value(QStringLiteral("folder")).toString().trimmed();
        channel.aspectMode = normaliseAspectMode(object.value(QStringLiteral("aspect")).toString());

        if (channel.number < 0 || channel.number > 999 || usedNumbers.contains(channel.number)) {
            result.warnings.append(QStringLiteral("Ignored invalid or duplicate channel number %1")
                                       .arg(channel.number));
            continue;
        }
        if (channel.name.isEmpty() || !isSafeRelativeFolder(channel.folder)) {
            result.warnings.append(QStringLiteral("Ignored channel %1 because its name or folder is invalid")
                                       .arg(channel.number));
            continue;
        }

        usedNumbers.insert(channel.number);
        const QString channelPath = mediaDirectory.absoluteFilePath(channel.folder);
        QDir channelDirectory(channelPath);
        if (!channelDirectory.exists()) {
            result.warnings.append(QStringLiteral("Channel %1 folder is missing: %2")
                                       .arg(channel.number)
                                       .arg(QDir::toNativeSeparators(channelPath)));
            result.channels.append(std::move(channel));
            continue;
        }

        const QFileInfoList files = channelDirectory.entryInfoList(QDir::Files | QDir::Readable,
                                                                    QDir::Name | QDir::IgnoreCase);
        for (const QFileInfo &file : files) {
            if (!supportedExtensions.contains(file.suffix().toLower())) {
                continue;
            }

            const MediaInspection inspection = mediaInspector(file.absoluteFilePath());
            if (!inspection.usable) {
                result.warnings.append(QStringLiteral("Ignored unusable media on channel %1: %2 (%3)")
                                           .arg(channel.number)
                                           .arg(file.fileName(), inspection.error));
                continue;
            }

            channel.episodes.append(
                Episode{file.absoluteFilePath(), std::max(0.0, inspection.durationSeconds)});
        }

        if (channel.episodes.isEmpty()) {
            result.warnings.append(QStringLiteral("Channel %1 has no supported media").arg(channel.number));
        }
        result.channels.append(std::move(channel));
    }

    std::sort(result.channels.begin(), result.channels.end(), [](const Channel &left, const Channel &right) {
        return left.number < right.number;
    });

    if (result.channels.isEmpty()) {
        result.error = QStringLiteral("No valid channels were found in the configuration");
    }
    return result;
}
