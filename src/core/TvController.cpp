#include "TvController.h"

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

QString displayNameForEpisodePath(const QString &path)
{
    QString name = QFileInfo(path).completeBaseName();
    name.replace(QLatin1Char('_'), QLatin1Char(' '));
    name = name.simplified();

    static const QRegularExpression episodePattern(
        QStringLiteral("^S(\\d{1,2})E(\\d{1,3})\\s*-\\s*(.+)$"),
        QRegularExpression::CaseInsensitiveOption);
    const QRegularExpressionMatch match = episodePattern.match(name);
    if (!match.hasMatch()) {
        return name;
    }

    return QStringLiteral("S%1  E%2  ·  %3")
        .arg(match.captured(1).rightJustified(2, QLatin1Char('0')),
             match.captured(2).rightJustified(2, QLatin1Char('0')),
             match.captured(3));
}
} // namespace

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
                 ? displayNameForEpisodePath(fileName) : metadataTitle},
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
    if (m_standby) {
        setStandby(false);
        saveState();
    }
    if (m_tvControl != nullptr) {
        m_tvControl->turnOn();
    }
}

void TvController::turnOff()
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
    if (m_tvControl != nullptr) {
        m_tvControl->turnOff();
    }
}

void TvController::setTvControl(CecTvControl *tvControl)
{
    m_tvControl = tvControl;
}

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
