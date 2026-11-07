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

void CoreTests::movedFilmKeepsPlaybackAndResume_data()
{
    QTest::addColumn<bool>("paused");
    QTest::newRow("playing") << false;
    QTest::newRow("paused") << true;
}

void CoreTests::movedFilmKeepsPlaybackAndResume()
{
    QFETCH(bool, paused);
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    QVERIFY(QDir(directory.path()).mkpath("media/films"));
    QVERIFY(QDir(directory.path()).mkpath("media/christmas"));
    const QString original = directory.filePath("media/films/The Grinch.mp4");
    const QString moved = directory.filePath("media/christmas/The Grinch.mp4");
    const auto write = [](const QString &path, const QByteArray &data) {
        QFile file(path); if (!file.open(QIODevice::WriteOnly)) return false;
        return file.write(data) == data.size();
    };
    QVERIFY(write(original, "film bytes"));
    QVERIFY(write(directory.filePath("channels.json"), R"({"channels":[
      {"number":5,"name":"Films","folder":"films","content_type":"films"},
      {"number":6,"name":"Christmas","folder":"christmas","content_type":"films"}]})"));
    QVERIFY(write(directory.filePath("settings.json"), R"({"playback_mode":"resume"})"));
    TvController controller;
    QVERIFY(TestStateFixture::initializeController(controller, directory.filePath("channels.json"),
        directory.filePath("settings.json"), directory.filePath("media"), directory.filePath("state.json"),
        [](const QString &) { return MediaInspection{true, true, 7200.0, QStringLiteral("h264"), {}}; }));
    QSignalSpy starts(&controller, &TvController::playbackRequested);
    QSignalSpy stops(&controller, &TvController::stopPlaybackRequested);
    controller.start();
    QTRY_COMPARE_WITH_TIMEOUT(starts.count(), 1, 1500);
    starts.clear();
    controller.playPortalProgramme(5, "The Grinch.mp4", 1200.0);
    QTRY_COMPARE_WITH_TIMEOUT(starts.count(), 1, 1500);
    controller.updatePlaybackPosition(1245.0, paused);
    QVERIFY(QFile::rename(original, moved));
    const QFileInfo info(moved);
    const QJsonObject inspection{{"size", double(info.size())},
        {"modified_utc_ms", double(info.lastModified().toUTC().toMSecsSinceEpoch())},
        {"usable", true}, {"inspected", true}, {"duration_seconds", 7200.0}, {"video_codec", "h264"}, {"error", ""}};
    QVERIFY(write(directory.filePath("media-index.json"), QJsonDocument(QJsonObject{
        {"schema_version", 1}, {"entries", QJsonObject{{info.absoluteFilePath(), inspection}}}}).toJson()));
    starts.clear(); stops.clear();
    controller.reloadLibrary();
    QTRY_COMPARE_WITH_TIMEOUT(controller.currentChannelNumber(), 6, 10000);
    QCOMPARE(starts.count(), 0); QCOMPARE(stops.count(), 0);
    const auto snapshot = mabeltv::state::player(TestStateFixture::databasePath(controller));
    const auto positions = snapshot.value("channel_film_positions").toObject();
    QVERIFY(!positions.contains("5/The Grinch.mp4"));
    QCOMPARE(positions.value("6/The Grinch.mp4").toDouble(), 1245.0);
    QCOMPARE(snapshot.value("playback_paused").toBool(), paused);
    const auto timeline = snapshot.value("channel_timelines").toObject().value("6").toObject();
    QCOMPARE(timeline.value("episode_name").toString(), QStringLiteral("The Grinch.mp4"));
    QVERIFY(timeline.value("position_seconds").toDouble() >= 1245.0);
    QVERIFY(timeline.value("position_seconds").toDouble() < 1260.0);
    controller.updatePlaybackPosition(1250.0, paused);
    const auto updated = mabeltv::state::player(TestStateFixture::databasePath(controller))
        .value("channel_film_positions").toObject();
    QCOMPARE(updated.value("6/The Grinch.mp4").toDouble(), 1250.0);
    QVERIFY(!updated.contains("5/The Grinch.mp4"));
}
