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
void checkMpv(int result, const char *operation)
{
    if (result < 0) {
        qFatal("%s failed: %s", operation, mpv_error_string(result));
    }
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

        mpv_render_context_render(context, parameters);
        QQuickOpenGLUtils::resetOpenGLState();
    }

private:
    void ensureRenderContext()
    {
        if (m_state->renderContext.load() != nullptr) {
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
        checkMpv(mpv_render_context_create(&context, m_state->handle, parameters),
                 "Creating the libmpv OpenGL render context");
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
        qFatal("Creating the libmpv client failed");
    }

    checkMpv(mpv_set_option_string(m_state->handle, "vo", "libmpv"), "Setting mpv video output");
    checkMpv(mpv_set_option_string(m_state->handle, "terminal", "no"), "Disabling mpv terminal output");
    checkMpv(mpv_set_option_string(m_state->handle, "osc", "no"), "Disabling mpv controls");
    checkMpv(mpv_set_option_string(m_state->handle, "input-default-bindings", "no"),
             "Disabling mpv input bindings");
    checkMpv(mpv_set_option_string(m_state->handle, "input-vo-keyboard", "no"),
             "Disabling mpv keyboard input");
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
    checkMpv(mpv_set_option_string(m_state->handle, "volume", "20"), "Setting initial mpv volume");

    const QByteArray logFile = qEnvironmentVariable("MABELTV_MPV_LOG").toUtf8();
    if (!logFile.isEmpty()) {
        checkMpv(mpv_set_option_string(m_state->handle, "log-file", logFile.constData()),
                 "Configuring the mpv diagnostic log");
        checkMpv(mpv_set_option_string(m_state->handle, "msg-level", "all=v"),
                 "Configuring mpv diagnostic verbosity");
    }
    checkMpv(mpv_initialize(m_state->handle), "Initialising libmpv");
    qInfo().noquote() << "libmpv hardware decoding:" << hardwareDecoder;

    checkMpv(mpv_observe_property(m_state->handle, 1, "pause", MPV_FORMAT_FLAG),
             "Observing mpv pause state");
    checkMpv(mpv_observe_property(m_state->handle, 2, "hwdec-current", MPV_FORMAT_STRING),
             "Observing mpv hardware decoder");
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
    const QByteArray value = QByteArray::number(volume);
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
    m_pendingStartPosition = std::max(0.0, startPositionSeconds);
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
    const char *command[] = {"stop", nullptr};
    checkMpv(mpv_command_async(m_state->handle, 0, command), "Stopping playback");
    setStatus(QStringLiteral("Stopped"));
}

void MpvVideo::togglePause()
{
    const char *command[] = {"cycle", "pause", nullptr};
    checkMpv(mpv_command_async(m_state->handle, 0, command), "Toggling pause");
}

void MpvVideo::replay()
{
    const char *command[] = {"seek", "0", "absolute+exact", nullptr};
    checkMpv(mpv_command_async(m_state->handle, 0, command), "Seeking to the beginning");
    const char *unpause[] = {"set", "pause", "no", nullptr};
    checkMpv(mpv_command_async(m_state->handle, 0, unpause), "Resuming playback");
}

void MpvVideo::wakeup(void *context)
{
    auto *item = static_cast<MpvVideo *>(context);
    QMetaObject::invokeMethod(item, &MpvVideo::processMpvEvents, Qt::QueuedConnection);
}

void MpvVideo::handleRenderContextReady()
{
    if (!m_source.isEmpty()) {
        loadCurrentSource();
    }
}

void MpvVideo::loadCurrentSource()
{
    const QString localPath = m_source.isLocalFile() ? m_source.toLocalFile() : m_source.toString();
    const QByteArray encodedPath = QFileInfo(localPath).absoluteFilePath().toUtf8();
    qInfo().noquote() << "Loading media:" << QDir::toNativeSeparators(QString::fromUtf8(encodedPath));
    const char *command[] = {"loadfile", encodedPath.constData(), "replace", nullptr};
    checkMpv(mpv_command_async(m_state->handle, 0, command), "Loading media");
    setStatus(QStringLiteral("Loading"));
}

void MpvVideo::processMpvEvents()
{
    while (true) {
        mpv_event *event = mpv_wait_event(m_state->handle, 0.0);
        if (event == nullptr || event->event_id == MPV_EVENT_NONE) {
            return;
        }

        switch (event->event_id) {
        case MPV_EVENT_START_FILE:
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
            if (end != nullptr && end->reason == MPV_END_FILE_REASON_ERROR) {
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
                    setStatus(pausedNow ? QStringLiteral("Paused") : QStringLiteral("Playing"));
                }
            } else if (QByteArray(change->name) == QByteArrayLiteral("hwdec-current")
                       && change->format == MPV_FORMAT_STRING) {
                const char *value = change->data != nullptr
                    ? *static_cast<char **>(change->data)
                    : nullptr;
                qInfo().noquote() << "Active hardware decoder:"
                                  << (value != nullptr ? value : "none (software fallback)");
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
