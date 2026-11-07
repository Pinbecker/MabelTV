#include "TvController.h"
#include <QFileInfo>
#include <utility>

QString TvController::relocateFilmResumeState(const ChannelLibraryResult &library, const QString &activePath)
{
    struct Destination { QString path; QString key; };
    QHash<QString, QVector<Destination>> destinations;
    QHash<QString, int> sourceCounts;
    for (const ChannelRuntime &runtime : std::as_const(m_channels))
        for (const Episode &episode : runtime.channel.episodes)
            if (!episode.fileIdentity.isEmpty()) ++sourceCounts[episode.fileIdentity];
    for (const Channel &channel : library.channels) {
        for (const Episode &episode : channel.episodes) {
            if (channel.contentType == QStringLiteral("films") && !episode.fileIdentity.isEmpty())
                destinations[episode.fileIdentity].append({QFileInfo(episode.path).absoluteFilePath(),
                    QStringLiteral("%1/%2").arg(channel.number).arg(QFileInfo(episode.path).fileName())});
        }
    }
    QString relocatedActive = activePath;
    for (const ChannelRuntime &runtime : std::as_const(m_channels)) {
        if (runtime.channel.contentType != QStringLiteral("films")) continue;
        for (const Episode &episode : runtime.channel.episodes) {
            const auto matches = destinations.value(episode.fileIdentity);
            // Never infer a move from a title, or conflate independent copies.
            if (episode.fileIdentity.isEmpty() || sourceCounts.value(episode.fileIdentity) != 1
                || matches.size() != 1 || QFileInfo::exists(episode.path)) continue;
            const auto &target = matches.first();
            const QString oldKey = QStringLiteral("%1/%2").arg(runtime.channel.number).arg(QFileInfo(episode.path).fileName());
            if (oldKey != target.key) {
                if (m_channelFilmPlaybackPositions.contains(oldKey))
                    m_channelFilmPlaybackPositions.insert(target.key, m_channelFilmPlaybackPositions.take(oldKey));
                if (m_channelFilmPlaybackDurations.contains(oldKey))
                    m_channelFilmPlaybackDurations.insert(target.key, m_channelFilmPlaybackDurations.take(oldKey));
                if (m_channelFilmPlaybackUpdatedUtcMs.contains(oldKey))
                    m_channelFilmPlaybackUpdatedUtcMs.insert(target.key, m_channelFilmPlaybackUpdatedUtcMs.take(oldKey));
                if (m_channelFilmDismissedKey == oldKey) m_channelFilmDismissedKey = target.key;
            }
            if (QFileInfo(episode.path).absoluteFilePath() == activePath) relocatedActive = target.path;
        }
    }
    return relocatedActive;
}
