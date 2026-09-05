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

void TvController::requestTune(int channelIndex,
                               bool updatePreviousChannel,
                               bool preserveCurrentPosition)
{
    if (channelIndex < 0 || channelIndex >= m_channels.size()
        || !m_channels[channelIndex].enabled) {
        return;
    }

    const bool changingChannel = channelIndex != m_currentChannelIndex;

    if (changingChannel && m_currentChannelIndex >= 0) {
        if (preserveCurrentPosition && m_playbackMode == QStringLiteral("resume")) {
            freezeTimeline(m_channels[m_currentChannelIndex]);
        }
        markCurrentEpisodeLeft(m_channels[m_currentChannelIndex]);
    }

    if (updatePreviousChannel && m_currentChannelIndex >= 0 && channelIndex != m_currentChannelIndex) {
        m_previousChannelNumber = currentChannelNumber();
    }

    m_currentChannelIndex = channelIndex;
    ChannelRuntime &targetRuntime = m_channels[m_currentChannelIndex];
    if (changingChannel) {
        prepareCurrentEpisodeForVisit(targetRuntime);
    }
    if (m_playbackMode == QStringLiteral("resume")) {
        targetRuntime.anchorMilliseconds = m_broadcastClock.elapsed();
    }
    m_playbackPaused = false;
    qInfo().noquote() << "Tuning channel" << currentChannelNumber() << "-" << currentChannelName();
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

void TvController::finishTune()
{
    if (m_currentChannelIndex < 0 || m_standby) {
        setTuning(false);
        return;
    }

    ChannelRuntime &runtime = m_channels[m_currentChannelIndex];
    if (runtime.channel.episodes.isEmpty() || !runtime.enabled) {
        setTuning(false);
        setNoSignal(true);
        return;
    }

    // Tuning/static time is not watched content in Resume mode. Start the
    // programme from the exact saved frame rather than adding the tune delay.
    if (m_playbackMode == QStringLiteral("resume")) {
        runtime.anchorMilliseconds = m_broadcastClock.elapsed();
    }
    const double startPosition = resolveBroadcastPosition(runtime);
    if (!episodeIsUsable(runtime, runtime.currentEpisode)) {
        setTuning(false);
        setNoSignal(true);
        return;
    }

    const Episode &episode = runtime.channel.episodes[runtime.currentEpisode];
    // Reassert the successful tune state. This also clears a late no-signal
    // result left by the channel we just departed.
    setNoSignal(false);
    setTuning(false);
    emit programmeDisplayRequested(programmeDisplayName(runtime));
    emit playbackRequested(QUrl::fromLocalFile(episode.path), startPosition);
}

void TvController::changeChannel(int direction)
{
    if (m_channels.isEmpty() || direction == 0) {
        return;
    }

    const int next = adjacentEnabledChannel(m_currentChannelIndex, direction);
    if (next >= 0) {
        requestTune(next);
    }
}

void TvController::changeProgramme(int direction)
{
    if (m_currentChannelIndex < 0 || direction == 0) {
        return;
    }

    ChannelRuntime &runtime = m_channels[m_currentChannelIndex];
    freezeTimeline(runtime);
    markCurrentEpisodeLeft(runtime);
    const int nextEpisode = adjacentUsableEpisode(runtime, direction);
    if (nextEpisode < 0) {
        return;
    }

    runtime.currentEpisode = nextEpisode;
    prepareCurrentEpisodeForVisit(runtime);
    runtime.anchorMilliseconds = m_broadcastClock.elapsed();
    runtime.anchorPositionSeconds = runtime.programmePositions[nextEpisode];
    requestTune(m_currentChannelIndex, false, false);
}

QString TvController::programmeDisplayName(const ChannelRuntime &runtime) const
{
    if (!episodeIsUsable(runtime, runtime.currentEpisode)) {
        return {};
    }

    return displayNameForEpisodePath(runtime.channel.episodes[runtime.currentEpisode].path);
}

double TvController::sanitiseStoredPosition(const ChannelRuntime &runtime,
                                            int episodeIndex,
                                            double positionSeconds) const
{
    if (!std::isfinite(positionSeconds) || positionSeconds <= 0.0) {
        return 0.0;
    }
    if (!episodeIsUsable(runtime, episodeIndex)) {
        return std::max(0.0, positionSeconds);
    }

    const double duration = runtime.channel.episodes[episodeIndex].durationSeconds;
    // A resume position at or past the end cannot belong to this programme.
    // Reset it rather than allowing it to spill into a different file.
    if (duration > 0.0 && positionSeconds >= duration) {
        return 0.0;
    }
    return positionSeconds;
}

double TvController::clampPlaybackPosition(const ChannelRuntime &runtime,
                                           int episodeIndex,
                                           double positionSeconds) const
{
    if (!std::isfinite(positionSeconds) || positionSeconds <= 0.0) {
        return 0.0;
    }
    if (!episodeIsUsable(runtime, episodeIndex)) {
        return std::max(0.0, positionSeconds);
    }

    const double duration = runtime.channel.episodes[episodeIndex].durationSeconds;
    if (duration <= 0.0) {
        return positionSeconds;
    }
    return std::min(positionSeconds, std::max(0.0, duration - 0.05));
}

void TvController::setVolume(int value)
{
    value = std::clamp(value, 0, maximumVolume());
    if (m_volume == value) {
        return;
    }
    m_volume = value;
    emit volumeChanged();
    saveState();
}

void TvController::setMuted(bool muted)
{
    if (m_muted == muted) {
        return;
    }
    m_muted = muted;
    emit mutedChanged();
    saveState();
}

void TvController::setTuning(bool tuning)
{
    if (m_tuning == tuning) {
        return;
    }
    m_tuning = tuning;
    emit tuningChanged();
}

void TvController::setNoSignal(bool noSignal)
{
    if (m_noSignal == noSignal) {
        return;
    }
    m_noSignal = noSignal;
    emit noSignalChanged();
}

void TvController::setStandby(bool standby)
{
    if (m_standby == standby) {
        return;
    }
    m_standby = standby;
    emit standbyChanged();
}

void TvController::tuneNumericEntry()
{
    const int requestedChannel = m_numericEntry.toInt();
    m_numericEntry.clear();
    emit numericEntryChanged();

    const int index = findChannelByNumber(requestedChannel);
    if (index >= 0) {
        requestTune(index);
    }
}

void TvController::seedTimeline(ChannelRuntime &runtime)
{
    runtime.currentEpisode = takeUsableEpisode(runtime);
    runtime.anchorMilliseconds = m_broadcastClock.elapsed();
    runtime.anchorPositionSeconds = runtime.currentEpisode >= 0
        ? runtime.programmePositions[runtime.currentEpisode]
        : 0.0;

    double totalDuration = 0.0;
    for (int index = 0; index < runtime.channel.episodes.size(); ++index) {
        if (!runtime.disabledEpisodes.contains(index)) {
            totalDuration += std::max(0.0,
                                      runtime.channel.episodes[index].durationSeconds);
        }
    }
    if (totalDuration > 0.0 && m_playbackMode == QStringLiteral("continuous")) {
        const double channelOffset = static_cast<double>(runtime.channel.number) * 977.0;
        runtime.anchorPositionSeconds = std::fmod(
            static_cast<double>(QDateTime::currentSecsSinceEpoch()) + channelOffset, totalDuration);
    }
}

void TvController::freezeTimeline(ChannelRuntime &runtime)
{
    const qint64 now = m_broadcastClock.elapsed();
    const bool isPausedCurrent = m_playbackPaused && m_currentChannelIndex >= 0
        && &runtime == &m_channels[m_currentChannelIndex];
    if (!isPausedCurrent) {
        runtime.anchorPositionSeconds +=
            std::max<qint64>(0, now - runtime.anchorMilliseconds) / 1000.0;
    }
    runtime.anchorMilliseconds = now;
    if (runtime.currentEpisode >= 0
        && runtime.currentEpisode < runtime.programmePositions.size()) {
        runtime.programmePositions[runtime.currentEpisode] =
            std::max(0.0, runtime.anchorPositionSeconds);
    }
}

qint64 TvController::episodeUptimeMilliseconds() const
{
    if (m_episodeUptimeClock) {
        return std::max<qint64>(0, m_episodeUptimeClock());
    }
    return m_processUptimeClock.isValid()
        ? std::max<qint64>(0, m_processUptimeClock.elapsed())
        : 0;
}

void TvController::markCurrentEpisodeLeft(ChannelRuntime &runtime)
{
    if (!episodeIsUsable(runtime, runtime.currentEpisode)) {
        return;
    }
    runtime.programmeLastLeftMilliseconds[runtime.currentEpisode] =
        episodeUptimeMilliseconds();
}

void TvController::prepareCurrentEpisodeForVisit(ChannelRuntime &runtime)
{
    if (!episodeIsUsable(runtime, runtime.currentEpisode)) {
        return;
    }

    const int episodeIndex = runtime.currentEpisode;
    const qint64 lastLeft = runtime.programmeLastLeftMilliseconds.value(episodeIndex, -1);
    const qint64 timeoutMilliseconds = static_cast<qint64>(m_episodeResetMinutes) * 60 * 1000;
    if (m_playbackMode == QStringLiteral("resume")
        && runtime.channel.contentType != QStringLiteral("films")
        && timeoutMilliseconds > 0 && lastLeft >= 0
        && episodeUptimeMilliseconds() - lastLeft >= timeoutMilliseconds) {
        runtime.programmePositions[episodeIndex] = 0.0;
        runtime.anchorPositionSeconds = 0.0;
        qInfo().noquote() << "Restarting an unvisited episode on channel"
                          << runtime.channel.number << "after"
                          << m_episodeResetMinutes << "minutes";
    }
    // While an episode is on screen it is being visited. The inactivity clock
    // starts again only when the viewer leaves it.
    runtime.programmeLastLeftMilliseconds[episodeIndex] = -1;
}

void TvController::setParentMessage(const QString &message)
{
    if (m_parentMessage == message) {
        return;
    }
    m_parentMessage = message;
    emit parentMessageChanged();
}

void TvController::updateLibraryStatus()
{
    int enabledChannels = 0;
    for (const ChannelRuntime &runtime : m_channels) {
        enabledChannels += runtime.enabled ? 1 : 0;
    }

    QStringList status{
        QStringLiteral("%1 of %2 channels enabled").arg(enabledChannels).arg(m_channels.size())};
    status.append(m_libraryWarnings);
    const QString nextStatus = status.join(QLatin1Char('\n'));
    if (nextStatus == m_libraryStatus) {
        return;
    }
    m_libraryStatus = nextStatus;
    emit libraryStatusChanged();
}

void TvController::enterNoChannelsState()
{
    m_tuningTimer.stop();
    emit stopPlaybackRequested();
    if (m_currentChannelIndex >= 0 && m_currentChannelIndex < m_channels.size()) {
        freezeTimeline(m_channels[m_currentChannelIndex]);
        markCurrentEpisodeLeft(m_channels[m_currentChannelIndex]);
    }
    m_currentChannelIndex = -1;
    emit channelChanged();
    setTuning(false);
    setNoSignal(true);
    saveState();
}

int TvController::findChannelByNumber(int channelNumber, bool includeDisabled) const
{
    for (int index = 0; index < m_channels.size(); ++index) {
        if (m_channels[index].channel.number == channelNumber
            && (includeDisabled || m_channels[index].enabled)) {
            return index;
        }
    }
    return -1;
}

int TvController::adjacentEnabledChannel(int channelIndex, int direction) const
{
    const int channelCount = static_cast<int>(m_channels.size());
    if (channelCount == 0 || direction == 0) {
        return -1;
    }

    const int step = direction < 0 ? -1 : 1;
    int candidate = channelIndex;
    for (int attempt = 0; attempt < channelCount; ++attempt) {
        if (candidate < 0 || candidate >= channelCount) {
            candidate = step > 0 ? 0 : channelCount - 1;
        } else {
            candidate = (candidate + step + channelCount) % channelCount;
        }
        if (m_channels[candidate].enabled) {
            return candidate;
        }
    }
    return -1;
}

bool TvController::episodeIsUsable(const ChannelRuntime &runtime, int episodeIndex) const
{
    return episodeIndex >= 0 && episodeIndex < runtime.channel.episodes.size()
        && !runtime.failedEpisodes.contains(episodeIndex)
        && !runtime.disabledEpisodes.contains(episodeIndex);
}

int TvController::nextUsableEpisode(const ChannelRuntime &runtime, int episodeIndex) const
{
    const int episodeCount = static_cast<int>(runtime.channel.episodes.size());
    if (episodeCount == 0) {
        return -1;
    }
    int candidate = episodeIndex;
    for (int attempt = 0; attempt < episodeCount; ++attempt) {
        candidate = (candidate + 1 + episodeCount) % episodeCount;
        if (episodeIsUsable(runtime, candidate)) {
            return candidate;
        }
    }
    return -1;
}

int TvController::takeUsableEpisode(ChannelRuntime &runtime)
{
    if (m_tvGuideEnabled) {
        return nextUsableEpisode(runtime, runtime.currentEpisode);
    }
    const int episodeCount = static_cast<int>(runtime.channel.episodes.size());
    for (int attempt = 0; attempt < episodeCount; ++attempt) {
        const int candidate = runtime.shuffle.take();
        if (episodeIsUsable(runtime, candidate)) {
            return candidate;
        }
    }
    return -1;
}

int TvController::adjacentUsableEpisode(const ChannelRuntime &runtime, int direction) const
{
    const int episodeCount = static_cast<int>(runtime.channel.episodes.size());
    if (episodeCount == 0 || direction == 0) {
        return -1;
    }

    const int step = direction < 0 ? -1 : 1;
    int candidate = runtime.currentEpisode;
    if (candidate < 0 || candidate >= episodeCount) {
        candidate = step > 0 ? episodeCount - 1 : 0;
    }

    for (int attempt = 0; attempt < episodeCount; ++attempt) {
        candidate = (candidate + step + episodeCount) % episodeCount;
        if (episodeIsUsable(runtime, candidate)) {
            return candidate;
        }
    }
    return -1;
}

double TvController::resolveBroadcastPosition(ChannelRuntime &runtime)
{
    const qint64 now = m_broadcastClock.elapsed();
    if (!episodeIsUsable(runtime, runtime.currentEpisode)) {
        runtime.currentEpisode = takeUsableEpisode(runtime);
        prepareCurrentEpisodeForVisit(runtime);
        runtime.anchorMilliseconds = now;
        runtime.anchorPositionSeconds = runtime.currentEpisode >= 0
            ? runtime.programmePositions[runtime.currentEpisode]
            : 0.0;
    }

    if (runtime.currentEpisode < 0) {
        return 0.0;
    }

    // Resume mode is programme-based, not a continuous broadcast. A selected
    // film or episode must never be advanced into another file by stale state.
    if (m_playbackMode == QStringLiteral("resume")) {
        const double position = sanitiseStoredPosition(
            runtime, runtime.currentEpisode, runtime.anchorPositionSeconds);
        runtime.anchorMilliseconds = now;
        runtime.anchorPositionSeconds = position;
        runtime.programmePositions[runtime.currentEpisode] = position;
        return position;
    }

    double position = runtime.anchorPositionSeconds
                      + static_cast<double>(now - runtime.anchorMilliseconds) / 1000.0;
    const int episodeCount = static_cast<int>(runtime.channel.episodes.size());

    double usableRoundDuration = 0.0;
    for (int index = 0; index < episodeCount; ++index) {
        if (episodeIsUsable(runtime, index)) {
            usableRoundDuration += std::max(0.0, runtime.channel.episodes[index].durationSeconds);
        }
    }

    // A television can remain away from a channel for months. Collapse complete
    // shuffle rounds before walking the remaining episodes so the calculated
    // seek is always inside a real file without a potentially huge startup loop.
    if (usableRoundDuration > 0.0 && position >= usableRoundDuration * 2.0) {
        position = std::fmod(position, usableRoundDuration);
        markCurrentEpisodeLeft(runtime);
        runtime.currentEpisode = takeUsableEpisode(runtime);
        prepareCurrentEpisodeForVisit(runtime);
    }

    int safety = std::max(1, episodeCount * 2);
    while (safety-- > 0) {
        const double duration = runtime.channel.episodes[runtime.currentEpisode].durationSeconds;
        if (duration <= 0.0) {
            position = 0.0;
            break;
        }
        if (position < duration) {
            break;
        }

        position -= duration;
        markCurrentEpisodeLeft(runtime);
        runtime.currentEpisode = takeUsableEpisode(runtime);
        if (runtime.currentEpisode < 0) {
            position = 0.0;
            break;
        }
        prepareCurrentEpisodeForVisit(runtime);
    }

    runtime.anchorMilliseconds = now;
    runtime.anchorPositionSeconds = position;
    if (runtime.currentEpisode >= 0
        && runtime.currentEpisode < runtime.programmePositions.size()) {
        runtime.programmePositions[runtime.currentEpisode] = position;
    }
    return std::max(0.0, position);
}
