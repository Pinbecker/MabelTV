#include "MpvVideo.h"

#include <QDir>
#include <QFileInfo>
#include <QMetaObject>
#include <QOpenGLContext>
#include <QOpenGLFramebufferObject>
#include <QOpenGLFramebufferObjectFormat>
#include <QQuickOpenGLUtils>
#include <QtGlobal>

#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>

#include <atomic>
#include <algorithm>
#include <utility>

namespace
{
constexpr int childSafeVolume = 60;
constexpr int boostedMaximumVolume = 160;

int outputVolume(int visibleVolume)
{
    visibleVolume = std::clamp(visibleVolume, 0, 100);
    if (visibleVolume <= childSafeVolume) {
        return visibleVolume;
    }
    return childSafeVolume
        + (visibleVolume - childSafeVolume) * (boostedMaximumVolume - childSafeVolume)
            / (100 - childSafeVolume);
}

bool checkMpv(int result, const char *operation)
{
    if (result < 0) {
        qCritical("%s failed: %s", operation, mpv_error_string(result));
        return false;
    }
    return true;
}

void *resolveOpenGlSymbol(void *, const char *name)
{
    auto *context = QOpenGLContext::currentContext();
    if (context == nullptr) {
        return nullptr;
    }

    const QFunctionPointer address = context->getProcAddress(QByteArray(name));
    return reinterpret_cast<void *>(address);
}

void requestFrame(void *context)
{
    auto *item = static_cast<MpvVideo *>(context);
    QMetaObject::invokeMethod(item, [item]() { item->update(); }, Qt::QueuedConnection);
}
} // namespace

struct MpvVideo::SharedState
{
    mpv_handle *handle = nullptr;
    std::atomic<mpv_render_context *> renderContext = nullptr;
    std::atomic_bool renderReady = false;
    std::atomic_bool fatalFailure = false;
    std::atomic<std::uint64_t> renderedFrames = 0;

    ~SharedState()
    {
        if (handle != nullptr) {
            mpv_terminate_destroy(handle);
        }
    }
};

class MpvRenderer final : public QQuickFramebufferObject::Renderer
{
public:
    MpvRenderer(MpvVideo *item, std::shared_ptr<MpvVideo::SharedState> state)
        : m_item(item)
        , m_state(std::move(state))
    {
    }

    ~MpvRenderer() override
    {
        auto *context = m_state->renderContext.exchange(nullptr);
        m_state->renderReady.store(false);
        if (context != nullptr) {
            mpv_render_context_set_update_callback(context, nullptr, nullptr);
            mpv_render_context_free(context);
        }
    }

    QOpenGLFramebufferObject *createFramebufferObject(const QSize &size) override
    {
        ensureRenderContext();

        QOpenGLFramebufferObjectFormat format;
        format.setAttachment(QOpenGLFramebufferObject::NoAttachment);
        format.setTextureTarget(GL_TEXTURE_2D);
        const auto *openGlContext = QOpenGLContext::currentContext();
        const bool openGlEs2 = openGlContext != nullptr
            && openGlContext->isOpenGLES()
            && openGlContext->format().majorVersion() < 3;
        format.setInternalTextureFormat(openGlEs2 ? GL_RGBA : GL_RGBA8);
        return new QOpenGLFramebufferObject(size, format);
    }

    void render() override
    {
        auto *context = m_state->renderContext.load();
        auto *target = framebufferObject();
        if (context == nullptr || target == nullptr) {
            return;
        }

        mpv_render_context_update(context);

        mpv_opengl_fbo targetFbo{
            static_cast<int>(target->handle()),
            target->width(),
            target->height(),
            0,
        };
        // QQuickFramebufferObject already presents the OpenGL texture in the
        // orientation expected by the Qt Quick scene. Asking libmpv to flip
        // the FBO as well turns the finished television picture upside down.
        int flipVertically = 0;
        mpv_render_param parameters[] = {
            {MPV_RENDER_PARAM_OPENGL_FBO, &targetFbo},
            {MPV_RENDER_PARAM_FLIP_Y, &flipVertically},
            {MPV_RENDER_PARAM_INVALID, nullptr},
        };

        const int result = mpv_render_context_render(context, parameters);
        if (result < 0) {
            qCritical("Rendering a libmpv frame failed: %s", mpv_error_string(result));
            const QString message = QStringLiteral("The video renderer stopped unexpectedly");
            QMetaObject::invokeMethod(m_item,
                                      [item = m_item, message]() {
                                          item->reportFatalFailure(message);
                                      },
                                      Qt::QueuedConnection);
            QQuickOpenGLUtils::resetOpenGLState();
            return;
        }
        m_state->renderedFrames.fetch_add(1, std::memory_order_relaxed);
        QQuickOpenGLUtils::resetOpenGLState();
    }

private:
    void ensureRenderContext()
    {
        if (m_state->renderContext.load() != nullptr) {
            return;
        }
        if (m_state->handle == nullptr) {
            return;
        }

        mpv_opengl_init_params openGlParameters{
            resolveOpenGlSymbol,
            nullptr,
        };
        int advancedControl = 1;
        mpv_render_param parameters[] = {
            {MPV_RENDER_PARAM_API_TYPE, const_cast<char *>(MPV_RENDER_API_TYPE_OPENGL)},
            {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &openGlParameters},
            {MPV_RENDER_PARAM_ADVANCED_CONTROL, &advancedControl},
            {MPV_RENDER_PARAM_INVALID, nullptr},
        };

        mpv_render_context *context = nullptr;
        const int result = mpv_render_context_create(&context, m_state->handle, parameters);
        if (!checkMpv(result, "Creating the libmpv OpenGL render context")
            || context == nullptr) {
            const QString message = QStringLiteral("The video renderer could not start");
            QMetaObject::invokeMethod(m_item,
                                      [item = m_item, message]() {
                                          item->reportFatalFailure(message);
                                      },
                                      Qt::QueuedConnection);
            return;
        }
        m_state->renderContext.store(context);
        m_state->renderReady.store(true);
        mpv_render_context_set_update_callback(context, requestFrame, m_item);
        QMetaObject::invokeMethod(m_item,
                                  &MpvVideo::handleRenderContextReady,
                                  Qt::QueuedConnection);
    }

    MpvVideo *m_item;
    std::shared_ptr<MpvVideo::SharedState> m_state;
};

MpvVideo::MpvVideo(QQuickItem *parent)
    : QQuickFramebufferObject(parent)
    , m_state(std::make_shared<SharedState>())
{
    setMirrorVertically(false);

    m_state->handle = mpv_create();
    if (m_state->handle == nullptr) {
        qCritical() << "Creating the libmpv client failed";
        m_state->fatalFailure.store(true);
        setStatus(QStringLiteral("The video player could not start"));
        return;
    }

    checkMpv(mpv_set_option_string(m_state->handle, "vo", "libmpv"), "Setting mpv video output");
    checkMpv(mpv_set_option_string(m_state->handle, "terminal", "no"), "Disabling mpv terminal output");
    checkMpv(mpv_set_option_string(m_state->handle, "osc", "no"), "Disabling mpv controls");
    checkMpv(mpv_set_option_string(m_state->handle, "input-default-bindings", "no"),
             "Disabling mpv input bindings");
    checkMpv(mpv_set_option_string(m_state->handle, "input-vo-keyboard", "no"),
             "Disabling mpv keyboard input");
#ifdef Q_OS_LINUX
    // The appliance runs as a system user without a PipeWire session. Sending
    // every programme change through PipeWire makes its missing-client errors
    // accumulate, so use the HDMI ALSA device directly instead.
    checkMpv(mpv_set_option_string(m_state->handle, "ao", "alsa"),
             "Selecting ALSA audio output");
    const QByteArray audioDevice = qEnvironmentVariable("MABELTV_AUDIO_DEVICE").toUtf8();
    if (!audioDevice.isEmpty()) {
        checkMpv(mpv_set_option_string(m_state->handle, "audio-device", audioDevice.constData()),
                 "Selecting Mabel TV audio device");
    }
#endif
    QByteArray hardwareDecoder = qEnvironmentVariable("MABELTV_HWDEC").toUtf8();
    if (hardwareDecoder.isEmpty()) {
#ifdef Q_OS_LINUX
        hardwareDecoder = QByteArrayLiteral("auto-safe");
#else
        hardwareDecoder = QByteArrayLiteral("no");
#endif
    }
    checkMpv(mpv_set_option_string(m_state->handle, "hwdec", hardwareDecoder.constData()),
             "Configuring mpv hardware decoding");
    checkMpv(mpv_set_option_string(m_state->handle, "cache", "no"),
             "Disabling network cache for local media");
    checkMpv(mpv_set_option_string(m_state->handle, "demuxer-max-bytes", "33554432"),
             "Limiting mpv demux memory");
    checkMpv(mpv_set_option_string(m_state->handle, "demuxer-max-back-bytes", "8388608"),
             "Limiting mpv back-buffer memory");
#ifdef Q_OS_LINUX
    checkMpv(mpv_set_option_string(m_state->handle, "vd-lavc-threads", "2"),
             "Limiting decoder threads for Raspberry Pi");
#endif
    checkMpv(mpv_set_option_string(m_state->handle, "keep-open", "no"),
             "Configuring mpv end-of-file behaviour");
    checkMpv(mpv_set_option_string(m_state->handle, "idle", "yes"), "Configuring mpv idle mode");
    checkMpv(mpv_set_option_string(m_state->handle, "volume-max", "160"),
             "Allowing amplified Mabel TV playback volume");
    checkMpv(mpv_set_option_string(m_state->handle, "volume", "20"), "Setting initial mpv volume");

    const QByteArray logFile = qEnvironmentVariable("MABELTV_MPV_LOG").toUtf8();
    if (!logFile.isEmpty()) {
        checkMpv(mpv_set_option_string(m_state->handle, "log-file", logFile.constData()),
                 "Configuring the mpv diagnostic log");
        checkMpv(mpv_set_option_string(m_state->handle, "msg-level", "all=v"),
                 "Configuring mpv diagnostic verbosity");
    }
    if (!checkMpv(mpv_initialize(m_state->handle), "Initialising libmpv")) {
        mpv_terminate_destroy(m_state->handle);
        m_state->handle = nullptr;
        m_state->fatalFailure.store(true);
        setStatus(QStringLiteral("The video player could not start"));
        return;
    }
    qInfo().noquote() << "libmpv hardware decoding:" << hardwareDecoder;

    checkMpv(mpv_observe_property(m_state->handle, 1, "pause", MPV_FORMAT_FLAG),
             "Observing mpv pause state");
    checkMpv(mpv_observe_property(m_state->handle, 2, "hwdec-current", MPV_FORMAT_STRING),
             "Observing mpv hardware decoder");
    checkMpv(mpv_observe_property(m_state->handle, 3, "time-pos", MPV_FORMAT_DOUBLE),
             "Observing mpv playback position");
    checkMpv(mpv_observe_property(m_state->handle, 4, "duration", MPV_FORMAT_DOUBLE),
             "Observing mpv programme duration");
    mpv_set_wakeup_callback(m_state->handle, wakeup, this);
}

MpvVideo::~MpvVideo()
{
    if (m_state && m_state->handle != nullptr) {
        mpv_set_wakeup_callback(m_state->handle, nullptr, nullptr);
    }
}

QQuickFramebufferObject::Renderer *MpvVideo::createRenderer() const
{
    return new MpvRenderer(const_cast<MpvVideo *>(this), m_state);
}

QUrl MpvVideo::source() const
{
    return m_source;
}

void MpvVideo::setSource(const QUrl &source)
{
    if (m_source == source) {
        return;
    }

    m_source = source;
    emit sourceChanged();

    if (source.isEmpty()) {
        setStatus(QStringLiteral("No media selected"));
        return;
    }
    if (m_state->handle == nullptr) {
        reportFatalFailure(QStringLiteral("The video player is unavailable"));
        return;
    }

    if (m_state->renderReady.load()) {
        loadCurrentSource();
    } else {
        setStatus(QStringLiteral("Preparing video"));
    }
}

QString MpvVideo::status() const
{
    return m_status;
}

bool MpvVideo::paused() const
{
    return m_paused;
}

int MpvVideo::volume() const
{
    return m_volume;
}

void MpvVideo::setVolume(int volume)
{
    volume = std::clamp(volume, 0, 100);
    if (m_volume == volume) {
        return;
    }

    m_volume = volume;
    if (m_state->handle == nullptr) {
        emit volumeChanged();
        return;
    }
    const QByteArray value = QByteArray::number(outputVolume(volume));
    const char *command[] = {"set", "volume", value.constData(), nullptr};
    checkMpv(mpv_command_async(m_state->handle, 0, command), "Setting volume");
    emit volumeChanged();
}

bool MpvVideo::muted() const
{
    return m_muted;
}

void MpvVideo::setMuted(bool muted)
{
    if (m_muted == muted) {
        return;
    }

    m_muted = muted;
    if (m_state->handle == nullptr) {
        emit mutedChanged();
        return;
    }
    const char *command[] = {"set", "mute", muted ? "yes" : "no", nullptr};
    checkMpv(mpv_command_async(m_state->handle, 0, command), "Setting mute");
    emit mutedChanged();
}

QString MpvVideo::aspectMode() const
{
    return m_aspectMode;
}

void MpvVideo::setAspectMode(const QString &aspectMode)
{
    const QString normalised = aspectMode == QStringLiteral("fit")
                                   || aspectMode == QStringLiteral("stretch")
                               ? aspectMode
                               : QStringLiteral("crop");
    const bool changed = m_aspectMode != normalised;
    m_aspectMode = normalised;
    if (m_state->handle == nullptr) {
        if (changed) {
            emit aspectModeChanged();
        }
        return;
    }
    const char *panscan[] = {"set", "panscan", normalised == QStringLiteral("crop") ? "1" : "0", nullptr};
    checkMpv(mpv_command_async(m_state->handle, 0, panscan), "Setting picture crop mode");
    const char *aspect[] = {
        "set",
        "video-aspect-override",
        normalised == QStringLiteral("stretch") ? "4:3" : "no",
        nullptr,
    };
    checkMpv(mpv_command_async(m_state->handle, 0, aspect), "Setting picture aspect mode");
    if (changed) {
        emit aspectModeChanged();
    }
}

void MpvVideo::play(const QUrl &source, double startPositionSeconds)
{
    const double safeStartPosition = std::max(0.0, startPositionSeconds);
    if (m_stopPending) {
        // stop and loadfile are both asynchronous libmpv commands. Queueing a
        // replacement load until MPV_EVENT_END_FILE prevents a rapid
        // Back -> OK sequence from overlapping decoder teardown and startup.
        m_queuedSource = source;
        m_queuedStartPosition = safeStartPosition;
        m_hasQueuedPlay = true;
        resetPlaybackTelemetry(safeStartPosition);
        setStatus(QStringLiteral("Waiting for previous playback to stop"));
        return;
    }
    beginPlay(source, safeStartPosition);
}

void MpvVideo::beginPlay(const QUrl &source, double startPositionSeconds)
{
    m_pendingStartPosition = startPositionSeconds;
    resetPlaybackTelemetry(startPositionSeconds);
    if (m_state->handle == nullptr) {
        setSource(source);
        return;
    }
    if (m_source == source && !source.isEmpty()) {
        if (m_state->renderReady.load()) {
            loadCurrentSource();
        } else {
            setStatus(QStringLiteral("Preparing video"));
        }
        return;
    }
    setSource(source);
}

void MpvVideo::stop()
{
    // A second stop (for example closing Adult Mode while a previous stop is
    // still draining) cancels any queued replay without issuing another
    // command into the same decoder teardown.
    m_hasQueuedPlay = false;
    m_queuedSource = QUrl();
    m_queuedStartPosition = 0.0;
    resetPlaybackTelemetry();
    if (m_state->handle == nullptr) {
        setStatus(QStringLiteral("Stopped"));
        emit playbackStopped();
        return;
    }
    if (m_stopPending) {
        setStatus(QStringLiteral("Stopping"));
        return;
    }
    if (!m_fileActive && m_status != QStringLiteral("Loading")
        && m_status != QStringLiteral("Preparing video")) {
        setStatus(QStringLiteral("Stopped"));
        emit playbackStopped();
        return;
    }

    m_stopPending = true;
    const char *command[] = {"stop", nullptr};
    if (!checkMpv(mpv_command_async(m_state->handle, 1002, command), "Stopping playback")) {
        m_stopPending = false;
        setStatus(QStringLiteral("The video player did not stop cleanly"));
        return;
    }
    setStatus(QStringLiteral("Stopping"));
}

void MpvVideo::togglePause()
{
    if (m_state->handle == nullptr) {
        return;
    }
    const char *command[] = {"cycle", "pause", nullptr};
    checkMpv(mpv_command_async(m_state->handle, 0, command), "Toggling pause");
}

double MpvVideo::positionSeconds() const
{
    // Never synchronously query libmpv from the Qt UI thread. Property values
    // are observed asynchronously and cached by processMpvEvents().
    return m_playbackPosition;
}

double MpvVideo::durationSeconds() const
{
    return m_playbackDuration;
}

void MpvVideo::seekRelative(double seconds)
{
    if (m_state->handle == nullptr || !std::isfinite(seconds)) {
        return;
    }
    const QByteArray value = QByteArray::number(seconds, 'f', 3);
    const char *command[] = {"seek", value.constData(), "relative+exact", nullptr};
    checkMpv(mpv_command_async(m_state->handle, 0, command), "Seeking within adult media");
}

void MpvVideo::seekAbsolute(double seconds)
{
    if (m_state->handle == nullptr || !std::isfinite(seconds)) {
        return;
    }
    const QByteArray value = QByteArray::number(std::max(0.0, seconds), 'f', 3);
    const char *command[] = {"seek", value.constData(), "absolute+exact", nullptr};
    checkMpv(mpv_command_async(m_state->handle, 0, command), "Seeking within adult media");
}

std::uint64_t MpvVideo::renderedFrameCount() const
{
    return m_state->renderedFrames.load(std::memory_order_relaxed);
}

bool MpvVideo::available() const
{
    return m_state->handle != nullptr && !m_state->fatalFailure.load();
}

void MpvVideo::reportFatalFailure(const QString &message)
{
    const bool wasFatal = m_state->fatalFailure.exchange(true);
    setStatus(message);
    if (!wasFatal) {
        emit fatalPlayerFailure(message);
    }
}

void MpvVideo::wakeup(void *context)
{
    auto *item = static_cast<MpvVideo *>(context);
    QMetaObject::invokeMethod(item, &MpvVideo::processMpvEvents, Qt::QueuedConnection);
}

void MpvVideo::handleRenderContextReady()
{
    if (m_state->handle != nullptr && !m_source.isEmpty()) {
        loadCurrentSource();
    }
}

void MpvVideo::loadCurrentSource()
{
    if (m_state->handle == nullptr) {
        const QString message = QStringLiteral("The video player is unavailable");
        reportFatalFailure(message);
        return;
    }
    const QString localPath = m_source.isLocalFile() ? m_source.toLocalFile() : m_source.toString();
    const QByteArray encodedPath = QFileInfo(localPath).absoluteFilePath().toUtf8();
    qInfo().noquote() << "Loading media:" << QDir::toNativeSeparators(QString::fromUtf8(encodedPath));
    const char *unpause[] = {"set", "pause", "no", nullptr};
    if (!checkMpv(mpv_command_async(m_state->handle, 0, unpause),
                  "Clearing pause for new media")) {
        const QString message = QStringLiteral("The video player did not accept a new programme");
        setStatus(message);
        emit playbackFailed(message);
        return;
    }
    const char *command[] = {"loadfile", encodedPath.constData(), "replace", nullptr};
    if (!checkMpv(mpv_command_async(m_state->handle, 1001, command), "Loading media")) {
        const QString message = QStringLiteral("The programme could not be opened");
        setStatus(message);
        emit playbackFailed(message);
        return;
    }
    setStatus(QStringLiteral("Loading"));
}

void MpvVideo::finishPendingStop()
{
    if (!m_stopPending) {
        return;
    }

    m_stopPending = false;
    setStatus(QStringLiteral("Stopped"));
    if (!m_hasQueuedPlay) {
        emit playbackStopped();
        return;
    }

    const QUrl queuedSource = m_queuedSource;
    const double queuedStartPosition = m_queuedStartPosition;
    m_hasQueuedPlay = false;
    m_queuedSource = QUrl();
    m_queuedStartPosition = 0.0;
    beginPlay(queuedSource, queuedStartPosition);
}

void MpvVideo::resetPlaybackTelemetry(double positionSeconds)
{
    setPlaybackPosition(positionSeconds);
    setPlaybackDuration(0.0);
}

void MpvVideo::setPlaybackPosition(double positionSeconds)
{
    const double safePosition = std::isfinite(positionSeconds)
        ? std::max(0.0, positionSeconds)
        : 0.0;
    if (qFuzzyCompare(m_playbackPosition + 1.0, safePosition + 1.0)) {
        return;
    }
    m_playbackPosition = safePosition;
    emit playbackPositionChanged();
}

void MpvVideo::setPlaybackDuration(double durationSeconds)
{
    const double safeDuration = std::isfinite(durationSeconds)
        ? std::max(0.0, durationSeconds)
        : 0.0;
    if (qFuzzyCompare(m_playbackDuration + 1.0, safeDuration + 1.0)) {
        return;
    }
    m_playbackDuration = safeDuration;
    emit playbackDurationChanged();
}

void MpvVideo::processMpvEvents()
{
    if (m_state->handle == nullptr) {
        return;
    }
    while (true) {
        mpv_event *event = mpv_wait_event(m_state->handle, 0.0);
        if (event == nullptr || event->event_id == MPV_EVENT_NONE) {
            return;
        }

        switch (event->event_id) {
        case MPV_EVENT_COMMAND_REPLY:
            if (event->reply_userdata == 1001 && event->error < 0) {
                const QString message = QStringLiteral("The programme could not be loaded: %1")
                                            .arg(QString::fromUtf8(mpv_error_string(event->error)));
                setStatus(message);
                emit playbackFailed(message);
            } else if (event->reply_userdata == 1002) {
                if (event->error < 0) {
                    qWarning("Stopping playback failed: %s", mpv_error_string(event->error));
                    m_fileActive = false;
                    finishPendingStop();
                } else if (!m_fileActive) {
                    finishPendingStop();
                }
            }
            break;
        case MPV_EVENT_SHUTDOWN: {
            const QString message = QStringLiteral("The video player stopped unexpectedly");
            qCritical().noquote() << message;
            reportFatalFailure(message);
            break;
        }
        case MPV_EVENT_START_FILE:
            m_fileActive = true;
            resetPlaybackTelemetry(m_pendingStartPosition);
            setStatus(QStringLiteral("Loading"));
            break;
        case MPV_EVENT_FILE_LOADED:
            if (m_pendingStartPosition > 0.05) {
                const QByteArray position = QByteArray::number(m_pendingStartPosition, 'f', 3);
                const char *seek[] = {"seek", position.constData(), "absolute+exact", nullptr};
                checkMpv(mpv_command_async(m_state->handle, 0, seek), "Seeking to broadcast position");
            }
            m_pendingStartPosition = 0.0;
            setStatus(QStringLiteral("Playing"));
            break;
        case MPV_EVENT_END_FILE: {
            const auto *end = static_cast<mpv_event_end_file *>(event->data);
            m_fileActive = false;
            resetPlaybackTelemetry();
            if (m_stopPending) {
                finishPendingStop();
            } else if (end != nullptr && end->reason == MPV_END_FILE_REASON_ERROR) {
                const QString message = QString::fromUtf8(mpv_error_string(end->error));
                qWarning().noquote() << "libmpv playback error:" << message;
                setStatus(QStringLiteral("Playback error: %1").arg(message));
                emit playbackFailed(message);
            } else if (end != nullptr && end->reason == MPV_END_FILE_REASON_EOF) {
                setStatus(QStringLiteral("Finished"));
                emit playbackFinished();
            }
            break;
        }
        case MPV_EVENT_PROPERTY_CHANGE: {
            const auto *change = static_cast<mpv_event_property *>(event->data);
            if (change == nullptr || change->name == nullptr) {
                break;
            }
            if (QByteArray(change->name) == QByteArrayLiteral("pause")
                && change->format == MPV_FORMAT_FLAG && change->data != nullptr) {
                const bool pausedNow = *static_cast<int *>(change->data) != 0;
                if (pausedNow != m_paused) {
                    m_paused = pausedNow;
                    emit pausedChanged();
                    if (pausedNow && m_fileActive) {
                        setStatus(QStringLiteral("Paused"));
                    } else if (!pausedNow && m_status == QStringLiteral("Paused")) {
                        setStatus(QStringLiteral("Playing"));
                    }
                }
            } else if (QByteArray(change->name) == QByteArrayLiteral("hwdec-current")
                       && change->format == MPV_FORMAT_STRING) {
                const char *value = change->data != nullptr
                    ? *static_cast<char **>(change->data)
                    : nullptr;
                qInfo().noquote() << "Active hardware decoder:"
                                  << (value != nullptr ? value : "none (software fallback)");
            } else if (QByteArray(change->name) == QByteArrayLiteral("time-pos")) {
                if (change->format == MPV_FORMAT_DOUBLE && change->data != nullptr) {
                    setPlaybackPosition(*static_cast<double *>(change->data));
                } else {
                    setPlaybackPosition(m_pendingStartPosition);
                }
            } else if (QByteArray(change->name) == QByteArrayLiteral("duration")) {
                if (change->format == MPV_FORMAT_DOUBLE && change->data != nullptr) {
                    setPlaybackDuration(*static_cast<double *>(change->data));
                } else {
                    setPlaybackDuration(0.0);
                }
            }
            break;
        }
        default:
            break;
        }
    }
}

void MpvVideo::setStatus(QString status)
{
    if (m_status == status) {
        return;
    }

    m_status = std::move(status);
    emit statusChanged();
}
