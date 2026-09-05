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

void TvController::start()
{
    if (m_started || m_channels.isEmpty()) {
        return;
    }
    m_started = true;

    int index = findChannelByNumber(m_initialChannelNumber);
    if (index < 0) {
        index = adjacentEnabledChannel(-1, 1);
    }
    if (index < 0) {
        enterNoChannelsState();
        return;
    }
    requestTune(index, false);
}

void TvController::dispatch(Action action)
{
    dispatchAction(action, true);
}

void TvController::dispatchPortal(Action action)
{
    dispatchAction(action, false);
}

void TvController::dispatchAction(Action action, bool respectRemoteLock)
{
    if (respectRemoteLock && m_remoteLocked) {
        return;
    }
    if (m_parentAccessState != ParentClosed && action != ToggleStandby) {
        return;
    }

    if (action == ToggleStandby) {
        if (m_standby) {
            turnOn();
        } else {
            turnOff();
        }
        return;
    }

    if (m_standby) {
        return;
    }

    switch (action) {
    case ChannelUp:
        changeChannel(1);
        break;
    case ChannelDown:
        changeChannel(-1);
        break;
    case VolumeUp:
        setMuted(false);
        setVolume(m_volume + 5);
        emit volumeDisplayRequested(m_volume, m_muted);
        break;
    case VolumeDown:
        setMuted(false);
        setVolume(m_volume - 5);
        emit volumeDisplayRequested(m_volume, m_muted);
        break;
    case ToggleMute:
        setMuted(!m_muted);
        emit volumeDisplayRequested(m_volume, m_muted);
        break;
    case PreviousChannel: {
        const int index = findChannelByNumber(m_previousChannelNumber);
        if (index >= 0) {
            requestTune(index);
        }
        break;
    }
    case RandomEpisode:
        if (m_currentChannelIndex >= 0) {
            ChannelRuntime &runtime = m_channels[m_currentChannelIndex];
            freezeTimeline(runtime);
            markCurrentEpisodeLeft(runtime);
            runtime.currentEpisode = takeUsableEpisode(runtime);
            prepareCurrentEpisodeForVisit(runtime);
            runtime.anchorMilliseconds = m_broadcastClock.elapsed();
            runtime.anchorPositionSeconds = runtime.currentEpisode >= 0
                ? runtime.programmePositions[runtime.currentEpisode]
                : 0.0;
            requestTune(m_currentChannelIndex, false, false);
        }
        break;
    case PreviousProgramme:
        changeProgramme(-1);
        break;
    case NextProgramme:
        changeProgramme(1);
        break;
    case ToggleStandby:
        break;
    }
}

void TvController::toggleRemoteLock()
{
    m_remoteLocked = !m_remoteLocked;
    if (m_remoteLocked) {
        closeParent();
        m_numericTimer.stop();
        if (!m_numericEntry.isEmpty()) {
            m_numericEntry.clear();
            emit numericEntryChanged();
        }
    }
    emit remoteLockedChanged();
    saveState();
    qInfo() << (m_remoteLocked ? "Remote locked" : "Remote unlocked");
}

void TvController::resumeFromStandby()
{
    if (m_standby || !m_started || m_currentChannelIndex < 0) {
        return;
    }
    prepareCurrentEpisodeForVisit(m_channels[m_currentChannelIndex]);
    m_channels[m_currentChannelIndex].anchorMilliseconds = m_broadcastClock.elapsed();
    requestTune(m_currentChannelIndex, false, false);
}

void TvController::enterDigit(int digit)
{
    if (m_remoteLocked || m_standby || digit < 0 || digit > 9) {
        return;
    }

    if (m_numericEntry.size() >= 3) {
        m_numericEntry.clear();
    }
    m_numericEntry.append(QString::number(digit));
    emit numericEntryChanged();
    m_numericTimer.start();
}

void TvController::confirmNumericEntry()
{
    if (m_numericEntry.isEmpty()) {
        return;
    }
    m_numericTimer.stop();
    tuneNumericEntry();
}

void TvController::playbackEnded()
{
    if (m_standby || m_currentChannelIndex < 0) {
        return;
    }

    ChannelRuntime &runtime = m_channels[m_currentChannelIndex];
    freezeTimeline(runtime);
    markCurrentEpisodeLeft(runtime);
    runtime.currentEpisode = takeUsableEpisode(runtime);
    prepareCurrentEpisodeForVisit(runtime);
    runtime.anchorMilliseconds = m_broadcastClock.elapsed();
    runtime.anchorPositionSeconds = runtime.currentEpisode >= 0
        ? runtime.programmePositions[runtime.currentEpisode]
        : 0.0;
    requestTune(m_currentChannelIndex, false, false);
}

void TvController::updatePlaybackPosition(double positionSeconds, bool paused)
{
    if (m_currentChannelIndex < 0 || !std::isfinite(positionSeconds)) {
        return;
    }

    ChannelRuntime &runtime = m_channels[m_currentChannelIndex];
    runtime.anchorPositionSeconds = clampPlaybackPosition(
        runtime, runtime.currentEpisode, positionSeconds);
    runtime.anchorMilliseconds = m_broadcastClock.elapsed();
    if (runtime.currentEpisode >= 0
        && runtime.currentEpisode < runtime.programmePositions.size()) {
        runtime.programmePositions[runtime.currentEpisode] = runtime.anchorPositionSeconds;
        if (runtime.channel.contentType == QStringLiteral("films")) {
            const Episode &episode = runtime.channel.episodes[runtime.currentEpisode];
            const QString key = QStringLiteral("%1/%2")
                                    .arg(runtime.channel.number)
                                    .arg(QFileInfo(episode.path).fileName());
            m_channelFilmPlaybackPositions.insert(key, runtime.anchorPositionSeconds);
            if (episode.durationSeconds >= 10.0) {
                m_channelFilmPlaybackDurations.insert(key, episode.durationSeconds);
            }
            m_channelFilmPlaybackUpdatedUtcMs.insert(
                key, QDateTime::currentMSecsSinceEpoch());
        }
    }
    m_playbackPaused = paused;
    saveState();
}

void TvController::restartCurrentProgramme()
{
    restartCurrentProgrammeInternal(false);
}

void TvController::restartPortalProgramme()
{
    restartCurrentProgrammeInternal(true);
}

void TvController::restartCurrentProgrammeInternal(bool parentPortalAuthorized)
{
    if ((!parentPortalAuthorized && m_parentAccessState != ParentConfirmation) || m_standby
        || m_currentChannelIndex < 0) {
        return;
    }

    ChannelRuntime &runtime = m_channels[m_currentChannelIndex];
    if (!episodeIsUsable(runtime, runtime.currentEpisode)) {
        return;
    }
    runtime.programmePositions[runtime.currentEpisode] = 0.0;
    runtime.programmeLastLeftMilliseconds[runtime.currentEpisode] = -1;
    runtime.anchorPositionSeconds = 0.0;
    runtime.anchorMilliseconds = m_broadcastClock.elapsed();
    m_playbackPaused = false;
    requestTune(m_currentChannelIndex, false, false);
    qInfo() << (parentPortalAuthorized
                    ? "Current programme deliberately restarted from parent portal"
                    : "Current programme deliberately restarted from parent confirmation");
}

void TvController::playbackFailed(const QString &message)
{
    if (m_currentChannelIndex < 0) {
        return;
    }

    ChannelRuntime &runtime = m_channels[m_currentChannelIndex];
    qWarning().noquote() << "Playback failed on channel" << runtime.channel.number << ":" << message;
    if (runtime.currentEpisode >= 0) {
        markCurrentEpisodeLeft(runtime);
        runtime.failedEpisodes.insert(runtime.currentEpisode);
    }

    const int replacement = takeUsableEpisode(runtime);
    if (replacement < 0) {
        m_libraryStatus = QStringLiteral("Channel %1 playback failed: %2")
                              .arg(runtime.channel.number)
                              .arg(message);
        emit libraryStatusChanged();
        emit stopPlaybackRequested();
        setTuning(false);
        setNoSignal(true);
        saveState();
        return;
    }

    runtime.currentEpisode = replacement;
    prepareCurrentEpisodeForVisit(runtime);
    runtime.anchorMilliseconds = m_broadcastClock.elapsed();
    runtime.anchorPositionSeconds = runtime.programmePositions[replacement];
    requestTune(m_currentChannelIndex, false, false);
    saveState();
}

void TvController::prepareForPlaybackRestart(const QString &message)
{
    if (m_currentChannelIndex < 0) {
        return;
    }

    ChannelRuntime &runtime = m_channels[m_currentChannelIndex];
    qCritical().noquote() << "Advancing past stalled programme before restart on channel"
                          << runtime.channel.number << ":" << message;
    if (runtime.currentEpisode >= 0) {
        markCurrentEpisodeLeft(runtime);
    }
    // A frame/load watchdog detects a stuck decoder pipeline, not a proven bad
    // media file. Permanently quarantining the current episode here hid valid
    // programmes after Adult Mode hand-off and after global V4L2 failures.
    // Move on when possible, but reserve persistent quarantine for an explicit
    // libmpv playback error handled by playbackFailed().
    runtime.currentEpisode = adjacentUsableEpisode(runtime, 1);
    prepareCurrentEpisodeForVisit(runtime);
    runtime.anchorMilliseconds = m_broadcastClock.elapsed();
    runtime.anchorPositionSeconds = runtime.currentEpisode >= 0
        ? runtime.programmePositions[runtime.currentEpisode]
        : 0.0;
    saveState();
}

void TvController::requestParentAccess()
{
    requestParentAccessInternal(true);
}

void TvController::requestPortalParentAccess()
{
    requestParentAccessInternal(false);
}

void TvController::requestParentAccessInternal(bool respectRemoteLock)
{
    if ((respectRemoteLock && m_remoteLocked) || m_parentAccessState == ParentOpen) {
        return;
    }
    m_parentAccessState = ParentConfirmation;
    m_parentConfirmationCount = 0;
    setParentMessage(QStringLiteral("Press OK three times"));
    emit parentConfirmationCountChanged();
    emit parentAccessStateChanged();
    qInfo() << "Parent confirmation requested";
}

void TvController::parentConfirm()
{
    if (m_parentAccessState != ParentConfirmation) {
        return;
    }
    ++m_parentConfirmationCount;
    emit parentConfirmationCountChanged();
    if (m_parentConfirmationCount >= 3) {
        m_parentAccessState = ParentOpen;
        setParentMessage(QStringLiteral("Parent controls unlocked"));
        emit parentAccessStateChanged();
        qInfo() << "Parent controls unlocked";
        return;
    }
    const int remaining = 3 - m_parentConfirmationCount;
    setParentMessage(remaining == 1 ? QStringLiteral("Press OK once more")
                                    : QStringLiteral("Press OK two more times"));
}

void TvController::requestAdultModeShortcut()
{
    // Adult Mode deliberately has a short route from the first grown-up
    // screen. It remains unavailable during normal viewing: the shortcut is
    // only accepted while that initial parent-access screen is visible.
    if (m_parentAccessState != ParentConfirmation) {
        return;
    }
    qInfo() << "Adult mode requested from parent-access shortcut";
    saveState();
    closeParent();
    emit parentCommandRequested(QStringLiteral("adult"));
}

void TvController::closeParent()
{
    if (m_parentAccessState == ParentClosed) {
        return;
    }
    m_parentAccessState = ParentClosed;
    m_parentConfirmationCount = 0;
    setParentMessage(QString());
    emit parentConfirmationCountChanged();
    emit parentAccessStateChanged();
    qInfo() << "Parent controls closed";
}

void TvController::cyclePlaybackMode(int direction)
{
    const QString next = cycleValue({QStringLiteral("continuous"),
                                     QStringLiteral("resume")},
                                    m_playbackMode,
                                    direction);
    if (next == m_playbackMode) {
        return;
    }
    for (ChannelRuntime &runtime : m_channels) {
        freezeTimeline(runtime);
    }
    m_playbackMode = next;
    emit playbackModeChanged();
    saveSettings();
}

void TvController::cycleEpisodeResetMinutes(int direction)
{
    static const QVector<int> values{0, 5, 20, 60, 180};
    int index = values.indexOf(m_episodeResetMinutes);
    if (index < 0) {
        index = 0;
    }
    const int count = static_cast<int>(values.size());
    const int next = values[(index + (direction < 0 ? -1 : 1) + count) % count];
    if (next == m_episodeResetMinutes) {
        return;
    }
    m_episodeResetMinutes = next;
    emit episodeResetMinutesChanged();
    saveSettings();
}

void TvController::cyclePictureMode(int direction)
{
    m_pictureMode = cycleValue({QStringLiteral("channel"),
                                QStringLiteral("crop"),
                                QStringLiteral("fit"),
                                QStringLiteral("stretch")},
                               m_pictureMode,
                               direction);
    emit pictureModeChanged();
    emit channelChanged();
    saveSettings();
}

void TvController::cycleDisplayResolution(int direction)
{
    m_displayResolution = cycleValue({QStringLiteral("720p"),
                                      QStringLiteral("1080p"),
                                      QStringLiteral("native")},
                                     m_displayResolution,
                                     direction);
    emit displayResolutionChanged();
    saveSettings();
    setParentMessage(QStringLiteral("Display output applies after relaunch"));
}

void TvController::adjustCrtGlass(int direction)
{
    const int next = std::clamp(m_crtGlass + (direction < 0 ? -5 : 5), 0, 100);
    if (next == m_crtGlass) {
        return;
    }
    m_crtGlass = next;
    emit crtGlassChanged();
    saveSettings();
}

void TvController::cycleTvBorderStyle(int direction)
{
    m_tvBorderStyle = cycleValue({QStringLiteral("slim-black"),
                                  QStringLiteral("silver-90s"),
                                  QStringLiteral("charcoal-90s"),
                                  QStringLiteral("vintage-black")},
                                 m_tvBorderStyle,
                                 direction);
    emit tvBorderStyleChanged();
    saveSettings();
}

void TvController::adjustVideoDistortion(int direction)
{
    const int next = std::clamp(m_videoDistortion + (direction < 0 ? -5 : 5), 0, 100);
    if (next == m_videoDistortion) {
        return;
    }
    m_videoDistortion = next;
    emit videoDistortionChanged();
    saveSettings();
}

void TvController::toggleSoundEffects()
{
    m_soundEffectsEnabled = !m_soundEffectsEnabled;
    emit soundEffectsEnabledChanged();
    saveSettings();
}

void TvController::toggleScrubbing()
{
    m_scrubbingEnabled = !m_scrubbingEnabled;
    emit scrubbingEnabledChanged();
    saveSettings();
}

void TvController::toggleVolumeLimit()
{
    m_volumeLimitEnabled = !m_volumeLimitEnabled;
    if (m_volumeLimitEnabled) {
        setVolume(std::min(m_volume, m_maximumVolume));
    }
    emit volumePolicyChanged();
    saveSettings();
}

void TvController::adjustMaximumVolume(int direction)
{
    const int maximum = std::clamp(m_maximumVolume + (direction < 0 ? -5 : 5), 5, 100);
    if (maximum == m_maximumVolume) {
        return;
    }
    m_maximumVolume = maximum;
    if (m_volumeLimitEnabled) {
        setVolume(std::min(m_volume, m_maximumVolume));
    }
    emit volumePolicyChanged();
    saveSettings();
}

void TvController::reloadLibrary()
{
    reloadAdultLibrary();
    if (m_libraryReloadWatcher.isRunning()) {
        m_libraryReloadRequested = true;
        return;
    }
    setParentMessage(QStringLiteral("Checking channel library in the background"));
    const QString channelsPath = m_channelsPath;
    const QString mediaRoot = m_mediaRoot;
    const QString cachePath = QDir(QFileInfo(m_statePath).absolutePath())
                                  .filePath(QStringLiteral("media-index.json"));
    m_libraryReloadWatcher.setFuture(QtConcurrent::run(
        [channelsPath, mediaRoot, cachePath]() {
            MediaIndex mediaIndex(cachePath);
            ChannelLibraryResult library = ChannelLibrary::load(
                channelsPath,
                mediaRoot,
                [&mediaIndex](const QString &path) { return mediaIndex.inspect(path); });
            if (!mediaIndex.save()) {
                library.warnings.append(
                    QStringLiteral("Could not save the media validation cache: %1")
                        .arg(QDir::toNativeSeparators(cachePath)));
            }
            return library;
        }));
}

void TvController::reloadAdultLibrary()
{
    emit adultLibraryChanged();
}

void TvController::turnOn()
{
    turnOnMabelOnly();
    if (m_tvControl != nullptr) {
        m_tvControl->turnOn();
    }
}

void TvController::turnOnMabelOnly()
{
    if (m_standby) {
        setStandby(false);
        saveState();
    }
}

void TvController::turnOff()
{
    turnOffMabelOnly();
    if (m_tvControl != nullptr) {
        m_tvControl->turnOff();
    }
}

void TvController::turnOffMabelOnly()
{
    if (!m_standby) {
        if (m_currentChannelIndex >= 0) {
            freezeTimeline(m_channels[m_currentChannelIndex]);
            markCurrentEpisodeLeft(m_channels[m_currentChannelIndex]);
        }
        setStandby(true);
        m_playbackPaused = false;
        m_tuningTimer.stop();
        setTuning(false);
        emit stopPlaybackRequested();
        saveState();
    }
}

void TvController::setTvControl(CecTvControl *tvControl)
{
    m_tvControl = tvControl;
}
