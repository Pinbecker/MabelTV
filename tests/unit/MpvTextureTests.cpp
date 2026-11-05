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
        QFile image(directory.filePath("colours.ppm"));
        QVERIFY(image.open(QIODevice::WriteOnly));
        image.write("P6\n64 32\n255\n");
        for (int y=0;y<32;++y) for (int x=0;x<64;++x)
            image.write(y<16 ? QByteArray::fromHex("ff0000") : QByteArray::fromHex("00ff00"));
        image.close();
        QQuickWindow window;
        const QColor background(18,52,86);
        window.setColor(background); window.resize(96,64);
        auto *video = new MpvVideo(window.contentItem());
        video->setSize(QSizeF(96,64)); video->setAspectMode("fit");
        window.show(); video->setSource(QUrl::fromLocalFile(image.fileName()));
        QTRY_VERIFY_WITH_TIMEOUT(video->videoWidth()==64,5000);
        QImage original;
        const auto picturePresented = [&] {
            original = window.grabWindow();
            return !original.isNull() && original.pixelColor(48,16).red()>200
                && original.pixelColor(48,48).green()>200;
        };
        // Header discovery precedes the first rendered frame. Pausing on width
        // alone can freeze a still-empty framebuffer on a slower CI worker.
        QTRY_VERIFY_WITH_TIMEOUT(picturePresented(),5000);
        video->togglePause();
        QTRY_VERIFY_WITH_TIMEOUT(video->paused(),5000);
        QVERIFY(!original.isNull());
        QVERIFY(original.pixelColor(48,16).red()>200);
        QVERIFY(original.pixelColor(48,48).green()>200);
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
