#include "DisplayRefresh.h"

#include <QDebug>
#include <QDir>
#include <QFileInfo>
#include <QGuiApplication>
#include <QPointer>
#include <QQuickWindow>
#include <QRunnable>
#include <QTimer>

#include <atomic>
#include <cstring>

#ifdef MABELTV_HAVE_DRM
#include <unistd.h>
#include <xf86drm.h>
#include <xf86drmMode.h>
#endif

namespace mabeltv::display {
namespace {
QPointer<QObject> activeOwner;
std::atomic_uint64_t generation{0};

#ifdef MABELTV_HAVE_DRM
double rate(const drmModeModeInfo &mode)
{
    return mode.htotal && mode.vtotal ? mode.clock * 1000.0 / mode.htotal / mode.vtotal : 0;
}

// Reuse our own Qt-owned DRM master, never take the display from another process.
int displayFd()
{
    const QDir descriptors(QStringLiteral("/proc/self/fd"));
    for (const auto &name : descriptors.entryList(QDir::Files | QDir::System | QDir::NoDotAndDotDot)) {
        const QFileInfo descriptor(descriptors.filePath(name));
        if (!descriptor.symLinkTarget().startsWith(QStringLiteral("/dev/dri/card"))) continue;
        bool ok = false;
        const int fd = name.toInt(&ok);
        if (ok && drmIsMaster(fd)) return dup(fd);
    }
    return -1;
}

bool setMode(int fd, uint32_t crtc, const drmModeModeInfo &mode)
{
    uint32_t property = 0, blob = 0;
    auto *properties = drmModeObjectGetProperties(fd, crtc, DRM_MODE_OBJECT_CRTC);
    if (!properties) return false;
    for (uint32_t i = 0; i < properties->count_props; ++i) {
        auto *value = drmModeGetProperty(fd, properties->props[i]);
        if (value && !std::strcmp(value->name, "MODE_ID")) property = value->prop_id;
        if (value) drmModeFreeProperty(value);
    }
    drmModeFreeObjectProperties(properties);
    if (!property || drmModeCreatePropertyBlob(fd, &mode, sizeof(mode), &blob)) return false;
    auto *request = drmModeAtomicAlloc();
    bool changed = false;
    if (request && drmModeAtomicAddProperty(request, crtc, property, blob) >= 0) {
        // Same resolution/planes; validate the complete current display state first.
        const uint32_t flags = DRM_MODE_ATOMIC_ALLOW_MODESET;
        if (!drmModeAtomicCommit(fd, request, flags | DRM_MODE_ATOMIC_TEST_ONLY, nullptr))
            changed = !drmModeAtomicCommit(fd, request, flags, nullptr);
    }
    if (request) drmModeAtomicFree(request);
    drmModeDestroyPropertyBlob(fd, blob);
    return changed;
}

void match(double fps)
{
    const int fd = displayFd();
    if (fd < 0) { qWarning() << "Display timing: no owned DRM master; mode unchanged"; return; }
    auto *resources = drmModeGetResources(fd);
    if (!resources) { close(fd); return; }
    for (int c = 0; c < resources->count_connectors; ++c) {
        auto *connector = drmModeGetConnector(fd, resources->connectors[c]);
        if (!connector) continue;
        auto *encoder = connector->connection == DRM_MODE_CONNECTED && connector->encoder_id
            ? drmModeGetEncoder(fd, connector->encoder_id) : nullptr;
        auto *crtc = encoder && encoder->crtc_id ? drmModeGetCrtc(fd, encoder->crtc_id) : nullptr;
        if (crtc && crtc->mode_valid) {
            std::vector<double> rates;
            std::vector<drmModeModeInfo> modes;
            for (int i = 0; i < connector->count_modes; ++i) {
                const auto &mode = connector->modes[i];
                if (mode.hdisplay != crtc->mode.hdisplay || mode.vdisplay != crtc->mode.vdisplay
                    || mode.flags & (DRM_MODE_FLAG_INTERLACE | DRM_MODE_FLAG_DBLSCAN)) continue;
                modes.push_back(mode); rates.push_back(rate(mode));
            }
            const int chosen = chooseRate(fps, rates);
            if (chosen >= 0 && std::abs(rate(crtc->mode) - rates[chosen]) > .01) {
                if (setMode(fd, crtc->crtc_id, modes[chosen])) {
                    auto *checked = drmModeGetCrtc(fd, crtc->crtc_id);
                    const double actual = checked && checked->mode_valid ? rate(checked->mode) : 0;
                    qInfo() << "Display timing:" << fps << "fps ->" << crtc->mode.hdisplay
                            << "x" << crtc->mode.vdisplay << "at" << actual << "Hz";
                    if (checked) drmModeFreeCrtc(checked);
                } else qWarning() << "Display timing: refresh change rejected; mode unchanged";
            }
        }
        if (crtc) drmModeFreeCrtc(crtc);
        if (encoder) drmModeFreeEncoder(encoder);
        drmModeFreeConnector(connector);
    }
    drmModeFreeResources(resources);
    close(fd);
}
#else
void match(double) {}
#endif

class RefreshJob final : public QRunnable {
public:
    RefreshJob(double fps, uint64_t request) : m_fps(fps), m_request(request) {}
    void run() override { if (generation.load() == m_request) match(m_fps); }
private:
    double m_fps;
    uint64_t m_request;
};

bool enabled(QQuickWindow *window)
{
    return window && QGuiApplication::platformName() == QStringLiteral("eglfs")
        && qEnvironmentVariableIntValue("MABELTV_MATCH_REFRESH") == 1
        && qEnvironmentVariableIsEmpty("MABELTV_DRM_MODE");
}
}

void requestRefresh(QObject *owner, QQuickWindow *window, double fps)
{
    if (!enabled(window) || !std::isfinite(fps) || fps <= 0 || fps > 60.01) return;
    activeOwner = owner;
    const auto request = ++generation;
    // Runs after the preceding flip has completed, before Qt queues its next one.
    window->scheduleRenderJob(new RefreshJob(fps, request), QQuickWindow::BeforeSynchronizingStage);
    window->update();
}

void releaseRefresh(QObject *owner, QQuickWindow *window)
{
    if (!enabled(window) || activeOwner != owner) return;
    activeOwner.clear();
    const auto request = ++generation;
    QPointer<QQuickWindow> safeWindow(window);
    QTimer::singleShot(350, window, [safeWindow, request] {
        if (!safeWindow || generation.load() != request) return;
        safeWindow->scheduleRenderJob(new RefreshJob(0, request), QQuickWindow::BeforeSynchronizingStage);
        safeWindow->update();
    });
}
}
