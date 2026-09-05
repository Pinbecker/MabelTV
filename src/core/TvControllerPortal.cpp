#include "TvController.h"

#include "TvControllerFormatting.h"
#include "hardware/CecTvControl.h"

#include <QDateTime>
#include <QDir>
#include <QDirIterator>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>
#include <QSaveFile>
#include <QUuid>
#include <QtConcurrentRun>

#include <algorithm>
#include <cmath>
#include <utility>

using mabeltv::detail::cycleValue;
using mabeltv::detail::displayNameForEpisodePath;
using mabeltv::detail::EpisodeDisplay;
using mabeltv::detail::episodeDisplayForPath;

void TvController::playPortalProgramme(int channelNumber,
                                       const QString &fileName,
                                       double positionSeconds)
{
    // This is an explicit, parent-authenticated portal choice. It may start a
    // hidden programme, but it never accepts an arbitrary path: the filename
    // must already belong to one of the indexed channels.
    if (m_standby || fileName.isEmpty()) {
        return;
    }

    const int channelIndex = findChannelByNumber(channelNumber, true);
    if (channelIndex < 0) {
        return;
    }
    ChannelRuntime &target = m_channels[channelIndex];
    int episodeIndex = -1;
    for (int index = 0; index < target.channel.episodes.size(); ++index) {
        if (QFileInfo(target.channel.episodes[index].path).fileName() == fileName) {
            episodeIndex = index;
            break;
        }
    }
    if (episodeIndex < 0 || !QFileInfo(target.channel.episodes[episodeIndex].path).isFile()) {
        return;
    }

    const bool changingChannel = channelIndex != m_currentChannelIndex;
    if (changingChannel && m_currentChannelIndex >= 0) {
        if (m_playbackMode == QStringLiteral("resume")) {
            freezeTimeline(m_channels[m_currentChannelIndex]);
        }
        markCurrentEpisodeLeft(m_channels[m_currentChannelIndex]);
        m_previousChannelNumber = currentChannelNumber();
    }

    m_currentChannelIndex = channelIndex;
    target.currentEpisode = episodeIndex;
    target.anchorMilliseconds = m_broadcastClock.elapsed();
    const double startPosition = target.channel.contentType == QStringLiteral("films")
        ? clampPlaybackPosition(target, episodeIndex, positionSeconds)
        : 0.0;
    target.anchorPositionSeconds = startPosition;
    target.programmePositions[episodeIndex] = startPosition;
    m_playbackPaused = false;
    emit channelChanged();
    if (changingChannel) {
        emit channelDisplayRequested(currentChannelNumber(), currentChannelName());
    }
    emit stopPlaybackRequested();
    setNoSignal(false);
    setTuning(true);
    m_tuningTimer.start();
    saveState();
}

void TvController::setChannelFilmPlaybackState(int channelNumber,
                                               const QString &fileName,
                                               double positionSeconds,
                                               double durationSeconds)
{
    if (fileName.isEmpty() || !std::isfinite(positionSeconds)
        || !std::isfinite(durationSeconds)) {
        return;
    }
    const int channelIndex = findChannelByNumber(channelNumber, true);
    if (channelIndex < 0
        || m_channels[channelIndex].channel.contentType != QStringLiteral("films")) {
        return;
    }
    const ChannelRuntime &runtime = m_channels[channelIndex];
    const bool knownFilm = std::any_of(
        runtime.channel.episodes.cbegin(), runtime.channel.episodes.cend(),
        [&fileName](const Episode &episode) {
            return QFileInfo(episode.path).fileName() == fileName;
        });
    if (!knownFilm) {
        return;
    }

    const QString key = QStringLiteral("%1/%2").arg(channelNumber).arg(fileName);
    const double position = std::max(0.0, positionSeconds);
    if (position < 2.0) {
        m_channelFilmPlaybackPositions.remove(key);
    } else {
        m_channelFilmPlaybackPositions.insert(key, position);
    }
    if (durationSeconds >= 10.0) {
        m_channelFilmPlaybackDurations.insert(key, durationSeconds);
    }
    m_channelFilmPlaybackUpdatedUtcMs.insert(key, QDateTime::currentMSecsSinceEpoch());
    saveState();
}

double TvController::adultPlaybackPosition(const QString &libraryId) const
{
    return m_adultPlaybackPositions.value(libraryId, 0.0);
}

double TvController::adultPlaybackDuration(const QString &libraryId) const
{
    return m_adultPlaybackDurations.value(libraryId, 0.0);
}

double TvController::adultPlaybackProgress(const QString &libraryId) const
{
    const double duration = adultPlaybackDuration(libraryId);
    if (duration < 10.0) {
        return 0.0;
    }
    return std::clamp(adultPlaybackPosition(libraryId) / duration, 0.0, 1.0);
}

void TvController::setAdultPlaybackPosition(const QString &libraryId,
                                            double positionSeconds)
{
    const QString key = libraryId.trimmed();
    if (key.isEmpty() || !std::isfinite(positionSeconds)) {
        return;
    }
    const double position = std::max(0.0, positionSeconds);
    if (position < 2.0) {
        if (m_adultPlaybackPositions.remove(key) > 0) {
            m_adultPlaybackUpdatedUtcMs.remove(key);
            saveState();
            emit adultPlaybackStateChanged();
        }
        return;
    }
    if (std::abs(m_adultPlaybackPositions.value(key, -1.0) - position) < 0.5) {
        return;
    }
    m_adultPlaybackPositions.insert(key, position);
    m_adultPlaybackUpdatedUtcMs.insert(key, QDateTime::currentMSecsSinceEpoch());
    saveState();
    emit adultPlaybackStateChanged();
}

void TvController::setAdultPlaybackDuration(const QString &libraryId,
                                            double durationSeconds)
{
    const QString key = libraryId.trimmed();
    if (key.isEmpty() || !std::isfinite(durationSeconds) || durationSeconds < 10.0) {
        return;
    }
    const double duration = std::max(10.0, durationSeconds);
    if (std::abs(m_adultPlaybackDurations.value(key, -1.0) - duration) < 1.0) {
        return;
    }
    m_adultPlaybackDurations.insert(key, duration);
    saveState();
    emit adultPlaybackStateChanged();
}

void TvController::toggleChannelEnabled(int channelNumber)
{
    if (m_parentAccessState != ParentOpen) {
        return;
    }

    const int channelIndex = findChannelByNumber(channelNumber, true);
    if (channelIndex < 0) {
        return;
    }

    ChannelRuntime &runtime = m_channels[channelIndex];
    runtime.enabled = !runtime.enabled;
    if (runtime.enabled) {
        m_disabledChannelNumbers.remove(channelNumber);
    } else {
        m_disabledChannelNumbers.insert(channelNumber);
    }
    saveSettings();
    updateLibraryStatus();
    emit parentLibraryChanged();

    setParentMessage(QStringLiteral("Channel %1 %2")
                         .arg(channelNumber)
                         .arg(runtime.enabled ? QStringLiteral("enabled")
                                              : QStringLiteral("disabled")));

    if (!runtime.enabled && m_currentChannelIndex == channelIndex) {
        const int next = adjacentEnabledChannel(channelIndex, 1);
        if (next >= 0) {
            requestTune(next, false);
        } else {
            enterNoChannelsState();
        }
    } else if (runtime.enabled && m_currentChannelIndex < 0 && m_started) {
        requestTune(channelIndex, false);
    }
}

void TvController::toggleProgrammeEnabled(int channelNumber, const QString &fileName)
{
    if (m_parentAccessState != ParentOpen || fileName.isEmpty()) {
        return;
    }

    const int channelIndex = findChannelByNumber(channelNumber, true);
    if (channelIndex < 0) {
        return;
    }

    ChannelRuntime &runtime = m_channels[channelIndex];
    int episodeIndex = -1;
    for (int index = 0; index < runtime.channel.episodes.size(); ++index) {
        if (QFileInfo(runtime.channel.episodes[index].path).fileName() == fileName) {
            episodeIndex = index;
            break;
        }
    }
    if (episodeIndex < 0) {
        return;
    }

    const bool enabling = runtime.disabledEpisodes.remove(episodeIndex);
    QSet<QString> &disabledNames = m_disabledProgrammeNames[channelNumber];
    if (enabling) {
        disabledNames.remove(fileName);
    } else {
        runtime.disabledEpisodes.insert(episodeIndex);
        disabledNames.insert(fileName);
    }
    if (disabledNames.isEmpty()) {
        m_disabledProgrammeNames.remove(channelNumber);
    }
    saveSettings();
    emit parentLibraryChanged();
    setParentMessage(QStringLiteral("%1 %2")
                         .arg(QFileInfo(fileName).completeBaseName())
                         .arg(enabling ? QStringLiteral("enabled")
                                       : QStringLiteral("disabled")));

    if (runtime.enabled && m_currentChannelIndex == channelIndex) {
        if ((!enabling && runtime.currentEpisode == episodeIndex) || m_noSignal) {
            if (!enabling && runtime.currentEpisode == episodeIndex) {
                freezeTimeline(runtime);
                markCurrentEpisodeLeft(runtime);
            }
            runtime.currentEpisode = enabling ? episodeIndex : takeUsableEpisode(runtime);
            prepareCurrentEpisodeForVisit(runtime);
            runtime.anchorMilliseconds = m_broadcastClock.elapsed();
            runtime.anchorPositionSeconds = runtime.currentEpisode >= 0
                ? runtime.programmePositions[runtime.currentEpisode]
                : 0.0;
            requestTune(channelIndex, false, false);
        }
    }
}

void TvController::requestParentCommand(const QString &command)
{
    if (m_parentAccessState != ParentOpen) {
        return;
    }
    if (command == QStringLiteral("adult") || command == QStringLiteral("exit")
        || command == QStringLiteral("restart") || command == QStringLiteral("shutdown")) {
        qInfo().noquote() << "Parent command requested:" << command;
        saveState();
        emit parentCommandRequested(command);
    }
}
