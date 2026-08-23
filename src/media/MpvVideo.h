#pragma once

#include <QQuickFramebufferObject>
#include <QString>
#include <QUrl>

#include <cstdint>
#include <memory>

class MpvRenderer;

class MpvVideo : public QQuickFramebufferObject
{
    Q_OBJECT
    Q_PROPERTY(QUrl source READ source WRITE setSource NOTIFY sourceChanged)
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)
    Q_PROPERTY(bool paused READ paused NOTIFY pausedChanged)
    Q_PROPERTY(double playbackPosition READ positionSeconds NOTIFY playbackPositionChanged)
    Q_PROPERTY(double playbackDuration READ durationSeconds NOTIFY playbackDurationChanged)
    Q_PROPERTY(int volume READ volume WRITE setVolume NOTIFY volumeChanged)
    Q_PROPERTY(bool muted READ muted WRITE setMuted NOTIFY mutedChanged)
    Q_PROPERTY(QString aspectMode READ aspectMode WRITE setAspectMode NOTIFY aspectModeChanged)

public:
    explicit MpvVideo(QQuickItem *parent = nullptr);
    ~MpvVideo() override;

    [[nodiscard]] Renderer *createRenderer() const override;

    [[nodiscard]] QUrl source() const;
    void setSource(const QUrl &source);

    [[nodiscard]] QString status() const;
    [[nodiscard]] bool paused() const;
    [[nodiscard]] int volume() const;
    void setVolume(int volume);
    [[nodiscard]] bool muted() const;
    void setMuted(bool muted);
    [[nodiscard]] QString aspectMode() const;
    void setAspectMode(const QString &aspectMode);

    Q_INVOKABLE void play(const QUrl &source, double startPositionSeconds = 0.0);
    Q_INVOKABLE void stop();
    Q_INVOKABLE void togglePause();
    Q_INVOKABLE double positionSeconds() const;
    Q_INVOKABLE double durationSeconds() const;
    Q_INVOKABLE void seekRelative(double seconds);
    Q_INVOKABLE void seekAbsolute(double seconds);
    [[nodiscard]] std::uint64_t renderedFrameCount() const;
    [[nodiscard]] bool available() const;

signals:
    void sourceChanged();
    void statusChanged();
    void pausedChanged();
    void playbackPositionChanged();
    void playbackDurationChanged();
    void volumeChanged();
    void mutedChanged();
    void aspectModeChanged();
    void playbackFinished();
    void playbackFailed(const QString &message);
    void fatalPlayerFailure(const QString &message);

private slots:
    void handleRenderContextReady();
    void processMpvEvents();

private:
    struct SharedState;
    friend class MpvRenderer;

    static void wakeup(void *context);
    void beginPlay(const QUrl &source, double startPositionSeconds);
    void finishPendingStop();
    void loadCurrentSource();
    void resetPlaybackTelemetry(double positionSeconds = 0.0);
    void setPlaybackPosition(double positionSeconds);
    void setPlaybackDuration(double durationSeconds);
    void setStatus(QString status);
    void reportFatalFailure(const QString &message);

    std::shared_ptr<SharedState> m_state;
    QUrl m_source;
    QString m_status = QStringLiteral("Ready");
    bool m_paused = false;
    int m_volume = 20;
    bool m_muted = false;
    QString m_aspectMode = QStringLiteral("crop");
    double m_pendingStartPosition = 0.0;
    double m_playbackPosition = 0.0;
    double m_playbackDuration = 0.0;
    bool m_fileActive = false;
    bool m_stopPending = false;
    bool m_hasQueuedPlay = false;
    QUrl m_queuedSource;
    double m_queuedStartPosition = 0.0;
};
