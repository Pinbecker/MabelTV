#include "TvController.h"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>

#include <algorithm>
#include <cmath>
#include <utility>

namespace
{
QString cycleValue(const QStringList &values, const QString &current, int direction)
{
    int index = values.indexOf(current);
    if (index < 0) {
        index = 0;
    }
    const int count = static_cast<int>(values.size());
    index = (index + (direction < 0 ? -1 : 1) + count) % count;
    return values[index];
}
} // namespace

TvController::TvController(QObject *parent)
    : QObject(parent)
{
    m_tuningTimer.setSingleShot(true);
    m_tuningTimer.setInterval(450);
    connect(&m_tuningTimer, &QTimer::timeout, this, &TvController::finishTune);

    m_numericTimer.setSingleShot(true);
    m_numericTimer.setInterval(1200);
    connect(&m_numericTimer, &QTimer::timeout, this, &TvController::tuneNumericEntry);
}

TvController::~TvController()
{
    saveState();
}

bool TvController::initialize(const QString &channelsPath,
                              const QString &settingsPath,
                              const QString &mediaRoot,
                              const QString &statePath,
                              ChannelLibrary::MediaInspector mediaInspector)
{
    m_tuningTimer.stop();
    m_numericTimer.stop();
    m_channels.clear();
    m_currentChannelIndex = -1;
    m_initialChannelNumber = -1;
    m_started = false;
    m_noSignal = false;

    m_channelsPath = QFileInfo(channelsPath).absoluteFilePath();
    m_settingsPath = QFileInfo(settingsPath).absoluteFilePath();
    m_mediaRoot = QFileInfo(mediaRoot).absoluteFilePath();
    m_statePath = QFileInfo(statePath).absoluteFilePath();
    loadSettings(m_settingsPath);

    ChannelLibraryResult library;
    if (mediaInspector) {
        library = ChannelLibrary::load(m_channelsPath, m_mediaRoot, std::move(mediaInspector));
    } else {
        const QString cachePath = QDir(QFileInfo(m_statePath).absolutePath())
                                      .filePath(QStringLiteral("media-index.json"));
        MediaIndex mediaIndex(cachePath);
        library = ChannelLibrary::load(m_channelsPath, m_mediaRoot, [&mediaIndex](const QString &path) {
            return mediaIndex.inspect(path);
        });
        if (!mediaIndex.save()) {
            library.warnings.append(QStringLiteral("Could not save the media validation cache: %1")
                                        .arg(QDir::toNativeSeparators(cachePath)));
        }
    }
    if (!library.isValid()) {
        m_libraryStatus = library.error;
        qCritical().noquote() << library.error;
        emit libraryStatusChanged();
        setNoSignal(true);
        return false;
    }

    const quint32 baseSeed = static_cast<quint32>(QDateTime::currentMSecsSinceEpoch());
    m_channels.reserve(library.channels.size());
    for (Channel &channel : library.channels) {
        const quint32 seed = baseSeed ^ (static_cast<quint32>(channel.number) * 2654435761U);
        m_channels.emplaceBack(std::move(channel), seed);
    }

    m_libraryStatus = library.warnings.isEmpty()
                          ? QStringLiteral("%1 channels ready").arg(m_channels.size())
                          : library.warnings.join(QLatin1Char('\n'));
    emit libraryStatusChanged();
    qInfo() << m_channels.size() << "channels loaded";
    for (const QString &warning : library.warnings) {
        qWarning().noquote() << warning;
    }

    m_broadcastClock.start();
    loadState();
    return true;
}

int TvController::currentChannelNumber() const
{
    return m_currentChannelIndex >= 0 ? m_channels[m_currentChannelIndex].channel.number : -1;
}

QString TvController::currentChannelName() const
{
    return m_currentChannelIndex >= 0 ? m_channels[m_currentChannelIndex].channel.name : QString();
}

QString TvController::currentAspectMode() const
{
    if (m_pictureMode != QStringLiteral("channel")) {
        return m_pictureMode;
    }
    return m_currentChannelIndex >= 0 ? m_channels[m_currentChannelIndex].channel.aspectMode
                                      : QStringLiteral("crop");
}

int TvController::volume() const
{
    return m_volume;
}

int TvController::maximumVolume() const
{
    return m_volumeLimitEnabled ? m_maximumVolume : 100;
}

int TvController::configuredMaximumVolume() const
{
    return m_maximumVolume;
}

bool TvController::volumeLimitEnabled() const
{
    return m_volumeLimitEnabled;
}

bool TvController::muted() const
{
    return m_muted;
}

bool TvController::tuning() const
{
    return m_tuning;
}

bool TvController::noSignal() const
{
    return m_noSignal;
}

bool TvController::standby() const
{
    return m_standby;
}

QString TvController::numericEntry() const
{
    return m_numericEntry;
}

QString TvController::libraryStatus() const
{
    return m_libraryStatus;
}

int TvController::parentAccessState() const
{
    return m_parentAccessState;
}

int TvController::parentConfirmationCount() const
{
    return m_parentConfirmationCount;
}

QString TvController::parentMessage() const
{
    return m_parentMessage;
}

QString TvController::playbackMode() const
{
    return m_playbackMode;
}

QString TvController::pictureMode() const
{
    return m_pictureMode;
}

QString TvController::displayResolution() const
{
    return m_displayResolution;
}

QString TvController::crtEffectLevel() const
{
    return m_crtEffectLevel;
}

bool TvController::soundEffectsEnabled() const
{
    return m_soundEffectsEnabled;
}

void TvController::start()
{
    if (m_started || m_channels.isEmpty()) {
        return;
    }
    m_started = true;

    int index = findChannelByNumber(m_initialChannelNumber);
    if (index < 0) {
        index = 0;
    }
    requestTune(index, false);
}

void TvController::dispatch(Action action)
{
    if (m_parentAccessState != ParentClosed && action != ToggleStandby) {
        return;
    }

    if (action == ToggleStandby) {
        setStandby(!m_standby);
        if (m_standby) {
            m_tuningTimer.stop();
            setTuning(false);
            emit stopPlaybackRequested();
        } else if (m_currentChannelIndex >= 0) {
            requestTune(m_currentChannelIndex, false);
        }
        saveState();
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
            if (m_playbackMode != QStringLiteral("restart")) {
                runtime.currentEpisode = takeUsableEpisode(runtime);
                runtime.anchorMilliseconds = m_broadcastClock.elapsed();
                runtime.anchorPositionSeconds = 0.0;
            }
            requestTune(m_currentChannelIndex, false);
        }
        break;
    case ToggleStandby:
        break;
    }
}

void TvController::enterDigit(int digit)
{
    if (m_standby || digit < 0 || digit > 9) {
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
    if (m_playbackMode != QStringLiteral("restart")) {
        runtime.currentEpisode = takeUsableEpisode(runtime);
        runtime.anchorMilliseconds = m_broadcastClock.elapsed();
        runtime.anchorPositionSeconds = 0.0;
    }
    requestTune(m_currentChannelIndex, false);
}

void TvController::playbackFailed(const QString &message)
{
    if (m_currentChannelIndex < 0) {
        return;
    }

    ChannelRuntime &runtime = m_channels[m_currentChannelIndex];
    qWarning().noquote() << "Playback failed on channel" << runtime.channel.number << ":" << message;
    if (runtime.currentEpisode >= 0) {
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
        return;
    }

    runtime.currentEpisode = replacement;
    runtime.anchorMilliseconds = m_broadcastClock.elapsed();
    runtime.anchorPositionSeconds = 0.0;
    requestTune(m_currentChannelIndex, false);
}

void TvController::requestParentAccess()
{
    if (m_parentAccessState == ParentOpen) {
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
                                     QStringLiteral("resume"),
                                     QStringLiteral("restart")},
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

void TvController::cycleCrtEffectLevel(int direction)
{
    m_crtEffectLevel = cycleValue({QStringLiteral("off"),
                                   QStringLiteral("low"),
                                   QStringLiteral("high")},
                                  m_crtEffectLevel,
                                  direction);
    emit crtEffectLevelChanged();
    saveSettings();
}

void TvController::toggleSoundEffects()
{
    m_soundEffectsEnabled = !m_soundEffectsEnabled;
    emit soundEffectsEnabledChanged();
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
    emit stopPlaybackRequested();
    saveState();
    const bool loaded = initialize(m_channelsPath, m_settingsPath, m_mediaRoot, m_statePath);
    setParentMessage(loaded ? QStringLiteral("Channel library reloaded") : m_libraryStatus);
    if (loaded) {
        start();
    }
}

void TvController::requestParentCommand(const QString &command)
{
    if (m_parentAccessState != ParentOpen) {
        return;
    }
    if (command == QStringLiteral("exit") || command == QStringLiteral("restart")
        || command == QStringLiteral("shutdown")) {
        qInfo().noquote() << "Parent command requested:" << command;
        saveState();
        emit parentCommandRequested(command);
    }
}

void TvController::requestSafeShutdown()
{
    qInfo() << "Safe shutdown requested by long power-button hold";
    saveState();
    emit parentCommandRequested(QStringLiteral("shutdown"));
}

void TvController::loadSettings(const QString &settingsPath)
{
    m_settingsRoot = QJsonObject{};
    QFile settings(settingsPath);
    if (!settings.open(QIODevice::ReadOnly)) {
        return;
    }

    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(settings.readAll(), &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()) {
        return;
    }

    m_settingsRoot = document.object();
    const QJsonObject volumeSettings = m_settingsRoot.value(QStringLiteral("volume")).toObject();
    m_volume = std::clamp(volumeSettings.value(QStringLiteral("initial")).toInt(20), 0, 100);
    m_maximumVolume = std::clamp(volumeSettings.value(QStringLiteral("maximum")).toInt(60), 0, 100);
    m_volumeLimitEnabled = volumeSettings.value(QStringLiteral("limit_enabled")).toBool(true);
    m_volume = std::min(m_volume, maximumVolume());

    const QString playbackMode = m_settingsRoot.value(QStringLiteral("playback_mode"))
                                     .toString(QStringLiteral("continuous"));
    m_playbackMode = playbackMode == QStringLiteral("resume")
            || playbackMode == QStringLiteral("restart")
        ? playbackMode
        : QStringLiteral("continuous");

    const QString pictureMode = m_settingsRoot.value(QStringLiteral("picture_mode"))
                                    .toString(QStringLiteral("channel"));
    m_pictureMode = pictureMode == QStringLiteral("crop") || pictureMode == QStringLiteral("fit")
            || pictureMode == QStringLiteral("stretch")
        ? pictureMode
        : QStringLiteral("channel");

    const QString resolution = m_settingsRoot.value(QStringLiteral("display_resolution"))
                                   .toString(QStringLiteral("720p"));
    m_displayResolution = resolution == QStringLiteral("1080p")
            || resolution == QStringLiteral("native")
        ? resolution
        : QStringLiteral("720p");

    const QString effectLevel = m_settingsRoot.value(QStringLiteral("crt_effect"))
                                    .toString(QStringLiteral("low"));
    m_crtEffectLevel = effectLevel == QStringLiteral("off") || effectLevel == QStringLiteral("high")
        ? effectLevel
        : QStringLiteral("low");
    m_soundEffectsEnabled = m_settingsRoot.value(QStringLiteral("sound_effects_enabled")).toBool(true);
}

void TvController::saveSettings()
{
    if (m_settingsPath.isEmpty()) {
        return;
    }

    m_settingsRoot.insert(QStringLiteral("schema_version"), 1);
    m_settingsRoot.insert(QStringLiteral("playback_mode"), m_playbackMode);
    m_settingsRoot.insert(QStringLiteral("picture_mode"), m_pictureMode);
    m_settingsRoot.insert(QStringLiteral("display_resolution"), m_displayResolution);
    m_settingsRoot.insert(QStringLiteral("crt_effect"), m_crtEffectLevel);
    m_settingsRoot.insert(QStringLiteral("sound_effects_enabled"), m_soundEffectsEnabled);
    m_settingsRoot.remove(QStringLiteral("parent_pin"));
    m_settingsRoot.insert(
        QStringLiteral("volume"),
        QJsonObject{{QStringLiteral("initial"), m_volume},
                    {QStringLiteral("maximum"), m_maximumVolume},
                    {QStringLiteral("limit_enabled"), m_volumeLimitEnabled}});

    QDir().mkpath(QFileInfo(m_settingsPath).absolutePath());
    QSaveFile settings(m_settingsPath);
    if (!settings.open(QIODevice::WriteOnly)) {
        setParentMessage(QStringLiteral("Could not save settings"));
        qWarning().noquote() << "Could not open settings for writing:" << m_settingsPath
                             << "-" << settings.errorString();
        return;
    }
    const QByteArray contents = QJsonDocument(m_settingsRoot).toJson(QJsonDocument::Indented);
    if (settings.write(contents) != contents.size()) {
        setParentMessage(QStringLiteral("Could not save settings"));
        qWarning().noquote() << "Could not write settings:" << m_settingsPath << "-"
                             << settings.errorString();
        settings.cancelWriting();
        return;
    }
    if (!settings.commit()) {
        setParentMessage(QStringLiteral("Could not save settings"));
        qWarning().noquote() << "Could not commit settings:" << m_settingsPath << "-"
                             << settings.errorString();
        return;
    }
    setParentMessage(QStringLiteral("Settings saved"));
}

void TvController::loadState()
{
    QJsonObject object;
    QFile state(m_statePath);
    if (state.open(QIODevice::ReadOnly)) {
        QJsonParseError error;
        const QJsonDocument document = QJsonDocument::fromJson(state.readAll(), &error);
        if (error.error == QJsonParseError::NoError && document.isObject()) {
            object = document.object();
        }
    }

    m_initialChannelNumber = object.value(QStringLiteral("current_channel")).toInt(-1);
    m_previousChannelNumber = object.value(QStringLiteral("previous_channel")).toInt(-1);
    m_volume = std::clamp(object.value(QStringLiteral("volume")).toInt(m_volume), 0, maximumVolume());
    m_muted = object.value(QStringLiteral("muted")).toBool(false);

    const qint64 savedAt = static_cast<qint64>(
        object.value(QStringLiteral("saved_at_utc_ms")).toDouble(0.0));
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    const double offlineSeconds = savedAt > 0 && m_playbackMode == QStringLiteral("continuous")
        ? std::max(0.0, (now - savedAt) / 1000.0)
        : 0.0;
    const QJsonObject timelines = object.value(QStringLiteral("channel_timelines")).toObject();

    for (ChannelRuntime &runtime : m_channels) {
        const QJsonObject timeline = timelines.value(QString::number(runtime.channel.number)).toObject();
        int episodeIndex = -1;
        const QString savedEpisodeName = timeline.value(QStringLiteral("episode_name")).toString();
        if (!savedEpisodeName.isEmpty()) {
            for (int index = 0; index < runtime.channel.episodes.size(); ++index) {
                if (QFileInfo(runtime.channel.episodes[index].path).fileName() == savedEpisodeName) {
                    episodeIndex = index;
                    break;
                }
            }
        }
        if (episodeIndex < 0) {
            episodeIndex = timeline.value(QStringLiteral("episode_index")).toInt(-1);
        }

        if (episodeIndex >= 0 && episodeIndex < runtime.channel.episodes.size()) {
            runtime.currentEpisode = episodeIndex;
            for (int attempt = 0; attempt < runtime.channel.episodes.size(); ++attempt) {
                if (runtime.shuffle.take() == episodeIndex) {
                    break;
                }
            }
            runtime.anchorPositionSeconds = std::max(
                0.0, timeline.value(QStringLiteral("position_seconds")).toDouble(0.0) + offlineSeconds);
            runtime.anchorMilliseconds = m_broadcastClock.elapsed();
        } else {
            seedTimeline(runtime);
        }
    }
}

void TvController::saveState() const
{
    if (m_statePath.isEmpty()) {
        return;
    }

    QDir().mkpath(QFileInfo(m_statePath).absolutePath());
    QSaveFile state(m_statePath);
    if (!state.open(QIODevice::WriteOnly)) {
        return;
    }

    QJsonObject object{
        {QStringLiteral("schema_version"), 1},
        {QStringLiteral("saved_at_utc_ms"),
         static_cast<double>(QDateTime::currentMSecsSinceEpoch())},
        {QStringLiteral("current_channel"), currentChannelNumber()},
        {QStringLiteral("previous_channel"), m_previousChannelNumber},
        {QStringLiteral("volume"), m_volume},
        {QStringLiteral("muted"), m_muted},
    };

    QJsonObject timelines;
    const qint64 elapsedNow = m_broadcastClock.isValid() ? m_broadcastClock.elapsed() : 0;
    for (const ChannelRuntime &runtime : m_channels) {
        if (runtime.currentEpisode < 0 || runtime.currentEpisode >= runtime.channel.episodes.size()) {
            continue;
        }

        const double position = runtime.anchorPositionSeconds
            + std::max<qint64>(0, elapsedNow - runtime.anchorMilliseconds) / 1000.0;
        const Episode &episode = runtime.channel.episodes[runtime.currentEpisode];
        timelines.insert(
            QString::number(runtime.channel.number),
            QJsonObject{{QStringLiteral("episode_index"), runtime.currentEpisode},
                        {QStringLiteral("episode_name"), QFileInfo(episode.path).fileName()},
                        {QStringLiteral("position_seconds"), position}});
    }
    object.insert(QStringLiteral("channel_timelines"), timelines);
    state.write(QJsonDocument(object).toJson(QJsonDocument::Indented));
    state.commit();
}

void TvController::requestTune(int channelIndex, bool updatePreviousChannel)
{
    if (channelIndex < 0 || channelIndex >= m_channels.size()) {
        return;
    }

    if (m_playbackMode == QStringLiteral("resume") && m_currentChannelIndex >= 0) {
        freezeTimeline(m_channels[m_currentChannelIndex]);
    }

    if (updatePreviousChannel && m_currentChannelIndex >= 0 && channelIndex != m_currentChannelIndex) {
        m_previousChannelNumber = currentChannelNumber();
    }

    m_currentChannelIndex = channelIndex;
    ChannelRuntime &targetRuntime = m_channels[m_currentChannelIndex];
    if (m_playbackMode == QStringLiteral("restart")) {
        targetRuntime.currentEpisode = takeUsableEpisode(targetRuntime);
        targetRuntime.anchorPositionSeconds = 0.0;
        targetRuntime.anchorMilliseconds = m_broadcastClock.elapsed();
    } else if (m_playbackMode == QStringLiteral("resume")) {
        targetRuntime.anchorMilliseconds = m_broadcastClock.elapsed();
    }
    qInfo().noquote() << "Tuning channel" << currentChannelNumber() << "-" << currentChannelName();
    emit channelChanged();
    emit channelDisplayRequested(currentChannelNumber(), currentChannelName());
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
    if (runtime.channel.episodes.isEmpty()) {
        setTuning(false);
        setNoSignal(true);
        return;
    }

    const double startPosition = resolveBroadcastPosition(runtime);
    if (runtime.currentEpisode < 0 || runtime.currentEpisode >= runtime.channel.episodes.size()) {
        setTuning(false);
        setNoSignal(true);
        return;
    }

    const Episode &episode = runtime.channel.episodes[runtime.currentEpisode];
    setTuning(false);
    emit playbackRequested(QUrl::fromLocalFile(episode.path), startPosition);
}

void TvController::changeChannel(int direction)
{
    if (m_channels.isEmpty()) {
        return;
    }

    int next = m_currentChannelIndex;
    if (next < 0) {
        next = 0;
    } else {
        next = (next + direction + m_channels.size()) % m_channels.size();
    }
    requestTune(next);
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
    runtime.anchorPositionSeconds = 0.0;

    double totalDuration = 0.0;
    for (const Episode &episode : runtime.channel.episodes) {
        totalDuration += std::max(0.0, episode.durationSeconds);
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
    runtime.anchorPositionSeconds += std::max<qint64>(0, now - runtime.anchorMilliseconds) / 1000.0;
    runtime.anchorMilliseconds = now;
}

void TvController::setParentMessage(const QString &message)
{
    if (m_parentMessage == message) {
        return;
    }
    m_parentMessage = message;
    emit parentMessageChanged();
}

int TvController::findChannelByNumber(int channelNumber) const
{
    for (int index = 0; index < m_channels.size(); ++index) {
        if (m_channels[index].channel.number == channelNumber) {
            return index;
        }
    }
    return -1;
}

int TvController::takeUsableEpisode(ChannelRuntime &runtime)
{
    const int episodeCount = static_cast<int>(runtime.channel.episodes.size());
    for (int attempt = 0; attempt < episodeCount; ++attempt) {
        const int candidate = runtime.shuffle.take();
        if (!runtime.failedEpisodes.contains(candidate)) {
            return candidate;
        }
    }
    return -1;
}

double TvController::resolveBroadcastPosition(ChannelRuntime &runtime)
{
    const qint64 now = m_broadcastClock.elapsed();
    if (runtime.currentEpisode < 0 || runtime.failedEpisodes.contains(runtime.currentEpisode)) {
        runtime.currentEpisode = takeUsableEpisode(runtime);
        runtime.anchorMilliseconds = now;
        runtime.anchorPositionSeconds = 0.0;
    }

    if (runtime.currentEpisode < 0) {
        return 0.0;
    }

    double position = runtime.anchorPositionSeconds
                      + static_cast<double>(now - runtime.anchorMilliseconds) / 1000.0;
    const int episodeCount = static_cast<int>(runtime.channel.episodes.size());

    double usableRoundDuration = 0.0;
    for (int index = 0; index < episodeCount; ++index) {
        if (!runtime.failedEpisodes.contains(index)) {
            usableRoundDuration += std::max(0.0, runtime.channel.episodes[index].durationSeconds);
        }
    }

    // A television can remain away from a channel for months. Collapse complete
    // shuffle rounds before walking the remaining episodes so the calculated
    // seek is always inside a real file without a potentially huge startup loop.
    if (usableRoundDuration > 0.0 && position >= usableRoundDuration * 2.0) {
        position = std::fmod(position, usableRoundDuration);
        runtime.currentEpisode = takeUsableEpisode(runtime);
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
        runtime.currentEpisode = takeUsableEpisode(runtime);
        if (runtime.currentEpisode < 0) {
            position = 0.0;
            break;
        }
    }

    runtime.anchorMilliseconds = now;
    runtime.anchorPositionSeconds = position;
    return std::max(0.0, position);
}
