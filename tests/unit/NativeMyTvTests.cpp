#include <QBuffer>
#include <QGuiApplication>
#include <QFontDatabase>
#include <QImage>
#include <QImageReader>
#include <QJSValue>
#include <QQmlComponent>
#include <QQmlEngine>
#include <QQuickItem>
#include <QtTest>

class NativeMyTvTests : public QObject {
    Q_OBJECT
private slots:

    void familyChannelsKeepFocusAndHaveOneBackStep() {
        QQmlEngine engine;
        QStringList warnings;
        connect(&engine, &QQmlEngine::warnings, this, [&](const QList<QQmlError>& errors) {
            for (const auto& error : errors) warnings.append(error.toString());
        });
        QQmlComponent component(&engine);
        component.setData(R"(
            import QtQuick
            Item {
                id: fixture; width: 1920; height: 1080
                property real uiScale: 1
                property bool playing: false
                property var requests: []
                property int aborted: 0
                MyTvLibraryView {
                    objectName: "browser"; host: fixture; tvController: fixture
                    function request(path, method, payload, success, failure) {
                        fixture.requests.push({path:path,success:success,failure:failure})
                        return {abort:function(){fixture.aborted++}}
                    }
                }
            }
        )", QUrl::fromLocalFile(QStringLiteral(TEST_QML_DIR "/FamilyBrowseTest.qml")));
        QScopedPointer<QObject> root(component.create());
        QVERIFY2(root, qPrintable(component.errorString()));
        auto* browser = root->findChild<QObject*>("browser");
        auto* family = root->findChild<QObject*>("familyBrowse");
        auto* detail = root->findChild<QObject*>("myTvDetail");
        QVERIFY(browser && family && detail);
        browser->setProperty("homeData", QVariant::fromValue(engine.evaluate(R"(({
            library:Array.from({length:13},(_,i)=>({key:'film:'+i,title:'Film '+i,media_type:'movie'}))
        }))")));
        QVERIFY(QMetaObject::invokeMethod(browser, "rebuildRows"));
        browser->setProperty("selectedRow", 1); browser->setProperty("selectedCard", 4);
        family->setProperty("directory", QVariant::fromValue(engine.evaluate(R"([
            {key:'mabel-channel:1',title:'Pat',channel_number:1,content_type:'episodes',family_channel:true},
            {key:'mabel-channel:2',title:'Puffin',channel_number:2,content_type:'episodes',family_channel:true},
            {key:'mabel-channel:9',title:'Zog',channel_number:9,content_type:'episodes',family_channel:true},
            {key:'mabel-channel:5',title:'Films',channel_number:5,content_type:'films',family_channel:true}
        ])")));
        family->setProperty("directoryUpdated", QDateTime::currentMSecsSinceEpoch());
        QVERIFY(QMetaObject::invokeMethod(family, "enter"));
        browser->setProperty("selectedCard", 2);
        QVERIFY(QMetaObject::invokeMethod(browser, "openSelected"));
        QVERIFY(browser->property("detailVisible").toBool());
        QCOMPARE(browser->property("selectedCard").toInt(), 2);
        auto requests = root->property("requests").value<QJSValue>();
        QCOMPARE(requests.property("length").toInt(), 1);
        QVERIFY(QMetaObject::invokeMethod(browser, "back"));
        QVERIFY(!browser->property("detailVisible").toBool());
        QCOMPARE(browser->property("selectedCard").toInt(), 2);
        QCOMPARE(root->property("aborted").toInt(), 1);
        const auto episodes = engine.evaluate(R"(({content_type:'episodes',items:[
            {key:'e1',season:1,number:1,name:'Episode 1',remote_position:0,source:'episode.mp4'}
        ]}))");
        requests.property(0).property("success").call({episodes}); // late response cannot reopen a closed channel
        QVERIFY(!browser->property("detailVisible").toBool());
        QVERIFY(QMetaObject::invokeMethod(browser, "openSelected"));
        requests = root->property("requests").value<QJSValue>();
        requests.property(1).property("failure").call({QJSValue("retry")});
        QVERIFY(detail->property("loadFailed").toBool());
        QVERIFY(QMetaObject::invokeMethod(detail, "handleKey", Q_ARG(QVariant, int(Qt::Key_Return))));
        requests = root->property("requests").value<QJSValue>();
        QCOMPARE(requests.property("length").toInt(), 3);
        requests.property(2).property("success").call({episodes});
        QVERIFY(!detail->property("loadFailed").toBool());
        QCOMPARE(detail->property("episodes").value<QJSValue>().property("length").toInt(), 1);
        QCOMPARE(browser->property("rows").value<QJSValue>().property(0).property("title").toString(), QString("Episode channels"));
        QVERIFY(QMetaObject::invokeMethod(detail, "handleKey", Q_ARG(QVariant, int(Qt::Key_Escape))));
        QVERIFY(!browser->property("detailVisible").toBool());
        QCOMPARE(browser->property("selectedCard").toInt(), 2);
        QVERIFY(QMetaObject::invokeMethod(browser, "openSelected")); // cached: no fourth request
        QCOMPARE(root->property("requests").value<QJSValue>().property("length").toInt(), 3);
        QVERIFY(QMetaObject::invokeMethod(browser, "back"));
        browser->setProperty("selectedRow", 1); browser->setProperty("selectedCard", 0);
        QVERIFY(QMetaObject::invokeMethod(browser, "openSelected"));
        QCOMPARE(browser->property("selectedRow").toInt(), 1); // keep directory focus until the film grid is ready
        requests = root->property("requests").value<QJSValue>();
        requests.property(3).property("success").call({engine.evaluate(R"(({content_type:'films',items:[
            {key:'film',title:'Film',borrowed:true,media_type:'movie',source:'film.mp4'}
        ]}))")});
        QVERIFY(QMetaObject::invokeMethod(browser, "openSelected"));
        QVERIFY(QMetaObject::invokeMethod(detail, "handleKey", Q_ARG(QVariant, int(Qt::Key_Escape))));
        QVERIFY(browser->property("mabelChannel").value<QJSValue>().isObject());
        QVERIFY(QMetaObject::invokeMethod(browser, "back"));
        QCOMPARE(browser->property("selectedRow").toInt(), 1);
        QVERIFY(QMetaObject::invokeMethod(browser, "back"));
        QVERIFY(!browser->property("mabelVisible").toBool());
        QCOMPARE(browser->property("selectedRow").toInt(), 1);
        QCOMPARE(browser->property("selectedCard").toInt(), 4);
        QCOMPARE(root->property("requests").value<QJSValue>().property("length").toInt(), 4);
        QCoreApplication::processEvents();
        QVERIFY2(warnings.isEmpty(), qPrintable(warnings.join('\n')));
    }
    void mabelPresentationCyclesWithoutChangingPlaybackOwnership() {
        QQmlEngine engine;
        QStringList warnings;
        connect(&engine, &QQmlEngine::warnings, this, [&](const QList<QQmlError>& errors) {
            for (const auto& error : errors) warnings.append(error.toString());
        });
        QQmlComponent component(&engine);
        component.setData(R"(
            import QtQuick
            Item {
                id: fixture; width: 1920; height: 1080
                property bool introPlaying: false
                property bool standby: false
                property bool poweringOff: false
                property bool portalFullScreenEnabled: presentation.mode === "fullscreen"
                property string currentProgrammeTitle: "Family film"
                property int currentChannelNumber: 5
                property string currentChannelName: "Films"
                property int pauses: 0
                property int syncs: 0
                function togglePlaybackPause() { pauses++ }
                function syncPlaybackPosition() { syncs++ }
                QtObject {
                    id: media
                    property url source: "family.mp4"
                    property string status: "Playing"
                    property bool paused: false
                    property bool subtitlesAvailable: true
                    property bool subtitlesVisible: false
                    property real playbackPosition: 123
                    property real playbackDuration: 1800
                    function seekRelative(value) { playbackPosition += value }
                    function toggleSubtitles() { subtitlesVisible = !subtitlesVisible }
                }
                MabelPresentation {
                    id: presentation; objectName: "presentation"; anchors.fill: parent
                    appRoot: fixture; controller: fixture; mediaPlayer: media
                }
            }
        )", QUrl::fromLocalFile(QStringLiteral(TEST_QML_DIR "/MabelPresentationTest.qml")));
        QScopedPointer<QObject> root(component.create());
        QVERIFY2(root, qPrintable(component.errorString()));
        auto *presentation = root->findChild<QObject *>("presentation");
        QVERIFY(presentation);
        auto cycle = [&] { QVERIFY(QMetaObject::invokeMethod(presentation, "cycle")); };
        auto key = [&](int value) {
            QVariant consumed;
            QMetaObject::invokeMethod(presentation, "handleKey", Q_RETURN_ARG(QVariant, consumed),
                Q_ARG(QVariant, value), Q_ARG(QVariant, false));
            return consumed.toBool();
        };
        QCOMPARE(presentation->property("mode").toString(), QString("standard"));
        cycle(); QCOMPARE(presentation->property("mode").toString(), QString("widescreen"));
        cycle(); QCOMPARE(presentation->property("mode").toString(), QString("fullscreen"));
        QVERIFY(presentation->property("visible").toBool());
        QVERIFY(key(Qt::Key_Right)); QCOMPARE(presentation->property("playbackPosition").toDouble(), 138.0);
        QVERIFY(key(Qt::Key_Return)); QCOMPARE(root->property("pauses").toInt(), 1);
        QVERIFY(key(Qt::Key_B)); QVERIFY(presentation->property("controlsHidden").toBool());
        QCOMPARE(presentation->property("mode").toString(), QString("fullscreen"));
        QVERIFY(presentation->property("playing").toBool());
        QVERIFY(!key(Qt::Key_PageDown)); // channel navigation remains owned by Mabel TV
        cycle(); QCOMPARE(presentation->property("mode").toString(), QString("standard"));
        QVERIFY(!presentation->property("visible").toBool());
        QCOMPARE(root->property("currentProgrammeTitle").toString(), QString("Family film"));
        QVERIFY2(warnings.isEmpty(), qPrintable(warnings.join('\n')));
    }

    void episodeHandoffCompletesOnceCrossesSeasonsAndCancelsSafely() {
        QQmlEngine engine;
        QStringList warnings;
        connect(&engine, &QQmlEngine::warnings, this, [&](const QList<QQmlError>& errors) {
            for (const auto& error : errors) warnings.append(error.toString());
        });
        QQmlComponent component(&engine);
        component.setData(R"(
            import QtQuick
            Item {
                id: fixture
                property bool playing: true
                property bool stopping: false
                property bool closing: false
                property bool paused: false
                property bool scrubberActive: false
                property real playbackDuration: 1800
                property real playbackPosition: 1780
                property int stops: 0
                property int completions: 0
                property var played: null
                property string errorMessage: ""
                property bool holdRequest: false
                property var requestCallback: null
                property var controller: fixture
                function setMyTvPlaybackPosition(id, position) { completions++ }
                function stopFilm() { stopping = true; stops++ }
                function startNativePlayback(item, position) {
                    played = item; playing = true; stopping = false; playbackPosition = position
                    sequence.begin(item)
                }
                function request(path, method, payload, success, failure) {
                    requestCallback = success
                    if (!holdRequest) success({ok:true})
                }
                function loadHome() {}
                function notify(message) {}
                function openScrubber() { scrubberActive = true }
                function isBackKey(key) { return key === Qt.Key_Escape }
                MyTvEpisodePlayback { id: sequence; objectName: "sequence"; host: fixture; library: fixture }
            }
        )", QUrl::fromLocalFile(QStringLiteral(TEST_QML_DIR "/MyTvSequenceTest.qml")));
        QScopedPointer<QObject> root(component.create());
        QVERIFY2(root, qPrintable(component.errorString()));
        QObject* sequence = root->findChild<QObject*>("sequence");
        QVERIFY(sequence);
        const auto first = engine.evaluate(R"(({
            id:'one',source:'file:///one.mp4',season:1,number:1,series:{id:'series',title:'Example',episodes:[
                {library_id:'three',source:'file:///three.mp4',season:2,number:1,name:'Third'},
                {library_id:'one',source:'file:///one.mp4',season:1,number:1,name:'First'},
                {library_id:'two',source:'file:///two.mp4',season:1,number:2,name:'Second'}]}
        }))");
        auto begin = [&] { QVERIFY(QMetaObject::invokeMethod(sequence, "begin",
            Q_ARG(QVariant, QVariant::fromValue(first)))); };
        auto call = [&](const char* method) { QVERIFY(QMetaObject::invokeMethod(sequence, method)); };
        begin();
        QCOMPARE(sequence->property("nextEpisode").value<QJSValue>().property("id").toString(), QString("two"));
        QVERIFY(sequence->property("promptVisible").toBool());
        call("skip");
        QCOMPARE(root->property("stops").toInt(), 1);
        QCOMPARE(root->property("completions").toInt(), 0);
        call("stopped");
        QTRY_COMPARE(root->property("played").value<QJSValue>().property("id").toString(), QString("two"));
        QCOMPARE(root->property("completions").toInt(), 1);
        QCOMPARE(sequence->property("nextEpisode").value<QJSValue>().property("season").toInt(), 2);
        call("finished");
        QTRY_COMPARE(root->property("played").value<QJSValue>().property("id").toString(), QString("three"));
        QVERIFY(sequence->property("nextEpisode").isNull());
        call("finished");
        QVERIFY(!root->property("playing").toBool());
        QCOMPARE(root->property("completions").toInt(), 3);
        root->setProperty("playing", true); root->setProperty("stopping", false);
        root->setProperty("playbackPosition", 100); begin();
        call("skip"); call("stopped");
        QTRY_COMPARE(root->property("played").value<QJSValue>().property("id").toString(), QString("two"));
        QCOMPARE(root->property("completions").toInt(), 3); // early skip keeps the bookmark
        root->setProperty("holdRequest", true); begin(); call("finished"); call("cancel");
        root->property("requestCallback").value<QJSValue>().call({engine.newObject()});
        QTest::qWait(400);
        QCOMPARE(root->property("completions").toInt(), 3); // stale completion cannot restart playback
        QVERIFY2(warnings.isEmpty(), qPrintable(warnings.join('\n')));
    }

    void artworkConcurrencyStaysBoundedAndReleasesCancelledWork() {
        QQmlEngine engine;
        QQmlComponent component(&engine, QUrl::fromLocalFile(QStringLiteral(TEST_QML_DIR "/MyTvArtworkQueue.qml")));
        QScopedPointer<QObject> queue(component.create());
        QVERIFY2(queue, qPrintable(component.errorString()));
        engine.globalObject().setProperty("launches", 0);
        const QJSValue callback = engine.evaluate("(function(){ launches++ })");
        QList<QVariant> jobs;
        for (int i = 0; i < 6; ++i) {
            QVariant job;
            QVERIFY(QMetaObject::invokeMethod(queue.get(), "enqueue", Q_RETURN_ARG(QVariant, job),
                                              Q_ARG(QVariant, QVariant::fromValue(callback))));
            jobs.append(job);
        }
        QTRY_COMPARE(queue->property("active").toInt(), 4);
        QCOMPARE(engine.globalObject().property("launches").toInt(), 4);
        QVERIFY(QMetaObject::invokeMethod(queue.get(), "release", Q_ARG(QVariant, jobs[5])));
        QVERIFY(QMetaObject::invokeMethod(queue.get(), "release", Q_ARG(QVariant, jobs[0])));
        QTRY_COMPARE(engine.globalObject().property("launches").toInt(), 5);
        QCOMPARE(queue->property("active").toInt(), 4);
        for (const auto& job : jobs)
            QVERIFY(QMetaObject::invokeMethod(queue.get(), "release", Q_ARG(QVariant, job)));
        QCOMPARE(queue->property("active").toInt(), 0);
        QCOMPARE(queue->property("jobs").value<QJSValue>().property("length").toInt(), 0);
    }

    void artworkDecoderSupportsWebP() {
        QVERIFY(QImageReader::supportedImageFormats().contains("webp"));
        QVERIFY(QImageReader::supportedImageFormats().contains("svg"));
        QImage original(8, 8, QImage::Format_RGB32);
        original.fill(Qt::red);
        QByteArray bytes;
        QBuffer buffer(&bytes);
        buffer.open(QIODevice::WriteOnly);
        QVERIFY(original.save(&buffer, "WEBP"));
        const QImage decoded = QImage::fromData(bytes);
        QCOMPARE(decoded.size(), QSize(8, 8));
    }

    void browseAndEpisodesUseRealQml() {
        QQmlEngine engine;
        QStringList warnings;
        connect(&engine, &QQmlEngine::warnings, this, [&](const QList<QQmlError>& errors) {
            for (const auto& error : errors) warnings.append(error.toString());
        });
        QQmlComponent component(&engine);
        component.setData(R"(
            import QtQuick
            Item {
                id: fixture
                width: 1280; height: 720
                property real uiScale: 2 / 3
                property bool playing: false
                property var played: null
                function startNativePlayback(item, position) { played = { id: item.id, position: position, item: item } }
                MyTvLibraryView { objectName: "browser"; host: fixture; tvController: fixture }
            }
        )", QUrl::fromLocalFile(QStringLiteral(TEST_QML_DIR "/MyTvTest.qml")));
        QScopedPointer<QObject> root(component.create());
        QVERIFY2(root, qPrintable(component.errorString()));
        QTRY_VERIFY(QFontDatabase::families().contains(QStringLiteral("Inter Variable")));
        auto* browser = root->findChild<QObject*>("browser");
        QVERIFY(browser);
        const auto home = engine.evaluate(R"(({
            continue: [{key:'movie:1',title:'Resume me',media_type:'movie'}],
            up_next: [{key:'movie:2',title:'Next',media_type:'movie'}],
            library: Array.from({length:13}, (_,i)=>({key:'movie:'+i,title:'Film '+i,media_type:'movie'}))
                .concat([{key:'tv:1',title:'Series',media_type:'tv'}])
        }))");
        QVERIFY(!home.isError());
        browser->setProperty("homeData", QVariant::fromValue(home));
        QVERIFY(QMetaObject::invokeMethod(browser, "rebuildRows"));
        const auto rows = browser->property("rows").value<QJSValue>();
        QCOMPARE(rows.property("length").toInt(), 6);
        QCOMPARE(rows.property(2).property("title").toString(), QString("Films"));
        QCOMPARE(rows.property(5).property("title").toString(), QString("Series"));
        for (int i = 0; i < 3; ++i)
            QVERIFY(QMetaObject::invokeMethod(browser, "handleKey", Q_ARG(QVariant, int(Qt::Key_Down))));
        QCOMPARE(browser->property("selectedRow").toInt(), 3);
        browser->setProperty("selectedCard", 2);
        browser->setProperty("selectedShortcut", 3);
        QVERIFY(QMetaObject::invokeMethod(browser, "jumpToSection"));
        QCOMPARE(browser->property("selectedRow").toInt(), 5);
        browser->setProperty("selectedShortcut", 2);
        QVERIFY(QMetaObject::invokeMethod(browser, "jumpToSection"));
        QCOMPARE(browser->property("selectedRow").toInt(), 3);
        QCOMPARE(browser->property("selectedCard").toInt(), 2);
        QVERIFY(QMetaObject::invokeMethod(browser, "closeDetail"));
        QCOMPARE(browser->property("selectedCard").toInt(), 2);
        const auto refreshed = engine.evaluate(R"(({
            continue: [{key:'movie:1',title:'Resume me',media_type:'movie'}], up_next: [],
            library: Array.from({length:13}, (_,i)=>({key:'movie:'+i,title:'Film '+i,media_type:'movie'}))
                .concat([{key:'tv:1',title:'Series',media_type:'tv'}])
        }))");
        browser->setProperty("homeData", QVariant::fromValue(refreshed));
        QVERIFY(QMetaObject::invokeMethod(browser, "rebuildRows"));
        QCOMPARE(browser->property("selectedRow").toInt(), 2);
        QCOMPARE(browser->property("selectedCard").toInt(), 2);
        QVariant backHandled;
        QVERIFY(QMetaObject::invokeMethod(browser, "back", Q_RETURN_ARG(QVariant, backHandled)));
        QVERIFY(backHandled.toBool());
        QCOMPARE(browser->property("selectedZone").toInt(), 2);
        QCOMPARE(browser->property("selectedShortcut").toInt(), 1);

        auto* detail = root->findChild<QObject*>("myTvDetail");
        QVERIFY(detail);
        const auto title = engine.evaluate(R"(({
            title:'Example',media_type:'tv',on_mabeltv:true,
            seasons:[{number:1},{number:2}],next_playable:{season:2,number:1},
            local_episodes:Array.from({length:12},(_,i)=>({season:2,number:i+1,name:'Episode '+(i+1),
                source:'file:///episode'+(i+1)+'.mp4',library_id:'episode'+(i+1),remote_position:i===8?120:0}))
        }))");
        QVERIFY(QMetaObject::invokeMethod(detail, "open", Q_ARG(QVariant, QVariant::fromValue(title))));
        QVERIFY(QMetaObject::invokeMethod(detail, "updateDetail", Q_ARG(QVariant, QVariant::fromValue(title))));
        QCOMPARE(detail->property("selectedSeason").toInt(), 1);
        QCOMPARE(detail->property("episodes").value<QJSValue>().property("length").toInt(), 12);
        detail->setProperty("zone", 3);
        for (int i = 0; i < 8; ++i)
            QVERIFY(QMetaObject::invokeMethod(detail, "handleKey", Q_ARG(QVariant, int(Qt::Key_Down))));
        QCOMPARE(detail->property("selectedEpisode").toInt(), 8);
        QVERIFY(QMetaObject::invokeMethod(detail, "handleKey", Q_ARG(QVariant, int(Qt::Key_Return))));
        const auto played = root->property("played").value<QJSValue>();
        QCOMPARE(played.property("id").toString(), QString("episode9"));
        QCOMPARE(played.property("position").toInt(), 120);
        QVERIFY(QMetaObject::invokeMethod(detail, "handleKey", Q_ARG(QVariant, int(Qt::Key_Up))));
        QVERIFY(QMetaObject::invokeMethod(detail, "handleKey", Q_ARG(QVariant, int(Qt::Key_Return))));
        const auto freshEpisode = root->property("played").value<QJSValue>();
        QCOMPARE(freshEpisode.property("id").toString(), QString("episode8"));
        QCOMPARE(freshEpisode.property("position").toInt(), 0);
        auto resumeTitle = engine.evaluate(R"(({
            title:'Example',media_type:'tv',on_mabeltv:true,seasons:[{number:2}],
            next_playable:{season:2,number:9,name:'Exact episode',remote_position:120},
            local_episodes:Array.from({length:12},(_,i)=>({season:2,number:i+1,name:'Episode '+(i+1),
                source:'file:///episode'+(i+1)+'.mp4',library_id:'episode'+(i+1),remote_position:i===8?120:0}))
        }))");
        QVERIFY(QMetaObject::invokeMethod(detail, "open", Q_ARG(QVariant, QVariant::fromValue(resumeTitle))));
        QVERIFY(QMetaObject::invokeMethod(detail, "updateDetail", Q_ARG(QVariant, QVariant::fromValue(resumeTitle))));
        QCOMPARE(detail->property("selectedEpisode").toInt(), 8);
        QCOMPARE(detail->property("actions").value<QJSValue>().property(0).property("label").toString(), QString("Resume S2 E9"));
        resumeTitle.setProperty("borrowed", true);
        QVERIFY(QMetaObject::invokeMethod(detail, "open", Q_ARG(QVariant, QVariant::fromValue(resumeTitle))));
        QVERIFY(QMetaObject::invokeMethod(detail, "updateDetail", Q_ARG(QVariant, QVariant::fromValue(resumeTitle))));
        QVERIFY(QMetaObject::invokeMethod(detail, "handleKey", Q_ARG(QVariant, int(Qt::Key_Down))));
        QCOMPARE(detail->property("zone").toInt(), 2); // no external-services section for family channels
        QVERIFY(QMetaObject::invokeMethod(detail, "handleKey", Q_ARG(QVariant, int(Qt::Key_Up))));
        QCOMPARE(detail->property("zone").toInt(), 0);
        QVERIFY(QMetaObject::invokeMethod(detail, "setZone", Q_ARG(QVariant, 3)));
        QVERIFY(QMetaObject::invokeMethod(detail, "handleKey", Q_ARG(QVariant, int(Qt::Key_Return))));
        QCOMPARE(root->property("played").value<QJSValue>().property("item").property("series").property("domain").toString(), QString("mabel"));
        QCoreApplication::processEvents();
        QVERIFY2(warnings.isEmpty(), qPrintable(warnings.join('\n')));
    }
};

int main(int argc, char** argv) {
    QGuiApplication app(argc, argv);
    NativeMyTvTests tests;
    return QTest::qExec(&tests, argc, argv);
}
#include "NativeMyTvTests.moc"
