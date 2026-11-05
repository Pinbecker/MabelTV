#pragma once

#include <QQuickFramebufferObject>
#include <QHash>
#include <QString>
#include <QTimer>
#include <QUrl>

#include <cstdint>
#include <atomic>
#include <memory>

class MpvRenderer;
class MpvSubtitles;

class MpvVideo : public QQuickFramebufferObject
{
    Q_OBJECT
    Q_PROPERTY(QUrl source READ source WRITE setSource NOTIFY sourceChanged)
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)
    Q_PROPERTY(bool paused READ paused NOTIFY pausedChanged)
    Q_PROPERTY(double playbackPosition READ positionSeconds NOTIFY playbackPositionChanged)
    Q_PROPERTY(double playbackDuration READ durationSeconds NOTIFY playbackDurationChanged)
    Q_PROPERTY(bool subtitlesVisible READ subtitlesVisible NOTIFY subtitlesVisibleChanged)
    Q_PROPERTY(bool subtitlesAvailable READ subtitlesAvailable NOTIFY subtitlesAvailableChanged)
    Q_PROPERTY(bool subtitleDefaultOn READ subtitleDefaultOn WRITE setSubtitleDefaultOn)
    Q_PROPERTY(bool cachedSubtitles READ cachedSubtitles WRITE setCachedSubtitles)
    Q_PROPERTY(int volume READ volume WRITE setVolume NOTIFY volumeChanged)
    Q_PROPERTY(bool muted READ muted WRITE setMuted NOTIFY mutedChanged)
    Q_PROPERTY(QString aspectMode READ aspectMode WRITE setAspectMode NOTIFY aspectModeChanged)
    Q_PROPERTY(int videoWidth READ videoWidth NOTIFY videoDimensionsChanged)
    Q_PROPERTY(int videoHeight READ videoHeight NOTIFY videoDimensionsChanged)
    Q_PROPERTY(bool textureOnly READ textureOnly WRITE setTextureOnly NOTIFY textureOnlyChanged)
    Q_PROPERTY(double videoAspectRatio READ videoAspectRatio NOTIFY videoAspectRatioChanged)
    Q_PROPERTY(qulonglong playbackGeneration READ playbackGeneration NOTIFY playbackGenerationChanged)

public:
    explicit MpvVideo(QQuickItem *parent = nullptr);
    ~MpvVideo() override;

    [[nodiscard]] Renderer *createRenderer() const override;

    [[nodiscard]] QUrl source() const;
    void setSource(const QUrl &source);

    [[nodiscard]] QString status() const;
    [[nodiscard]] bool paused() const;
    [[nodiscard]] bool subtitlesVisible() const;
    [[nodiscard]] bool subtitlesAvailable() const;
    [[nodiscard]] bool subtitleDefaultOn() const;
    void setSubtitleDefaultOn(bool enabled);
    bool cachedSubtitles() const;
    void setCachedSubtitles(bool enabled);
    [[nodiscard]] int volume() const;
    void setVolume(int volume);
    [[nodiscard]] bool muted() const;
    void setMuted(bool muted);
    [[nodiscard]] QString aspectMode() const;
    void setAspectMode(const QString &aspectMode);
    [[nodiscard]] int videoWidth() const { return m_videoWidth; }
    [[nodiscard]] int videoHeight() const { return m_videoHeight; }
    [[nodiscard]] bool textureOnly() const { return m_textureOnly; }
    void setTextureOnly(bool enabled);
    [[nodiscard]] double videoAspectRatio() const;
    [[nodiscard]] qulonglong playbackGeneration() const;

    Q_INVOKABLE void play(const QUrl &source, double startPositionSeconds = 0.0);
    Q_INVOKABLE void stop();
    Q_INVOKABLE void togglePause();
    Q_INVOKABLE void toggleSubtitles();
    Q_INVOKABLE double positionSeconds() const;
    Q_INVOKABLE double durationSeconds() const;
    Q_INVOKABLE void seekRelative(double seconds);
    Q_INVOKABLE void seekAbsolute(double seconds);
    [[nodiscard]] std::uint64_t renderedFrameCount() const;
    [[nodiscard]] bool available() const;
    void requestRenderUpdate();

signals:
    void sourceChanged();
    void statusChanged();
    void pausedChanged();
    void playbackPositionChanged();
    void playbackDurationChanged();
    void subtitlesVisibleChanged();
    void subtitlesAvailableChanged();
    void volumeChanged();
    void mutedChanged();
    void aspectModeChanged();
    void videoAspectRatioChanged();
    void videoDimensionsChanged();
    void textureOnlyChanged();
    void playbackGenerationChanged();
    void playbackFinished();
    void playbackReady();
    void playbackStopped();
    void playbackFailed(const QString &message);
    void fatalPlayerFailure(const QString &message);

protected:
    QSGNode *updatePaintNode(QSGNode *node, UpdatePaintNodeData *data) override;

private slots:
    void handleRenderContextReady(bool softwareMesa);
    void processMpvEvents();

private:
    struct SharedState;
    friend class MpvRenderer;

    static void wakeup(void *context);
    void beginPlay(const QUrl &source,
                   double startPositionSeconds,
                   std::uint64_t playbackGeneration = 0);
    void finishPendingStop();
    void loadCurrentSource();
    void resetPlaybackTelemetry(double positionSeconds = 0.0);
    void resetSubtitleState();
    void setPlaybackPosition(double positionSeconds);
    void setPlaybackDuration(double durationSeconds);
    void setVideoAspectRatio(double aspectRatio);
    void setSubtitlesVisible(bool visible);
    void setSubtitlesAvailable(bool available);
    void setStatus(QString status);
    void reportFatalFailure(const QString &message);

    std::shared_ptr<SharedState> m_state;
    MpvSubtitles *m_subtitles;
    QUrl m_source;
    QString m_status = QStringLiteral("Ready");
    bool m_paused = false;
    bool m_textureOnly = false;
    bool m_subtitlesVisible = true;
    bool m_subtitlesAvailable = false;
    bool m_subtitleDefaultOn = false;
    int m_volume = 20;
    bool m_muted = false;
    QString m_aspectMode = QStringLiteral("crop");
    double m_videoAspectRatio = 0.0;
    int m_videoWidth = 0;
    int m_videoHeight = 0;
    double m_pendingStartPosition = 0.0;
    double m_playbackPosition = 0.0;
    double m_playbackDuration = 0.0;
    bool m_fileActive = false;
    bool m_stopPending = false;
    bool m_hasQueuedPlay = false;
    QUrl m_queuedSource;
    double m_queuedStartPosition = 0.0;
    std::uint64_t m_queuedPlaybackGeneration = 0;
    std::uint64_t m_playbackGeneration = 0;
    std::uint64_t m_dispatchedPlaybackGeneration = 0;
    QTimer m_stopTimeout;
    std::atomic_bool m_renderUpdateQueued = false;
    bool m_checkpointPending = false;
    QHash<QString, double> m_playbackDiagnostics;
};
