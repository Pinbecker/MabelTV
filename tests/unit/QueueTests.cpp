#include "CoreTests.h"
#include "TestStateFixture.h"
#include "core/TvController.h"
#include <QDir>
#include <QFile>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QTemporaryDir>
#include <QUuid>
#include <QtTest>
void CoreTests::queuePlaybackRetainsCurrentAndFollowsRemoteSkips()
{
    QTemporaryDir directory;
    QVERIFY(directory.isValid());
    QDir(directory.path()).mkpath("media/films");
    for (const QString &name : {"a.mp4", "b.mp4", "c.mp4"}) {
        QFile file(directory.filePath("media/films/" + name));
        QVERIFY(file.open(QIODevice::WriteOnly));
    }
    QFile config(directory.filePath("channels.json"));
    QVERIFY(config.open(QIODevice::WriteOnly));
    config.write(R"({"channels":[{"number":7,"name":"Films","folder":"films","content_type":"shows"}]})");
    config.close();
    TvController controller;
    QVERIFY(TestStateFixture::initializeController(controller,config.fileName(),
        directory.filePath("settings.json"),directory.filePath("media"),directory.filePath("state.json"),
        [](const QString &) { return MediaInspection{true,true,300.0,"h264",{}}; }));
    const QString connectionName = QUuid::createUuid().toString();
    {
        auto db = QSqlDatabase::addDatabase("QSQLITE",connectionName);
        db.setDatabaseName(TestStateFixture::databasePath(controller));
        QVERIFY(db.open());
        QSqlQuery insert(db);
        QVERIFY(insert.exec("INSERT INTO mabel_queue_entries VALUES('c',0,7,'c.mp4','C','','Films'),"
                            "('a',1,7,'a.mp4','A','','Films')"));
        insert.finish();
        const auto scalar = [&db](const QString &sql) {
            QSqlQuery query(db);
            if (!query.exec(sql) || !query.next()) return QVariant();
            return query.value(0);
        };
        QSignalSpy requests(&controller,&TvController::playbackRequested);
        controller.start();
        QTRY_COMPARE_WITH_TIMEOUT(requests.count(),1,1500);
        controller.playbackEnded();
        QTRY_COMPARE_WITH_TIMEOUT(requests.count(),2,1500);
        QCOMPARE(requests.last()[0].toUrl().fileName(),QString("c.mp4"));
        QCOMPARE(scalar("SELECT COUNT(*) FROM mabel_queue_entries").toInt(),2);
        QCOMPARE(scalar("SELECT phase FROM mabel_queue_state").toString(),QString("starting"));
        controller.queuePlaybackStarted(requests.last()[0].toUrl());
        QCOMPARE(scalar("SELECT active FROM mabel_queue_state").toInt(),1);
        controller.dispatchPortal(TvController::NextProgramme);
        QTRY_COMPARE_WITH_TIMEOUT(requests.count(),3,1500);
        QCOMPARE(requests.last()[0].toUrl().fileName(),QString("a.mp4"));
        QCOMPARE(scalar("SELECT COUNT(*) FROM mabel_queue_entries").toInt(),1);
        controller.queuePlaybackStarted(requests.last()[0].toUrl());
        controller.updatePlaybackPosition(1,false);
        controller.dispatchPortal(TvController::PreviousProgramme);
        QTRY_COMPARE_WITH_TIMEOUT(requests.count(),4,1500);
        QCOMPARE(requests.last()[0].toUrl().fileName(),QString("c.mp4"));
        QCOMPARE(scalar("SELECT COUNT(*) FROM mabel_queue_entries").toInt(),2);
        controller.queuePlaybackStarted(requests.last()[0].toUrl());
        controller.playbackFailed("Queue media failed");
        QCOMPARE(scalar("SELECT paused FROM mabel_queue_state").toInt(),1);
        QCOMPARE(scalar("SELECT COUNT(*) FROM mabel_queue_entries").toInt(),2);
        QCOMPARE(scalar("SELECT error FROM mabel_queue_state").toString(),QString("Queue media failed"));
        controller.playPortalProgramme(7,"b.mp4",0);
        QTRY_COMPARE_WITH_TIMEOUT(requests.count(),5,1500);
        controller.playbackEnded();
        QTRY_COMPARE_WITH_TIMEOUT(requests.count(),6,1500);
        QCOMPARE(scalar("SELECT COUNT(*) FROM mabel_queue_entries").toInt(),2);
        db.close();
    }
    QSqlDatabase::removeDatabase(connectionName);
}
