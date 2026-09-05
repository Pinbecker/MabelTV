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

TvController::TvController(QObject *parent)
    : QObject(parent)
{
    m_sessionId = QUuid::createUuid().toString(QUuid::WithoutBraces);
    m_processUptimeClock.start();
    m_tuningTimer.setSingleShot(true);
    m_tuningTimer.setInterval(450);
    connect(&m_tuningTimer, &QTimer::timeout, this, &TvController::finishTune);

    m_numericTimer.setSingleShot(true);
    m_numericTimer.setInterval(1200);
    connect(&m_numericTimer, &QTimer::timeout, this, &TvController::tuneNumericEntry);

    connect(&m_libraryReloadWatcher,
            &QFutureWatcher<ChannelLibraryResult>::finished,
            this,
            [this]() {
                if (m_libraryReloadRequested) {
                    // A newer filesystem event arrived while this snapshot was
                    // being built. Never interrupt playback to apply stale
                    // paths; discard it and immediately scan the newest state.
                    m_libraryReloadRequested = false;
                    QTimer::singleShot(0, this, &TvController::reloadLibrary);
                    return;
                }
                ChannelLibraryResult library = m_libraryReloadWatcher.result();
                if (!library.isValid()) {
                    m_libraryStatus = library.error;
                    emit libraryStatusChanged();
                    setParentMessage(QStringLiteral("Library check failed; continuing with the previous channels"));
                    qCritical().noquote() << library.error;
                    if (m_libraryReloadRequested) {
                        m_libraryReloadRequested = false;
                        QTimer::singleShot(0, this, &TvController::reloadLibrary);
                    }
                    return;
                }
                const bool wasStarted = m_started;
                const bool wasPaused = m_playbackPaused;
                QString activeProgrammePath;
                if (m_currentChannelIndex >= 0 && m_currentChannelIndex < m_channels.size()) {
                    const ChannelRuntime &active = m_channels[m_currentChannelIndex];
                    if (active.currentEpisode >= 0
                        && active.currentEpisode < active.channel.episodes.size()) {
                        activeProgrammePath = QFileInfo(
                            active.channel.episodes[active.currentEpisode].path).absoluteFilePath();
                    }
                }
                saveState();
                loadSettings(m_settingsPath, true);
                const bool loaded = applyLibrary(std::move(library));
                setParentMessage(loaded ? QStringLiteral("Channel library reloaded")
                                        : m_libraryStatus);
                if (loaded) {
                    int preservedChannel = -1;
                    int preservedEpisode = -1;
                    if (wasStarted && !m_standby && !activeProgrammePath.isEmpty()) {
                        for (int channelIndex = 0;
                             channelIndex < m_channels.size() && preservedChannel < 0;
                             ++channelIndex) {
                            const ChannelRuntime &candidate = m_channels[channelIndex];
                            for (int episodeIndex = 0;
                                 episodeIndex < candidate.channel.episodes.size();
                                 ++episodeIndex) {
                                if (QFileInfo(candidate.channel.episodes[episodeIndex].path)
                                        .absoluteFilePath() == activeProgrammePath) {
                                    preservedChannel = channelIndex;
                                    preservedEpisode = episodeIndex;
                                    break;
                                }
                            }
                        }
                    }

                    if (preservedChannel >= 0) {
                        m_currentChannelIndex = preservedChannel;
                        m_channels[preservedChannel].currentEpisode = preservedEpisode;
                        m_started = true;
                        m_playbackPaused = wasPaused;
                        setNoSignal(false);
                        setTuning(false);
                        emit channelChanged();
                        saveState();
                        qInfo() << "Library refreshed without interrupting the active programme";
                    } else if (wasStarted && m_standby) {
                        // The decoder is already stopped in standby. Keep the
                        // controller started without producing a tuning flash.
                        m_started = true;
                    } else if (wasStarted) {
                        // The active file really disappeared (for example it
                        // was moved to the bin), so selecting a valid item is
                        // the only safe recovery.
                        start();
                    }
                }
                if (m_libraryReloadRequested) {
                    m_libraryReloadRequested = false;
                    QTimer::singleShot(0, this, &TvController::reloadLibrary);
                }
            });
}

TvController::~TvController()
{
    saveState();
}

bool TvController::initialize(const QString &channelsPath,
                              const QString &settingsPath,
                              const QString &mediaRoot,
                              const QString &statePath,
                              ChannelLibrary::MediaInspector mediaInspector,
                              std::function<qint64()> uptimeClock)
{
    m_channelsPath = QFileInfo(channelsPath).absoluteFilePath();
    m_settingsPath = QFileInfo(settingsPath).absoluteFilePath();
    m_mediaRoot = QFileInfo(mediaRoot).absoluteFilePath();
    m_adultMediaRoot = QDir(m_mediaRoot).filePath(QStringLiteral(".adult"));
    m_statePath = QFileInfo(statePath).absoluteFilePath();
    m_episodeUptimeClock = std::move(uptimeClock);
    loadSettings(m_settingsPath);

    ChannelLibraryResult library;
    bool pendingInspections = false;
    if (mediaInspector) {
        library = ChannelLibrary::load(m_channelsPath, m_mediaRoot, std::move(mediaInspector));
    } else {
        const QString cachePath = QDir(QFileInfo(m_statePath).absolutePath())
                                      .filePath(QStringLiteral("media-index.json"));
        MediaIndex mediaIndex(cachePath);
        library = ChannelLibrary::load(m_channelsPath, m_mediaRoot, [&mediaIndex](const QString &path) {
            return mediaIndex.inspectCached(path);
        });
        pendingInspections = mediaIndex.hasPendingInspections();
    }
    const bool loaded = applyLibrary(std::move(library));
    reloadAdultLibrary();
    if (loaded && pendingInspections) {
        qInfo() << "Uncached media will be validated in the background";
        QTimer::singleShot(0, this, &TvController::reloadLibrary);
    }
    return loaded;
}

bool TvController::applyLibrary(ChannelLibraryResult library)
{
    m_tuningTimer.stop();
    m_numericTimer.stop();
    m_channels.clear();
    m_libraryWarnings.clear();
    m_currentChannelIndex = -1;
    m_initialChannelNumber = -1;
    m_started = false;
    m_noSignal = false;

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
        ChannelRuntime &runtime = m_channels.back();
        runtime.enabled = !m_disabledChannelNumbers.contains(runtime.channel.number);
        const QSet<QString> disabledNames = m_disabledProgrammeNames.value(runtime.channel.number);
        for (int index = 0; index < runtime.channel.episodes.size(); ++index) {
            const QString fileName = QFileInfo(runtime.channel.episodes[index].path).fileName();
            if (disabledNames.contains(fileName)) {
                runtime.disabledEpisodes.insert(index);
            }
        }
    }

    m_libraryWarnings = library.warnings;
    updateLibraryStatus();
    emit parentLibraryChanged();
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

QString TvController::currentContentType() const
{
    return m_currentChannelIndex >= 0 ? m_channels[m_currentChannelIndex].channel.contentType
                                      : QStringLiteral("shows");
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

bool TvController::remoteLocked() const
{
    return m_remoteLocked;
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

QString TvController::parentOverlayStyle() const
{
    return m_parentOverlayStyle;
}

bool TvController::tvGuideEnabled() const
{
    return m_tvGuideEnabled;
}

QString TvController::playbackMode() const
{
    return m_playbackMode;
}

int TvController::episodeResetMinutes() const
{
    return m_episodeResetMinutes;
}

QString TvController::pictureMode() const
{
    return m_pictureMode;
}

QString TvController::displayResolution() const
{
    return m_displayResolution;
}

int TvController::crtGlass() const
{
    return m_crtGlass;
}

QString TvController::tvBorderStyle() const
{
    return m_tvBorderStyle;
}

int TvController::videoDistortion() const
{
    return m_videoDistortion;
}

bool TvController::soundEffectsEnabled() const
{
    return m_soundEffectsEnabled;
}

bool TvController::scrubbingEnabled() const
{
    return m_scrubbingEnabled;
}

QVariantList TvController::parentLibrary() const
{
    QVariantList channels;
    channels.reserve(m_channels.size());
    for (const ChannelRuntime &runtime : m_channels) {
        QVariantList programmes;
        programmes.reserve(runtime.channel.episodes.size());
        int enabledProgrammeCount = 0;
        for (int index = 0; index < runtime.channel.episodes.size(); ++index) {
            const QString fileName = QFileInfo(runtime.channel.episodes[index].path).fileName();
            QString displayName = QFileInfo(fileName).completeBaseName();
            displayName.replace(QLatin1Char('_'), QLatin1Char(' '));
            displayName = displayName.simplified();
            const bool enabled = !runtime.disabledEpisodes.contains(index);
            enabledProgrammeCount += enabled ? 1 : 0;
            programmes.append(QVariantMap{{QStringLiteral("fileName"), fileName},
                                          {QStringLiteral("name"), displayName},
                                          {QStringLiteral("enabled"), enabled}});
        }
        channels.append(QVariantMap{
            {QStringLiteral("number"), runtime.channel.number},
            {QStringLiteral("name"), runtime.channel.name},
            {QStringLiteral("folder"), runtime.channel.folder},
            {QStringLiteral("enabled"), runtime.enabled},
            {QStringLiteral("programmeCount"), runtime.channel.episodes.size()},
            {QStringLiteral("enabledProgrammeCount"), enabledProgrammeCount},
            {QStringLiteral("programmes"), programmes},
        });
    }
    return channels;
}

QVariantMap TvController::currentChannelSummary() const
{
    if (m_currentChannelIndex < 0
        || m_currentChannelIndex >= static_cast<int>(m_channels.size())) {
        return {};
    }

    const ChannelRuntime &runtime = m_channels[m_currentChannelIndex];
    QJsonObject channelMetadata;
    QJsonObject programmeMetadata;
    QFile metadataFile(QDir(m_mediaRoot).filePath(QStringLiteral(".mabeltv-channels.json")));
    if (metadataFile.open(QIODevice::ReadOnly)) {
        const QJsonObject metadataRoot = QJsonDocument::fromJson(metadataFile.readAll()).object();
        channelMetadata = metadataRoot.value(QStringLiteral("channels"))
                              .toObject()
                              .value(QString::number(runtime.channel.number))
                              .toObject();
        programmeMetadata = metadataRoot.value(QStringLiteral("programmes")).toObject();
    }

    const QString artworkDirectory =
        QDir(m_mediaRoot).filePath(QStringLiteral(".channel-metadata"));
    const auto artworkUrl = [&artworkDirectory](const QString &fileName) -> QUrl {
        if (fileName.isEmpty()) {
            return {};
        }
        const QString path = QDir(artworkDirectory).filePath(fileName);
        return QFileInfo::exists(path) ? QUrl::fromLocalFile(path) : QUrl();
    };

    QVariantList programmes;
    int selectedIndex = 0;
    int enabledIndex = 0;
    QUrl selectedPoster;
    QUrl firstPoster;
    for (int index = 0; index < runtime.channel.episodes.size(); ++index) {
        if (runtime.disabledEpisodes.contains(index)) {
            continue;
        }

        const Episode &episode = runtime.channel.episodes[index];
        const QString fileName = QFileInfo(episode.path).fileName();
        const QString metadataKey = QStringLiteral("%1/%2")
                                        .arg(runtime.channel.number)
                                        .arg(fileName);
        const QJsonObject metadata = programmeMetadata.value(metadataKey).toObject();
        const QString metadataTitle = metadata.value(QStringLiteral("title")).toString();
        const EpisodeDisplay episodeDisplay = episodeDisplayForPath(fileName);
        const QUrl poster = artworkUrl(metadata.value(QStringLiteral("poster")).toString());
        const QString playbackKey = metadataKey;
        const double position = m_channelFilmPlaybackPositions.contains(playbackKey)
            ? m_channelFilmPlaybackPositions.value(playbackKey)
            : (index < runtime.programmePositions.size()
                   ? runtime.programmePositions[index] : 0.0);
        const double duration = m_channelFilmPlaybackDurations.contains(playbackKey)
            ? m_channelFilmPlaybackDurations.value(playbackKey)
            : episode.durationSeconds;
        const double progress = duration >= 10.0
            ? std::clamp(position / duration, 0.0, 1.0) : 0.0;
        const bool current = index == runtime.currentEpisode;
        if (current) {
            selectedIndex = enabledIndex;
            selectedPoster = poster;
        }
        if (firstPoster.isEmpty() && !poster.isEmpty()) {
            firstPoster = poster;
        }

        programmes.append(QVariantMap{
            {QStringLiteral("fileName"), fileName},
            {QStringLiteral("name"), metadataTitle.isEmpty()
                 ? episodeDisplay.name : metadataTitle},
            {QStringLiteral("episodeTitle"), metadataTitle.isEmpty()
                 ? episodeDisplay.title : metadataTitle},
            {QStringLiteral("seriesNumber"), episodeDisplay.seriesNumber},
            {QStringLiteral("episodeNumber"), episodeDisplay.episodeNumber},
            {QStringLiteral("year"), metadata.value(QStringLiteral("year")).toString()},
            {QStringLiteral("poster"), poster},
            {QStringLiteral("position"), std::max(0.0, position)},
            {QStringLiteral("duration"), std::max(0.0, duration)},
            {QStringLiteral("progress"), progress},
            {QStringLiteral("current"), current},
        });
        ++enabledIndex;
    }

    QUrl headerArtwork = artworkUrl(channelMetadata.value(QStringLiteral("artwork")).toString());
    if (headerArtwork.isEmpty()) {
        headerArtwork = !selectedPoster.isEmpty() ? selectedPoster : firstPoster;
    }

    return QVariantMap{
        {QStringLiteral("number"), runtime.channel.number},
        {QStringLiteral("name"), runtime.channel.name},
        {QStringLiteral("contentType"), runtime.channel.contentType},
        {QStringLiteral("artwork"), headerArtwork},
        {QStringLiteral("programmeCount"), programmes.size()},
        {QStringLiteral("selectedIndex"), selectedIndex},
        {QStringLiteral("programmes"), programmes},
    };
}

QVariantList TvController::adultLibrary() const
{
    QVariantList films;
    const QDir directory(m_adultMediaRoot);
    QJsonObject metadataStates;
    QFile metadataFile(directory.filePath(QStringLiteral(".mabeltv-adult.json")));
    if (metadataFile.open(QIODevice::ReadOnly)) {
        metadataStates = QJsonDocument::fromJson(metadataFile.readAll()).object();
    }
    const QStringList filters{
        QStringLiteral("*.mp4"), QStringLiteral("*.m4v"), QStringLiteral("*.mkv"),
        QStringLiteral("*.mov"), QStringLiteral("*.webm"), QStringLiteral("*.avi"),
        QStringLiteral("*.mpg"), QStringLiteral("*.mpeg"),
    };
    QFileInfoList entries;
    QDirIterator iterator(directory.absolutePath(), filters,
                          QDir::Files | QDir::Readable,
                          QDirIterator::Subdirectories);
    while (iterator.hasNext()) {
        const QFileInfo entry(iterator.next());
        const QString relativePath = directory.relativeFilePath(entry.absoluteFilePath());
        const QStringList parts = relativePath.split(QLatin1Char('/'));
        if (parts.size() <= 2 && !relativePath.startsWith(QStringLiteral(".metadata/"))) {
            entries.append(entry);
        }
    }
    std::sort(entries.begin(), entries.end(), [&directory](const QFileInfo &left,
                                                            const QFileInfo &right) {
        return directory.relativeFilePath(left.absoluteFilePath()).compare(
                   directory.relativeFilePath(right.absoluteFilePath()),
                   Qt::CaseInsensitive) < 0;
    });
    films.reserve(entries.size());
    for (const QFileInfo &entry : entries) {
        const QString relativePath = directory.relativeFilePath(entry.absoluteFilePath());
        const QJsonObject state = metadataStates.value(relativePath).toObject();
        const QJsonObject metadata = state.value(QStringLiteral("metadata")).toObject();
        const QString metadataTitle = metadata.value(QStringLiteral("title")).toString();
        const QString posterName = metadata.value(QStringLiteral("poster")).toString();
        const QString posterPath = directory.filePath(
            QStringLiteral(".metadata/%1").arg(posterName));
        films.append(QVariantMap{
            {QStringLiteral("id"), state.value(QStringLiteral("library_id"))
                 .toString(relativePath)},
            {QStringLiteral("fileName"), entry.fileName()},
            {QStringLiteral("path"), relativePath},
            {QStringLiteral("folder"), QFileInfo(relativePath).path() == QStringLiteral(".")
                 ? QString() : QFileInfo(relativePath).path()},
            {QStringLiteral("name"), metadataTitle.isEmpty()
                 ? displayNameForEpisodePath(entry.fileName()) : metadataTitle},
            {QStringLiteral("source"), QUrl::fromLocalFile(entry.absoluteFilePath())},
            {QStringLiteral("size"), entry.size()},
            {QStringLiteral("year"), metadata.value(QStringLiteral("year")).toString()},
            {QStringLiteral("overview"), metadata.value(QStringLiteral("overview")).toString()},
            {QStringLiteral("runtime"), metadata.value(QStringLiteral("runtime")).toInt()},
            {QStringLiteral("poster"), posterName.isEmpty() || !QFileInfo::exists(posterPath)
                 ? QUrl() : QUrl::fromLocalFile(posterPath)},
        });
    }
    return films;
}

QVariantList TvController::guideSchedule() const
{
    QVariantList rows;
    if (!m_tvGuideEnabled) {
        return rows;
    }

    const qint64 elapsedNow = m_broadcastClock.isValid() ? m_broadcastClock.elapsed() : 0;
    const QDateTime now = QDateTime::currentDateTime();
    for (int channelIndex = 0; channelIndex < static_cast<int>(m_channels.size());
         ++channelIndex) {
        const ChannelRuntime &runtime = m_channels[channelIndex];
        if (!runtime.enabled || runtime.channel.episodes.isEmpty()) {
            continue;
        }

        int episodeIndex = episodeIsUsable(runtime, runtime.currentEpisode)
            ? runtime.currentEpisode
            : nextUsableEpisode(runtime, -1);
        if (episodeIndex < 0) {
            continue;
        }

        const bool isCurrentChannel = channelIndex == m_currentChannelIndex;
        const bool advances = m_playbackMode == QStringLiteral("continuous")
            || (isCurrentChannel && !m_playbackPaused);
        double position = std::max(0.0, runtime.anchorPositionSeconds);
        if (advances) {
            position += std::max<qint64>(0, elapsedNow - runtime.anchorMilliseconds) / 1000.0;
        }

        int safety = std::max(1, static_cast<int>(runtime.channel.episodes.size()) * 3);
        double duration = std::max(60.0,
                                   runtime.channel.episodes[episodeIndex].durationSeconds);
        while (position >= duration && safety-- > 0) {
            position -= duration;
            episodeIndex = nextUsableEpisode(runtime, episodeIndex);
            if (episodeIndex < 0) {
                break;
            }
            duration = std::max(60.0,
                                runtime.channel.episodes[episodeIndex].durationSeconds);
        }
        if (episodeIndex < 0) {
            continue;
        }

        // The guide is a real, uninterrupted two-hour window, rather than a
        // fixed number of programme cards. Short children's episodes used to
        // leave most of the grid blank after just four entries.
        const int minutesPastHalfHour = now.time().minute() % 30;
        const QDateTime windowStart = now.addSecs(
            -((minutesPastHalfHour * 60) + now.time().second()));
        const QDateTime windowEnd = windowStart.addSecs(2 * 60 * 60);
        const auto previousUsableEpisode = [this, &runtime](int index) {
            const int count = static_cast<int>(runtime.channel.episodes.size());
            if (count == 0) {
                return -1;
            }
            int candidate = index;
            for (int attempt = 0; attempt < count; ++attempt) {
                candidate = (candidate - 1 + count) % count;
                if (episodeIsUsable(runtime, candidate)) {
                    return candidate;
                }
            }
            return -1;
        };

        QDateTime start = now.addMSecs(-static_cast<qint64>(position * 1000.0));
        int scheduledEpisode = episodeIndex;
        int rewindSafety = std::max(1, static_cast<int>(runtime.channel.episodes.size()) * 3);
        while (start > windowStart && rewindSafety-- > 0) {
            const int previous = previousUsableEpisode(scheduledEpisode);
            if (previous < 0) {
                break;
            }
            scheduledEpisode = previous;
            const double previousDuration = std::max(
                60.0, runtime.channel.episodes[scheduledEpisode].durationSeconds);
            start = start.addMSecs(-static_cast<qint64>(previousDuration * 1000.0));
        }

        QVariantList programmes;
        int scheduleSafety = std::max(128,
            static_cast<int>(runtime.channel.episodes.size()) * 6);
        while (start < windowEnd && scheduledEpisode >= 0 && scheduleSafety-- > 0) {
            const Episode &episode = runtime.channel.episodes[scheduledEpisode];
            const double slotDuration = std::max(60.0, episode.durationSeconds);
            const QDateTime end = start.addMSecs(
                static_cast<qint64>(slotDuration * 1000.0));
            const bool isNow = start <= now && now < end;
            const double progress = isNow
                ? std::clamp(static_cast<double>(start.msecsTo(now)) / 1000.0 / slotDuration,
                             0.0, 1.0)
                : 0.0;
            programmes.append(QVariantMap{
                {QStringLiteral("name"), displayNameForEpisodePath(episode.path)},
                {QStringLiteral("start"), start.toString(QStringLiteral("HH:mm"))},
                {QStringLiteral("end"), end.toString(QStringLiteral("HH:mm"))},
                {QStringLiteral("now"), isNow},
                {QStringLiteral("progress"), progress},
            });
            start = end;
            scheduledEpisode = nextUsableEpisode(runtime, scheduledEpisode);
        }

        rows.append(QVariantMap{
            {QStringLiteral("number"), runtime.channel.number},
            {QStringLiteral("name"), runtime.channel.name},
            {QStringLiteral("current"), isCurrentChannel},
            {QStringLiteral("programmes"), programmes},
        });
    }
    return rows;
}

void TvController::tuneGuideChannel(int channelNumber)
{
    tuneGuideChannelInternal(channelNumber, true);
}

void TvController::tunePortalChannel(int channelNumber)
{
    tuneGuideChannelInternal(channelNumber, false);
}

void TvController::tuneGuideChannelInternal(int channelNumber, bool respectRemoteLock)
{
    if (!m_tvGuideEnabled || (respectRemoteLock && m_remoteLocked) || m_standby
        || m_parentAccessState != ParentClosed) {
        return;
    }
    const int index = findChannelByNumber(channelNumber);
    if (index >= 0) {
        requestTune(index);
    }
}
