#include "core/TvController.h"
#include "hardware/CecTvControl.h"
#include "library/ChannelLibrary.h"
#include "library/ShuffleBag.h"

#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QTemporaryDir>
#include <QtTest>

#include <cmath>

class CoreTests final : public QObject
{
    Q_OBJECT

private slots:
    void shuffleBagVisitsEveryItemBeforeRepeating();
    void shuffleBagAvoidsImmediateRepeatAcrossRefill();
    void channelLibraryLoadsAndSortsValidChannels();
    void channelLibraryKeepsMissingFoldersAsNoSignalChannels();
    void controllerTunesNumericChannelsAndHonoursVolumeLimit();
    void controllerClearsNoSignalWhenReturningToPopulatedChannel();
    void controllerSkipsAnEpisodeAfterPlaybackFailure();
    void controllerDoesNotPersistWatchdogQuarantine();
    void controllerMovesBetweenProgrammesInFilenameOrder();
    void controllerRestartsStaleShowsButNeverFilms();
    void controllerDisplaysSeasonEpisodeOrFilmNameWhenProgrammeChanges();
    void controllerRestoresCorruptFilmPositionWithoutChangingFilm();
    void standbyWakeWaitsForWelcomeBeforeResumingPlayback();
    void cecFailureDoesNotBlockMabelTvStandbyOrWake();
    void remoteLockBlocksActionsAndPersists();
    void parentControlsRequireThreeConfirmationsAndPersistSettings();
    void tvGuideBuildsOrderedScheduleAndTunesChannels();
    void parentLibraryControlsPersistAndAffectPlayback();
    void adultLibraryIsSeparateAndParentOnly();
};

void CoreTests::shuffleBagVisitsEveryItemBeforeRepeating()
{
    ShuffleBag bag(4, 1973);
    QSet<int> firstRound;
    for (int index = 0; index < 4; ++index) {
        firstRound.insert(bag.take());
    }

    QCOMPARE(firstRound, QSet<int>({0, 1, 2, 3}));
}

void CoreTests::shuffleBagAvoidsImmediateRepeatAcrossRefill()
{
    ShuffleBag bag(3, 973);
    int previous = bag.take();
    for (int index = 0; index < 30; ++index) {
        const int current = bag.take();
        QVERIFY2(current != previous, "The shuffle bag repeated an episode immediately");
        previous = current;
    }
}

void CoreTests::channelLibraryLoadsAndSortsValidChannels()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/one")));
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/two")));

    QFile firstEpisode(directory.filePath(QStringLiteral("media/one/a.mp4")));
    QVERIFY(firstEpisode.open(QIODevice::WriteOnly));
    firstEpisode.close();
    QFile ignoredFile(directory.filePath(QStringLiteral("media/one/notes.txt")));
    QVERIFY(ignoredFile.open(QIODevice::WriteOnly));
    ignoredFile.close();
    QFile partialConversion(
        directory.filePath(QStringLiteral("media/one/a.optimising.mp4")));
    QVERIFY(partialConversion.open(QIODevice::WriteOnly));
    partialConversion.close();

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({
        "schema_version": 1,
        "channels": [
            {"number": 7, "name": "Two", "folder": "two", "aspect": "fit"},
            {"number": 2, "name": "One", "folder": "one", "aspect": "crop"}
        ]
    })");
    configuration.close();

    const ChannelLibraryResult result = ChannelLibrary::load(
        configuration.fileName(),
        directory.filePath(QStringLiteral("media")),
        [](const QString &) { return MediaInspection{true, true, 42.0, QStringLiteral("h264"), {}}; });

    QVERIFY2(result.isValid(), qPrintable(result.error));
    QCOMPARE(result.channels.size(), 2);
    QCOMPARE(result.channels[0].number, 2);
    QCOMPARE(result.channels[0].episodes.size(), 1);
    QCOMPARE(result.channels[0].episodes[0].durationSeconds, 42.0);
    QCOMPARE(result.channels[1].number, 7);
    QCOMPARE(result.channels[1].aspectMode, QStringLiteral("fit"));
    QCOMPARE(result.channels[1].contentType, QStringLiteral("shows"));
}

void CoreTests::channelLibraryKeepsMissingFoldersAsNoSignalChannels()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({
        "schema_version": 1,
        "channels": [
            {"number": 99, "name": "Empty", "folder": "not-there"}
        ]
    })");
    configuration.close();

    const ChannelLibraryResult result = ChannelLibrary::load(
        configuration.fileName(), directory.filePath(QStringLiteral("media")), [](const QString &) {
            return MediaInspection{true, true, 0.0, QStringLiteral("h264"), {}};
        });

    QVERIFY2(result.isValid(), qPrintable(result.error));
    QCOMPARE(result.channels.size(), 1);
    QVERIFY(result.channels[0].episodes.isEmpty());
    QVERIFY(!result.warnings.isEmpty());
}

void CoreTests::controllerTunesNumericChannelsAndHonoursVolumeLimit()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({
        "schema_version": 1,
        "channels": [
            {"number": 1, "name": "One", "folder": "one"},
            {"number": 8, "name": "Eight", "folder": "eight"}
        ]
    })");
    configuration.close();

    QFile settings(directory.filePath(QStringLiteral("settings.json")));
    QVERIFY(settings.open(QIODevice::WriteOnly));
    settings.write(R"({
        "schema_version": 1,
        "volume": {"initial": 20, "maximum": 60, "limit_enabled": true}
    })");
    settings.close();

    TvController controller;
    QVERIFY(controller.initialize(configuration.fileName(),
                                  settings.fileName(),
                                  directory.filePath(QStringLiteral("media")),
                                  directory.filePath(QStringLiteral("state.json")),
                                  [](const QString &) {
                                      return MediaInspection{true, true, 42.0, QStringLiteral("h264"), {}};
                                  }));
    controller.start();
    QCOMPARE(controller.currentChannelNumber(), 1);

    controller.enterDigit(8);
    controller.confirmNumericEntry();
    QCOMPARE(controller.currentChannelNumber(), 8);

    for (int count = 0; count < 30; ++count) {
        controller.dispatch(TvController::VolumeUp);
    }
    QCOMPARE(controller.volume(), 60);
    QCOMPARE(controller.maximumVolume(), 60);
}

void CoreTests::controllerClearsNoSignalWhenReturningToPopulatedChannel()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/one")));

    QFile episode(directory.filePath(QStringLiteral("media/one/a.mp4")));
    QVERIFY(episode.open(QIODevice::WriteOnly));
    episode.close();

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({
        "schema_version": 1,
        "channels": [
            {"number": 1, "name": "One", "folder": "one"},
            {"number": 2, "name": "Empty", "folder": "empty"}
        ]
    })");
    configuration.close();

    TvController controller;
    QVERIFY(controller.initialize(configuration.fileName(),
                                  directory.filePath(QStringLiteral("settings.json")),
                                  directory.filePath(QStringLiteral("media")),
                                  directory.filePath(QStringLiteral("state.json")),
                                  [](const QString &) {
                                      return MediaInspection{true, true, 42.0, QStringLiteral("h264"), {}};
                                  }));

    QSignalSpy playbackRequests(&controller, &TvController::playbackRequested);
    controller.start();
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 1, 1000);
    QVERIFY(!controller.noSignal());

    controller.dispatch(TvController::ChannelUp);
    QTRY_VERIFY_WITH_TIMEOUT(controller.noSignal(), 1000);

    controller.dispatch(TvController::ChannelDown);
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 2, 1000);
    QVERIFY(!controller.noSignal());
    QVERIFY(!controller.tuning());
}

void CoreTests::controllerSkipsAnEpisodeAfterPlaybackFailure()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/one")));

    for (const QString &fileName : {QStringLiteral("a.mp4"), QStringLiteral("b.mp4")}) {
        QFile episode(directory.filePath(QStringLiteral("media/one/%1").arg(fileName)));
        QVERIFY(episode.open(QIODevice::WriteOnly));
        episode.close();
    }

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({
        "schema_version": 1,
        "channels": [{"number": 1, "name": "One", "folder": "one"}]
    })");
    configuration.close();

    TvController controller;
    QVERIFY(controller.initialize(configuration.fileName(),
                                  directory.filePath(QStringLiteral("settings.json")),
                                  directory.filePath(QStringLiteral("media")),
                                  directory.filePath(QStringLiteral("state.json")),
                                  [](const QString &) {
                                      return MediaInspection{true, true, 42.0, QStringLiteral("h264"), {}};
                                  }));

    QSignalSpy playbackRequests(&controller, &TvController::playbackRequested);
    controller.start();
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 1, 1000);
    const QUrl firstSource = playbackRequests.at(0).at(0).toUrl();

    controller.playbackFailed(QStringLiteral("synthetic failure"));
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 2, 1000);
    const QUrl replacementSource = playbackRequests.at(1).at(0).toUrl();

    QVERIFY(!firstSource.isEmpty());
    QVERIFY(!replacementSource.isEmpty());
    QVERIFY(firstSource != replacementSource);
    QVERIFY(!controller.noSignal());
}

void CoreTests::controllerDoesNotPersistWatchdogQuarantine()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/one")));

    const QString episodePath = directory.filePath(QStringLiteral("media/one/stuck.mp4"));
    QFile episode(episodePath);
    QVERIFY(episode.open(QIODevice::WriteOnly));
    episode.write("first");
    episode.close();

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({
        "schema_version": 1,
        "channels": [{"number": 1, "name": "One", "folder": "one"}]
    })");
    configuration.close();
    const QString statePath = directory.filePath(QStringLiteral("state.json"));
    const auto inspector = [](const QString &) {
        return MediaInspection{true, true, 42.0, QStringLiteral("h264"), {}};
    };

    TvController controller;
    QVERIFY(controller.initialize(configuration.fileName(),
                                  directory.filePath(QStringLiteral("settings.json")),
                                  directory.filePath(QStringLiteral("media")),
                                  statePath,
                                  inspector));
    QSignalSpy firstRequests(&controller, &TvController::playbackRequested);
    controller.start();
    QTRY_COMPARE_WITH_TIMEOUT(firstRequests.count(), 1, 1000);
    controller.prepareForPlaybackRestart(QStringLiteral("synthetic frame stall"));

    TvController restored;
    QVERIFY(restored.initialize(configuration.fileName(),
                                directory.filePath(QStringLiteral("settings.json")),
                                directory.filePath(QStringLiteral("media")),
                                statePath,
                                inspector));
    QSignalSpy restoredRequests(&restored, &TvController::playbackRequested);
    restored.start();
    QTRY_COMPARE_WITH_TIMEOUT(restoredRequests.count(), 1, 1000);
    QVERIFY(!restored.noSignal());
}

void CoreTests::controllerMovesBetweenProgrammesInFilenameOrder()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/one")));

    for (const QString &fileName : {QStringLiteral("a.mp4"),
                                    QStringLiteral("b.mp4"),
                                    QStringLiteral("c.mp4")}) {
        QFile episode(directory.filePath(QStringLiteral("media/one/%1").arg(fileName)));
        QVERIFY(episode.open(QIODevice::WriteOnly));
        episode.close();
    }

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({
        "schema_version": 1,
        "channels": [{"number": 1, "name": "One", "folder": "one"}]
    })");
    configuration.close();

    QFile settings(directory.filePath(QStringLiteral("settings.json")));
    QVERIFY(settings.open(QIODevice::WriteOnly));
    settings.write(R"({
        "schema_version": 1,
        "playback_mode": "restart"
    })");
    settings.close();

    TvController controller;
    QVERIFY(controller.initialize(configuration.fileName(),
                                  directory.filePath(QStringLiteral("settings.json")),
                                  directory.filePath(QStringLiteral("media")),
                                  directory.filePath(QStringLiteral("state.json")),
                                  [](const QString &) {
                                      return MediaInspection{true, true, 42.0, QStringLiteral("h264"), {}};
                                  }));

    QSignalSpy playbackRequests(&controller, &TvController::playbackRequested);
    QSignalSpy channelDisplays(&controller, &TvController::channelDisplayRequested);
    controller.start();
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 1, 1000);
    QCOMPARE(channelDisplays.count(), 1);

    const QString firstFile = playbackRequests.at(0).at(0).toUrl().fileName();
    const QStringList orderedFiles{QStringLiteral("a.mp4"),
                                   QStringLiteral("b.mp4"),
                                   QStringLiteral("c.mp4")};
    const int firstIndex = orderedFiles.indexOf(firstFile);
    QVERIFY(firstIndex >= 0);
    QCOMPARE(controller.playbackMode(), QStringLiteral("resume"));

    controller.updatePlaybackPosition(23.5, true);
    controller.dispatch(TvController::NextProgramme);
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 2, 1000);
    QCOMPARE(playbackRequests.at(1).at(0).toUrl().fileName(),
             orderedFiles[(firstIndex + 1) % orderedFiles.size()]);
    QVERIFY(playbackRequests.at(1).at(1).toDouble() < 1.0);
    QCOMPARE(channelDisplays.count(), 1);

    controller.updatePlaybackPosition(9.25, false);
    controller.dispatch(TvController::PreviousProgramme);
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 3, 1000);
    QCOMPARE(playbackRequests.at(2).at(0).toUrl().fileName(), firstFile);
    QVERIFY(std::abs(playbackRequests.at(2).at(1).toDouble() - 23.5) < 0.2);
    QCOMPARE(channelDisplays.count(), 1);

    TvController restored;
    QVERIFY(restored.initialize(configuration.fileName(),
                                settings.fileName(),
                                directory.filePath(QStringLiteral("media")),
                                directory.filePath(QStringLiteral("state.json")),
                                [](const QString &) {
                                    return MediaInspection{true, true, 42.0,
                                                           QStringLiteral("h264"), {}};
                                }));
    QSignalSpy restoredRequests(&restored, &TvController::playbackRequested);
    restored.start();
    QTRY_COMPARE_WITH_TIMEOUT(restoredRequests.count(), 1, 1000);
    QCOMPARE(restoredRequests.at(0).at(0).toUrl().fileName(), firstFile);
    QVERIFY(std::abs(restoredRequests.at(0).at(1).toDouble() - 23.5) < 0.2);

    controller.requestParentAccess();
    controller.restartCurrentProgramme();
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 4, 1000);
    QCOMPARE(playbackRequests.at(3).at(0).toUrl().fileName(), firstFile);
    QVERIFY(playbackRequests.at(3).at(1).toDouble() < 0.2);
}

void CoreTests::controllerRestartsStaleShowsButNeverFilms()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/shows")));
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/films")));
    for (const QString &path : {QStringLiteral("media/shows/a.mp4"),
                                QStringLiteral("media/shows/b.mp4"),
                                QStringLiteral("media/films/c.mp4"),
                                QStringLiteral("media/films/d.mp4")}) {
        QFile media(directory.filePath(path));
        QVERIFY(media.open(QIODevice::WriteOnly));
        media.close();
    }

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({
        "schema_version": 1,
        "channels": [
            {"number": 1, "name": "Shows", "folder": "shows", "content_type": "shows"},
            {"number": 2, "name": "Films", "folder": "films"}
        ]
    })");
    configuration.close();

    QFile settings(directory.filePath(QStringLiteral("settings.json")));
    QVERIFY(settings.open(QIODevice::WriteOnly));
    settings.write(R"({
        "schema_version": 1,
        "playback_mode": "resume",
        "episode_reset_minutes": 5
    })");
    settings.close();

    qint64 uptimeMilliseconds = 0;
    TvController controller;
    QVERIFY(controller.initialize(
        configuration.fileName(),
        settings.fileName(),
        directory.filePath(QStringLiteral("media")),
        directory.filePath(QStringLiteral("state.json")),
        [](const QString &) {
            return MediaInspection{true, true, 120.0, QStringLiteral("h264"), {}};
        },
        [&uptimeMilliseconds]() { return uptimeMilliseconds; }));
    QCOMPARE(controller.episodeResetMinutes(), 5);

    QSignalSpy playbackRequests(&controller, &TvController::playbackRequested);
    controller.start();
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 1, 1000);
    const QString firstShow = playbackRequests.at(0).at(0).toUrl().fileName();

    controller.updatePlaybackPosition(23.5, true);
    controller.dispatch(TvController::NextProgramme);
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 2, 1000);
    uptimeMilliseconds = 4 * 60 * 1000;
    controller.dispatch(TvController::PreviousProgramme);
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 3, 1000);
    QCOMPARE(playbackRequests.at(2).at(0).toUrl().fileName(), firstShow);
    QVERIFY(std::abs(playbackRequests.at(2).at(1).toDouble() - 23.5) < 0.8);

    controller.dispatch(TvController::NextProgramme);
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 4, 1000);
    uptimeMilliseconds = 9 * 60 * 1000;
    controller.dispatch(TvController::PreviousProgramme);
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 5, 1000);
    QCOMPARE(playbackRequests.at(4).at(0).toUrl().fileName(), firstShow);
    QVERIFY(playbackRequests.at(4).at(1).toDouble() < 0.2);

    controller.dispatch(TvController::ChannelUp);
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 6, 1000);
    const QString firstFilm = playbackRequests.at(5).at(0).toUrl().fileName();
    controller.updatePlaybackPosition(31.25, true);
    controller.dispatch(TvController::NextProgramme);
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 7, 1000);
    uptimeMilliseconds = 14 * 60 * 1000;
    controller.dispatch(TvController::PreviousProgramme);
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 8, 1000);
    QCOMPARE(playbackRequests.at(7).at(0).toUrl().fileName(), firstFilm);
    QVERIFY(std::abs(playbackRequests.at(7).at(1).toDouble() - 31.25) < 0.2);
}

void CoreTests::controllerDisplaysSeasonEpisodeOrFilmNameWhenProgrammeChanges()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/one")));

    const QString episodeName = QStringLiteral("S01E02 - Making Friends.mp4");
    const QString filmName = QStringLiteral("Finding Nemo.mp4");
    for (const QString &name : {episodeName, filmName}) {
        QFile media(directory.filePath(QStringLiteral("media/one/") + name));
        QVERIFY(media.open(QIODevice::WriteOnly));
        media.close();
    }

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({
        "schema_version": 1,
        "channels": [{"number": 1, "name": "One", "folder": "one"}]
    })");
    configuration.close();

    TvController controller;
    QVERIFY(controller.initialize(configuration.fileName(),
                                  directory.filePath(QStringLiteral("settings.json")),
                                  directory.filePath(QStringLiteral("media")),
                                  directory.filePath(QStringLiteral("state.json")),
                                  [](const QString &) {
                                      return MediaInspection{true, true, 42.0,
                                                             QStringLiteral("h264"), {}};
                                  }));
    QSignalSpy playbackRequests(&controller, &TvController::playbackRequested);
    QSignalSpy programmeDisplays(&controller, &TvController::programmeDisplayRequested);
    controller.start();
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 1, 1000);
    programmeDisplays.clear();

    const auto expectedLabel = [&](const QString &fileName) {
        return fileName == episodeName ? QStringLiteral("S01  E02  ·  Making Friends")
                                       : QStringLiteral("Finding Nemo");
    };

    controller.dispatch(TvController::NextProgramme);
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 2, 1000);
    QCOMPARE(programmeDisplays.count(), 1);
    QCOMPARE(programmeDisplays.at(0).at(0).toString(),
             expectedLabel(playbackRequests.at(1).at(0).toUrl().fileName()));

    controller.dispatch(TvController::NextProgramme);
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 3, 1000);
    QCOMPARE(programmeDisplays.count(), 2);
    QCOMPARE(programmeDisplays.at(1).at(0).toString(),
             expectedLabel(playbackRequests.at(2).at(0).toUrl().fileName()));
}

void CoreTests::controllerRestoresCorruptFilmPositionWithoutChangingFilm()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/films")));
    for (const QString &name : {QStringLiteral("Finding Dory.mp4"),
                                QStringLiteral("Finding Nemo.mp4"),
                                QStringLiteral("Snow White.mp4")}) {
        QFile media(directory.filePath(QStringLiteral("media/films/") + name));
        QVERIFY(media.open(QIODevice::WriteOnly));
        media.close();
    }

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({
        "schema_version": 1,
        "channels": [{"number": 5, "name": "Films", "folder": "films", "content_type": "films"}]
    })");
    configuration.close();

    QFile settings(directory.filePath(QStringLiteral("settings.json")));
    QVERIFY(settings.open(QIODevice::WriteOnly));
    settings.write(R"({"schema_version": 1, "playback_mode": "resume"})");
    settings.close();

    QFile state(directory.filePath(QStringLiteral("state.json")));
    QVERIFY(state.open(QIODevice::WriteOnly));
    state.write(R"({
        "current_channel": 5,
        "channel_timelines": {
            "5": {
                "episode_name": "Finding Dory.mp4",
                "position_seconds": 91166,
                "programme_positions": {
                    "Finding Dory.mp4": 91166,
                    "Finding Nemo.mp4": 120,
                    "Snow White.mp4": 240
                }
            }
        }
    })");
    state.close();

    TvController controller;
    QVERIFY(controller.initialize(
        configuration.fileName(), settings.fileName(), directory.filePath(QStringLiteral("media")),
        state.fileName(), [](const QString &) {
            return MediaInspection{true, true, 600.0, QStringLiteral("h264"), {}};
        }));
    QSignalSpy playbackRequests(&controller, &TvController::playbackRequested);
    controller.start();
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 1, 1000);
    QCOMPARE(playbackRequests.at(0).at(0).toUrl().fileName(), QStringLiteral("Finding Dory.mp4"));
    QVERIFY(playbackRequests.at(0).at(1).toDouble() < 0.2);

    QVERIFY(state.open(QIODevice::ReadOnly));
    const QJsonObject saved = QJsonDocument::fromJson(state.readAll()).object();
    const QJsonObject positions = saved.value(QStringLiteral("channel_timelines")).toObject()
                                     .value(QStringLiteral("5")).toObject()
                                     .value(QStringLiteral("programme_positions")).toObject();
    QVERIFY(!positions.contains(QStringLiteral("Finding Dory.mp4")));
}

void CoreTests::standbyWakeWaitsForWelcomeBeforeResumingPlayback()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/one")));

    QFile episode(directory.filePath(QStringLiteral("media/one/a.mp4")));
    QVERIFY(episode.open(QIODevice::WriteOnly));
    episode.close();

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({
        "schema_version": 1,
        "channels": [{"number": 1, "name": "One", "folder": "one"}]
    })");
    configuration.close();

    TvController controller;
    QVERIFY(controller.initialize(configuration.fileName(),
                                  directory.filePath(QStringLiteral("settings.json")),
                                  directory.filePath(QStringLiteral("media")),
                                  directory.filePath(QStringLiteral("state.json")),
                                  [](const QString &) {
                                      return MediaInspection{true, true, 42.0, QStringLiteral("h264"), {}};
                                  }));

    QSignalSpy playbackRequests(&controller, &TvController::playbackRequested);
    QSignalSpy stopRequests(&controller, &TvController::stopPlaybackRequested);
    controller.start();
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 1, 1000);
    stopRequests.clear();

    controller.updatePlaybackPosition(17.25, false);
    controller.turnOff();
    QVERIFY(controller.standby());
    QCOMPARE(stopRequests.count(), 1);
    controller.turnOff();
    QCOMPARE(stopRequests.count(), 1);

    controller.turnOn();
    QVERIFY(!controller.standby());
    controller.turnOn();
    QTest::qWait(600);
    QCOMPARE(playbackRequests.count(), 1);

    controller.resumeFromStandby();
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 2, 1000);
    QVERIFY(std::abs(playbackRequests.at(1).at(1).toDouble() - 17.25) < 0.8);
}

void CoreTests::cecFailureDoesNotBlockMabelTvStandbyOrWake()
{
    const QByteArray oldClient = qgetenv("MABELTV_CEC_CLIENT");
    const QByteArray oldDevice = qgetenv("MABELTV_CEC_DEVICE");
    qputenv("MABELTV_CEC_CLIENT", "mabeltv-cec-client-that-does-not-exist");
    qputenv("MABELTV_CEC_DEVICE", "/dev/mabeltv-cec-that-does-not-exist");

    {
        CecTvControl cec(QStringLiteral("MabelTV"));
        TvController controller;
        controller.setTvControl(&cec);

        controller.turnOff();
        QVERIFY(controller.standby());
        QTest::qWait(100);

        controller.turnOn();
        QVERIFY(!controller.standby());
        QTest::qWait(100);
    }

    if (oldClient.isNull()) {
        qunsetenv("MABELTV_CEC_CLIENT");
    } else {
        qputenv("MABELTV_CEC_CLIENT", oldClient);
    }
    if (oldDevice.isNull()) {
        qunsetenv("MABELTV_CEC_DEVICE");
    } else {
        qputenv("MABELTV_CEC_DEVICE", oldDevice);
    }
}

void CoreTests::remoteLockBlocksActionsAndPersists()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({
        "schema_version": 1,
        "channels": [{"number": 1, "name": "One", "folder": "one"}]
    })");
    configuration.close();

    const QString settingsPath = directory.filePath(QStringLiteral("settings.json"));
    const QString statePath = directory.filePath(QStringLiteral("state.json"));
    {
        TvController controller;
        QVERIFY(controller.initialize(configuration.fileName(),
                                      settingsPath,
                                      directory.filePath(QStringLiteral("media")),
                                      statePath,
                                      [](const QString &) { return MediaInspection{}; }));
        QCOMPARE(controller.volume(), 20);
        QVERIFY(!controller.remoteLocked());

        controller.toggleRemoteLock();
        QVERIFY(controller.remoteLocked());
        controller.dispatch(TvController::VolumeUp);
        controller.dispatch(TvController::ToggleStandby);
        QCOMPARE(controller.volume(), 20);
        QVERIFY(!controller.standby());
    }

    TvController restored;
    QVERIFY(restored.initialize(configuration.fileName(),
                                settingsPath,
                                directory.filePath(QStringLiteral("media")),
                                statePath,
                                [](const QString &) { return MediaInspection{}; }));
    QVERIFY(restored.remoteLocked());
    restored.toggleRemoteLock();
    QVERIFY(!restored.remoteLocked());
    restored.dispatch(TvController::VolumeUp);
    QCOMPARE(restored.volume(), 25);
}

void CoreTests::parentControlsRequireThreeConfirmationsAndPersistSettings()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({
        "schema_version": 1,
        "channels": [{"number": 1, "name": "One", "folder": "one"}]
    })");
    configuration.close();

    QFile settings(directory.filePath(QStringLiteral("settings.json")));
    QVERIFY(settings.open(QIODevice::WriteOnly));
    settings.write(R"({
        "schema_version": 1,
        "parent_pin": "0973",
        "parent_overlay_style": "modern",
        "tv_guide_enabled": true,
        "playback_mode": "continuous",
        "crt_effect": "low",
        "volume": {"initial": 20, "maximum": 60, "limit_enabled": true}
    })");
    settings.close();

    TvController controller;
    QVERIFY(controller.initialize(configuration.fileName(),
                                  settings.fileName(),
                                  directory.filePath(QStringLiteral("media")),
                                  directory.filePath(QStringLiteral("state.json")),
                                  [](const QString &) { return MediaInspection{}; }));

    controller.requestParentAccess();
    QCOMPARE(controller.parentOverlayStyle(), QStringLiteral("modern"));
    QVERIFY(controller.tvGuideEnabled());
    QVERIFY(!controller.scrubbingEnabled());
    QCOMPARE(controller.parentAccessState(), TvController::ParentConfirmation);
    QCOMPARE(controller.parentConfirmationCount(), 0);
    controller.parentConfirm();
    controller.parentConfirm();
    QCOMPARE(controller.parentAccessState(), TvController::ParentConfirmation);
    QCOMPARE(controller.parentConfirmationCount(), 2);
    controller.parentConfirm();
    QCOMPARE(controller.parentAccessState(), TvController::ParentOpen);

    controller.cyclePlaybackMode(1);
    QCOMPARE(controller.episodeResetMinutes(), 0);
    controller.cycleEpisodeResetMinutes(1);
    QCOMPARE(controller.episodeResetMinutes(), 5);
    controller.cycleEpisodeResetMinutes(1);
    QCOMPARE(controller.episodeResetMinutes(), 20);
    controller.cycleEpisodeResetMinutes(1);
    QCOMPARE(controller.episodeResetMinutes(), 60);
    controller.cycleEpisodeResetMinutes(1);
    QCOMPARE(controller.episodeResetMinutes(), 180);
    controller.cycleEpisodeResetMinutes(1);
    QCOMPARE(controller.episodeResetMinutes(), 0);
    controller.cycleEpisodeResetMinutes(1);
    controller.cycleTvBorderStyle(1);
    QCOMPARE(controller.crtGlass(), 35);
    for (int count = 0; count < 20; ++count) {
        controller.adjustCrtGlass(1);
    }
    for (int count = 0; count < 30; ++count) {
        controller.adjustVideoDistortion(1);
    }
    controller.toggleVolumeLimit();
    controller.toggleScrubbing();
    QCOMPARE(controller.playbackMode(), QStringLiteral("resume"));
    QCOMPARE(controller.episodeResetMinutes(), 5);
    QCOMPARE(controller.tvBorderStyle(), QStringLiteral("silver-90s"));
    QCOMPARE(controller.crtGlass(), 100);
    QCOMPARE(controller.videoDistortion(), 100);
    QVERIFY(!controller.volumeLimitEnabled());
    QVERIFY(controller.scrubbingEnabled());

    QFile savedSettings(settings.fileName());
    QVERIFY(savedSettings.open(QIODevice::ReadOnly));
    const QJsonDocument savedDocument = QJsonDocument::fromJson(savedSettings.readAll());
    QCOMPARE(savedDocument.object().value(QStringLiteral("playback_mode")).toString(),
             QStringLiteral("resume"));
    QCOMPARE(savedDocument.object().value(QStringLiteral("parent_overlay_style")).toString(),
             QStringLiteral("modern"));
    QVERIFY(savedDocument.object().value(QStringLiteral("tv_guide_enabled")).toBool());
    QCOMPARE(savedDocument.object().value(QStringLiteral("episode_reset_minutes")).toInt(), 5);
    QCOMPARE(savedDocument.object().value(QStringLiteral("tv_border")).toString(),
             QStringLiteral("silver-90s"));
    QCOMPARE(savedDocument.object().value(QStringLiteral("crt_glass")).toInt(), 100);
    QVERIFY(!savedDocument.object().contains(QStringLiteral("crt_effect")));
    QCOMPARE(savedDocument.object().value(QStringLiteral("video_distortion")).toInt(), 100);
    QVERIFY(savedDocument.object().value(QStringLiteral("scrubbing_enabled")).toBool());
    QVERIFY(!savedDocument.object().contains(QStringLiteral("parent_pin")));
    QVERIFY(!savedDocument.object()
                 .value(QStringLiteral("volume"))
                 .toObject()
                 .value(QStringLiteral("limit_enabled"))
                 .toBool(true));

    TvController restored;
    QVERIFY(restored.initialize(configuration.fileName(),
                                settings.fileName(),
                                directory.filePath(QStringLiteral("media")),
                                directory.filePath(QStringLiteral("restored-state.json")),
                                [](const QString &) { return MediaInspection{}; }));
    QCOMPARE(restored.tvBorderStyle(), QStringLiteral("silver-90s"));
    QCOMPARE(restored.parentOverlayStyle(), QStringLiteral("modern"));
    QVERIFY(restored.tvGuideEnabled());
    QCOMPARE(restored.episodeResetMinutes(), 5);
    QCOMPARE(restored.crtGlass(), 100);
    QCOMPARE(restored.videoDistortion(), 100);
    QVERIFY(restored.scrubbingEnabled());
}

void CoreTests::tvGuideBuildsOrderedScheduleAndTunesChannels()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/one")));
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/two")));
    for (const QString &path : {QStringLiteral("media/one/a.mp4"),
                                QStringLiteral("media/one/b.mp4"),
                                QStringLiteral("media/two/c.mp4")}) {
        QFile episode(directory.filePath(path));
        QVERIFY(episode.open(QIODevice::WriteOnly));
        episode.close();
    }

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({
        "schema_version": 1,
        "channels": [
            {"number": 1, "name": "One", "folder": "one"},
            {"number": 2, "name": "Two", "folder": "two"}
        ]
    })");
    configuration.close();

    QFile settings(directory.filePath(QStringLiteral("settings.json")));
    QVERIFY(settings.open(QIODevice::WriteOnly));
    settings.write(R"({
        "schema_version": 1,
        "tv_guide_enabled": true,
        "playback_mode": "continuous"
    })");
    settings.close();

    TvController controller;
    QVERIFY(controller.initialize(
        configuration.fileName(), settings.fileName(),
        directory.filePath(QStringLiteral("media")),
        directory.filePath(QStringLiteral("state.json")),
        [](const QString &path) {
            const QString name = QFileInfo(path).fileName();
            return MediaInspection{true, true,
                                   name == QStringLiteral("a.mp4") ? 600.0
                                       : (name == QStringLiteral("b.mp4") ? 900.0
                                                                          : 1200.0),
                                   QStringLiteral("h264"), {}};
        }));
    QVERIFY(controller.tvGuideEnabled());
    controller.start();

    const QVariantList rows = controller.guideSchedule();
    QCOMPARE(rows.size(), 2);
    const QVariantMap firstChannel = rows.at(0).toMap();
    QCOMPARE(firstChannel.value(QStringLiteral("number")).toInt(), 1);
    const QVariantList firstProgrammes = firstChannel.value(QStringLiteral("programmes")).toList();
    QVERIFY(firstProgrammes.size() >= 8);
    int nowProgrammes = 0;
    for (const QVariant &value : firstProgrammes) {
        const QVariantMap programme = value.toMap();
        QVERIFY(!programme.value(QStringLiteral("name")).toString().isEmpty());
        QCOMPARE(programme.value(QStringLiteral("start")).toString().size(), 5);
        nowProgrammes += programme.value(QStringLiteral("now")).toBool() ? 1 : 0;
    }
    QCOMPARE(nowProgrammes, 1);

    controller.tuneGuideChannel(2);
    QCOMPARE(controller.currentChannelNumber(), 2);
}

void CoreTests::parentLibraryControlsPersistAndAffectPlayback()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/one")));
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/two")));
    for (const QString &path : {QStringLiteral("media/one/a.mp4"),
                                QStringLiteral("media/one/b.mp4"),
                                QStringLiteral("media/two/c.mp4")}) {
        QFile episode(directory.filePath(path));
        QVERIFY(episode.open(QIODevice::WriteOnly));
        episode.close();
    }

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({
        "schema_version": 1,
        "channels": [
            {"number": 1, "name": "One", "folder": "one"},
            {"number": 2, "name": "Two", "folder": "two"}
        ]
    })");
    configuration.close();

    QFile settings(directory.filePath(QStringLiteral("settings.json")));
    QVERIFY(settings.open(QIODevice::WriteOnly));
    settings.write(R"({"schema_version": 1, "playback_mode": "restart"})");
    settings.close();

    const auto inspector = [](const QString &) {
        return MediaInspection{true, true, 42.0, QStringLiteral("h264"), {}};
    };
    TvController controller;
    QVERIFY(controller.initialize(configuration.fileName(),
                                  settings.fileName(),
                                  directory.filePath(QStringLiteral("media")),
                                  directory.filePath(QStringLiteral("state.json")),
                                  inspector));
    QSignalSpy playbackRequests(&controller, &TvController::playbackRequested);
    controller.start();
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 1, 1000);

    controller.requestParentAccess();
    controller.parentConfirm();
    controller.parentConfirm();
    controller.parentConfirm();
    QCOMPARE(controller.parentAccessState(), TvController::ParentOpen);

    const QString playingFile = playbackRequests.constFirst().constFirst().toUrl().fileName();
    controller.toggleProgrammeEnabled(1, playingFile);
    QTRY_COMPARE_WITH_TIMEOUT(playbackRequests.count(), 2, 1000);
    QVERIFY(playbackRequests.at(1).at(0).toUrl().fileName() != playingFile);

    controller.toggleChannelEnabled(2);
    const QVariantList library = controller.parentLibrary();
    QCOMPARE(library.size(), 2);
    QVERIFY(!library.at(1).toMap().value(QStringLiteral("enabled")).toBool());
    QCOMPARE(library.at(0).toMap().value(QStringLiteral("enabledProgrammeCount")).toInt(), 1);
    controller.closeParent();
    controller.dispatch(TvController::ChannelUp);
    QCOMPARE(controller.currentChannelNumber(), 1);

    QFile savedSettings(settings.fileName());
    QVERIFY(savedSettings.open(QIODevice::ReadOnly));
    const QJsonObject savedRoot = QJsonDocument::fromJson(savedSettings.readAll()).object();
    const QJsonObject librarySettings = savedRoot.value(QStringLiteral("library")).toObject();
    QCOMPARE(librarySettings.value(QStringLiteral("disabled_channels")).toArray().at(0).toInt(), 2);
    QVERIFY(librarySettings.value(QStringLiteral("disabled_programmes"))
                .toObject()
                .value(QStringLiteral("1"))
                .toArray()
                .contains(playingFile));

    TvController restored;
    QVERIFY(restored.initialize(configuration.fileName(),
                                settings.fileName(),
                                directory.filePath(QStringLiteral("media")),
                                directory.filePath(QStringLiteral("restored-state.json")),
                                inspector));
    const QVariantList restoredLibrary = restored.parentLibrary();
    QVERIFY(!restoredLibrary.at(1).toMap().value(QStringLiteral("enabled")).toBool());
    QCOMPARE(restoredLibrary.at(0)
                 .toMap()
                 .value(QStringLiteral("enabledProgrammeCount"))
                 .toInt(),
             1);
}

void CoreTests::adultLibraryIsSeparateAndParentOnly()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/one")));
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/.adult")));
    QVERIFY(QDir(directory.path()).mkpath(QStringLiteral("media/.adult/Harry Potter")));

    QFile configuration(directory.filePath(QStringLiteral("channels.json")));
    QVERIFY(configuration.open(QIODevice::WriteOnly));
    configuration.write(R"({"schema_version":1,"channels":[{"number":1,"name":"One","folder":"one"}]})");
    configuration.close();
    QFile film(directory.filePath(QStringLiteral("media/.adult/Evening Film.mkv")));
    QVERIFY(film.open(QIODevice::WriteOnly));
    film.write("raw");
    film.close();
    QFile nestedFilm(directory.filePath(
        QStringLiteral("media/.adult/Harry Potter/Philosophers Stone.mp4")));
    QVERIFY(nestedFilm.open(QIODevice::WriteOnly));
    nestedFilm.write("nested");
    nestedFilm.close();
    QFile adultMetadata(directory.filePath(QStringLiteral("media/.adult/.mabeltv-adult.json")));
    QVERIFY(adultMetadata.open(QIODevice::WriteOnly));
    adultMetadata.write(R"({
        "Evening Film.mkv":{"library_id":"evening-id"},
        "Harry Potter/Philosophers Stone.mp4":{"library_id":"potter-id",
          "metadata":{"title":"Harry Potter and the Philosopher's Stone","year":"2001"}}
    })");
    adultMetadata.close();

    TvController controller;
    QVERIFY(controller.initialize(configuration.fileName(),
                                  directory.filePath(QStringLiteral("settings.json")),
                                  directory.filePath(QStringLiteral("media")),
                                  directory.filePath(QStringLiteral("state.json")),
                                  [](const QString &) {
                                      return MediaInspection{true, true, 42.0,
                                                             QStringLiteral("h264"), {}};
                                  }));
    const QVariantList adult = controller.adultLibrary();
    QCOMPARE(adult.size(), 2);
    QCOMPARE(adult.constFirst().toMap().value(QStringLiteral("name")).toString(),
             QStringLiteral("Evening Film"));
    const QVariantMap nested = adult.at(1).toMap();
    QCOMPARE(nested.value(QStringLiteral("id")).toString(), QStringLiteral("potter-id"));
    QCOMPARE(nested.value(QStringLiteral("folder")).toString(), QStringLiteral("Harry Potter"));
    QCOMPARE(nested.value(QStringLiteral("name")).toString(),
             QStringLiteral("Harry Potter and the Philosopher's Stone"));
    QCOMPARE(controller.parentLibrary().constFirst().toMap()
                 .value(QStringLiteral("programmeCount")).toInt(), 0);

    QSignalSpy commands(&controller, &TvController::parentCommandRequested);
    controller.requestParentCommand(QStringLiteral("adult"));
    QCOMPARE(commands.count(), 0);
    controller.requestParentAccess();
    controller.parentConfirm();
    controller.parentConfirm();
    controller.parentConfirm();
    controller.requestParentCommand(QStringLiteral("adult"));
    QCOMPARE(commands.count(), 1);
    QCOMPARE(commands.constFirst().constFirst().toString(), QStringLiteral("adult"));

    controller.setAdultPlaybackPosition(QStringLiteral("potter-id"), 842.5);
    controller.setAdultPlaybackDuration(QStringLiteral("potter-id"), 10234.0);
    TvController restored;
    QVERIFY(restored.initialize(configuration.fileName(),
                                directory.filePath(QStringLiteral("settings.json")),
                                directory.filePath(QStringLiteral("media")),
                                directory.filePath(QStringLiteral("state.json")),
                                [](const QString &) {
                                    return MediaInspection{true, true, 42.0,
                                                           QStringLiteral("h264"), {}};
                                }));
    QCOMPARE(restored.adultPlaybackPosition(QStringLiteral("potter-id")), 842.5);
    QCOMPARE(restored.adultPlaybackDuration(QStringLiteral("potter-id")), 10234.0);
    QCOMPARE(restored.adultPlaybackProgress(QStringLiteral("potter-id")),
             842.5 / 10234.0);
}

QTEST_MAIN(CoreTests)
#include "CoreTests.moc"
