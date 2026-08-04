#pragma once

#include "library/ChannelLibrary.h"
#include "library/ShuffleBag.h"

#include <QElapsedTimer>
#include <QJsonObject>
#include <QObject>
#include <QSet>
#include <QString>
#include <QTimer>
#include <QUrl>
#include <QVector>

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
    Q_PROPERTY(QString numericEntry READ numericEntry NOTIFY numericEntryChanged)
    Q_PROPERTY(QString libraryStatus READ libraryStatus NOTIFY libraryStatusChanged)
    Q_PROPERTY(int parentAccessState READ parentAccessState NOTIFY parentAccessStateChanged)
    Q_PROPERTY(int parentConfirmationCount READ parentConfirmationCount NOTIFY parentConfirmationCountChanged)
    Q_PROPERTY(QString parentMessage READ parentMessage NOTIFY parentMessageChanged)
    Q_PROPERTY(QString playbackMode READ playbackMode NOTIFY playbackModeChanged)
    Q_PROPERTY(QString pictureMode READ pictureMode NOTIFY pictureModeChanged)
    Q_PROPERTY(QString displayResolution READ displayResolution NOTIFY displayResolutionChanged)
    Q_PROPERTY(QString crtEffectLevel READ crtEffectLevel NOTIFY crtEffectLevelChanged)
    Q_PROPERTY(bool soundEffectsEnabled READ soundEffectsEnabled NOTIFY soundEffectsEnabledChanged)

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
                    ChannelLibrary::MediaInspector mediaInspector = {});

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
    [[nodiscard]] QString numericEntry() const;
    [[nodiscard]] QString libraryStatus() const;
    [[nodiscard]] int parentAccessState() const;
    [[nodiscard]] int parentConfirmationCount() const;
    [[nodiscard]] QString parentMessage() const;
    [[nodiscard]] QString playbackMode() const;
    [[nodiscard]] QString pictureMode() const;
    [[nodiscard]] QString displayResolution() const;
    [[nodiscard]] QString crtEffectLevel() const;
    [[nodiscard]] bool soundEffectsEnabled() const;

    Q_INVOKABLE void start();
    Q_INVOKABLE void dispatch(Action action);
    Q_INVOKABLE void resumeFromStandby();
    Q_INVOKABLE void enterDigit(int digit);
    Q_INVOKABLE void confirmNumericEntry();
    Q_INVOKABLE void playbackEnded();
    Q_INVOKABLE void playbackFailed(const QString &message);
    Q_INVOKABLE void requestParentAccess();
    Q_INVOKABLE void parentConfirm();
    Q_INVOKABLE void closeParent();
    Q_INVOKABLE void cyclePlaybackMode(int direction);
    Q_INVOKABLE void cyclePictureMode(int direction);
    Q_INVOKABLE void cycleDisplayResolution(int direction);
    Q_INVOKABLE void cycleCrtEffectLevel(int direction);
    Q_INVOKABLE void toggleSoundEffects();
    Q_INVOKABLE void toggleVolumeLimit();
    Q_INVOKABLE void adjustMaximumVolume(int direction);
    Q_INVOKABLE void reloadLibrary();
    Q_INVOKABLE void requestParentCommand(const QString &command);
    Q_INVOKABLE void requestSafeShutdown();

signals:
    void channelChanged();
    void volumeChanged();
    void mutedChanged();
    void tuningChanged();
    void noSignalChanged();
    void standbyChanged();
    void numericEntryChanged();
    void libraryStatusChanged();
    void volumePolicyChanged();
    void parentAccessStateChanged();
    void parentConfirmationCountChanged();
    void parentMessageChanged();
    void playbackModeChanged();
    void pictureModeChanged();
    void displayResolutionChanged();
    void crtEffectLevelChanged();
    void soundEffectsEnabledChanged();

    void playbackRequested(const QUrl &source, double startPositionSeconds);
    void stopPlaybackRequested();
    void channelDisplayRequested(int channelNumber, const QString &channelName);
    void volumeDisplayRequested(int volume, bool muted);
    void parentCommandRequested(const QString &command);

private:
    struct ChannelRuntime
    {
        explicit ChannelRuntime(Channel value, quint32 seed)
            : channel(std::move(value))
            , shuffle(channel.episodes.size(), seed)
        {
        }

        Channel channel;
        ShuffleBag shuffle;
        int currentEpisode = -1;
        qint64 anchorMilliseconds = 0;
        double anchorPositionSeconds = 0.0;
        QSet<int> failedEpisodes;
    };

    void loadSettings(const QString &settingsPath);
    void saveSettings();
    void loadState();
    void saveState() const;
    void requestTune(int channelIndex,
                     bool updatePreviousChannel = true,
                     bool chooseRestartEpisode = true);
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
    int findChannelByNumber(int channelNumber) const;
    int takeUsableEpisode(ChannelRuntime &runtime);
    int adjacentUsableEpisode(const ChannelRuntime &runtime, int direction) const;
    double resolveBroadcastPosition(ChannelRuntime &runtime);
    void freezeTimeline(ChannelRuntime &runtime);
    void setParentMessage(const QString &message);

    QVector<ChannelRuntime> m_channels;
    QTimer m_tuningTimer;
    QTimer m_numericTimer;
    QElapsedTimer m_broadcastClock;
    QString m_statePath;
    QString m_channelsPath;
    QString m_settingsPath;
    QString m_mediaRoot;
    QString m_libraryStatus;
    QString m_numericEntry;
    int m_parentConfirmationCount = 0;
    QString m_parentMessage;
    QString m_playbackMode = QStringLiteral("continuous");
    QString m_pictureMode = QStringLiteral("channel");
    QString m_displayResolution = QStringLiteral("720p");
    QString m_crtEffectLevel = QStringLiteral("low");
    QJsonObject m_settingsRoot;
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
    bool m_started = false;
    bool m_soundEffectsEnabled = true;
    ParentAccessState m_parentAccessState = ParentClosed;
};
