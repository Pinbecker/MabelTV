#include "FrameCapture.h"
#include <QDir>
#include <QDebug>
#include <QFile>
#include <QFileInfo>
#include <QImage>
#include <QOpenGLContext>
#include <QOpenGLFunctions>
#include <QQuickWindow>
#include <QTimer>
#include <atomic>
#include <memory>

void FrameCapture::enable(QQuickWindow *window)
{
    if (!window || qEnvironmentVariable("MABELTV_FRAME_CAPTURE") != "1") return;
    const QString directory = QStringLiteral("/run/mabeltv/frame-capture");
    if (!QDir().mkpath(directory) || !QFile::setPermissions(directory,
            QFileDevice::ReadOwner | QFileDevice::WriteOwner | QFileDevice::ExeOwner)) return;
    auto pending = std::make_shared<std::atomic<int>>(-1);
    auto *timer = new QTimer(window);
    timer->setInterval(1000);
    QObject::connect(timer,&QTimer::timeout,window,[window,timer,directory,pending,count=0]() mutable {
        const QString request = directory + QStringLiteral("/request");
        if (pending->load()>=0 || !QFileInfo::exists(request) || !QFile::remove(request)) return;
        pending->store(count++); window->update();
        if (count==3) timer->stop();
    });
    // Read the actual completed OpenGL render pass, without initiating another
    // scene render or racing a reused DRM scanout buffer. Images remain private.
    QObject::connect(window,&QQuickWindow::afterRenderPassRecording,window,
        [window,directory,pending]() {
            const int index=pending->exchange(-1);
            if (index<0) return;
            window->beginExternalCommands();
            auto *context=QOpenGLContext::currentContext();
            if (!context) { window->endExternalCommands(); return; }
            auto *gl=context->functions();
            GLint viewport[4],framebuffer=0;
            gl->glGetIntegerv(GL_VIEWPORT,viewport);
            gl->glGetIntegerv(GL_FRAMEBUFFER_BINDING,&framebuffer);
            QImage frame(viewport[2],viewport[3],QImage::Format_RGBA8888);
            if (frame.isNull()) { window->endExternalCommands(); return; }
            gl->glReadPixels(viewport[0],viewport[1],viewport[2],viewport[3],GL_RGBA,GL_UNSIGNED_BYTE,frame.bits());
            window->endExternalCommands();
            frame=frame.mirrored();
            QMetaObject::invokeMethod(window,[directory,index,frame,framebuffer]() {
                const QString output=directory+QStringLiteral("/frame-%1.png").arg(index);
                if (QFileInfo(output).isSymLink() || !frame.save(output)) return;
                QFile::setPermissions(output,QFileDevice::ReadOwner | QFileDevice::WriteOwner);
                qInfo().noquote()<<"Completed native render capture:"<<output<<"framebuffer"<<framebuffer;
            },Qt::QueuedConnection);
        },Qt::DirectConnection);
    QTimer::singleShot(600000,timer,&QTimer::stop);
    timer->start();
}
