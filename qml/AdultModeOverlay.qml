pragma ComponentBehavior: Bound

import QtQuick
import MabelTV 1.0

Item {
    id: overlay
    objectName: "mabeltvAdultMode"

    required property var controller
    property bool active: false
    property bool playing: false
    property bool stopping: false
    property bool closing: false
    property bool backPressHeld: false
    property double ignoreLibraryBackBeforeMs: 0
    property int selectedIndex: 0
    readonly property real playbackPosition: adultPlayer.playbackPosition
    readonly property real playbackDuration: adultPlayer.playbackDuration
    readonly property string currentFilmName: currentFilm() ? currentFilm().name : ""
    readonly property real uiScale: Math.max(0.62, Math.min(width / 1920, height / 1080))
    property real controlsOpacity: 1
    property real selectedSavedPosition: 0
    property string errorMessage: ""
    property var filmPositions: ({})
    property bool externalSession: false
    property url externalSource: ""
    property string externalTitle: ""
    property url queuedExternalSource: ""
    property string queuedExternalTitle: ""

    signal closed()
    signal powerRequested()

    onSelectedIndexChanged: refreshSelectedFilmPosition()

    visible: active
    z: 180

    function open() {
        clampLibrarySelection()
        playing = false
        stopping = false
        closing = false
        backPressHeld = false
        ignoreLibraryBackBeforeMs = 0
        errorMessage = ""
        controlsOpacity = 1
        active = true
        externalSession = false
        externalSource = ""
        externalTitle = ""
        refreshSelectedFilmPosition()
    }

    function openExternal(source, title) {
        open()
        playExternal(source, title)
    }

    function requestExternal(source, title) {
        queuedExternalSource = source
        queuedExternalTitle = title
        if (playing || stopping) {
            stopFilm()
        } else {
            externalStartTimer.restart()
        }
    }

    function playExternal(source, title) {
        externalSession = true
        externalSource = source
        externalTitle = title || "USB video"
        queuedExternalSource = ""
        queuedExternalTitle = ""
        errorMessage = ""
        playing = true
        stopping = false
        controlsOpacity = 1
        adultPlayer.play(source, 0)
        controlsTimer.restart()
    }

    function close() {
        if (closing)
            return
        closing = true
        controlsOpacity = 1
        stopFilm()
    }

    function finishClose() {
        externalStartTimer.stop()
        queuedExternalSource = ""
        queuedExternalTitle = ""
        externalSession = false
        active = false
        closing = false
        playing = false
        stopping = false
        backPressHeld = false
        ignoreLibraryBackBeforeMs = 0
        closed()
    }

    function isBackKey(key) {
        return key === Qt.Key_Escape || key === Qt.Key_Backspace
                || key === Qt.Key_B
    }

    // Adult mode has two real navigation levels. Back from a film returns to
    // this library; only a fresh Back from the library leaves Adult mode.
    // Some IR receivers deliver a repeat tail after stop() has completed, so
    // retain the press across the async player transition and briefly debounce
    // a second press instead of accidentally falling through to children's TV.
    function back(waitForRelease) {
        if (playing || stopping) {
            backPressHeld = waitForRelease
            ignoreLibraryBackBeforeMs = Date.now() + 750
            controlsOpacity = 1
            stopFilm()
            return
        }
        if (backPressHeld || Date.now() < ignoreLibraryBackBeforeMs)
            return
        close()
    }

    function handleKeyReleased(key, isAutoRepeat) {
        if (isBackKey(key) && !isAutoRepeat) {
            backPressHeld = false
            return true
        }
        return false
    }

    function currentFilm() {
        if (externalSession)
            return { "name": externalTitle, "source": externalSource, "size": 0 }
        const films = controller.adultLibrary
        return selectedIndex >= 0 && selectedIndex < films.length
                ? films[selectedIndex] : null
    }

    function clampLibrarySelection() {
        selectedIndex = Math.max(0, Math.min(selectedIndex,
                                             controller.adultLibrary.length - 1))
        refreshSelectedFilmPosition()
    }

    function refreshSelectedFilmPosition() {
        const film = currentFilm()
        selectedSavedPosition = film
                ? (filmPositions[film.source.toString()] || 0) : 0
    }

    function accentColor(index) {
        const colours = ["#d46b4c", "#a66e9f", "#477f89", "#a1814d",
                         "#6675a8", "#6f8c69"]
        return colours[Math.abs(index) % colours.length]
    }

    function formatFileSize(bytes) {
        const gib = Number(bytes || 0) / 1073741824
        if (gib >= 1)
            return gib.toFixed(gib >= 10 ? 0 : 1) + " GB"
        return Math.max(1, Math.round(Number(bytes || 0) / 1048576)) + " MB"
    }

    function playSelected() {
        const film = currentFilm()
        if (!film)
            return
        errorMessage = ""
        externalSession = false
        playing = true
        stopping = false
        backPressHeld = false
        ignoreLibraryBackBeforeMs = 0
        controlsOpacity = 1
        const savedPosition = filmPositions[film.source.toString()] || 0
        selectedSavedPosition = savedPosition
        adultPlayer.play(film.source, savedPosition)
        controlsTimer.restart()
    }

    function rememberCurrentFilmPosition() {
        if (externalSession)
            return
        const film = currentFilm()
        if (!film || adultPlayer.playbackPosition < 2)
            return
        filmPositions[film.source.toString()] = adultPlayer.playbackPosition
        selectedSavedPosition = adultPlayer.playbackPosition
    }

    function stopFilm() {
        if (stopping)
            return
        rememberCurrentFilmPosition()
        stopping = true
        adultPlayer.stop()
    }

    function showControls() {
        controlsOpacity = 1
        controlsTimer.restart()
    }

    function selectRelative(offset) {
        const count = controller.adultLibrary.length
        if (playing || stopping || count === 0)
            return
        selectedIndex = (selectedIndex + count + offset) % count
    }

    function togglePause() {
        if (!playing || stopping)
            return
        adultPlayer.togglePause()
        showControls()
    }

    function restartFilm() {
        if (!playing || stopping)
            return
        adultPlayer.seekAbsolute(0)
        showControls()
    }

    function seek(seconds) {
        adultPlayer.seekRelative(seconds)
        showControls()
    }

    function toggleSubtitles() {
        if (adultPlayer.subtitlesAvailable)
            adultPlayer.toggleSubtitles()
        showControls()
    }

    function formatTime(seconds) {
        const value = Math.max(0, Math.floor(seconds || 0))
        const hours = Math.floor(value / 3600)
        const minutes = Math.floor((value % 3600) / 60)
        const remaining = value % 60
        return (hours > 0 ? hours + ":" + String(minutes).padStart(2, "0")
                          : String(minutes))
                + ":" + String(remaining).padStart(2, "0")
    }

    function handleKey(key, isAutoRepeat) {
        if (!playing) {
            const count = controller.adultLibrary.length
            if ((key === Qt.Key_Up || key === Qt.Key_Left) && count > 0) {
                selectRelative(-1)
            } else if ((key === Qt.Key_Down || key === Qt.Key_Right) && count > 0) {
                selectRelative(1)
            } else if ((key === Qt.Key_Return || key === Qt.Key_Enter) && !isAutoRepeat) {
                playSelected()
            } else if (isBackKey(key)) {
                if (!isAutoRepeat)
                    back(true)
            } else {
                return false
            }
            return true
        }

        if (stopping)
            return true

        if ((key === Qt.Key_Return || key === Qt.Key_Enter) && !isAutoRepeat) {
            togglePause()
        } else if ((key === Qt.Key_R || key === Qt.Key_S) && !isAutoRepeat) {
            toggleSubtitles()
        } else if (key === Qt.Key_Left) {
            seek(isAutoRepeat ? -30 : -15)
        } else if (key === Qt.Key_Right) {
            seek(isAutoRepeat ? 30 : 15)
        } else if (key === Qt.Key_Up && !isAutoRepeat) {
            seek(300)
        } else if (key === Qt.Key_Down && !isAutoRepeat) {
            seek(-300)
        } else if (key === Qt.Key_Plus || key === Qt.Key_Equal) {
            controller.dispatch(TvController.VolumeUp)
            showControls()
        } else if (key === Qt.Key_Minus) {
            controller.dispatch(TvController.VolumeDown)
            showControls()
        } else if (isBackKey(key)) {
            if (!isAutoRepeat)
                back(true)
        } else {
            showControls()
            return false
        }
        return true
    }

    Rectangle {
        anchors.fill: parent
        color: "#050706"
    }

    MpvVideo {
        id: adultPlayer
        objectName: "mabeltvAdultPlayer"
        anchors.fill: parent
        visible: overlay.playing
        volume: controller.volume
        muted: controller.muted
        aspectMode: "fit"
        subtitleDefaultOn: true

        onPlaybackFinished: {
            const film = overlay.currentFilm()
            if (film && !overlay.externalSession)
                overlay.filmPositions[film.source.toString()] = 0
            if (overlay.closing)
                overlay.finishClose()
            else if (overlay.queuedExternalSource.toString().length > 0) {
                overlay.playing = false
                overlay.stopping = false
                externalStartTimer.restart()
            }
            else {
                overlay.externalSession = false
                overlay.playing = false
                overlay.stopping = false
                overlay.controlsOpacity = 1
            }
        }
        onPlaybackStopped: {
            if (overlay.closing)
                overlay.finishClose()
            else if (overlay.queuedExternalSource.toString().length > 0) {
                overlay.playing = false
                overlay.stopping = false
                externalStartTimer.restart()
            }
            else {
                overlay.externalSession = false
                overlay.playing = false
                overlay.stopping = false
                overlay.controlsOpacity = 1
            }
        }
        onPlaybackFailed: message => {
            overlay.errorMessage = message
            if (overlay.closing)
                overlay.finishClose()
            else if (overlay.queuedExternalSource.toString().length > 0) {
                overlay.playing = false
                overlay.stopping = false
                externalStartTimer.restart()
            }
            else {
                overlay.externalSession = false
                overlay.playing = false
                overlay.stopping = false
                overlay.controlsOpacity = 1
            }
        }
        onPlaybackPositionChanged: overlay.rememberCurrentFilmPosition()
        onPausedChanged: overlay.showControls()
    }

    Item {
        anchors.fill: parent
        visible: !overlay.playing

        Rectangle {
            anchors.fill: parent
            color: "#090b0f"
            gradient: Gradient {
                GradientStop { position: 0; color: "#12151b" }
                GradientStop { position: 0.55; color: "#090b0f" }
                GradientStop { position: 1; color: "#06070a" }
            }
        }

        Rectangle {
            id: adultRail
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            width: Math.max(104, parent.width * 0.082)
            color: "#0d1015"
            border.color: "#20242b"
            border.width: 1

            Rectangle {
                anchors.top: parent.top
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.topMargin: Math.max(28, parent.height * 0.045)
                width: Math.max(52, 66 * overlay.uiScale)
                height: width
                radius: width * 0.28
                color: "#f0eee9"

                Text {
                    anchors.centerIn: parent
                    color: "#11141a"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: parent.height * 0.42
                    text: "M"
                }
            }

            Column {
                anchors.top: parent.top
                anchors.topMargin: Math.max(132, parent.height * 0.21)
                anchors.horizontalCenter: parent.horizontalCenter
                width: parent.width - 20
                spacing: 9

                Rectangle {
                    width: parent.width
                    height: Math.max(66, 82 * overlay.uiScale)
                    radius: 12
                    color: "#242931"
                    border.color: "#3b424d"

                    Column {
                        anchors.centerIn: parent
                        spacing: 5
                        Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            color: "#f4f1eb"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: Math.max(18, 23 * overlay.uiScale)
                            text: "▦"
                        }
                        Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            color: "#f4f1eb"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: Math.max(9, 11 * overlay.uiScale)
                            text: "LIBRARY"
                        }
                    }
                }

                Text {
                    width: parent.width
                    color: "#747c87"
                    horizontalAlignment: Text.AlignHCenter
                    font.family: "DejaVu Sans"
                    font.pixelSize: Math.max(10, 12 * overlay.uiScale)
                    text: controller.adultLibrary.length + (controller.adultLibrary.length === 1
                                                            ? " FILM" : " FILMS")
                }
            }

            Column {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.margins: 16
                spacing: 5

                Text {
                    width: parent.width
                    color: "#8b929c"
                    horizontalAlignment: Text.AlignHCenter
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: Math.max(10, 12 * overlay.uiScale)
                    text: "BACK"
                }
                Text {
                    width: parent.width
                    color: "#555c66"
                    horizontalAlignment: Text.AlignHCenter
                    font.family: "DejaVu Sans"
                    font.pixelSize: Math.max(9, 10 * overlay.uiScale)
                    text: "EXIT"
                }
            }
        }

        Item {
            id: adultContent
            anchors.left: adultRail.right
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            anchors.leftMargin: Math.max(34, parent.width * 0.032)
            anchors.rightMargin: Math.max(34, parent.width * 0.038)

            Row {
                id: adultHeader
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.topMargin: Math.max(28, parent.height * 0.042)
                height: Math.max(52, parent.height * 0.07)

                Column {
                    width: parent.width - privacyBadge.width
                    spacing: 3

                    Text {
                        color: "#f3f0ea"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: Math.max(23, parent.parent.height * 0.041)
                        text: "Adult TV"
                    }

                    Text {
                        color: "#727a85"
                        font.family: "DejaVu Sans"
                        font.pixelSize: Math.max(11, parent.parent.height * 0.017)
                        text: "Your private film library"
                    }
                }

                Rectangle {
                    id: privacyBadge
                    anchors.verticalCenter: parent.verticalCenter
                    width: privacyText.implicitWidth + 28
                    height: Math.max(30, 38 * overlay.uiScale)
                    radius: height / 2
                    color: "#181c22"
                    border.color: "#333a44"

                    Text {
                        id: privacyText
                        anchors.centerIn: parent
                        color: "#9da5af"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.letterSpacing: 1.2
                        font.pixelSize: Math.max(9, 11 * overlay.uiScale)
                        text: "●  PRIVATE"
                    }
                }
            }

            Rectangle {
                id: featurePanel
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: adultHeader.bottom
                anchors.topMargin: Math.max(14, parent.height * 0.02)
                height: parent.height * 0.39
                visible: controller.adultLibrary.length > 0
                radius: Math.max(16, 24 * overlay.uiScale)
                color: "#151920"
                border.color: "#2c323b"
                clip: true

                Rectangle {
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    width: parent.width * 0.34
                    color: overlay.accentColor(overlay.selectedIndex)
                    gradient: Gradient {
                        GradientStop {
                            position: 0
                            color: Qt.lighter(overlay.accentColor(overlay.selectedIndex), 1.18)
                        }
                        GradientStop {
                            position: 1
                            color: Qt.darker(overlay.accentColor(overlay.selectedIndex), 1.45)
                        }
                    }

                    Image {
                        anchors.fill: parent
                        source: overlay.currentFilm() ? overlay.currentFilm().poster : ""
                        fillMode: Image.PreserveAspectCrop
                        visible: source.toString().length > 0
                        asynchronous: true
                        cache: true
                    }

                    Text {
                        anchors.centerIn: parent
                        color: "#38ffffff"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: Math.max(94, parent.height * 0.56)
                        text: String(overlay.selectedIndex + 1).padStart(2, "0")
                    }

                    Rectangle {
                        anchors.left: parent.left
                        anchors.top: parent.top
                        anchors.bottom: parent.bottom
                        width: parent.width * 0.28
                        gradient: Gradient {
                            orientation: Gradient.Horizontal
                            GradientStop { position: 0; color: "#151920" }
                            GradientStop { position: 1; color: "#00151920" }
                        }
                    }
                }

                Column {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    anchors.leftMargin: Math.max(26, parent.width * 0.035)
                    anchors.rightMargin: parent.width * 0.37
                    anchors.topMargin: Math.max(22, parent.height * 0.11)
                    anchors.bottomMargin: Math.max(20, parent.height * 0.10)
                    spacing: Math.max(8, parent.height * 0.035)

                    Text {
                        color: overlay.accentColor(overlay.selectedIndex)
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.letterSpacing: 1.8
                        font.pixelSize: Math.max(10, 12 * overlay.uiScale)
                        text: overlay.selectedSavedPosition >= 30
                              ? "CONTINUE WATCHING" : "FEATURED FROM YOUR LIBRARY"
                    }

                    Text {
                        width: parent.width
                        color: "#f6f3ed"
                        elide: Text.ElideRight
                        maximumLineCount: 2
                        wrapMode: Text.Wrap
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: Math.max(29, Math.min(58, overlay.height * 0.061))
                        text: overlay.currentFilm() ? overlay.currentFilm().name : ""
                    }

                    Text {
                        width: parent.width
                        color: "#929ba6"
                        elide: Text.ElideRight
                        font.family: "DejaVu Sans"
                        font.pixelSize: Math.max(11, 15 * overlay.uiScale)
                        text: overlay.currentFilm()
                              ? (overlay.currentFilm().year
                                 ? overlay.currentFilm().year + "   •   " : "")
                                + overlay.formatFileSize(overlay.currentFilm().size)
                                + "   •   LOCAL FILM   •   SUBTITLES WHEN AVAILABLE"
                              : ""
                    }

                    Text {
                        width: parent.width
                        visible: overlay.currentFilm() && overlay.currentFilm().overview
                        color: "#aeb5bd"
                        maximumLineCount: 2
                        elide: Text.ElideRight
                        wrapMode: Text.Wrap
                        font.family: "DejaVu Sans"
                        font.pixelSize: Math.max(10, 13 * overlay.uiScale)
                        text: overlay.currentFilm() ? overlay.currentFilm().overview : ""
                    }

                    Rectangle {
                        width: playText.implicitWidth + Math.max(34, 46 * overlay.uiScale)
                        height: Math.max(36, 48 * overlay.uiScale)
                        radius: height / 2
                        color: "#f2efe9"

                        Text {
                            id: playText
                            anchors.centerIn: parent
                            color: "#15181e"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: Math.max(12, 15 * overlay.uiScale)
                            text: overlay.selectedSavedPosition >= 30
                                  ? "▶  RESUME  " + overlay.formatTime(overlay.selectedSavedPosition)
                                  : "▶  PLAY FILM"
                        }

                    }
                }
            }

            Item {
                anchors.fill: featurePanel
                visible: controller.adultLibrary.length === 0

                Column {
                    anchors.centerIn: parent
                    width: Math.min(parent.width * 0.8, 720)
                    spacing: 12

                    Text {
                        width: parent.width
                        color: "#f1eee8"
                        horizontalAlignment: Text.AlignHCenter
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: Math.max(28, 44 * overlay.uiScale)
                        text: "Your Adult TV library is ready"
                    }
                    Text {
                        width: parent.width
                        color: "#858e99"
                        horizontalAlignment: Text.AlignHCenter
                        wrapMode: Text.Wrap
                        font.family: "DejaVu Sans"
                        font.pixelSize: Math.max(13, 17 * overlay.uiScale)
                        text: "Add films from Adult mode in the parent web portal, then they will appear here."
                    }
                }
            }

            Text {
                id: libraryHeading
                anchors.left: parent.left
                anchors.top: featurePanel.bottom
                anchors.topMargin: Math.max(18, parent.height * 0.027)
                color: "#ece9e3"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: Math.max(16, 21 * overlay.uiScale)
                text: "Your films"
            }

            ListView {
                id: filmStrip
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: libraryHeading.bottom
                anchors.topMargin: Math.max(10, parent.height * 0.014)
                anchors.bottom: adultFooter.top
                anchors.bottomMargin: Math.max(10, parent.height * 0.014)
                visible: controller.adultLibrary.length > 0
                orientation: ListView.Horizontal
                clip: true
                spacing: Math.max(12, 18 * overlay.uiScale)
                model: controller.adultLibrary
                currentIndex: overlay.selectedIndex
                highlightMoveDuration: 180
                onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

                delegate: Rectangle {
                    required property int index
                    required property var modelData
                    readonly property bool selected: index === overlay.selectedIndex
                    width: Math.max(180, Math.min(258, filmStrip.height * 0.83))
                    height: filmStrip.height - (selected ? 2 : Math.max(9, 14 * overlay.uiScale))
                    y: selected ? 0 : Math.max(7, 10 * overlay.uiScale)
                    radius: Math.max(12, 18 * overlay.uiScale)
                    color: selected ? "#f0ede7" : "#171b21"
                    border.color: selected ? "#ffffff" : "#2a3038"
                    border.width: selected ? 3 : 1
                    clip: true

                    Behavior on y { NumberAnimation { duration: 160 } }
                    Behavior on height { NumberAnimation { duration: 160 } }

                    Rectangle {
                        id: cardArtwork
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        height: parent.height * 0.56
                        color: overlay.accentColor(index)
                        gradient: Gradient {
                            GradientStop {
                                position: 0
                                color: Qt.lighter(overlay.accentColor(index), 1.16)
                            }
                            GradientStop {
                                position: 1
                                color: Qt.darker(overlay.accentColor(index), 1.35)
                            }
                        }

                        Image {
                            anchors.fill: parent
                            source: modelData.poster
                            fillMode: Image.PreserveAspectCrop
                            visible: source.toString().length > 0
                            asynchronous: true
                            cache: true
                        }

                        Text {
                            anchors.left: parent.left
                            anchors.top: parent.top
                            anchors.margins: Math.max(12, 17 * overlay.uiScale)
                            color: "#b8ffffff"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: Math.max(11, 14 * overlay.uiScale)
                            text: String(index + 1).padStart(2, "0")
                        }

                        Text {
                            anchors.centerIn: parent
                            color: "#32ffffff"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: parent.height * 0.44
                            text: modelData.name.length > 0 ? modelData.name.charAt(0).toUpperCase() : "M"
                        }
                    }

                    Column {
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: cardArtwork.bottom
                        anchors.bottom: parent.bottom
                        anchors.margins: Math.max(12, 17 * overlay.uiScale)
                        spacing: Math.max(5, 7 * overlay.uiScale)

                        Text {
                            width: parent.width
                            color: selected ? "#181b20" : "#ece9e3"
                            elide: Text.ElideRight
                            maximumLineCount: 2
                            wrapMode: Text.Wrap
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: Math.max(13, 17 * overlay.uiScale)
                            text: modelData.name
                        }

                        Text {
                            width: parent.width
                            color: selected ? "#666d75" : "#7e8791"
                            font.family: "DejaVu Sans"
                            font.pixelSize: Math.max(10, 12 * overlay.uiScale)
                            text: (modelData.year ? modelData.year + "  •  " : "")
                                  + overlay.formatFileSize(modelData.size) + "  •  FILM"
                        }
                    }
                }
            }

            Row {
                id: adultFooter
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.bottomMargin: Math.max(15, parent.height * 0.024)
                height: Math.max(22, 28 * overlay.uiScale)

                Text {
                    width: parent.width * 0.7
                    color: overlay.errorMessage.length > 0 ? "#ff9b89" : "#68717c"
                    elide: Text.ElideRight
                    font.family: "DejaVu Sans"
                    font.pixelSize: Math.max(10, 12 * overlay.uiScale)
                    text: overlay.errorMessage.length > 0
                          ? overlay.errorMessage : "← →  BROWSE     OK  PLAY     BACK  EXIT"
                }
                Text {
                    width: parent.width * 0.3
                    color: "#4e5660"
                    horizontalAlignment: Text.AlignRight
                    font.family: "DejaVu Sans"
                    font.pixelSize: Math.max(10, 12 * overlay.uiScale)
                    text: "MABELTV  •  ADULT"
                }
            }
        }
    }

    Timer {
        id: externalStartTimer
        interval: 350
        repeat: false
        onTriggered: {
            if (!overlay.closing && overlay.queuedExternalSource.toString().length > 0)
                overlay.playExternal(overlay.queuedExternalSource,
                                     overlay.queuedExternalTitle)
        }
    }

    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        visible: overlay.playing
        height: Math.max(118, parent.height * 0.19)
        opacity: adultPlayer.paused ? 1 : overlay.controlsOpacity
        color: "#e8111512"

        Behavior on opacity { NumberAnimation { duration: 180 } }

        Column {
            anchors.fill: parent
            anchors.margins: Math.max(20, parent.height * 0.04)
            spacing: 12

            Row {
                width: parent.width
                spacing: 16
                Text {
                    width: parent.width - transportHelp.width - 16
                    color: "white"
                    elide: Text.ElideRight
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: Math.max(18, overlay.height * 0.032)
                    text: overlay.currentFilm() ? overlay.currentFilm().name : ""
                }
                Text {
                    id: transportHelp
                    color: "#c1cbc5"
                    font.family: "DejaVu Sans"
                    font.pixelSize: Math.max(13, overlay.height * 0.022)
                    text: adultPlayer.paused ? "PAUSED"
                          : (adultPlayer.subtitlesAvailable
                             ? "SUBTITLES " + (adultPlayer.subtitlesVisible ? "ON" : "OFF")
                             : "OK pause")
                }
            }

            Rectangle {
                width: parent.width
                height: 10
                radius: 5
                color: "#4c5751"
                Rectangle {
                    width: parent.width * Math.min(1, overlay.playbackDuration > 0
                                                   ? overlay.playbackPosition / overlay.playbackDuration : 0)
                    height: parent.height
                    radius: parent.radius
                    color: "#ed6a4d"
                }
            }

            Row {
                width: parent.width
                Text {
                    width: parent.width * 0.33
                    color: "#d8dfdb"
                    font.family: "DejaVu Sans"
                    text: overlay.formatTime(overlay.playbackPosition)
                }
                Text {
                    width: parent.width * 0.34
                    color: "#d8dfdb"
                    horizontalAlignment: Text.AlignHCenter
                    font.family: "DejaVu Sans"
                    text: (adultPlayer.subtitlesAvailable ? "SOURCE subtitles   " : "")
                          + "HOLD MUTE subtitles   ↓ −5 min   ← −15 sec   OK   +15 sec →   +5 min ↑"
                }
                Text {
                    width: parent.width * 0.33
                    color: "#d8dfdb"
                    horizontalAlignment: Text.AlignRight
                    font.family: "DejaVu Sans"
                    text: overlay.formatTime(overlay.playbackDuration)
                }
            }
        }
    }

    Timer {
        id: controlsTimer
        interval: 3500
        onTriggered: {
            if (!adultPlayer.paused)
                overlay.controlsOpacity = 0
        }
    }

    Connections {
        target: controller

        function onAdultLibraryChanged() {
            overlay.clampLibrarySelection()
        }
    }
}
