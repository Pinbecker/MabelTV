#include "CoreTests.h"
#include "TestStateFixture.h"
#include "core/StateDatabase.h"
#include "core/TvController.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QTemporaryDir>
#include <QtTest>

void CoreTests::controllerPortalRetriesQuarantinedProgramme_data()
{
    QTest::addColumn<bool>("reregister");
    QTest::newRow("explicit-retry") << false;
    QTest::newRow("live-reregistration") << true;
}

void CoreTests::controllerPortalRetriesQuarantinedProgramme()
{
    QFETCH(bool, reregister);
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    const QString mediaRoot = directory.filePath(QStringLiteral("media"));
    QVERIFY(QDir(mediaRoot).mkpath(QStringLiteral("films")));
    const QString chosenName = QStringLiteral("The Gruffalos Child.mp4");
    const QString chosenPath = QDir(mediaRoot).filePath(QStringLiteral("films/") + chosenName);
    const QString nextPath = QDir(mediaRoot).filePath(QStringLiteral("films/The Highway Rat.mp4"));
    for (const QString &path : {chosenPath, nextPath}) {
        QFile media(path);
        QVERIFY(media.open(QIODevice::WriteOnly));
        media.write("film");
    }
    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({"channels":[
        {"number":6,"name":"Julia Donaldson","folder":"films","content_type":"films"}
    ]})");
    configuration.close();
    QFile settings(directory.filePath(QStringLiteral("settings.json")));
    QVERIFY(settings.open(QIODevice::WriteOnly));
    settings.write(R"({"playback_mode":"resume","tv_guide_enabled":true})");
    settings.close();

    TvController controller;
    QVERIFY(TestStateFixture::initializeController(
        controller, configuration.fileName(), settings.fileName(), mediaRoot,
        directory.filePath(QStringLiteral("state.json")), [](const QString &) {
            return MediaInspection{true, true, 600.0, QStringLiteral("h264"), {}};
        }));
    QSignalSpy requests(&controller, &TvController::playbackRequested);
    QSignalSpy stops(&controller, &TvController::stopPlaybackRequested);
    controller.playPortalProgramme(6, chosenName, 0.0);
    QTRY_COMPARE_WITH_TIMEOUT(requests.count(), 1, 1500);
    QCOMPARE(requests.last().at(0).toUrl().toLocalFile(), chosenPath);
    controller.playbackFailed(QStringLiteral("historical transient failure"));
    QTRY_COMPARE_WITH_TIMEOUT(requests.count(), 2, 1500);
    QCOMPARE(requests.last().at(0).toUrl().toLocalFile(), nextPath);
    const QString database = TestStateFixture::databasePath(controller);
    const auto failed = [&]() {
        return mabeltv::state::player(database)
            .value(QStringLiteral("channel_timelines")).toObject()
            .value(QStringLiteral("6")).toObject()
            .value(QStringLiteral("failed_programmes")).toObject();
    };
    QVERIFY(failed().contains(chosenName));

    if (reregister) {
        // The installed player can forget a stale failure through its existing
        // filename lifecycle, without touching SQLite or restarting playback.
        controller.start();
        QTRY_COMPARE_WITH_TIMEOUT(requests.count(), 3, 1500);
        requests.clear();
        stops.clear();
        const QString temporaryPath = chosenPath + QStringLiteral(".recheck.mp4");
        QString currentPath = chosenPath;
        for (const QString &replacement : {temporaryPath, chosenPath}) {
            QVERIFY(QFile::rename(currentPath, replacement));
            currentPath = replacement;
            QJsonObject entries;
            for (const QString &path : {currentPath, nextPath}) {
                const QFileInfo info(path);
                entries.insert(info.absoluteFilePath(), QJsonObject{
                    {QStringLiteral("size"), static_cast<double>(info.size())},
                    {QStringLiteral("modified_utc_ms"),
                     static_cast<double>(info.lastModified().toMSecsSinceEpoch())},
                    {QStringLiteral("usable"), true}, {QStringLiteral("inspected"), true},
                    {QStringLiteral("duration_seconds"), 600.0},
                    {QStringLiteral("video_codec"), QStringLiteral("h264")},
                    {QStringLiteral("error"), QString()}});
            }
            QFile cache(directory.filePath(QStringLiteral("media-index.json")));
            QVERIFY(cache.open(QIODevice::WriteOnly));
            cache.write(QJsonDocument(QJsonObject{
                {QStringLiteral("schema_version"), 1}, {QStringLiteral("entries"), entries}}).toJson());
            cache.close();
            QSignalSpy changes(&controller, &TvController::parentLibraryChanged);
            controller.reloadLibrary();
            QTRY_COMPARE_WITH_TIMEOUT(changes.count(), 1, 10000);
            QCOMPARE(requests.count(), 0);
            QCOMPARE(stops.count(), 0);
            QVERIFY(!controller.tuning());
            QVERIFY(!failed().contains(chosenName));
        }
    }

    requests.clear();
    controller.playPortalProgramme(6, chosenName, 75.0);
    QTRY_COMPARE_WITH_TIMEOUT(requests.count(), 1, 1500);
    QCOMPARE(requests.last().at(0).toUrl().toLocalFile(), chosenPath);
    QCOMPARE(requests.last().at(1).toDouble(), 75.0);
    QVERIFY(!failed().contains(chosenName));
}
