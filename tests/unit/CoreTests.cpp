#include "core/TvController.h"
#include "library/ChannelLibrary.h"
#include "library/ShuffleBag.h"

#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QTemporaryDir>
#include <QtTest>

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
    void parentControlsRequireThreeConfirmationsAndPersistSettings();
    void longPowerRequestBypassesParentPanelButUsesOnlyShutdownCommand();
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
        "playback_mode": "continuous",
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
    QCOMPARE(controller.parentAccessState(), TvController::ParentConfirmation);
    QCOMPARE(controller.parentConfirmationCount(), 0);
    controller.parentConfirm();
    controller.parentConfirm();
    QCOMPARE(controller.parentAccessState(), TvController::ParentConfirmation);
    QCOMPARE(controller.parentConfirmationCount(), 2);
    controller.parentConfirm();
    QCOMPARE(controller.parentAccessState(), TvController::ParentOpen);

    controller.cyclePlaybackMode(1);
    controller.toggleVolumeLimit();
    QCOMPARE(controller.playbackMode(), QStringLiteral("resume"));
    QVERIFY(!controller.volumeLimitEnabled());

    QFile savedSettings(settings.fileName());
    QVERIFY(savedSettings.open(QIODevice::ReadOnly));
    const QJsonDocument savedDocument = QJsonDocument::fromJson(savedSettings.readAll());
    QCOMPARE(savedDocument.object().value(QStringLiteral("playback_mode")).toString(),
             QStringLiteral("resume"));
    QVERIFY(!savedDocument.object().contains(QStringLiteral("parent_pin")));
    QVERIFY(!savedDocument.object()
                 .value(QStringLiteral("volume"))
                 .toObject()
                 .value(QStringLiteral("limit_enabled"))
                 .toBool(true));
}

void CoreTests::longPowerRequestBypassesParentPanelButUsesOnlyShutdownCommand()
{
    TvController controller;
    QSignalSpy commands(&controller, &TvController::parentCommandRequested);

    controller.requestSafeShutdown();

    QCOMPARE(commands.count(), 1);
    QCOMPARE(commands.constFirst().constFirst().toString(), QStringLiteral("shutdown"));
}

QTEST_MAIN(CoreTests)
#include "CoreTests.moc"
