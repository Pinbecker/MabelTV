#include "media/MpvVideo.h"
#include <QFile>
#include <QQmlComponent>
#include <QQmlContext>
#include <QQmlEngine>
#include <QQuickWindow>
#include <QSGRendererInterface>
#include <QTemporaryDir>
#include <QtTest>
#include <clocale>

class MpvTextureTests : public QObject {
    Q_OBJECT
private slots:
    void textureProviderWorksWithoutAnUnwarpedQuad() {
        QTemporaryDir directory;
        QVERIFY(directory.isValid());
        QFile image(directory.filePath("colours.y4m"));
        QVERIFY(image.open(QIODevice::WriteOnly));
        image.write("YUV4MPEG2 W64 H32 F25:1 Ip A1:1 C420jpeg\n");
        // A real multi-frame video avoids image-demuxer EOF while waiting for
        // the first displayed picture on different libmpv/Qt versions.
        for (int frame=0;frame<250;++frame) {
            image.write("FRAME\n");
            image.write(QByteArray(64*16,char(81))+QByteArray(64*16,char(145)));
            image.write(QByteArray(32*8,char(90))+QByteArray(32*8,char(54)));
            image.write(QByteArray(32*8,char(240))+QByteArray(32*8,char(34)));
        }
        image.close();
        QQuickWindow window;
        QSignalSpy presented(&window,&QQuickWindow::frameSwapped);
        const QColor background(18,52,86);
        window.setColor(background); window.resize(96,64);
        auto *video = new MpvVideo(window.contentItem());
        video->setSize(QSizeF(96,64)); video->setAspectMode("fit");
        window.show(); video->setSource(QUrl::fromLocalFile(image.fileName()));
        QVERIFY(QTest::qWaitForWindowExposed(&window));
        QTRY_VERIFY_WITH_TIMEOUT(video->videoWidth()==64,5000);
        // Header discovery precedes the first rendered frame. Pausing on width
        // alone can freeze a still-empty framebuffer on a slower CI worker.
        // Keep the GUI event loop free while libmpv finishes that frame.
        QTRY_VERIFY_WITH_TIMEOUT(video->renderedFrameCount()>=3,5000);
        QTRY_VERIFY_WITH_TIMEOUT(video->positionSeconds()>=0.2,5000);
        // A render callback / playback clock can precede the first coloured
        // texture actually reaching Qt's window. Establish that observable
        // frame before pausing, then independently check the paused capture.
        const auto picturePresented = [&window] {
            const auto frame = window.grabWindow();
            return !frame.isNull() && frame.pixelColor(48,16).red()>200
                && frame.pixelColor(48,48).green()>200;
        };
        QTRY_VERIFY_WITH_TIMEOUT(picturePresented(),5000);
        video->togglePause();
        QTRY_VERIFY_WITH_TIMEOUT(video->paused(),5000);
        const int beforePresentation=presented.count();
        window.update();
        QTRY_VERIFY_WITH_TIMEOUT(presented.count()>beforePresentation,5000);
        const QImage original=window.grabWindow();
        if (!original.isNull() && original.pixelColor(48,16).red()<=200)
            original.save(QDir::current().filePath("mpv-texture-original.png"));
        QVERIFY(!original.isNull());
        QVERIFY2(original.pixelColor(48,16).red()>200,qPrintable(QStringLiteral("top=%1 bottom=%2").arg(original.pixelColor(48,16).name(),original.pixelColor(48,48).name())));
        QVERIFY2(original.pixelColor(48,48).green()>200,qPrintable(original.pixelColor(48,48).name()));
        for (int y=12;y<28;++y) for (int x=12;x<84;++x) {
            QVERIFY2(original.pixelColor(x,y).red()>200,"The solid red picture contains corrupted pixels");
            QVERIFY2(original.pixelColor(x,y+24).green()>200,"The solid green picture contains corrupted pixels");
        }
        video->setTextureOnly(true); QTest::qWait(100);
        const QImage hidden=window.grabWindow();
        QCOMPARE(hidden.pixelColor(48,16),background);
        QQmlEngine engine;
        engine.rootContext()->setContextProperty("videoSource",video);
        QQmlComponent component(&engine);
        component.setData(R"(import QtQuick
            ShaderEffect {
                width:96; height:64
                property variant source: videoSource
                fragmentShader:"qrc:/shaders/texture-copy.frag.qsb"
            })",QUrl());
        QScopedPointer<QObject> effect(component.create());
        QVERIFY2(effect,qPrintable(component.errorString()));
        qobject_cast<QQuickItem*>(effect.data())->setParentItem(window.contentItem());
        QTest::qWait(250);
        const QImage sampled=window.grabWindow();
        QCOMPARE(sampled.pixelColor(48,16),original.pixelColor(48,16));
        QCOMPARE(sampled.pixelColor(48,48),original.pixelColor(48,48));
        effect.reset(); video->setTextureOnly(false); QTest::qWait(100);
        const QImage restored=window.grabWindow();
        QCOMPARE(restored.pixelColor(48,16),original.pixelColor(48,16));
        QCOMPARE(restored.pixelColor(48,48),original.pixelColor(48,48));
    }
};
int main(int argc,char **argv) {
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
    QGuiApplication app(argc,argv);
    std::setlocale(LC_NUMERIC,"C");
    MpvTextureTests test; return QTest::qExec(&test,argc,argv);
}
#include "MpvTextureTests.moc"
