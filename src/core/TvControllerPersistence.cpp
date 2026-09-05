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

void TvController::loadSettings(const QString &settingsPath, bool preserveRuntimeVolume)
{
    m_settingsRoot = QJsonObject{};
    m_disabledChannelNumbers.clear();
    m_disabledProgrammeNames.clear();
    QFile settings(settingsPath);
    if (!settings.open(QIODevice::ReadOnly)) {
        return;
    }

    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(settings.readAll(), &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()) {
        return;
    }

    const int previousVolume = m_volume;
    const int previousMaximumVolume = m_maximumVolume;
    const bool previousVolumeLimitEnabled = m_volumeLimitEnabled;
    const QString previousPlaybackMode = m_playbackMode;
    const int previousEpisodeResetMinutes = m_episodeResetMinutes;
    const QString previousPictureMode = m_pictureMode;
    const QString previousDisplayResolution = m_displayResolution;
    const int previousCrtGlass = m_crtGlass;
    const QString previousTvBorderStyle = m_tvBorderStyle;
    const int previousVideoDistortion = m_videoDistortion;
    const bool previousSoundEffectsEnabled = m_soundEffectsEnabled;
    const bool previousScrubbingEnabled = m_scrubbingEnabled;

    m_settingsRoot = document.object();
    const QString parentOverlayStyle =
        m_settingsRoot.value(QStringLiteral("parent_overlay_style"))
            .toString(QStringLiteral("classic"));
    const QString validatedParentOverlayStyle = parentOverlayStyle == QStringLiteral("modern")
        ? QStringLiteral("modern")
        : QStringLiteral("classic");
    if (validatedParentOverlayStyle != m_parentOverlayStyle) {
        m_parentOverlayStyle = validatedParentOverlayStyle;
        emit parentOverlayStyleChanged();
    }
    const bool tvGuideEnabled =
        m_settingsRoot.value(QStringLiteral("tv_guide_enabled")).toBool(false);
    if (tvGuideEnabled != m_tvGuideEnabled) {
        m_tvGuideEnabled = tvGuideEnabled;
        emit tvGuideEnabledChanged();
    }
    const QJsonObject volumeSettings = m_settingsRoot.value(QStringLiteral("volume")).toObject();
    const int configuredInitialVolume = std::clamp(
        volumeSettings.value(QStringLiteral("initial")).toInt(20), 0, 100);
    m_maximumVolume = std::clamp(volumeSettings.value(QStringLiteral("maximum")).toInt(60), 0, 100);
    m_volumeLimitEnabled = volumeSettings.value(QStringLiteral("limit_enabled")).toBool(true);
    m_volume = preserveRuntimeVolume ? previousVolume : configuredInitialVolume;
    m_volume = std::min(m_volume, maximumVolume());

    const QString playbackMode = m_settingsRoot.value(QStringLiteral("playback_mode"))
                                     .toString(QStringLiteral("continuous"));
    // Older releases exposed a restart-on-return mode. It is intentionally
    // migrated to resume so an existing Pi can never silently rewind a film.
    m_playbackMode = playbackMode == QStringLiteral("resume")
            || playbackMode == QStringLiteral("restart")
        ? QStringLiteral("resume")
        : QStringLiteral("continuous");

    const int episodeResetMinutes =
        m_settingsRoot.value(QStringLiteral("episode_reset_minutes")).toInt(0);
    m_episodeResetMinutes = QVector<int>{0, 5, 20, 60, 180}.contains(episodeResetMinutes)
        ? episodeResetMinutes
        : 0;

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

    if (m_settingsRoot.contains(QStringLiteral("crt_glass"))) {
        m_crtGlass = std::clamp(
            m_settingsRoot.value(QStringLiteral("crt_glass")).toInt(35), 0, 100);
    } else {
        const QString legacyEffect = m_settingsRoot.value(QStringLiteral("crt_effect"))
                                         .toString(QStringLiteral("low"));
        m_crtGlass = legacyEffect == QStringLiteral("off")
            ? 0
            : (legacyEffect == QStringLiteral("high") ? 75 : 35);
    }
    const QString borderStyle = m_settingsRoot.value(QStringLiteral("tv_border"))
                                    .toString(QStringLiteral("slim-black"));
    // Migrate the three early colour-only cabinets to their more convincing
    // reference-inspired replacements. Slim Black intentionally stays exact.
    if (borderStyle == QStringLiteral("cream")) {
        m_tvBorderStyle = QStringLiteral("silver-90s");
    } else if (borderStyle == QStringLiteral("charcoal")) {
        m_tvBorderStyle = QStringLiteral("charcoal-90s");
    } else if (borderStyle == QStringLiteral("walnut")) {
        m_tvBorderStyle = QStringLiteral("vintage-black");
    } else if (borderStyle == QStringLiteral("silver-90s")
               || borderStyle == QStringLiteral("charcoal-90s")
               || borderStyle == QStringLiteral("vintage-black")) {
        m_tvBorderStyle = borderStyle;
    } else {
        m_tvBorderStyle = QStringLiteral("slim-black");
    }
    m_videoDistortion = std::clamp(
        m_settingsRoot.value(QStringLiteral("video_distortion")).toInt(20), 0, 100);
    m_soundEffectsEnabled = m_settingsRoot.value(QStringLiteral("sound_effects_enabled")).toBool(true);
    m_scrubbingEnabled = m_settingsRoot.value(QStringLiteral("scrubbing_enabled")).toBool(false);

    // A portal save asks the running player to reload this file. These values
    // were previously assigned silently, leaving QML bound to the old CRT and
    // cabinet properties until a full player restart. Notify every changed
    // runtime setting so the on-screen TV updates immediately.
    if (m_volume != previousVolume) {
        emit volumeChanged();
    }
    if (m_maximumVolume != previousMaximumVolume
            || m_volumeLimitEnabled != previousVolumeLimitEnabled) {
        emit volumePolicyChanged();
    }
    if (m_playbackMode != previousPlaybackMode) {
        emit playbackModeChanged();
    }
    if (m_episodeResetMinutes != previousEpisodeResetMinutes) {
        emit episodeResetMinutesChanged();
    }
    if (m_pictureMode != previousPictureMode) {
        emit pictureModeChanged();
    }
    if (m_displayResolution != previousDisplayResolution) {
        emit displayResolutionChanged();
    }
    if (m_crtGlass != previousCrtGlass) {
        emit crtGlassChanged();
    }
    if (m_tvBorderStyle != previousTvBorderStyle) {
        emit tvBorderStyleChanged();
    }
    if (m_videoDistortion != previousVideoDistortion) {
        emit videoDistortionChanged();
    }
    if (m_soundEffectsEnabled != previousSoundEffectsEnabled) {
        emit soundEffectsEnabledChanged();
    }
    if (m_scrubbingEnabled != previousScrubbingEnabled) {
        emit scrubbingEnabledChanged();
    }

    const QJsonObject librarySettings = m_settingsRoot.value(QStringLiteral("library")).toObject();
    const QJsonArray disabledChannels = librarySettings.value(QStringLiteral("disabled_channels"))
                                            .toArray();
    for (const QJsonValue &value : disabledChannels) {
        if (value.isDouble()) {
            m_disabledChannelNumbers.insert(value.toInt());
        }
    }
    const QJsonObject disabledProgrammes =
        librarySettings.value(QStringLiteral("disabled_programmes")).toObject();
    for (auto iterator = disabledProgrammes.constBegin();
         iterator != disabledProgrammes.constEnd();
         ++iterator) {
        bool validChannel = false;
        const int channelNumber = iterator.key().toInt(&validChannel);
        if (!validChannel || !iterator.value().isArray()) {
            continue;
        }
        QSet<QString> names;
        for (const QJsonValue &value : iterator.value().toArray()) {
            const QString fileName = QFileInfo(value.toString()).fileName();
            if (!fileName.isEmpty()) {
                names.insert(fileName);
            }
        }
        if (!names.isEmpty()) {
            m_disabledProgrammeNames.insert(channelNumber, names);
        }
    }
}

void TvController::saveSettings()
{
    if (m_settingsPath.isEmpty()) {
        return;
    }

    m_settingsRoot.insert(QStringLiteral("schema_version"), 1);
    m_settingsRoot.insert(QStringLiteral("parent_overlay_style"), m_parentOverlayStyle);
    m_settingsRoot.insert(QStringLiteral("tv_guide_enabled"), m_tvGuideEnabled);
    m_settingsRoot.insert(QStringLiteral("playback_mode"), m_playbackMode);
    m_settingsRoot.insert(QStringLiteral("episode_reset_minutes"), m_episodeResetMinutes);
    m_settingsRoot.insert(QStringLiteral("picture_mode"), m_pictureMode);
    m_settingsRoot.insert(QStringLiteral("display_resolution"), m_displayResolution);
    m_settingsRoot.insert(QStringLiteral("crt_glass"), m_crtGlass);
    m_settingsRoot.remove(QStringLiteral("crt_effect"));
    m_settingsRoot.insert(QStringLiteral("tv_border"), m_tvBorderStyle);
    m_settingsRoot.insert(QStringLiteral("video_distortion"), m_videoDistortion);
    m_settingsRoot.insert(QStringLiteral("sound_effects_enabled"), m_soundEffectsEnabled);
    m_settingsRoot.insert(QStringLiteral("scrubbing_enabled"), m_scrubbingEnabled);
    m_settingsRoot.remove(QStringLiteral("parent_pin"));
    m_settingsRoot.insert(
        QStringLiteral("volume"),
        QJsonObject{{QStringLiteral("initial"), m_volume},
                    {QStringLiteral("maximum"), m_maximumVolume},
                    {QStringLiteral("limit_enabled"), m_volumeLimitEnabled}});

    QList<int> disabledChannels = m_disabledChannelNumbers.values();
    std::sort(disabledChannels.begin(), disabledChannels.end());
    QJsonArray disabledChannelValues;
    for (const int channelNumber : disabledChannels) {
        disabledChannelValues.append(channelNumber);
    }

    QList<int> programmeChannels = m_disabledProgrammeNames.keys();
    std::sort(programmeChannels.begin(), programmeChannels.end());
    QJsonObject disabledProgrammes;
    for (const int channelNumber : programmeChannels) {
        QStringList names = m_disabledProgrammeNames.value(channelNumber).values();
        names.sort(Qt::CaseInsensitive);
        QJsonArray nameValues;
        for (const QString &name : names) {
            nameValues.append(name);
        }
        disabledProgrammes.insert(QString::number(channelNumber), nameValues);
    }
    m_settingsRoot.insert(
        QStringLiteral("library"),
        QJsonObject{{QStringLiteral("disabled_channels"), disabledChannelValues},
                    {QStringLiteral("disabled_programmes"), disabledProgrammes}});

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
    const bool remoteWasLocked = m_remoteLocked;
    m_remoteLocked = object.value(QStringLiteral("remote_locked")).toBool(false);
    if (remoteWasLocked != m_remoteLocked) {
        emit remoteLockedChanged();
    }

    const qint64 savedAt = static_cast<qint64>(
        object.value(QStringLiteral("saved_at_utc_ms")).toDouble(0.0));
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    const double offlineSeconds = savedAt > 0 && m_playbackMode == QStringLiteral("continuous")
        ? std::max(0.0, (now - savedAt) / 1000.0)
        : 0.0;
    const bool sameUptimeSession =
        object.value(QStringLiteral("uptime_session_id")).toString() == m_sessionId;
    const int stateSchemaVersion = object.value(QStringLiteral("schema_version")).toInt(0);
    const QJsonObject adultPositions = object.value(QStringLiteral("adult_positions")).toObject();
    m_adultPlaybackPositions.clear();
    for (auto iterator = adultPositions.constBegin(); iterator != adultPositions.constEnd();
         ++iterator) {
        const double position = iterator.value().toDouble(0.0);
        if (!iterator.key().isEmpty() && std::isfinite(position) && position >= 2.0) {
            m_adultPlaybackPositions.insert(iterator.key(), position);
        }
    }
    const QJsonObject adultPositionUpdates =
        object.value(QStringLiteral("adult_position_updated_utc_ms")).toObject();
    m_adultPlaybackUpdatedUtcMs.clear();
    for (auto iterator = adultPositionUpdates.constBegin();
         iterator != adultPositionUpdates.constEnd(); ++iterator) {
        const qint64 updated = static_cast<qint64>(iterator.value().toDouble(0.0));
        if (m_adultPlaybackPositions.contains(iterator.key()) && updated > 0) {
            m_adultPlaybackUpdatedUtcMs.insert(iterator.key(), updated);
        }
    }
    const QJsonObject adultDurations = object.value(QStringLiteral("adult_durations")).toObject();
    m_adultPlaybackDurations.clear();
    for (auto iterator = adultDurations.constBegin(); iterator != adultDurations.constEnd();
         ++iterator) {
        const double duration = iterator.value().toDouble(0.0);
        if (!iterator.key().isEmpty() && std::isfinite(duration) && duration >= 10.0) {
            m_adultPlaybackDurations.insert(iterator.key(), duration);
        }
    }
    const QJsonObject channelFilmPositions =
        object.value(QStringLiteral("channel_film_positions")).toObject();
    m_channelFilmPlaybackPositions.clear();
    for (auto iterator = channelFilmPositions.constBegin();
         iterator != channelFilmPositions.constEnd(); ++iterator) {
        const double position = iterator.value().toDouble(0.0);
        if (!iterator.key().isEmpty() && std::isfinite(position) && position >= 2.0) {
            m_channelFilmPlaybackPositions.insert(iterator.key(), position);
        }
    }
    const QJsonObject channelFilmDurations =
        object.value(QStringLiteral("channel_film_durations")).toObject();
    m_channelFilmPlaybackDurations.clear();
    for (auto iterator = channelFilmDurations.constBegin();
         iterator != channelFilmDurations.constEnd(); ++iterator) {
        const double duration = iterator.value().toDouble(0.0);
        if (!iterator.key().isEmpty() && std::isfinite(duration) && duration >= 10.0) {
            m_channelFilmPlaybackDurations.insert(iterator.key(), duration);
        }
    }
    const QJsonObject channelFilmUpdates =
        object.value(QStringLiteral("channel_film_position_updated_utc_ms")).toObject();
    m_channelFilmPlaybackUpdatedUtcMs.clear();
    for (auto iterator = channelFilmUpdates.constBegin();
         iterator != channelFilmUpdates.constEnd(); ++iterator) {
        const qint64 updated = static_cast<qint64>(iterator.value().toDouble(0.0));
        if (updated > 0) {
            m_channelFilmPlaybackUpdatedUtcMs.insert(iterator.key(), updated);
        }
    }
    const QJsonObject timelines = object.value(QStringLiteral("channel_timelines")).toObject();

    for (ChannelRuntime &runtime : m_channels) {
        const QJsonObject timeline = timelines.value(QString::number(runtime.channel.number)).toObject();
        // Schema 2 could not distinguish a corrupt file from a global player
        // watchdog failure. Do not carry those false quarantines forward.
        if (stateSchemaVersion >= 3) {
            const QJsonObject failedProgrammes =
                timeline.value(QStringLiteral("failed_programmes")).toObject();
            for (int index = 0; index < runtime.channel.episodes.size(); ++index) {
                const QFileInfo episodeFile(runtime.channel.episodes[index].path);
                const qint64 failedModified = static_cast<qint64>(
                    failedProgrammes.value(episodeFile.fileName()).toDouble(-1.0));
                if (failedModified >= 0
                    && failedModified == episodeFile.lastModified().toMSecsSinceEpoch()) {
                    runtime.failedEpisodes.insert(index);
                }
            }
        }
        const QJsonObject savedProgrammePositions =
            timeline.value(QStringLiteral("programme_positions")).toObject();
        for (int index = 0; index < runtime.channel.episodes.size(); ++index) {
            const QString episodeName = QFileInfo(runtime.channel.episodes[index].path).fileName();
            runtime.programmePositions[index] = sanitiseStoredPosition(
                runtime, index, savedProgrammePositions.value(episodeName).toDouble(0.0));
        }
        if (sameUptimeSession) {
            const QJsonObject savedLastLeft =
                timeline.value(QStringLiteral("programme_last_left_uptime_ms")).toObject();
            for (int index = 0; index < runtime.channel.episodes.size(); ++index) {
                const QString episodeName =
                    QFileInfo(runtime.channel.episodes[index].path).fileName();
                runtime.programmeLastLeftMilliseconds[index] = static_cast<qint64>(
                    savedLastLeft.value(episodeName).toDouble(-1.0));
            }
        }
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

        if (episodeIsUsable(runtime, episodeIndex)) {
            runtime.currentEpisode = episodeIndex;
            for (int attempt = 0; attempt < runtime.channel.episodes.size(); ++attempt) {
                if (runtime.shuffle.take() == episodeIndex) {
                    break;
                }
            }
            const double savedPosition = timeline.contains(QStringLiteral("position_seconds"))
                ? timeline.value(QStringLiteral("position_seconds")).toDouble(0.0)
                : runtime.programmePositions[episodeIndex];
            runtime.anchorPositionSeconds = sanitiseStoredPosition(
                runtime, episodeIndex, savedPosition + offlineSeconds);
            runtime.programmePositions[episodeIndex] = runtime.anchorPositionSeconds;
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
        {QStringLiteral("schema_version"), 4},
        {QStringLiteral("uptime_session_id"), m_sessionId},
        {QStringLiteral("saved_at_utc_ms"),
         static_cast<double>(QDateTime::currentMSecsSinceEpoch())},
        {QStringLiteral("current_channel"), currentChannelNumber()},
        {QStringLiteral("previous_channel"), m_previousChannelNumber},
        {QStringLiteral("volume"), m_volume},
        {QStringLiteral("muted"), m_muted},
        {QStringLiteral("remote_locked"), m_remoteLocked},
        {QStringLiteral("standby"), m_standby},
        {QStringLiteral("playback_paused"), m_playbackPaused},
    };

    QJsonObject adultPositions;
    for (auto iterator = m_adultPlaybackPositions.constBegin();
         iterator != m_adultPlaybackPositions.constEnd(); ++iterator) {
        adultPositions.insert(iterator.key(), iterator.value());
    }
    object.insert(QStringLiteral("adult_positions"), adultPositions);

    QJsonObject adultPositionUpdates;
    for (auto iterator = m_adultPlaybackUpdatedUtcMs.constBegin();
         iterator != m_adultPlaybackUpdatedUtcMs.constEnd(); ++iterator) {
        adultPositionUpdates.insert(iterator.key(), static_cast<double>(iterator.value()));
    }
    object.insert(QStringLiteral("adult_position_updated_utc_ms"), adultPositionUpdates);

    QJsonObject adultDurations;
    for (auto iterator = m_adultPlaybackDurations.constBegin();
         iterator != m_adultPlaybackDurations.constEnd(); ++iterator) {
        adultDurations.insert(iterator.key(), iterator.value());
    }
    object.insert(QStringLiteral("adult_durations"), adultDurations);

    QJsonObject channelFilmPositions;
    for (auto iterator = m_channelFilmPlaybackPositions.constBegin();
         iterator != m_channelFilmPlaybackPositions.constEnd(); ++iterator) {
        channelFilmPositions.insert(iterator.key(), iterator.value());
    }
    object.insert(QStringLiteral("channel_film_positions"), channelFilmPositions);

    QJsonObject channelFilmDurations;
    for (auto iterator = m_channelFilmPlaybackDurations.constBegin();
         iterator != m_channelFilmPlaybackDurations.constEnd(); ++iterator) {
        channelFilmDurations.insert(iterator.key(), iterator.value());
    }
    object.insert(QStringLiteral("channel_film_durations"), channelFilmDurations);

    QJsonObject channelFilmUpdates;
    for (auto iterator = m_channelFilmPlaybackUpdatedUtcMs.constBegin();
         iterator != m_channelFilmPlaybackUpdatedUtcMs.constEnd(); ++iterator) {
        channelFilmUpdates.insert(iterator.key(), static_cast<double>(iterator.value()));
    }
    object.insert(QStringLiteral("channel_film_position_updated_utc_ms"),
                  channelFilmUpdates);

    QJsonObject timelines;
    const qint64 elapsedNow = m_broadcastClock.isValid() ? m_broadcastClock.elapsed() : 0;
    for (const ChannelRuntime &runtime : m_channels) {
        const bool hasCurrent = runtime.currentEpisode >= 0
            && runtime.currentEpisode < runtime.channel.episodes.size();
        const bool isCurrent = m_currentChannelIndex >= 0
            && &runtime == &m_channels[m_currentChannelIndex];
        const bool advances = m_playbackMode == QStringLiteral("continuous")
            || (isCurrent && !m_playbackPaused);
        const double position = hasCurrent
            ? runtime.anchorPositionSeconds
                + (advances
                       ? std::max<qint64>(0, elapsedNow - runtime.anchorMilliseconds) / 1000.0
                       : 0.0)
            : 0.0;
        QJsonObject programmePositions;
        for (int index = 0; index < runtime.channel.episodes.size(); ++index) {
            double savedPosition = runtime.programmePositions[index];
            if (hasCurrent && index == runtime.currentEpisode) {
                savedPosition = position;
            }
            if (savedPosition > 0.05) {
                programmePositions.insert(
                    QFileInfo(runtime.channel.episodes[index].path).fileName(),
                    savedPosition);
            }
        }
        QJsonObject failedProgrammes;
        for (int index : runtime.failedEpisodes) {
            if (index < 0 || index >= runtime.channel.episodes.size()) {
                continue;
            }
            const QFileInfo episodeFile(runtime.channel.episodes[index].path);
            failedProgrammes.insert(
                episodeFile.fileName(),
                static_cast<double>(episodeFile.lastModified().toMSecsSinceEpoch()));
        }
        QJsonObject programmeLastLeft;
        for (int index = 0; index < runtime.channel.episodes.size(); ++index) {
            const qint64 lastLeft = runtime.programmeLastLeftMilliseconds.value(index, -1);
            if (lastLeft >= 0) {
                programmeLastLeft.insert(
                    QFileInfo(runtime.channel.episodes[index].path).fileName(),
                    static_cast<double>(lastLeft));
            }
        }
        QJsonObject timeline{
            {QStringLiteral("episode_index"), runtime.currentEpisode},
            {QStringLiteral("programme_positions"), programmePositions},
            {QStringLiteral("programme_last_left_uptime_ms"), programmeLastLeft},
            {QStringLiteral("failed_programmes"), failedProgrammes},
        };
        if (hasCurrent) {
            const Episode &episode = runtime.channel.episodes[runtime.currentEpisode];
            timeline.insert(QStringLiteral("episode_name"), QFileInfo(episode.path).fileName());
            timeline.insert(QStringLiteral("position_seconds"), position);
        }
        timelines.insert(QString::number(runtime.channel.number), timeline);
    }
    object.insert(QStringLiteral("channel_timelines"), timelines);
    state.write(QJsonDocument(object).toJson(QJsonDocument::Indented));
    state.commit();
}
