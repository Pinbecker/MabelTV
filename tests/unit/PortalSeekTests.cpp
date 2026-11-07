#include "CoreTests.h"
#include "ipc/PortalSeek.h"
#include <QUrl>
#include <QtTest>
#include <limits>

class SeekPlayer final : public QObject
{
    Q_OBJECT
public:
    using QObject::QObject;
    double sought = -1;
    Q_INVOKABLE void seekAbsolute(double position) { sought = position; }
};

void CoreTests::portalSeekTargetsCurrentOwnerAndRejectsStalePlayback()
{
    QObject root;
    SeekPlayer mabel(&root), myTv(&root), family(&root);
    QObject myTvMode(&root), familyMode(&root);
    mabel.setObjectName("mabeltvPlayer"); myTv.setObjectName("mabeltvMyTvPlayer");
    family.setObjectName("mabeltvFamilyPlayer"); myTvMode.setObjectName("mabeltvMyTvMode");
    familyMode.setObjectName("mabeltvFamilyMedia");
    for (auto *player : {&mabel, &myTv, &family}) {
        player->setProperty("source", QUrl::fromLocalFile("/private/film.mp4"));
        player->setProperty("playbackDuration", 7200.0);
        player->setProperty("playbackPosition", 125.0);
        player->setProperty("playbackGeneration", 1);
        player->setProperty("status", "Playing"); player->setProperty("paused", false);
    }
    auto state = PortalSeek::status(&root);
    QVERIFY(state.value("seek_available").toBool());
    QCOMPARE(state.value("playback_position").toDouble(), 125.0);
    QString token = state.value("seek_token").toString();
    QVERIFY(!token.contains("film"));
    QVERIFY(PortalSeek::apply(&root, 500.0, token)); QCOMPARE(mabel.sought, 500.0);
    QCOMPARE(myTv.sought, -1.0);
    mabel.setProperty("playbackGeneration", 2);
    QVERIFY(!PortalSeek::apply(&root, 300.0, token)); QCOMPARE(mabel.sought, 500.0);
    myTvMode.setProperty("active", true); myTvMode.setProperty("playing", true);
    myTv.setProperty("paused", true);
    token = PortalSeek::status(&root).value("seek_token").toString();
    QVERIFY(PortalSeek::apply(&root, 9000.0, token)); QCOMPARE(myTv.sought, 7199.9);
    QVERIFY(myTv.property("paused").toBool());
    QVERIFY(!PortalSeek::apply(&root, std::numeric_limits<double>::quiet_NaN(), token));
    QVERIFY(!PortalSeek::apply(&root, -2.0, token));
    familyMode.setProperty("active", true); familyMode.setProperty("kind", "storytime");
    familyMode.setProperty("ready", true);
    QVERIFY(!PortalSeek::apply(&root, 200.0, token));
    token = PortalSeek::status(&root).value("seek_token").toString();
    QVERIFY(PortalSeek::apply(&root, 200.0, token)); QCOMPARE(family.sought, 200.0);
    root.setProperty("portalStandby", true);
    QVERIFY(!PortalSeek::status(&root).value("seek_available").toBool());
    QVERIFY(!PortalSeek::apply(&root, 10.0, token));
}

#include "PortalSeekTests.moc"
