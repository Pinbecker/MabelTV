#pragma once

#include "library/ChannelLibrary.h"
#include "library/ShuffleBag.h"

#include <QElapsedTimer>
#include <QFutureWatcher>
#include <QHash>
#include <QJsonObject>
#include <QObject>
#include <QSet>
#include <QString>
#include <QTimer>
#include <QUrl>
#include <QVariantList>
#include <QVector>

#include <functional>
#include <utility>

class TvController final : public QObject
{
    Q_OBJECT
    Q_PROPERTY(int currentChannelNumber READ currentChannelNumber NOTIFY channelChanged)
    Q_PROPERTY(QString currentChannelName READ currentChannelName NOTIFY channelChanged)
    Q_PROPERTY(QString currentAspectMode READ currentAspectMode NOTIFY channelChanged)
    Q_PROPERTY(int volume READ volume NOTIFY volumeChanged)
    Q_PROPERTY(int maximumVolume READ maximumVolume NOTIFY volumePolicyChanged)
    Q_PROPERTY(int configuredMaximumVolume READ configuredMaximumVolume NOTIFY volumePolicyChanged)
    Q_PROPERTY(bool volumeLimitEnabled READ volumeLimitEnabled NOTIFY volumePolicyChanged)
    Q_PROPERTY(bool muted READ muted NOTIFY mutedChanged)
    Q_PROPERTY(bool tuning READ tuning NOTIFY tuningChanged)
    Q_PROPERTY(bool noSignal READ noSignal NOTIFY noSignalChanged)
    Q_PROPERTY(bool standby READ standby NOTIFY standbyChanged)
    Q_PROPERTY(bool remoteLocked READ remoteLocked NOTIFY remoteLockedChanged)
    Q_PROPERTY(QString numericEntry READ numericEntry NOTIFY numericEntryChanged)
    Q_PROPERTY(QString libraryStatus READ libraryStatus NOTIFY libraryStatusChanged)
    Q_PROPERTY(int parentAccessState READ parentAccessState NOTIFY parentAccessStateChanged)
    Q_PROPERTY(int parentConfirmationCount READ parentConfirmationCount NOTIFY parentConfirmationCountChanged)
    Q_PROPERTY(QString parentMessage READ parentMessage NOTIFY parentMessageChanged)
    Q_PROPERTY(QString parentOverlayStyle READ parentOverlayStyle NOTIFY parentOverlayStyleChanged)
    Q_PROPERTY(bool tvGuideEnabled READ tvGuideEnabled NOTIFY tvGuideEnabledChanged)
    Q_PROPERTY(QString playbackMode READ playbackMode NOTIFY playbackModeChanged)
    Q_PROPERTY(int episodeResetMinutes READ episodeResetMinutes NOTIFY episodeResetMinutesChanged)
    Q_PROPERTY(QString pictureMode READ pictureMode NOTIFY pictureModeChanged)
    Q_PROPERTY(QString displayResolution READ displayResolution NOTIFY displayResolutionChanged)
    Q_PROPERTY(int crtGlass READ crtGlass NOTIFY crtGlassChanged)
    Q_PROPERTY(QString tvBorderStyle READ tvBorderStyle NOTIFY tvBorderStyleChanged)
    Q_PROPERTY(int videoDistortion READ videoDistortion NOTIFY videoDistortionChanged)
    Q_PROPERTY(bool soundEffectsEnabled READ soundEffectsEnabled NOTIFY soundEffectsEnabledChanged)
    Q_PROPERTY(bool scrubbingEnabled READ scrubbingEnabled NOTIFY scrubbingEnabledChanged)
    Q_PROPERTY(QVariantList parentLibrary READ parentLibrary NOTIFY parentLibraryChanged)
    Q_PROPERTY(QVariantList adultLibrary READ adultLibrary NOTIFY adultLibraryChanged)

public:
    enum Action
    {
        ChannelUp,
        ChannelDown,
        VolumeUp,
        VolumeDown,
        ToggleMute,
        PreviousChannel,
        ToggleStandby,
        RandomEpisode,
        PreviousProgramme,
        NextProgramme,
    };
    Q_ENUM(Action)

    enum ParentAccessState
    {
        ParentClosed,
        ParentConfirmation,
        ParentOpen,
    };
    Q_ENUM(ParentAccessState)

    explicit TvController(QObject *parent = nullptr);
    ~TvController() override;

    bool initialize(const QString &channelsPath,
                    const QString &settingsPath,
                    const QString &mediaRoot,
                    const QString &statePath,
                    ChannelLibrary::MediaInspector mediaInspector = {},
                    std::function<qint64()> uptimeClock = {});

    [[nodiscard]] int currentChannelNumber() const;
    [[nodiscard]] QString currentChannelName() const;
    [[nodiscard]] QString currentAspectMode() const;
    [[nodiscard]] int volume() const;
    [[nodiscard]] int maximumVolume() const;
    [[nodiscard]] int configuredMaximumVolume() const;
    [[nodiscard]] bool volumeLimitEnabled() const;
    [[nodiscard]] bool muted() const;
    [[nodiscard]] bool tuning() const;
    [[nodiscard]] bool noSignal() const;
    [[nodiscard]] bool standby() const;
    [[nodiscard]] bool remoteLocked() const;
    [[nodiscard]] QString numericEntry() const;
    [[nodiscard]] QString libraryStatus() const;
    [[nodiscard]] int parentAccessState() const;
    [[nodiscard]] int parentConfirmationCount() const;
    [[nodiscard]] QString parentMessage() const;
    [[nodiscard]] QString parentOverlayStyle() const;
    [[nodiscard]] bool tvGuideEnabled() const;
    [[nodiscard]] QString playbackMode() const;
    [[nodiscard]] int episodeResetMinutes() const;
    [[nodiscard]] QString pictureMode() const;
    [[nodiscard]] QString displayResolution() const;
    [[nodiscard]] int crtGlass() const;
    [[nodiscard]] QString tvBorderStyle() const;
    [[nodiscard]] int videoDistortion() const;
    [[nodiscard]] bool soundEffectsEnabled() const;
    [[nodiscard]] bool scrubbingEnabled() const;
    [[nodiscard]] QVariantList parentLibrary() const;
    [[nodiscard]] QVariantList adultLibrary() const;

    Q_INVOKABLE void start();
    Q_INVOKABLE void dispatch(Action action);
    Q_INVOKABLE void toggleRemoteLock();
    Q_INVOKABLE void resumeFromStandby();
    Q_INVOKABLE void enterDigit(int digit);
    Q_INVOKABLE void confirmNumericEntry();
    Q_INVOKABLE void playbackEnded();
    Q_INVOKABLE void playbackFailed(const QString &message);
    Q_INVOKABLE void prepareForPlaybackRestart(const QString &message);
    Q_INVOKABLE void updatePlaybackPosition(double positionSeconds, bool paused);
    Q_INVOKABLE void restartCurrentProgramme();
    Q_INVOKABLE void requestParentAccess();
    Q_INVOKABLE void parentConfirm();
    Q_INVOKABLE void closeParent();
    Q_INVOKABLE void cyclePlaybackMode(int direction);
    Q_INVOKABLE void cycleEpisodeResetMinutes(int direction);
    Q_INVOKABLE void cyclePictureMode(int direction);
    Q_INVOKABLE void cycleDisplayResolution(int direction);
    Q_INVOKABLE void adjustCrtGlass(int direction);
    Q_INVOKABLE void cycleTvBorderStyle(int direction);
    Q_INVOKABLE void adjustVideoDistortion(int direction);
    Q_INVOKABLE void toggleSoundEffects();
    Q_INVOKABLE void toggleScrubbing();
    Q_INVOKABLE void toggleVolumeLimit();
    Q_INVOKABLE void adjustMaximumVolume(int direction);
    Q_INVOKABLE void reloadLibrary();
    Q_INVOKABLE void reloadAdultLibrary();
    Q_INVOKABLE void toggleChannelEnabled(int channelNumber);
    Q_INVOKABLE void toggleProgrammeEnabled(int channelNumber, const QString &fileName);
    Q_INVOKABLE QVariantList guideSchedule() const;
    Q_INVOKABLE void tuneGuideChannel(int channelNumber);
    Q_INVOKABLE void requestParentCommand(const QString &command);
    Q_INVOKABLE void requestSafeShutdown();

signals:
    void channelChanged();
    void volumeChanged();
    void mutedChanged();
    void tuningChanged();
    void noSignalChanged();
    void standbyChanged();
    void remoteLockedChanged();
    void numericEntryChanged();
    void libraryStatusChanged();
    void volumePolicyChanged();
    void parentAccessStateChanged();
    void parentConfirmationCountChanged();
    void parentMessageChanged();
    void parentOverlayStyleChanged();
    void tvGuideEnabledChanged();
    void playbackModeChanged();
    void episodeResetMinutesChanged();
    void pictureModeChanged();
    void displayResolutionChanged();
    void crtGlassChanged();
    void tvBorderStyleChanged();
    void videoDistortionChanged();
    void soundEffectsEnabledChanged();
    void scrubbingEnabledChanged();
    void parentLibraryChanged();
    void adultLibraryChanged();

    void playbackRequested(const QUrl &source, double startPositionSeconds);
    void stopPlaybackRequested();
    void channelDisplayRequested(int channelNumber, const QString &channelName);
    void programmeDisplayRequested(const QString &programmeName);
    void volumeDisplayRequested(int volume, bool muted);
    void parentCommandRequested(const QString &command);

private:
    struct ChannelRuntime
    {
        explicit ChannelRuntime(Channel value, quint32 seed)
            : channel(std::move(value))
            , shuffle(channel.episodes.size(), seed)
            , programmePositions(channel.episodes.size(), 0.0)
            , programmeLastLeftMilliseconds(channel.episodes.size(), -1)
        {
        }

        Channel channel;
        ShuffleBag shuffle;
        QVector<double> programmePositions;
        QVector<qint64> programmeLastLeftMilliseconds;
        int currentEpisode = -1;
        qint64 anchorMilliseconds = 0;
        double anchorPositionSeconds = 0.0;
        QSet<int> failedEpisodes;
        QSet<int> disabledEpisodes;
        bool enabled = true;
    };

    void loadSettings(const QString &settingsPath);
    void saveSettings();
    void loadState();
    void saveState() const;
    void requestTune(int channelIndex,
                     bool updatePreviousChannel = true,
                     bool preserveCurrentPosition = true);
    void finishTune();
    void changeChannel(int direction);
    void changeProgramme(int direction);
    void setVolume(int value);
    void setMuted(bool muted);
    void setTuning(bool tuning);
    void setNoSignal(bool noSignal);
    void setStandby(bool standby);
    void tuneNumericEntry();
    void seedTimeline(ChannelRuntime &runtime);
    int findChannelByNumber(int channelNumber, bool includeDisabled = false) const;
    int adjacentEnabledChannel(int channelIndex, int direction) const;
    bool episodeIsUsable(const ChannelRuntime &runtime, int episodeIndex) const;
    int nextUsableEpisode(const ChannelRuntime &runtime, int episodeIndex) const;
    int takeUsableEpisode(ChannelRuntime &runtime);
    int adjacentUsableEpisode(const ChannelRuntime &runtime, int direction) const;
    QString programmeDisplayName(const ChannelRuntime &runtime) const;
    double resolveBroadcastPosition(ChannelRuntime &runtime);
    void freezeTimeline(ChannelRuntime &runtime);
    void markCurrentEpisodeLeft(ChannelRuntime &runtime);
    void prepareCurrentEpisodeForVisit(ChannelRuntime &runtime);
    [[nodiscard]] qint64 episodeUptimeMilliseconds() const;
    void setParentMessage(const QString &message);
    void updateLibraryStatus();
    void enterNoChannelsState();
    bool applyLibrary(ChannelLibraryResult library);

    QVector<ChannelRuntime> m_channels;
    QTimer m_tuningTimer;
    QTimer m_numericTimer;
    QElapsedTimer m_broadcastClock;
    QElapsedTimer m_processUptimeClock;
    QString m_statePath;
    QString m_channelsPath;
    QString m_settingsPath;
    QString m_mediaRoot;
    QString m_adultMediaRoot;
    QString m_libraryStatus;
    QStringList m_libraryWarnings;
    QString m_numericEntry;
    int m_parentConfirmationCount = 0;
    QString m_parentMessage;
    QString m_parentOverlayStyle = QStringLiteral("classic");
    bool m_tvGuideEnabled = false;
    QString m_playbackMode = QStringLiteral("continuous");
    int m_episodeResetMinutes = 0;
    QString m_pictureMode = QStringLiteral("channel");
    QString m_displayResolution = QStringLiteral("720p");
    int m_crtGlass = 35;
    QString m_tvBorderStyle = QStringLiteral("slim-black");
    int m_videoDistortion = 20;
    QJsonObject m_settingsRoot;
    QSet<int> m_disabledChannelNumbers;
    QHash<int, QSet<QString>> m_disabledProgrammeNames;
    int m_currentChannelIndex = -1;
    int m_initialChannelNumber = -1;
    int m_previousChannelNumber = -1;
    int m_volume = 20;
    int m_maximumVolume = 60;
    bool m_volumeLimitEnabled = true;
    bool m_muted = false;
    bool m_tuning = false;
    bool m_noSignal = false;
    bool m_standby = false;
    QFutureWatcher<ChannelLibraryResult> m_libraryReloadWatcher;
    bool m_libraryReloadRequested = false;
    bool m_remoteLocked = false;
    bool m_playbackPaused = false;
    bool m_started = false;
    bool m_soundEffectsEnabled = true;
    bool m_scrubbingEnabled = false;
    QString m_sessionId;
    std::function<qint64()> m_episodeUptimeClock;
    ParentAccessState m_parentAccessState = ParentClosed;
};
