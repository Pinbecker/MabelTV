#include "media/MpvVideo.h"
#include "media/MpvSubtitles.h"
#include "media/SubtitleText.h"
#include <QFile>
#include <QQuickWindow>
#include <QSGRendererInterface>
#include <QTemporaryDir>
#include <QtTest>
#include <clocale>

class SubtitleTests : public QObject {
    Q_OBJECT
private slots:
    void preservesSrtStylingAndEscapesContent() {
        const auto rich = subtitleRichText("{\\c&HFF00&}Green {\\i1}italic{\\i0}{\\c}\\NWhite {\\b1}bold{\\b0} & <img src='file:///private'>");
        QVERIFY(rich);
        QVERIFY(rich->contains("color:#00ff00"));
        QVERIFY(rich->contains("font-style:italic"));
        QVERIFY(rich->contains("color:#ffffff"));
        QVERIFY(rich->contains("font-weight:bold"));
        QVERIFY(rich->contains("<br>"));
        QVERIFY(rich->contains("&amp; &lt;img"));
        QVERIFY(!rich->contains("<img"));
        const auto blue = subtitleRichText("{\\1c&HFF0000&}Blue");
        QVERIFY(blue && blue->contains("color:#0000ff"));
    }

    void leavesComplexStylesToMpv() {
        for (const auto &text : {"{\\pos(20,20)}Top", "{\\an8}Top", "{\\p1}m 0 0 l 1 1",
                                 "{\\fad(100,200)}Fade", "{\\rOther}Style", "{\\c&HNO&}Bad", "{broken"})
            QVERIFY2(!subtitleRichText(text), text);
        QVERIFY(!subtitleRichText(QString(20000, 'x')));
    }

    void captionsFollowMpvWithoutRepaintingEveryFrame() {
        QTemporaryDir directory;
        QVERIFY(directory.isValid());
        const auto path = directory.filePath("captions.y4m");
        QFile videoFile(path);
        QVERIFY(videoFile.open(QIODevice::WriteOnly));
        videoFile.write("YUV4MPEG2 W64 H36 F50:1 Ip A1:1 C420jpeg\n");
        for (int frame = 0; frame < 1500; ++frame) {
            videoFile.write("FRAME\n");
            videoFile.write(QByteArray(64 * 18, char(81)) + QByteArray(64 * 18, char(41)));
            videoFile.write(QByteArray(32 * 9, char(90)) + QByteArray(32 * 9, char(240)));
            videoFile.write(QByteArray(32 * 9, char(240)) + QByteArray(32 * 9, char(110)));
        }
        videoFile.close();
        QFile srt(directory.filePath("captions.srt"));
        QVERIFY(srt.open(QIODevice::WriteOnly));
        srt.write("1\n00:00:00,100 --> 00:00:10,000\n<font color=\"#00ff00\">Green <i>italic</i></font>\nWhite <b>bold</b>\n\n"
                  "2\n00:00:12,000 --> 00:00:15,000\nSecond cue\n\n"
                  "3\n00:00:18,000 --> 00:00:22,000\n{\\an8}Top caption\n");
        srt.close();
        QQuickWindow window;
        window.resize(960, 540);
        auto *video = new MpvVideo(window.contentItem());
        video->setSize(QSizeF(960, 540));
        video->setAspectMode("fit");
        video->setSubtitleDefaultOn(true);
        video->setCachedSubtitles(true);
        window.show();
        QVERIFY(QTest::qWaitForWindowExposed(&window));
        video->play(QUrl::fromLocalFile(path));
        auto *captions = video->findChild<MpvSubtitles *>();
        QVERIFY(captions);
        QTRY_VERIFY_WITH_TIMEOUT(captions->active() && captions->caption().contains("Green"), 8000);
        QTRY_VERIFY(captions->paintCount() > 0);
        QTRY_VERIFY(video->subtitlesAvailable());
        QVERIFY(video->subtitlesVisible());
        // Let the first visible caption texture reach the window before
        // measuring repaint frequency (the initial show needs a second swap).
        QTRY_VERIFY(video->renderedFrameCount() >= 10);
        const auto renders = video->renderedFrameCount();
        const auto paints = captions->paintCount();
        QTRY_VERIFY(video->renderedFrameCount() > renders + 15);
        QCOMPARE(captions->paintCount(), paints);
        video->togglePause();
        QTRY_VERIFY(video->paused());
        const auto capture = window.grabWindow();
        QVERIFY(!capture.isNull());
        capture.save("subtitle-cached.png");
        QVERIFY(capture.pixelColor(480, 100).red() > 200);
        QVERIFY(capture.pixelColor(100, 450).blue() > 200);
        int greenPixels = 0, whitePixels = 0;
        for (int y = 360; y < 535; ++y) for (int x = 100; x < 860; ++x) {
            const auto pixel = capture.pixelColor(x, y);
            if (pixel.green() > 180 && pixel.red() < 80 && pixel.blue() < 80) ++greenPixels;
            if (pixel.green() > 180 && pixel.red() > 180 && pixel.blue() > 180) ++whitePixels;
        }
        QVERIFY2(greenPixels > 100, "The actual coloured subtitle was not drawn");
        QVERIFY2(whitePixels > 100, "The white subtitle line was not drawn");
        video->setCachedSubtitles(false);
        QTRY_VERIFY(!captions->isVisible());
        QTest::qWait(150);
        window.grabWindow().save("subtitle-native.png");
        video->setCachedSubtitles(true);
        QTRY_VERIFY(captions->isVisible());
        video->toggleSubtitles();
        QVERIFY(!video->subtitlesVisible());
        QTRY_VERIFY(!captions->isVisible());
        video->toggleSubtitles();
        QVERIFY(video->subtitlesVisible());
        QTRY_VERIFY(captions->isVisible());
        video->seekAbsolute(11);
        QTRY_VERIFY(captions->caption().isEmpty());
        QVERIFY(!captions->isVisible());
        video->seekAbsolute(13);
        QTRY_VERIFY(captions->caption().contains("Second cue"));
        QTRY_VERIFY(captions->isVisible());
        video->seekAbsolute(19);
        QTRY_VERIFY(!captions->active());
        QVERIFY(!captions->isVisible());
        const auto topCaptionVisible = [&window] {
            const auto frame = window.grabWindow();
            int bright = 0;
            if (frame.isNull()) return false;
            for (int y = 0; y < 160; ++y) for (int x = 100; x < 860; ++x) {
                const auto pixel = frame.pixelColor(x, y);
                if (pixel.red() > 180 && pixel.green() > 180 && pixel.blue() > 180) ++bright;
            }
            return bright > 100;
        };
        QTRY_VERIFY(topCaptionVisible());
        // Unsupported positioning falls back for this entire track, even
        // after seeking back to a simple cue.
        video->seekAbsolute(2);
        QTRY_VERIFY(video->positionSeconds() < 3);
        QVERIFY(!captions->active());
        QVERIFY(video->subtitlesVisible());
        video->stop();
        QTRY_VERIFY(video->status() == "Stopped");
        QVERIFY(captions->caption().isEmpty());
        video->play(QUrl::fromLocalFile(path));
        QTRY_VERIFY(captions->active() && captions->caption().contains("Green"));
        video->stop();
        QTRY_VERIFY(video->status() == "Stopped");
        video->setCachedSubtitles(false);
        QFile plain(directory.filePath("plain.y4m"));
        QVERIFY(QFile::copy(path, plain.fileName()));
        // No matching sidecar: the old track/caption cannot leak to this file.
        video->setSubtitleDefaultOn(false);
        video->play(QUrl::fromLocalFile(plain.fileName()));
        QTRY_VERIFY(video->positionSeconds() > 0.2);
        video->setCachedSubtitles(true);
        QTRY_VERIFY(!video->subtitlesAvailable());
        QVERIFY(!captions->active());
        QVERIFY(captions->caption().isEmpty());
        video->stop();
        QTRY_VERIFY(video->status() == "Stopped");
    }
};

int main(int argc, char **argv) {
    QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
    QGuiApplication app(argc, argv);
    std::setlocale(LC_NUMERIC, "C");
    SubtitleTests test;
    return QTest::qExec(&test, argc, argv);
}
#include "SubtitleTests.moc"
