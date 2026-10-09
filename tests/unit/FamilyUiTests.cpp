#include <QDir>
#include <QGuiApplication>
#include <QJSValue>
#include <QQmlComponent>
#include <QQmlContext>
#include <QQmlEngine>
#include <QQuickItem>
#include <QQuickWindow>
#include <QSGRendererInterface>
#include <QSet>
#include <QtTest>
#include "FamilyUiTests.h"
#include "FamilyNetworkFixture.h"

static FamilyNetworkFixture familyNetworkFixture;

static QQuickItem* familyVisualItem(QQuickItem* item, const QString& name) {
    if (item->objectName() == name) return item;
    for (auto* child : item->childItems())
        if (auto* found = familyVisualItem(child,name)) return found;
    return nullptr;
}

void FamilyUiTests::initTestCase() {
    qmlRegisterType(QUrl::fromLocalFile(QStringLiteral(TEST_FIXTURE_DIR "/FamilyMpvFixture.qml")),
                    "MabelTV", 1, 0, "MpvVideo");
}

void FamilyUiTests::storytimeLibraryNavigationAndClosingAreInterruptible() {
    QQmlEngine engine;
    QStringList warnings;
    connect(&engine, &QQmlEngine::warnings, this, [&](const QList<QQmlError>& errors) {
        for (const auto& error : errors) warnings.append(error.toString());
    });
    QQmlComponent component(&engine, QUrl::fromLocalFile(QStringLiteral(TEST_QML_DIR "/StorytimeStage.qml")));
    QScopedPointer<QObject> root(component.create());
    QVERIFY2(root, qPrintable(component.errorString()));
    auto* stage = qobject_cast<QQuickItem*>(root.data()); QVERIFY(stage);
    stage->setWidth(1920); stage->setHeight(1080);
    const QString picture = qEnvironmentVariable("STORYBOOK_PREVIEW_ARTWORK",
        QStringLiteral(TEST_FIXTURE_DIR "/story-illustration.svg"));
    const QStringList titles{"The Gruffalo", "Room on the Broom", "Winnie the Pooh", "The Highway Rat",
        "The Snail and the Whale", "Zog", "The Gruffalo’s Child", "Stick Man",
        "A little adventure", "A story being prepared"};
    auto stories = engine.newArray(titles.size());
    for (int index = 0; index < titles.size(); ++index) {
        auto story = engine.newObject();
        story.setProperty("id", QString("book-%1").arg(index)); story.setProperty("title", titles.at(index));
        story.setProperty("illustration", QUrl::fromLocalFile(picture).toString());
        story.setProperty("ready", index != 9); story.setProperty("position",0);
        stories.setProperty(index,story);
    }
    stage->setProperty("stories", QVariant::fromValue(stories));
    stage->setProperty("storyId", "book-0"); stage->setProperty("storyTitle", "The Gruffalo");
    stage->setProperty("illustration", QUrl::fromLocalFile(picture));
    auto* library = root->findChild<QObject*>("storytimeLibrary"); QVERIFY(library);
    auto* book = root->findChild<QObject*>("storytimeBook"); QVERIFY(book);
    QSet<QString> covers;
    for (int index = 0; index < 8; ++index) {
        auto* card = familyVisualItem(stage, QStringLiteral("storytimeBookCard%1").arg(index)); QVERIFY(card);
        auto* preview = card->findChild<QObject*>("storytimePreviewBook"); QVERIFY(preview);
        QCOMPARE(preview->property("childName").toString(), QString("Mabel"));
        covers.insert(preview->property("coverSource").toUrl().toString());
    }
    QCOMPARE(covers.size(), 8);
    QSignalSpy chosen(stage, SIGNAL(chosen(QString))); QSignalSpy exited(stage, SIGNAL(exited()));
    QSignalSpy opened(stage, SIGNAL(openingFinished()));
    QSignalSpy rustled(stage, SIGNAL(previewSound()));
    QQuickWindow window; window.setGeometry(0,0,1920,1080); window.setColor(QColor("#292821"));
    QQmlComponent floorComponent(&engine);
    floorComponent.setData("import QtQuick; Image { width:1920; height:1080; source:'qrc:/storytime/stone-floor.png'; fillMode:Image.PreserveAspectCrop }", QUrl());
    QScopedPointer<QObject> floor(floorComponent.create()); QVERIFY(floor);
    qobject_cast<QQuickItem*>(floor.data())->setParentItem(window.contentItem());
    stage->setParentItem(window.contentItem()); window.show();
    QVERIFY(QMetaObject::invokeMethod(stage,"showLibrary",Q_ARG(QVariant,false)));
    const auto navigate = [&](const char* direction) {
        return QMetaObject::invokeMethod(stage,"navigate",Q_ARG(QVariant,QString(direction)));
    };
    auto* first = familyVisualItem(stage,"storytimeBookCard0"); QVERIFY2(first,qPrintable(warnings.join('\n')));
    QTRY_COMPARE_WITH_TIMEOUT(first->property("previewProgress").toDouble(), 1., 5000);
    QVERIFY(rustled.count() > 0);
    QVERIFY(navigate("right")); QVERIFY(navigate("right")); QVERIFY(navigate("left"));
    QCOMPARE(library->property("selectedIndex").toInt(),1);
    QTRY_COMPARE_WITH_TIMEOUT(first->property("previewProgress").toDouble(),0.,5000);
    auto* second = familyVisualItem(stage,"storytimeBookCard1"); QVERIFY(second);
    QTRY_COMPARE_WITH_TIMEOUT(second->property("previewProgress").toDouble(),1.,5000);
    auto refreshed = engine.newArray(titles.size());
    refreshed.setProperty(0, stories.property(7));
    for (int index = 0; index < 7; ++index) refreshed.setProperty(index + 1, stories.property(index));
    for (int index = 8; index < titles.size(); ++index) refreshed.setProperty(index, stories.property(index));
    stage->setProperty("stories", QVariant::fromValue(refreshed));
    QCOMPARE(library->property("selectedIdentity").toString(), QString("book-1"));
    QCOMPARE(library->property("selectedIndex").toInt(), 2);
    stage->setProperty("stories", QVariant::fromValue(stories));
    QDir().mkpath(QStringLiteral(TEST_OUTPUT_DIR));
    const auto capture = [&](const char* name) {
        return qEnvironmentVariableIsEmpty("STORYTIME_CAPTURE_FRAMES")
            || window.grabWindow().save(QStringLiteral(TEST_OUTPUT_DIR "/") + name);
    };
    QVERIFY(capture("storytime-library.png"));
    library->setProperty("selectedIndex",7); QVERIFY(navigate("right"));
    QCOMPARE(library->property("page").toInt(),1);
    QVERIFY(navigate("up")); QVERIFY(library->property("headerSelected").toBool());
    QVERIFY(navigate("down")); QVERIFY(QMetaObject::invokeMethod(stage,"select"));
    QCOMPARE(chosen.count(),1); QCOMPARE(chosen.at(0).at(0).toString(),QString("book-8"));
    QVERIFY(navigate("right")); QVERIFY(QMetaObject::invokeMethod(stage,"select"));
    QCOMPARE(chosen.count(),1); // unavailable stories cannot start
    QVERIFY(QMetaObject::invokeMethod(stage,"open"));
    QVERIFY(stage->property("lifting").toBool());
    QCOMPARE(book->property("coverTitle").toString(), QString("The Gruffalo"));
    QCOMPARE(stage->property("dockProgress").toDouble(), 1.);
    const double shelfWidth = book->property("width").toDouble();
    QTest::qWait(350);
    QVERIFY(book->property("width").toDouble() > shelfWidth);
    QVERIFY(book->property("width").toDouble() < stage->property("readingWidth").toDouble());
    QVERIFY(capture("storytime-lifting.png"));
    QTRY_VERIFY_WITH_TIMEOUT(!stage->property("lifting").toBool(), 1500);
    QCOMPARE(book->property("coverTitle").toString(), QString("The Gruffalo"));
    QCOMPARE(book->property("width").toDouble(), stage->property("readingWidth").toDouble());
    QVERIFY(QMetaObject::invokeMethod(stage,"finish"));
    QCOMPARE(opened.count(),1);
    QVERIFY(QMetaObject::invokeMethod(stage,"showLibrary",Q_ARG(QVariant,true)));
    QTest::qWait(500); QVERIFY(stage->property("returning").toBool());
    QVERIFY(capture("storytime-closing.png"));
    QTest::qWait(1150); QVERIFY(capture("storytime-docking.png"));
    QTRY_VERIFY_WITH_TIMEOUT(stage->property("browsing").toBool(),1500);
    QVERIFY(!stage->property("returning").toBool());
    QCOMPARE(opened.count(),1); QCOMPARE(exited.count(),0);
    QVERIFY(QMetaObject::invokeMethod(stage,"open"));
    QVERIFY(QMetaObject::invokeMethod(stage,"finish"));
    QVERIFY(QMetaObject::invokeMethod(stage,"showLibrary",Q_ARG(QVariant,true)));
    QTest::qWait(90); QVERIFY(QMetaObject::invokeMethod(stage,"back"));
    QVERIFY(stage->property("browsing").toBool()); QVERIFY(!stage->property("returning").toBool());
    QVERIFY(QMetaObject::invokeMethod(stage,"back")); QCOMPARE(exited.count(),0);
    QVERIFY2(warnings.isEmpty(),qPrintable(warnings.join('\n')));
}

void FamilyUiTests::illustrationTravelsWithLeafAndLandsWithoutJump() {
    QQmlEngine engine;
    QQmlComponent component(&engine, QUrl::fromLocalFile(QStringLiteral(TEST_QML_DIR "/Storybook.qml")));
    QScopedPointer<QObject> root(component.create());
    QVERIFY2(root, qPrintable(component.errorString()));
    auto* book = qobject_cast<QQuickItem*>(root.data());
    QVERIFY(book);
    book->setWidth(967.68); book->setHeight(691.2); book->setX(476.16); book->setY(134.4);
    const QString picture = qEnvironmentVariable("STORYBOOK_PREVIEW_ARTWORK",
        QStringLiteral(TEST_FIXTURE_DIR "/story-illustration.svg"));
    book->setProperty("illustration", QUrl::fromLocalFile(picture));
    book->setProperty("storyTitle", "The Gruffalo");
    auto* left = book->findChild<QQuickItem*>("storyStaticLeftPage");
    auto* moving = book->findChild<QQuickItem*>("storyTurningLeaf");
    auto* print = book->findChild<QQuickItem*>("storyTurningIllustration");
    auto* cover = book->findChild<QQuickItem*>("storyOpeningCover");
    QVERIFY(left); QVERIFY(moving); QVERIFY(print); QVERIFY(cover);
    QCOMPARE(print->parentItem(), moving);
    QQuickWindow window; window.setGeometry(0, 0, 1920, 1080); window.setColor(QColor("#292821"));
    QQmlComponent floorComponent(&engine);
    floorComponent.setData("import QtQuick; Image { width: 1920; height: 1080; source: 'qrc:/storytime/stone-floor.png'; fillMode: Image.PreserveAspectCrop }", QUrl());
    QScopedPointer<QObject> floor(floorComponent.create());
    QVERIFY2(floor, qPrintable(floorComponent.errorString()));
    qobject_cast<QQuickItem*>(floor.data())->setParentItem(window.contentItem());
    book->setParentItem(window.contentItem()); window.show(); QTest::qWait(150);
    QDir().mkpath(QStringLiteral(TEST_OUTPUT_DIR));
    auto* movingArt = print->findChild<QQuickItem*>("storyPrintedArtwork");
    auto* landedArt = left->findChild<QQuickItem*>("storyPrintedArtwork");
    QVERIFY(movingArt); QVERIFY(landedArt);
    QColor turningPicture, landedPicture;
    const auto artSample = [](QQuickItem* art) {
        return art->mapToScene(QPointF(art->width() * .3, art->height() * .5)).toPoint();
    };
    for (const double progress : {0., .37, .55, .70, .80, .90, .93999, .94, 1.}) {
        book->setProperty("progress", progress); QTest::qWait(45);
        if (qEnvironmentVariable("QSG_RHI_BACKEND") == "opengl")
            QCOMPARE(window.rendererInterface()->graphicsApi(), QSGRendererInterface::OpenGL);
        if (!qEnvironmentVariableIsEmpty("STORYBOOK_PREVIEW_ARTWORK")) {
            const QString name = QStringLiteral(TEST_OUTPUT_DIR "/storybook-leaf-%1.png").arg(qRound(progress * 100000));
            QVERIFY(window.grabWindow().save(name));
        }
        QCOMPARE(left->isVisible(), progress >= .94);
        QCOMPARE(moving->isVisible(), progress < .94);
        QCOMPARE(print->isVisible(), progress >= .755 && progress < .94);
        QVERIFY(cover->isVisible());
        QCOMPARE(cover->opacity(), 1.);
        if (progress == .55) {
            const QPoint inside = cover->mapToScene(QPointF(cover->width() * .5, cover->height() * .82)).toPoint();
            const QColor paper = window.grabWindow().pixelColor(inside);
            QVERIFY2(paper.red() > 200 && paper.green() > 185 && paper.blue() > 145,
                     qPrintable("Turning cover disappeared: " + paper.name()));
        }
        if (progress == .80) turningPicture = window.grabWindow().pixelColor(artSample(movingArt));
        if (progress == 1.) landedPicture = window.grabWindow().pixelColor(artSample(landedArt));
        if (progress >= .74) {
            QVERIFY(cover->z() >= 0);
            QVERIFY(cover->z() < left->z());
        }
        if (progress >= .70 && progress < .94) {
            const QRectF page = moving->mapRectToScene(moving->boundingRect());
            QVERIFY(page.top() >= 0); QVERIFY(page.bottom() <= window.height());
        }
    }
    book->setProperty("progress", .93999); QTest::qWait(45);
    const QImage before = window.grabWindow();
    book->setProperty("progress", .94); QTest::qWait(45);
    const QImage after = window.grabWindow();
    // The exposed gold rim must survive the moving-to-stationary page handoff.
    const QPoint rim = cover->mapToScene(QPointF(cover->width() - 4 * book->height() / 800,
                                                cover->height() / 2)).toPoint();
    const QColor rimBefore = before.pixelColor(rim), rimAfter = after.pixelColor(rim);
    const QColor gold("#937441");
    const auto distance = [](const QColor& a, const QColor& b) {
        return qAbs(a.red()-b.red()) + qAbs(a.green()-b.green()) + qAbs(a.blue()-b.blue());
    };
    QVERIFY2(distance(turningPicture, landedPicture) < 60,
             qPrintable("Turning artwork disappeared: " + turningPicture.name() + " vs " + landedPicture.name()));
    QVERIFY2(distance(rimAfter, gold) < 60, qPrintable("Cover rim: " + rimAfter.name()));
    QVERIFY(distance(rimBefore, rimAfter) < 20);
    // Match the landed left page away from its outer edge and the binding shadow.
    int changed = 0, samples = 0;
    for (int y = 190; y < 750; y += 3) for (int x = 515; x < 925; x += 3) {
        const QColor a = before.pixelColor(x,y), b = after.pixelColor(x,y);
        if (qAbs(a.red()-b.red()) + qAbs(a.green()-b.green()) + qAbs(a.blue()-b.blue()) > 45) changed++;
        samples++;
    }
    QVERIFY2(changed < samples / 100, qPrintable(QString("Landing changes %1 of %2 samples").arg(changed).arg(samples)));
}

void FamilyUiTests::storybookAndPlaybackRespectStandbyAndBack() {
        QQmlEngine engine;
        engine.setNetworkAccessManagerFactory(&familyNetworkFixture);
        engine.rootContext()->setContextProperty("tvDisplayName", "Mabel TV");
        QStringList warnings;
        connect(&engine, &QQmlEngine::warnings, this, [&](const QList<QQmlError>& errors) {
            for (const auto& error : errors) warnings.append(error.toString());
        });
        QQmlComponent component(&engine);
        component.setData(R"QML(
pragma ComponentBehavior: Bound
import QtQuick
import MabelTV 1.0
Rectangle {
    id: fixture
    width: 1920; height: 1080; color: "#f4ecd9"
    property int volume: 50
    property bool muted: false
    property bool standby: false
    property string currentChannelName: "Children's TV"
    property int currentChannelNumber: 1
    property string currentContentType: "shows"
    property int resumes: 0
    property int turnOns: 0
    property string lastCommand: ""
    property var player: childPlayer
    signal familyMemoryRequested(int number)
    signal channelChanged()
    function syncPlaybackPosition() {}
    function updatePlaybackPosition(position, force) {}
    function pauseQueuePlaybackForTransfer() {}
    function portalCommand(value) { lastCommand = value }
    function cancelFilmCountdown() {}
    function turnOn() { turnOns++; standby = false }
    function resumeFromStandby() { resumes++ }
    MpvVideo { id: childPlayer; paused: true }
    FamilyMediaCoordinator { id: family; objectName: "family"; appRoot: fixture; controller: fixture }
}
)QML", QUrl::fromLocalFile(QStringLiteral(TEST_QML_DIR "/FamilyTestFixture.qml")));
        QScopedPointer<QObject> root(component.create());
        QVERIFY2(root, qPrintable(component.errorString()));
        auto* family = root->findChild<QObject*>("family");
        auto* player = root->findChild<QObject*>("mabeltvFamilyPlayer");
        QVERIFY(family); QVERIFY(player);
        QVERIFY(family->metaObject()->indexOfMethod("openSession(QVariant,QVariant)") >= 0);
        QVERIFY(family->metaObject()->indexOfMethod("openStories()") >= 0);
        auto* playbackControls = root->findChild<QQuickItem*>("familyPlaybackControls");
        QVERIFY(playbackControls);
        const auto story = engine.evaluate(QString::fromUtf8(R"(({
            id:'fixture',kind:'storytime',story_id:'',title:'A little adventure',position:38,
            scenes:[{kind:'audio',items:[{id:'picture',source:'%1'}],audio:{source:'file:///story.m4a',duration:7200}}],settings:{}
        }))").arg(QUrl::fromLocalFile(QStringLiteral(TEST_FIXTURE_DIR "/story-illustration.svg")).toString()));
        QQuickWindow window;
        window.setGeometry(0,0,1920,1080);
        qobject_cast<QQuickItem*>(root.data())->setParentItem(window.contentItem());
        window.show();
        QVERIFY(QMetaObject::invokeMethod(family, "prepare"));
        auto* audioSurface = qobject_cast<QQuickItem*>(player); QVERIFY(audioSurface);
        // The real libmpv player cannot load audio until Qt creates its renderer.
        // A zero-size or fully transparent host leaves it stuck preparing.
        QVERIFY(audioSurface->width() > 0 && audioSurface->height() > 0);
        QVERIFY(audioSurface->parentItem()->opacity() > 0);
        family->setProperty("session", QVariant::fromValue(story));
        QTest::qWait(750);
        QDir().mkpath(QStringLiteral(TEST_OUTPUT_DIR));
        const auto capture = [&](const QString& name) {
            return qEnvironmentVariableIsEmpty("STORYBOOK_CAPTURE_FRAMES")
                || window.grabWindow().save(QStringLiteral(TEST_OUTPUT_DIR "/") + name);
        };
        QVERIFY(capture("storybook-cover.png"));
        QCOMPARE(player->property("starts").toInt(), 0); // silence until the opening has settled
        QTest::qWait(2600);
        QVERIFY(capture("storybook-cover-opening.png"));
        QTest::qWait(2700);
        QVERIFY(capture("storybook-page-turn.png"));
        QTRY_COMPARE_WITH_TIMEOUT(player->property("starts").toInt(), 1, 6000);
        QCOMPARE(player->property("playbackPosition").toInt(), 38);
        QCOMPARE(family->property("currentTitle").toString(), QString("A little adventure"));
        QCOMPARE(root->property("turnOns").toInt(), 0);
        QVERIFY(!playbackControls->isVisible());
        const auto command = [&](const char* action, double position = 0) {
            return QMetaObject::invokeMethod(family, "control", Q_ARG(QVariant, QString(action)), Q_ARG(QVariant, position));
        };
        QVERIFY(command("pause"));
        QVERIFY(player->property("paused").toBool());
        QTRY_COMPARE_WITH_TIMEOUT(playbackControls->opacity(), 1., 1000);
        auto* controlsTimer = root->findChild<QObject*>("familyControlsTimer"); QVERIFY(controlsTimer);
        QCOMPARE(controlsTimer->property("interval").toInt(), 8000);
        QVERIFY(QMetaObject::invokeMethod(controlsTimer,"triggered"));
        QTest::qWait(200);
        QVERIFY(playbackControls->isVisible()); // a timeout cannot hide a paused book
        player->setProperty("playbackDuration", 0);
        QCOMPARE(family->property("playbackDuration").toInt(), 7200); // combined-book startup fallback
        player->setProperty("playbackDuration", 7200);
        player->setProperty("playbackPosition", 3672);
        auto* elapsed = root->findChild<QObject*>("familyElapsedTime"); QVERIFY(elapsed);
        auto* remaining = root->findChild<QObject*>("familyRemainingTime"); QVERIFY(remaining);
        QCOMPARE(elapsed->property("text").toString(), QString("1:01:12 / 2:00:00"));
        QCOMPARE(remaining->property("text").toString(), QString("58:48 remaining"));
        if (!qEnvironmentVariableIsEmpty("STORYTIME_CAPTURE_CONTROLS"))
            QVERIFY(window.grabWindow().save(QStringLiteral(TEST_OUTPUT_DIR "/storytime-controls-paused.png")));
        QVERIFY(command("seek", 92));
        QCOMPARE(player->property("playbackPosition").toInt(), 92);
        const auto key = [&](int value) {
            return QMetaObject::invokeMethod(family,"handleKey",Q_ARG(QVariant,value),Q_ARG(QVariant,false));
        };
        const auto portal = [&](const char* value) {
            return QMetaObject::invokeMethod(family,"handlePortal",Q_ARG(QVariant,QString(value)));
        };
        QVERIFY(key(Qt::Key_Right));
        QCOMPARE(family->property("playbackControlIndex").toInt(),2);
        QCOMPARE(player->property("playbackPosition").toInt(),92); // visible arrows select, never seek
        auto* restart = root->findChild<QObject*>("familyRestartControl"); QVERIFY(restart);
        QVERIFY(restart->property("highlighted").toBool());
        QVERIFY(key(Qt::Key_Return)); // the physical OK button activates Restart
        QVERIFY(!family->property("paused").toBool());
        QVERIFY(!player->property("paused").toBool());
        QCOMPARE(player->property("playbackPosition").toInt(), 0);
        QVERIFY(portal("navigate-right"));
        QCOMPARE(family->property("playbackControlIndex").toInt(),3);
        QCOMPARE(player->property("playbackPosition").toInt(),0);
        QVERIFY(portal("navigate-right")); // selection stops at the last button
        QCOMPARE(family->property("playbackControlIndex").toInt(),3);
        QVERIFY(portal("select"));
        QCOMPARE(player->property("playbackPosition").toInt(),15);
        QVERIFY(portal("navigate-left"));
        QVERIFY(portal("select")); // the phone remote can activate Restart too
        QCOMPARE(player->property("playbackPosition").toInt(),0);
        QTest::qWait(450);
        QVERIFY(playbackControls->isVisible()); // Play keeps controls and the timeline readable
        QVERIFY(controlsTimer->property("running").toBool());
        QVERIFY(command("next"));
        QVERIFY(playbackControls->isVisible()); // seeking renews the visible interval
        QCOMPARE(player->property("playbackPosition").toInt(),15);
        QCOMPARE(remaining->property("text").toString(), QString("1:59:45 remaining"));
        QVERIFY(QMetaObject::invokeMethod(controlsTimer,"triggered"));
        QTRY_VERIFY_WITH_TIMEOUT(!playbackControls->isVisible(),1000);
        QVERIFY(key(Qt::Key_Right));
        QCOMPARE(player->property("playbackPosition").toInt(),30); // hidden controls retain direct seeking
        QCOMPARE(family->property("playbackControlIndex").toInt(),1);
        QVERIFY(QMetaObject::invokeMethod(controlsTimer,"triggered"));
        QTRY_VERIFY_WITH_TIMEOUT(!playbackControls->isVisible(),1000);
        QVERIFY(portal("navigate-left"));
        QCOMPARE(player->property("playbackPosition").toInt(),15);
        QCOMPARE(family->property("playbackControlIndex").toInt(),1);
        QVERIFY(QMetaObject::invokeMethod(controlsTimer,"triggered"));
        QTRY_VERIFY_WITH_TIMEOUT(!playbackControls->isVisible(),1000);

        QTest::qWait(1250);
        const QImage book = window.grabWindow();
        QVERIFY(!book.isNull());
        QDir().mkpath(QStringLiteral(TEST_OUTPUT_DIR));
        if (!qEnvironmentVariableIsEmpty("STORYBOOK_CAPTURE_FRAMES"))
            QVERIFY(book.save(QStringLiteral(TEST_OUTPUT_DIR "/storybook-open.png")));

        QVERIFY(QMetaObject::invokeMethod(player,"playbackFinished"));
        player->setProperty("playbackDuration",0); player->setProperty("playbackPosition",0);
        QCOMPARE(elapsed->property("text").toString(),QString("2:00:00 / 2:00:00"));
        QCOMPARE(remaining->property("text").toString(),QString("0:00 remaining"));
        QVERIFY(playbackControls->property("showing").toBool());

        // Back closes the book into Storytime, without resuming the old film.
        QVERIFY(command("close"));
        QTRY_VERIFY_WITH_TIMEOUT(family->property("browsingStories").toBool(), 3000);
        QVERIFY(family->property("active").toBool());
        QCOMPARE(root->property("resumes").toInt(), 0);

        QVERIFY(QMetaObject::invokeMethod(family,"openStories"));
        QVERIFY(family->property("browsingStories").toBool());
        QVERIFY(family->property("wasPaused").toBool()); // browsing cannot reset the old film's pause state
        QCOMPARE(player->property("status").toString(),QString("Idle"));
        auto* catalogue = root->findChild<QObject*>("storytimeCatalogue"); QVERIFY(catalogue);
        catalogue->setProperty("pageSound", QUrl("file:///page-turn.ogg"));
        const int previewsBefore = player->property("starts").toInt();
        QVERIFY(QMetaObject::invokeMethod(family,"previewSound"));
        QCOMPARE(player->property("source").toUrl(), QUrl("file:///page-turn.ogg"));
        QCOMPARE(player->property("volume").toInt(), 50);
        QCOMPARE(player->property("starts").toInt(), previewsBefore + 1);
        root->setProperty("muted", true);
        QVERIFY(QMetaObject::invokeMethod(family,"previewSound"));
        QCOMPARE(player->property("starts").toInt(), previewsBefore + 1);
        root->setProperty("muted", false);
        QVERIFY(QMetaObject::invokeMethod(family,"stopPreviewSound"));
        // A selected shelf book remains visible while its session loads, then
        // starts the lift rather than being mistaken for idle catalogue browsing.
        auto* stage = root->findChild<QObject*>("storytimeStage"); QVERIFY(stage);
        const auto shelfStory = engine.evaluate("({id:'shelf-book',title:'A little adventure',ready:true})");
        auto shelf = engine.newArray(1); shelf.setProperty(0, shelfStory);
        stage->setProperty("stories", QVariant::fromValue(shelf));
        const int startsBeforeSelection = player->property("starts").toInt();
        QVERIFY(QMetaObject::invokeMethod(family,"prepareSession",Q_ARG(QVariant,true)));
        auto selected = story; selected.setProperty("story_id", "shelf-book");
        family->setProperty("session", QVariant::fromValue(selected));
        QTRY_VERIFY_WITH_TIMEOUT(stage->property("lifting").toBool(),1500);
        QVERIFY(QMetaObject::invokeMethod(stage,"finish"));
        QTRY_COMPARE_WITH_TIMEOUT(player->property("starts").toInt(), startsBeforeSelection + 1, 1000);
        QVERIFY(command("close"));
        QVERIFY(family->property("active").toBool());
        QCOMPARE(root->property("resumes").toInt(), 0);

        const auto memories = engine.evaluate(QString::fromUtf8(R"(({
            id:'memory-fixture',kind:'memories',channel:10,title:'Family Videos',
            scenes:[{kind:'photo',seconds:30,items:[{id:'first',kind:'photo',source:'%1'},
                {id:'second',kind:'photo',source:'%1'}]},
                {kind:'video',items:[{id:'video',kind:'video',source:'file:///memory.mp4',artwork:'%1'}]},
                {kind:'photo',seconds:30,items:[{id:'last',kind:'photo',source:'%1'}]}],
            settings:{music:{source:'file:///music.m4a'},music_volume:25}
        }))").arg(QUrl::fromLocalFile(QStringLiteral(TEST_FIXTURE_DIR "/story-illustration.svg")).toString()));
        QVERIFY(QMetaObject::invokeMethod(family, "prepare"));
        family->setProperty("session", QVariant::fromValue(memories));
        QTRY_COMPARE_WITH_TIMEOUT(player->property("source").toUrl(), QUrl("file:///music.m4a"), 2500);
        QCOMPARE(family->property("playbackDuration").toInt(), 30); // photos do not use the music duration
        QTest::qWait(900);
        QVERIFY(capture("memory-portrait-pair.png"));
        QVERIFY(command("pause"));
        const double photoPosition = family->property("photoElapsed").toDouble();
        QTest::qWait(250);
        QCOMPARE(family->property("photoElapsed").toDouble(), photoPosition);
        QVERIFY(player->property("paused").toBool());
        player->setProperty("playbackPosition", 42);
        QVERIFY(command("next"));
        QTRY_COMPARE_WITH_TIMEOUT(player->property("source").toUrl(), QUrl("file:///memory.mp4"), 1500);
        QCOMPARE(family->property("sceneIndex").toInt(), 1);
        QVERIFY(!family->property("paused").toBool());
        QCOMPARE(player->property("volume").toInt(), 50); // a video uses its own sound
        QVERIFY(QMetaObject::invokeMethod(player, "playbackFinished"));
        QTRY_COMPARE_WITH_TIMEOUT(player->property("source").toUrl(), QUrl("file:///music.m4a"), 1500);
        QCOMPARE(family->property("sceneIndex").toInt(), 2);
        QCOMPARE(player->property("playbackPosition").toInt(), 42); // music resumes after the video
        QVERIFY(!playbackControls->isVisible()); // the presentation stays clear while playing
        QVERIFY(command("pause"));
        QVERIFY(player->property("paused").toBool());
        QVERIFY(command("restart"));
        QVERIFY(!player->property("paused").toBool()); // moving to a photo while paused resumes its soundtrack
        QVERIFY(command("close"));
        QTRY_VERIFY_WITH_TIMEOUT(!family->property("active").toBool(), 1000);
        QCOMPARE(root->property("resumes").toInt(), 1);

        QVERIFY(QMetaObject::invokeMethod(family, "prepare"));
        family->setProperty("session", QVariant::fromValue(story));
        const int before = player->property("starts").toInt();
        root->setProperty("standby", true);
        QTest::qWait(2300);
        QCOMPARE(player->property("starts").toInt(), before); // delayed audio must be cancelled
        QVERIFY(!family->property("active").toBool());
        auto* cancelledBook = root->findChild<QObject*>("storytimeBook");
        QVERIFY(cancelledBook);
        QVERIFY(QMetaObject::invokeMethod(cancelledBook, "finish"));
        QCOMPARE(player->property("starts").toInt(), before);
        QCOMPARE(root->property("turnOns").toInt(), 0);
        QVERIFY2(warnings.isEmpty(), qPrintable(warnings.join('\n')));
}

void FamilyUiTests::memoriesOwnOkReleaseAndDeferredChildResume() {
    QQmlEngine engine;
    engine.rootContext()->setContextProperty("tvDisplayName", "Mabel TV");
    engine.rootContext()->setContextProperty("directMediaMode", false);
    engine.rootContext()->setContextProperty("memoryPicture", QUrl::fromLocalFile(QStringLiteral(TEST_FIXTURE_DIR "/story-illustration.svg")));
    QStringList warnings;
    connect(&engine, &QQmlEngine::warnings, this, [&](const QList<QQmlError>& errors) {
        for (const auto& error : errors) warnings.append(error.toString());
    });
    QQmlComponent component(&engine, QUrl::fromLocalFile(QStringLiteral(TEST_FIXTURE_DIR "/FamilyInputFixture.qml")));
    QScopedPointer<QObject> root(component.create());
    QVERIFY2(root, qPrintable(component.errorString()));
    auto* family = root->findChild<QObject*>("family");
    auto* hold = root->findChild<QObject*>("childGuideHold");
    QQuickWindow window; window.setGeometry(0, 0, 1920, 1080);
    qobject_cast<QQuickItem*>(root.data())->setParentItem(window.contentItem()); window.show(); window.requestActivate();
    auto* input = root->findChild<QQuickItem*>("familyRemoteInput"); QVERIFY(input); input->forceActiveFocus();
    QTRY_VERIFY_WITH_TIMEOUT(input->hasActiveFocus(), 1000);
    QVERIFY(QMetaObject::invokeMethod(root.data(), "seedChildHold"));
    QVERIFY(hold->property("running").toBool());
    QTest::keyPress(&window, Qt::Key_Return);
    QVERIFY(family->property("paused").toBool());
    QTest::keyRelease(&window, Qt::Key_Return);
    QVERIFY(family->property("paused").toBool()); // release cannot toggle the stopped child decoder
    QCOMPARE(root->property("childStarts").toInt(), 0);
    QVERIFY(!hold->property("running").toBool());
    QTest::keyClick(&window, Qt::Key_Enter);
    QVERIFY(!family->property("paused").toBool());
    QCOMPARE(root->property("childStarts").toInt(), 0);
    QVariant handled;
    QVERIFY(QMetaObject::invokeMethod(family, "handlePortal", Q_RETURN_ARG(QVariant, handled), Q_ARG(QVariant, QString("navigate-down"))));
    QVERIFY(handled.toBool()); QCOMPARE(family->property("sceneIndex").toInt(), 1);
    QVERIFY(QMetaObject::invokeMethod(root.data(), "channelChanged"));
    QVERIFY(family->property("active").toBool()); // the prior film channel is not the memory session identity
    QVERIFY(QMetaObject::invokeMethod(root.data(), "seedResume"));
    QTRY_VERIFY_WITH_TIMEOUT(!root->property("restoreChildPauseAfterMyTv").toBool(), 1500);
    QCOMPARE(root->property("resumes").toInt(), 0);
    QVERIFY(!root->property("restoreChildPauseAfterMyTv").toBool());
    family->setProperty("active", false);
    QVERIFY(QMetaObject::invokeMethod(root.data(), "seedResume"));
    QTRY_COMPARE_WITH_TIMEOUT(root->property("resumes").toInt(), 1, 1500);
    family->setProperty("active", true);
    QVERIFY(QMetaObject::invokeMethod(family, "queueChildPlayback", Q_ARG(QVariant, QUrl("file:///Tarzan.mp4")), Q_ARG(QVariant, 0)));
    QCOMPARE(root->property("childStarts").toInt(), 0); // a background resume is ignored while memories own playback
    QVERIFY(QMetaObject::invokeMethod(family, "close", Q_ARG(QVariant, false)));
    QVERIFY(QMetaObject::invokeMethod(family, "queueChildPlayback", Q_ARG(QVariant, QUrl("file:///Chosen.mp4")), Q_ARG(QVariant, 24)));
    QTRY_COMPARE_WITH_TIMEOUT(root->property("childStarts").toInt(), 1, 1500);
    QCOMPARE(root->property("lastChildSource").toString(), QString("file:///Chosen.mp4"));
    QCOMPARE(root->property("resumes").toInt(), 1); // an explicit choice is transferred once after audio release
    QVERIFY2(warnings.isEmpty(), qPrintable(warnings.join('\n')));
}

void FamilyUiTests::compositionsRenderWholePhotosAndPauseTheirMotion() {
    QQmlEngine engine;
    QStringList warnings;
    connect(&engine, &QQmlEngine::warnings, this, [&](const QList<QQmlError>& errors) {
        for (const auto& error : errors) warnings.append(error.toString());
    });
    QQmlComponent component(&engine, QUrl::fromLocalFile(QStringLiteral(TEST_QML_DIR "/MemoryStage.qml")));
    QScopedPointer<QObject> root(component.create());
    QVERIFY2(root, qPrintable(component.errorString()));
    auto* stage = qobject_cast<QQuickItem*>(root.data());
    stage->setWidth(1920); stage->setHeight(1080);
    const QString assets = qEnvironmentVariable("MEMORY_PREVIEW_ASSETS");
    QStringList pictures;
    if (!assets.isEmpty()) pictures = QDir(assets).entryList({"*.jpg"}, QDir::Files, QDir::Name);
    QString expression = "({kind:'photo',layout:'triptych',transition:'rise',seconds:30,items:[";
    for (int index = 0; index < 3; ++index) {
        const QString path = pictures.size() >= 4 ? assets + '/' + pictures[index] : QStringLiteral(TEST_FIXTURE_DIR "/story-illustration.svg");
        QImage image(path);
        expression += QString("{id:'%1',source:'%2',width:%3,height:%4},").arg(index)
            .arg(QUrl::fromLocalFile(path).toString()).arg(image.width()).arg(image.height());
    }
    expression += "],frames:[{x:.015,y:.025,width:.305,height:.95},{x:.3475,y:.025,width:.305,height:.95},{x:.68,y:.025,width:.305,height:.95}]})";
    const auto scene = engine.evaluate(expression);
    QVERIFY(!scene.isError());
    QQuickWindow window; window.setGeometry(0, 0, 1920, 1080); window.setColor(QColor("#0c151c"));
    stage->setParentItem(window.contentItem()); window.show();
    QVERIFY(QMetaObject::invokeMethod(stage, "present", Q_ARG(QVariant, QVariant::fromValue(scene))));
    QTRY_COMPARE_WITH_TIMEOUT(stage->property("reveal").toDouble(), 1., 5000);
    QList<QQuickItem*> photos;
    const auto findPhotos = [&](auto&& visit, QQuickItem* item) -> void {
        if (item->objectName() == "memoryWholePhoto") photos.append(item);
        for (auto* child : item->childItems()) visit(visit, child);
    };
    findPhotos(findPhotos, stage);
    QCOMPARE(photos.size(), 3);
    for (auto* image : photos) {
        QCOMPARE(image->property("fillMode").toInt(), 1); // PreserveAspectFit
        const QRectF frame = image->mapRectToScene(image->boundingRect());
        QVERIFY(frame.left() >= 0 && frame.right() <= 1920);
        QVERIFY(frame.top() >= 0 && frame.bottom() <= 1080);
    }
    stage->setProperty("paused", true);
    const double drift = stage->property("drift").toDouble(); QTest::qWait(200);
    QCOMPARE(stage->property("drift").toDouble(), drift);
    if (!assets.isEmpty()) {
        QDir().mkpath(QStringLiteral(TEST_OUTPUT_DIR));
        QVERIFY(window.grabWindow().save(QStringLiteral(TEST_OUTPUT_DIR "/memories-gallery-1080.png")));
    }
    QVERIFY2(warnings.isEmpty(), qPrintable(warnings.join('\n')));
}

void FamilyUiTests::memoryVideoClipsSharePhotoStageAndAdvanceAtClipEnd() {
    QQmlEngine engine;
    engine.rootContext()->setContextProperty("tvDisplayName", "Mabel TV");
    engine.rootContext()->setContextProperty("memoryPicture", QUrl::fromLocalFile(QStringLiteral(TEST_FIXTURE_DIR "/story-illustration.svg")));
    QQmlComponent component(&engine, QUrl::fromLocalFile(QStringLiteral(TEST_FIXTURE_DIR "/FamilyInputFixture.qml")));
    QScopedPointer<QObject> root(component.create());
    QVERIFY2(root, qPrintable(component.errorString()));
    auto* family = root->findChild<QQuickItem*>("family"); QVERIFY(family);
    auto* player = family->findChild<QQuickItem*>("mabeltvFamilyPlayer"); QVERIFY(player);
    engine.globalObject().setProperty("memoryPicture", QUrl::fromLocalFile(QStringLiteral(TEST_FIXTURE_DIR "/story-illustration.svg")).toString());
    const auto session = engine.evaluate(R"(({kind:'memories',channel:10,settings:{},scenes:[
        {kind:'video',seconds:8,clip_start:5,video_index:1,items:[
            {id:'photo',kind:'photo',width:600,height:900,source:memoryPicture},
            {id:'clip',kind:'video',width:1280,height:720,source:'file:///clip.mp4',artwork:memoryPicture}],
         frames:[{x:.02,y:.025,width:.465,height:.95},{x:.515,y:.025,width:.465,height:.95}]},
        {kind:'photo',seconds:30,items:[{id:'next',kind:'photo',source:memoryPicture}]}]}))");
    QVERIFY(!session.isError());
    family->setProperty("session", QVariant::fromValue(session));
    QVERIFY(player->parentItem()->opacity() > 0); // video loading must also bootstrap before Playing
    QVERIFY(QMetaObject::invokeMethod(family, "presentScene", Q_ARG(QVariant, 0)));
    QTRY_COMPARE_WITH_TIMEOUT(player->property("source").toUrl(), QUrl("file:///clip.mp4"), 1800);
    QCOMPARE(player->property("playbackPosition").toInt(), 5);
    QCOMPARE(family->property("playbackDuration").toInt(), 8);
    QVERIFY(player->parentItem()->width() < family->width() * .5);
    QVERIFY(player->parentItem()->height() > family->height() * .4);
    QVERIFY(QMetaObject::invokeMethod(family, "control", Q_ARG(QVariant, QString("pause")), Q_ARG(QVariant, 0)));
    player->setProperty("playbackPosition", 13);
    QTest::qWait(350); QCOMPARE(family->property("sceneIndex").toInt(), 0);
    QVERIFY(QMetaObject::invokeMethod(family, "control", Q_ARG(QVariant, QString("pause")), Q_ARG(QVariant, 0)));
    player->setProperty("playbackPosition", 14);
    QTRY_COMPARE_WITH_TIMEOUT(family->property("sceneIndex").toInt(), 1, 1200);
    QCOMPARE(root->property("childStarts").toInt(), 0);
}

int main(int argc, char** argv) {
    QGuiApplication app(argc, argv);
    FamilyUiTests tests;
    return QTest::qExec(&tests, argc, argv);
}
