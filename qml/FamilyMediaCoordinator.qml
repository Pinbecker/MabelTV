pragma ComponentBehavior: Bound
import QtQuick
import MabelTV 1.0

Item {
    id: family
    objectName: "mabeltvFamilyMedia"
    required property var appRoot
    required property var controller
    anchors.fill: parent
    z: 210
    visible: active
    property bool active: false
    property bool loading: false
    property bool ready: false
    property bool paused: false
    property bool ended: false
    property bool closing: false
    property bool wasPaused: false
    property bool restorePause: false
    property var session: ({ "scenes": [], "settings": {} })
    property int sceneIndex: 0
    property real photoElapsed: 0
    property real musicPosition: 0
    property real soundVolume: controller.volume
    property string errorMessage: ""
    property int requestGeneration: 0
    property var requestObject: null
    property int pendingScene: -1
    property bool returningToChild: false
    property url requestedChildSource: ""
    property real requestedChildPosition: 0
    readonly property var scene: session.scenes[sceneIndex] || ({ "items": [] })
    readonly property var videoAsset: scene.items?.[Number(scene.video_index || 0)] || ({})
    readonly property string kind: session.kind || ""
    readonly property string currentTitle: session.title || (kind === "storytime" ? "Storytime" : "Family memories")
    readonly property string currentAsset: scene.items?.[0]?.id || ""
    readonly property real playbackPosition: kind === "storytime" ? (ended ? playbackDuration : media.playbackPosition) : scene.kind === "video" ? Math.max(0, media.playbackPosition - Number(scene.clip_start || 0)) : photoElapsed
    readonly property real playbackDuration: kind === "storytime" ? (media.playbackDuration > 0 ? media.playbackDuration : Number(scene.audio?.duration || 0)) : Number(scene.seconds || 0)
    readonly property real uiScale: Math.max(.5,Math.min(width / 1920,height / 1080))
    readonly property string childName: tvDisplayName.replace(/\s*TV$/i, "").trim()
    property bool controlsVisible: true
    property int playbackControlIndex: 1
    readonly property var playbackActions: kind === "storytime" ? ["close", "pause", "restart", "next"] : ["close", "pause", "next"]
    property bool storyStarted: false
    readonly property bool browsingStories: book.browsing
    readonly property bool returningToStories: book.returning
    readonly property bool storyOpening: kind === "storytime" && ready && !storyStarted && !browsingStories && !returningToStories
    component FamilyControl: MyTvControl {
        id: control
        property int actionIndex: -1
        highlighted: actionIndex >= 0 && family.playbackControlIndex === actionIndex
        signal activated()
        MouseArea { anchors.fill: parent; onClicked: { if (control.actionIndex >= 0) family.playbackControlIndex = control.actionIndex; control.activated() } }
    }

    function formatTime(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0))
        const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60)
        return (hours ? hours + ":" + String(minutes).padStart(2,"0") : String(minutes))
            + ":" + String(total % 60).padStart(2,"0")
    }

    function request(path, success, payload) {
        const generation = ++requestGeneration
        if (requestObject) requestObject.abort()
        const xhr = new XMLHttpRequest(); requestObject = xhr; loading = true
        xhr.open(payload === undefined ? "GET" : "POST", "http://127.0.0.1:8080/api/native/family-media/" + path)
        xhr.setRequestHeader("X-MabelTV-Native", "1")
        if (payload !== undefined) xhr.setRequestHeader("Content-Type", "application/json")
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE || generation !== family.requestGeneration) return
            requestDeadline.stop(); family.requestObject = null; family.loading = false
            if (xhr.status >= 200 && xhr.status < 300) {
                try { success(JSON.parse(xhr.responseText)) }
                catch (error) { family.errorMessage = "That family item could not be opened." }
            } else {
                try { family.errorMessage = JSON.parse(xhr.responseText).error || "Your family library is unavailable." }
                catch (error) { family.errorMessage = "Your family library is unavailable." }
            }
        }
        requestDeadline.restart()
        xhr.send(payload === undefined ? null : JSON.stringify(payload))
    }

    function prepare() { prepareSession(false) }
    function prepareSession(preserveCatalogue) {
        const alreadyActive = active
        if (active) progress(ended)
        closeDelay.stop(); bookOpening.stop(); sceneSwitch.stop()
        if (preserveCatalogue) book.holdLibrary(); else book.reset()
        videoStart.stop(); musicStart.stop(); fadeSound.stop(); memories.reset()
        active = false; session = { scenes: [], settings: {} }
        closing = false; ready = false; ended = false; storyStarted = false; errorMessage = ""
        requestedChildSource = ""; requestedChildPosition = 0
        if (!alreadyActive) {
            wasPaused = appRoot.player.paused
            appRoot.syncPlaybackPosition()
            controller.updatePlaybackPosition(appRoot.player.positionSeconds(), true)
            controller.pauseQueuePlaybackForTransfer()
        }
        // Close other overlays through their existing coordinator before
        // claiming audio. No second decoder is opened during that handoff.
        appRoot.portalCommand("return-to-mabeltv")
        active = true; paused = false; controlsVisible = false; playbackControlIndex = 1
        if (appRoot.channelOverlay) appRoot.channelOverlay.close()
        appRoot.cancelFilmCountdown(); appRoot.player.stop(); media.stop()
        if (controller.standby) controller.turnOn()
        readyDelay.restart(); controlsTimer.restart()
    }

    function openSession(identity, requestedKind) {
        prepare()
        session = { kind: requestedKind === "memories" ? "memories" : "storytime", scenes: [], settings: {} }
        if (kind === "storytime") storyCatalogue.refresh()
        request("session?id=" + encodeURIComponent(String(identity)), function(value) {
            family.session = value; family.sceneIndex = 0; family.musicPosition = 0
            storyCatalogue.includeCurrent(value)
            readyDelay.restart()
        })
    }

    function openStories() {
        prepare()
        session = { kind: "storytime", scenes: [], settings: {} }
        ready = true; book.showLibrary(false); storyCatalogue.refresh()
    }

    function chooseStory(identity) {
        stopPreviewSound(); prepareSession(true)
        session = { kind: "storytime", scenes: [], settings: {} }
        request("start?kind=storytime&id=" + encodeURIComponent(identity), function(value) {
            family.session = value; family.sceneIndex = 0; family.musicPosition = 0
            storyCatalogue.includeCurrent(value); readyDelay.restart()
        })
    }

    function back() {
        if (kind !== "storytime") { close(true); return }
        if (browsingStories || returningToStories) { book.back(); return }
        progress(ended); bookOpening.stop(); readyDelay.stop(); controlsTimer.stop()
        requestGeneration++; requestDeadline.stop()
        if (requestObject) requestObject.abort()
        requestObject = null; loading = false; paused = false; controlsVisible = false; errorMessage = ""
        storyStarted = false; media.stop(); book.showLibrary(true); storyCatalogue.refresh()
    }

    function stopPreviewSound() { if (browsingStories || returningToStories) media.stop() }
    function previewSound() {
        if (!active || !(browsingStories || storyOpening) || returningToStories || controller.standby || controller.muted || !storyCatalogue.pageSound.toString().length) return
        // The paper recording is already quiet; do not attenuate it twice.
        soundVolume = controller.volume
        media.play(storyCatalogue.pageSound, 0)
    }

    function openChannel(number) {
        prepare()
        request("start?kind=memories&channel=" + Number(number), function(value) {
            family.session = value; family.sceneIndex = 0; family.musicPosition = 0
            readyDelay.restart()
        })
    }

    function beginReady() {
        if (!active || loading || !session.scenes?.length || controller.standby || closing) return
        appRoot.player.stop()
        ready = true; soundVolume = controller.volume
        if (kind === "storytime") {
            bookOpening.restart()
        } else presentScene(0)
    }

    function beginStory() {
        if (!active || !ready || closing || browsingStories || returningToStories || controller.standby || kind !== "storytime" || storyStarted) return
        storyStarted = true
        media.play(scene.audio.source,Number(session.position || 0))
    }

    function presentScene(index) {
        if (!active || !ready || closing) return
        if (index >= session.scenes.length) {
            const avoid = scene.items?.[scene.items.length - 1]?.id || ""
            request("start?kind=memories&channel=" + session.channel + "&ordering=" + session.settings.ordering
                    + "&avoid_id=" + encodeURIComponent(avoid), function(value) {
                family.session = value; family.sceneIndex = 0; family.pendingScene = -1
                family.beginMemoryScene()
            })
            return
        }
        pendingScene = Math.max(0,index)
        if (scene.kind === "photo" && session.scenes[pendingScene].kind === "photo") {
            beginMemoryScene(); return
        }
        // A single libmpv audio output avoids fighting the Pi's exclusive
        // HDMI ALSA device. Music fades out for original home-video sound,
        // then resumes from its saved position when photographs return.
        if (scene.kind === "photo" && session.settings.music && media.status === "Playing")
            musicPosition = media.playbackPosition
        fadeSound.stop(); fadeSound.from = soundVolume; fadeSound.to = 0; fadeSound.duration = 260; fadeSound.start()
        sceneSwitch.restart()
    }

    function beginMemoryScene() {
        if (!active || closing) return
        if (pendingScene >= 0) sceneIndex = pendingScene
        pendingScene = -1; photoElapsed = 0; paused = false; errorMessage = ""
        memories.present(scene)
        if (scene.kind === "video") {
            media.stop(); soundVolume = controller.volume
            videoStart.restart()
        } else if (session.settings.music) {
            const music = session.settings.music
            if (media.source.toString() !== music.source || media.status !== "Playing") {
                media.stop(); musicStart.restart()
            } else { if (media.paused) media.togglePause(); fadeToMusic() }
        } else { media.stop(); soundVolume = controller.volume }
    }

    function fadeToMusic() {
        fadeSound.stop(); fadeSound.from = soundVolume
        fadeSound.to = controller.volume * Number(session.settings.music_volume || 0) / 100
        fadeSound.duration = 550; fadeSound.start()
    }

    function progress(finished) {
        if (kind !== "storytime" || !session.story_id || !storyStarted) return
        const xhr = new XMLHttpRequest()
        xhr.open("POST", "http://127.0.0.1:8080/api/native/family-media/progress")
        xhr.setRequestHeader("X-MabelTV-Native", "1"); xhr.setRequestHeader("Content-Type", "application/json")
        xhr.send(JSON.stringify({ action: "progress", session: session.id, position: finished ? 0 : Math.max(0,media.playbackPosition) }))
    }

    function close(resumeChild) {
        if (!active) return
        progress(ended); closing = true; controlsTimer.stop(); bookOpening.stop()
        sceneSwitch.stop(); videoStart.stop(); musicStart.stop(); readyDelay.stop(); fadeSound.stop()
        book.reset(); memories.reset()
        storyCatalogue.cancel()
        requestGeneration++; requestDeadline.stop()
        if (requestObject) requestObject.abort()
        requestObject = null; loading = false; ready = false
        returningToChild = resumeChild !== false && !controller.standby
        restorePause = returningToChild && wasPaused
        media.stop(); closeDelay.restart()
    }

    function queueChildPlayback(source, position) {
        if (!closing || returningToChild) return
        requestedChildSource = source; requestedChildPosition = Math.max(0, Number(position) || 0)
    }

    function control(action, position) {
        if (!active || closing) return
        if (!playbackControls.showing) playbackControlIndex = 1
        controlsVisible = true; controlsTimer.restart()
        if (action === "close") { back(); return }
        if (browsingStories || returningToStories) {
            if (action === "pause") book.select()
            else if (action === "next" || action === "previous") book.navigate(action === "next" ? "right" : "left")
            return
        }
        if (!ready || loading) return
        if (storyOpening && action === "pause") { book.finish(); return }
        if (action === "pause") {
            if (ended) { ended = false; paused = false; media.play(scene.audio.source,0); return }
            paused = !paused
            if (kind === "storytime" || scene.kind === "video" || session.settings.music) media.togglePause()
        } else if (action === "seek" && kind === "storytime") media.seekAbsolute(Math.max(0,Number(position) || 0))
        else if (action === "restart") {
            if (kind === "storytime") { ended = false; paused = false; media.play(scene.audio.source,0) }
            else presentScene(sceneIndex)
        } else if (action === "next") {
            if (kind === "storytime") media.seekRelative(15)
            else presentScene(sceneIndex + 1)
        } else if (action === "previous") {
            if (kind === "storytime") media.seekRelative(-15)
            else presentScene(Math.max(0,sceneIndex - 1))
        }
    }

    function navigatePlaybackControl(step) {
        if (!playbackControls.showing) { control(step < 0 ? "previous" : "next", 0); return }
        playbackControlIndex = Math.max(0, Math.min(playbackActions.length - 1, playbackControlIndex + step))
        controlsVisible = true; controlsTimer.restart()
    }

    function activatePlaybackControl() {
        control(playbackControls.showing ? playbackActions[playbackControlIndex] : "pause", 0)
    }

    function handlePortal(command) {
        if (!active) return false
        if ((browsingStories || returningToStories) && command.startsWith("navigate-")) {
            book.navigate(command.slice(9)); return true
        }
        if (["navigate-left", "navigate-right", "navigate-up", "navigate-down"].includes(command)) {
            navigatePlaybackControl(command === "navigate-left" || command === "navigate-up" ? -1 : 1); return true
        }
        if (command === "select") { activatePlaybackControl(); return true }
        const commands = { "toggle-pause": "pause", "next-programme": "next", "previous-programme": "previous",
            "restart-programme": "restart", "close-overlay": "close" }
        if (commands[command]) { control(commands[command],0); return true }
        if (["return-to-mabeltv", "enter-my-tv-mode", "open-channel-menu", "open-tv-guide", "open-parent-menu",
             "channel-up", "channel-down"].includes(command)) { close(command === "return-to-mabeltv"); return false }
        if (["turn-off", "turn-off-mabel-only", "toggle-power"].includes(command)) { close(false); return false }
        return false
    }

    function handleKey(key, repeat) {
        if ([Qt.Key_P, Qt.Key_M, Qt.Key_Plus, Qt.Key_Equal, Qt.Key_Minus, Qt.Key_F11].includes(key)) return false
        if (repeat) return true
        if (key === Qt.Key_B || key === Qt.Key_Escape || key === Qt.Key_Backspace) { back(); return true }
        if (browsingStories || returningToStories) {
            if (key === Qt.Key_Return || key === Qt.Key_Enter || key === Qt.Key_Space) book.select()
            else if ([Qt.Key_Left, Qt.Key_Right, Qt.Key_Up, Qt.Key_Down].includes(key))
                book.navigate(key === Qt.Key_Left ? "left" : key === Qt.Key_Right ? "right" : key === Qt.Key_Up ? "up" : "down")
            else if (key === Qt.Key_Home) close(true)
            else if (key === Qt.Key_PageUp || key === Qt.Key_PageDown) { close(false); return false }
            return true
        }
        if (key === Qt.Key_Return || key === Qt.Key_Enter || key === Qt.Key_Space) { activatePlaybackControl(); return true }
        if (key === Qt.Key_Right || key === Qt.Key_Down) { navigatePlaybackControl(1); return true }
        if (key === Qt.Key_Left || key === Qt.Key_Up) { navigatePlaybackControl(-1); return true }
        if (key === Qt.Key_Home) { close(true); return true }
        if (key === Qt.Key_PageUp || key === Qt.Key_PageDown) { close(false); return false }
        return true
    }

    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            GradientStop { position: 0; color: family.kind === "storytime" ? "#193329" : "#101f2a" }
            GradientStop { position: .55; color: family.kind === "storytime" ? "#345342" : "#0c151c" }
            GradientStop { position: 1; color: family.kind === "storytime" ? "#0b1813" : "#16212a" }
        }
    }
    Image {
        anchors.fill: parent; visible: family.kind === "storytime"
        source: "qrc:/storytime/stone-floor.png"; fillMode: Image.PreserveAspectCrop
        sourceSize.width: 1920; sourceSize.height: 1080
    }
    FontLoader { source: "qrc:/fonts/inter/InterVariable.ttf" }
    MemoryStage { id: memories; anchors.fill: parent; anchors.margins: 12 * family.uiScale; visible: family.kind === "memories"; paused: family.paused }
    Item {
        id: videoCard
        readonly property var frame: memories.videoGeometry
        readonly property bool showingVideo: family.kind === "memories" && family.scene.kind === "video"
        x: showingVideo ? memories.x + frame.x : 0; y: showingVideo ? memories.y + frame.y : 0
        width: showingVideo ? Math.max(8 * family.uiScale, frame.width) : 4
        height: showingVideo ? Math.max(8 * family.uiScale, frame.height) : 4
        rotation: showingVideo ? frame.rotation : 0; scale: showingVideo ? frame.scale : 1
        // libmpv waits for this Qt render context before loading any media,
        // including audio. Zero opacity/size prevents that context from starting.
        opacity: showingVideo && (media.status === "Playing" || media.paused) ? Math.max(.01, memories.reveal) : .01
        Behavior on opacity { NumberAnimation { duration: 350 } }
    MpvVideo {
        id: media; objectName: "mabeltvFamilyPlayer"
        anchors.fill: parent; anchors.margins: videoCard.showingVideo ? 2 * family.uiScale : 0
        aspectMode: "fit"; volume: Math.round(family.soundVolume); muted: family.controller.muted
        onPlaybackPositionChanged: {
            if (family.active && !family.closing && !family.paused && status === "Playing" && source.toString() === family.videoAsset.source
                    && family.scene.kind === "video" && family.pendingScene < 0
                    && playbackPosition >= Number(family.scene.clip_start || 0) + Number(family.scene.seconds || 10))
                family.presentScene(family.sceneIndex + 1)
        }
        onPlaybackFinished: {
            if (!family.active || family.closing) return
            if (family.browsingStories || family.returningToStories || family.storyOpening) return
            if (family.kind === "storytime") { family.ended = true; family.controlsVisible = true; family.progress(true) }
            else if (family.scene.kind === "video" && family.pendingScene < 0) family.presentScene(family.sceneIndex + 1)
            else if (family.session.settings.music) { family.musicPosition = 0; musicStart.restart() }
        }
        onPlaybackFailed: message => {
            if (family.browsingStories || family.returningToStories || family.storyOpening) return
            family.errorMessage = message; family.paused = true; family.controlsVisible = true
        }
        onStatusChanged: { if (family.active && family.paused && status === "Playing" && !paused) togglePause() }
    }
    }
    StorytimeCatalogue { id: storyCatalogue; objectName: "storytimeCatalogue" }
    StorytimeStage {
        id: book
        anchors.fill: parent
        childName: family.childName; storyTitle: family.session.title || ""
        storyId: family.session.story_id || ""; stories: storyCatalogue.stories
        catalogueStatus: storyCatalogue.error || (storyCatalogue.loading ? "Opening your books…" : "")
        illustration: family.kind === "storytime" ? family.scene.items?.[0]?.source || "" : ""
        visible: family.kind === "storytime"
        onOpeningFinished: family.beginStory()
        onChosen: identity => family.chooseStory(identity)
        onExited: family.close(true)
        onPreviewSound: family.previewSound()
        onStopPreviewSound: family.stopPreviewSound()
        onReturned: if (family.active && !family.controller.standby) family.ready = true
    }
    FamilyControl {
        anchors.right: parent.right; anchors.bottom: parent.bottom
        anchors.margins: 36 * family.uiScale; width: 185 * family.uiScale; height: 50 * family.uiScale
        uiScale: family.uiScale; visible: family.storyOpening; onActivated: book.finish()
        MyTvText { anchors.centerIn: parent; text: "Skip opening"; color: "#28463c"; font.pixelSize: 21 * family.uiScale }
    }
    Rectangle {
        id: playbackControls
        objectName: "familyPlaybackControls"
        anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom
        anchors.leftMargin: 42 * family.uiScale; anchors.rightMargin: 42 * family.uiScale
        anchors.bottomMargin: 28 * family.uiScale
        height: (family.kind === "storytime" ? 218 : 180) * family.uiScale
        radius: 22 * family.uiScale; color: "#f4eee5ed"; border.color: "#c9bea8"
        readonly property bool showing: family.active && family.ready && !family.closing && !family.loading
            && !family.browsingStories && !family.returningToStories
            && (family.kind === "storytime" ? family.storyStarted && (family.controlsVisible || family.paused || family.ended) : family.paused)
        opacity: showing ? 1 : 0
        visible: opacity > 0; enabled: showing
        Behavior on opacity { NumberAnimation { duration: 180 } }
        Column {
            x: 26 * family.uiScale; y: 22 * family.uiScale; width: parent.width - 52 * family.uiScale; spacing: 10 * family.uiScale
            Item {
                width: parent.width; height: 38 * family.uiScale
                MyTvText { anchors.left: parent.left; anchors.right: playbackState.left; anchors.rightMargin: 20 * family.uiScale; text: family.currentTitle; color: "#28463c"; font.pixelSize: 31 * family.uiScale; font.weight: Font.Bold; elide: Text.ElideRight }
                MyTvText { id: playbackState; anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter; text: family.ended ? "All done for now" : family.paused ? "Paused" : family.kind === "storytime" ? "Listening" : `${family.sceneIndex + 1} of ${family.session.scenes.length}`; color: "#81745c"; font.pixelSize: 21 * family.uiScale }
            }
            Item {
                width: parent.width; height: 22 * family.uiScale
                readonly property real ratio: Math.min(1,Math.max(0,family.playbackPosition / Math.max(1,family.playbackDuration)))
                Rectangle {
                    anchors.verticalCenter: parent.verticalCenter; width: parent.width; height: 7 * family.uiScale; radius: height / 2; color: "#d4c9b0"
                    Rectangle { width: parent.width * parent.parent.ratio; height: parent.height; radius: height / 2; color: "#128d79" }
                }
                Rectangle { x: Math.max(0,Math.min(parent.width - width,parent.width * parent.ratio - width / 2)); anchors.verticalCenter: parent.verticalCenter; width: 16 * family.uiScale; height: width; radius: width / 2; color: "#128d79" }
                MouseArea { anchors.fill: parent; enabled: family.kind === "storytime" && family.playbackDuration > 0; onClicked: mouse => family.control("seek",mouse.x / width * family.playbackDuration) }
            }
            Item {
                visible: family.kind === "storytime"; width: parent.width; height: 24 * family.uiScale
                MyTvText { objectName: "familyElapsedTime"; anchors.left: parent.left; text: family.formatTime(family.playbackPosition) + " / " + family.formatTime(family.playbackDuration); color: "#28463c"; font.pixelSize: 20 * family.uiScale }
                MyTvText { objectName: "familyRemainingTime"; anchors.right: parent.right; text: family.formatTime(Math.max(0,family.playbackDuration - family.playbackPosition)) + " remaining"; color: "#81745c"; font.pixelSize: 20 * family.uiScale }
            }
            Row {
                spacing: 12 * family.uiScale
                FamilyControl { actionIndex: 0; width: 170 * family.uiScale; height: 50 * family.uiScale; uiScale: family.uiScale; onActivated: family.back(); MyTvText { anchors.centerIn: parent; text: "Back"; color: "#28463c"; font.pixelSize: 21 * family.uiScale } }
                FamilyControl { actionIndex: 1; width: 170 * family.uiScale; height: 50 * family.uiScale; uiScale: family.uiScale; onActivated: family.control("pause",0); MyTvText { anchors.centerIn: parent; text: family.ended ? "Play again" : family.paused ? "Play" : "Pause"; color: "#28463c"; font.pixelSize: 21 * family.uiScale } }
                FamilyControl { objectName: "familyRestartControl"; actionIndex: 2; width: 170 * family.uiScale; height: 50 * family.uiScale; uiScale: family.uiScale; visible: family.kind === "storytime"; onActivated: family.control("restart",0); MyTvText { anchors.centerIn: parent; text: "Restart"; color: "#28463c"; font.pixelSize: 21 * family.uiScale } }
                FamilyControl { actionIndex: family.kind === "storytime" ? 3 : 2; width: 180 * family.uiScale; height: 50 * family.uiScale; uiScale: family.uiScale; onActivated: family.control("next",0); MyTvText { anchors.centerIn: parent; text: family.kind === "storytime" ? "+15 seconds" : "Next memory"; color: "#28463c"; font.pixelSize: 21 * family.uiScale } }
            }
        }
    }
    MyTvText {
        anchors.centerIn: parent; width: parent.width * .65; horizontalAlignment: Text.AlignHCenter
        text: family.errorMessage || (family.loading ? "Opening your family library…" : "")
        visible: family.errorMessage.length > 0 || family.loading
        font.pixelSize: 30 * family.uiScale; color: family.kind === "memories" ? "#eaf2f4" : "#28463c"; wrapMode: Text.WordWrap
    }
    NumberAnimation { id: fadeSound; target: family; property: "soundVolume" }
    Timer { id: requestDeadline; interval: 15000; onTriggered: { family.requestGeneration++; if (family.requestObject) family.requestObject.abort(); family.loading = false; family.errorMessage = "Your family library took too long to respond. Try opening it again." } }
    Timer { id: readyDelay; interval: 550; onTriggered: family.beginReady() }
    Timer { id: bookOpening; interval: 0; onTriggered: { if (family.active && family.ready && family.session.scenes?.length && !family.closing && !family.controller.standby) book.open() } }
    Timer { id: sceneSwitch; interval: 280; onTriggered: family.beginMemoryScene() }
    Timer { id: videoStart; interval: 300; onTriggered: { if (family.active && family.scene.kind === "video") media.play(family.videoAsset.source, Number(family.scene.clip_start || 0)) } }
    Timer { id: musicStart; interval: 300; onTriggered: { if (family.active && family.scene.kind === "photo" && family.session.settings.music) { family.soundVolume = 0; media.play(family.session.settings.music.source,family.musicPosition); family.fadeToMusic() } } }
    Timer { id: controlsTimer; objectName: "familyControlsTimer"; interval: 8000; onTriggered: { if (!family.paused && !family.ended) family.controlsVisible = false } }
    Timer {
        id: photoTimer; interval: 100; repeat: true
        running: family.active && family.ready && !family.paused && !family.loading && !family.closing && family.scene.kind === "photo" && family.pendingScene < 0
        onTriggered: { family.photoElapsed += interval / 1000; if (family.photoElapsed >= Number(family.scene.seconds || 10)) family.presentScene(family.sceneIndex + 1) }
    }
    Timer { interval: 10000; repeat: true; running: family.active && family.ready && family.kind === "storytime" && !family.ended; onTriggered: family.progress(false) }
    Timer {
        id: closeDelay; interval: 400
        onTriggered: {
            family.active = false; family.closing = false; family.session = { scenes: [], settings: {} }
            if (family.requestedChildSource.toString().length && !family.controller.standby) {
                const source = family.requestedChildSource, position = family.requestedChildPosition
                family.requestedChildSource = ""; family.requestedChildPosition = 0
                family.appRoot.startControllerPlayback(source, position)
            } else if (family.returningToChild && !family.controller.standby) {
                if (family.controller.currentContentType === "memories") family.appRoot.portalCommand("open-channel-menu")
                else family.controller.resumeFromStandby()
            }
            family.returningToChild = false
        }
    }
    Connections {
        target: family.controller
        function onFamilyMemoryRequested(number) { family.openChannel(number) }
        function onStandbyChanged() { if (family.controller.standby) family.close(false) }
        function onVolumeChanged() { if (family.active) family.soundVolume = family.scene.kind === "photo" ? family.controller.volume * Number(family.session.settings.music_volume || 0) / 100 : family.controller.volume }
    }
    Connections {
        target: family.appRoot.player
        function onStatusChanged() {
            if (!family.active && family.restorePause && family.appRoot.player.status === "Playing") {
                family.restorePause = false
                if (!family.appRoot.player.paused) family.appRoot.player.togglePause()
            }
        }
    }
}
