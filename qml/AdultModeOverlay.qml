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
    property int selectedCollectionIndex: 0
    property int navigationZone: 1
    property var collections: []
    property var visibleFilms: []
    readonly property real playbackPosition: adultPlayer.playbackPosition
    readonly property real playbackDuration: adultPlayer.playbackDuration
    readonly property string currentFilmName: currentFilm() ? currentFilm().name : ""
    readonly property real uiScale: Math.max(0.62, Math.min(width / 1920, height / 1080))
    property real controlsOpacity: 1
    property real selectedSavedPosition: 0
    property string errorMessage: ""
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
        rebuildCollections()
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
        navigationZone = visibleFilms.length > 0 ? 1 : 0
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
        if (navigationZone === 1) {
            navigationZone = 0
            return
        }
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
        const films = visibleFilms
        return selectedIndex >= 0 && selectedIndex < films.length
                ? films[selectedIndex] : null
    }

    function clampLibrarySelection() {
        selectedIndex = Math.max(0, Math.min(selectedIndex, visibleFilms.length - 1))
        refreshSelectedFilmPosition()
    }

    function rebuildCollections() {
        const films = controller.adultLibrary
        const previousKey = collections.length > selectedCollectionIndex
                ? collections[selectedCollectionIndex].key : "all"
        const folders = []
        let hasUnfiled = false
        let hasContinue = false
        for (let index = 0; index < films.length; ++index) {
            const film = films[index]
            const folder = film.folder || ""
            if (folder.length === 0)
                hasUnfiled = true
            else if (folders.indexOf(folder) < 0)
                folders.push(folder)
            if (controller.adultPlaybackPosition(film.id) >= 30)
                hasContinue = true
        }
        folders.sort((left, right) => left.localeCompare(right))
        const next = [{ "key": "all", "name": "All films", "folder": "*" }]
        if (hasContinue)
            next.push({ "key": "continue", "name": "Continue watching", "folder": "@continue" })
        if (hasUnfiled)
            next.push({ "key": "unfiled", "name": "Unfiled", "folder": "" })
        for (let folderIndex = 0; folderIndex < folders.length; ++folderIndex)
            next.push({ "key": "folder:" + folders[folderIndex],
                        "name": folders[folderIndex], "folder": folders[folderIndex] })
        collections = next
        let nextIndex = 0
        for (let collectionIndex = 0; collectionIndex < next.length; ++collectionIndex) {
            if (next[collectionIndex].key === previousKey) {
                nextIndex = collectionIndex
                break
            }
        }
        selectedCollectionIndex = nextIndex
        applySelectedCollection()
    }

    function applySelectedCollection() {
        const films = controller.adultLibrary
        const collection = collections.length > selectedCollectionIndex
                ? collections[selectedCollectionIndex] : null
        const filtered = []
        for (let index = 0; index < films.length; ++index) {
            const film = films[index]
            if (!collection || collection.folder === "*"
                    || (collection.folder === "@continue"
                        && controller.adultPlaybackPosition(film.id) >= 30)
                    || film.folder === collection.folder)
                filtered.push(film)
        }
        visibleFilms = filtered
        clampLibrarySelection()
    }

    function selectCollectionRelative(offset) {
        if (collections.length === 0)
            return
        selectedCollectionIndex = (selectedCollectionIndex + collections.length + offset)
                % collections.length
        selectedIndex = 0
        applySelectedCollection()
    }

    function collectionFilmCount(collection) {
        const films = controller.adultLibrary
        let count = 0
        for (let index = 0; index < films.length; ++index) {
            if (collection.folder === "*"
                    || (collection.folder === "@continue"
                        && controller.adultPlaybackPosition(films[index].id) >= 30)
                    || films[index].folder === collection.folder)
                ++count
        }
        return count
    }

    function refreshSelectedFilmPosition() {
        const film = currentFilm()
        selectedSavedPosition = film
                ? controller.adultPlaybackPosition(film.id) : 0
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
        const savedPosition = controller.adultPlaybackPosition(film.id)
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
        controller.setAdultPlaybackPosition(film.id, adultPlayer.playbackPosition)
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
        const count = visibleFilms.length
        if (playing || stopping || count === 0)
            return
        selectedIndex = (selectedIndex + count + offset) % count
    }

    function navigateGrid(horizontal, vertical) {
        const count = visibleFilms.length
        if (count === 0)
            return
        const columns = Math.max(1, posterGrid.columns)
        if (horizontal < 0 && selectedIndex % columns === 0) {
            navigationZone = 0
            return
        }
        let next = selectedIndex + horizontal + vertical * columns
        next = Math.max(0, Math.min(count - 1, next))
        selectedIndex = next
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
            if (navigationZone === 0) {
                if (key === Qt.Key_Up)
                    selectCollectionRelative(-1)
                else if (key === Qt.Key_Down)
                    selectCollectionRelative(1)
                else if ((key === Qt.Key_Right || key === Qt.Key_Return
                          || key === Qt.Key_Enter) && visibleFilms.length > 0)
                    navigationZone = 1
                else if (isBackKey(key)) {
                    if (!isAutoRepeat)
                        back(true)
                } else
                    return false
            } else if (key === Qt.Key_Left) {
                navigateGrid(-1, 0)
            } else if (key === Qt.Key_Right) {
                navigateGrid(1, 0)
            } else if (key === Qt.Key_Up) {
                navigateGrid(0, -1)
            } else if (key === Qt.Key_Down) {
                navigateGrid(0, 1)
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
            if (film && !overlay.externalSession) {
                controller.setAdultPlaybackPosition(film.id, 0)
                overlay.selectedSavedPosition = 0
            }
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
        onPausedChanged: overlay.showControls()
    }

    Item {
        id: libraryScreen
        anchors.fill: parent
        visible: !overlay.playing

        Rectangle {
            anchors.fill: parent
            color: "#080a0d"
            gradient: Gradient {
                GradientStop { position: 0; color: "#10141a" }
                GradientStop { position: 0.58; color: "#090c10" }
                GradientStop { position: 1; color: "#06080a" }
            }
        }

        Image {
            anchors.right: parent.right
            anchors.top: parent.top
            width: parent.width * 0.42
            height: parent.height * 0.48
            source: overlay.currentFilm() ? overlay.currentFilm().poster : ""
            fillMode: Image.PreserveAspectCrop
            opacity: 0.055
            visible: source.toString().length > 0
            asynchronous: true
            cache: true
        }

        Rectangle {
            anchors.fill: parent
            gradient: Gradient {
                orientation: Gradient.Horizontal
                GradientStop { position: 0; color: "#0010141a" }
                GradientStop { position: 0.63; color: "#85080a0d" }
                GradientStop { position: 1; color: "#d6080a0d" }
            }
        }

        Row {
            id: adultHeader
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.leftMargin: Math.max(28, 42 * overlay.uiScale)
            anchors.rightMargin: Math.max(28, 42 * overlay.uiScale)
            anchors.topMargin: Math.max(20, 27 * overlay.uiScale)
            height: Math.max(48, 60 * overlay.uiScale)
            spacing: Math.max(12, 16 * overlay.uiScale)

            Rectangle {
                width: Math.max(5, 7 * overlay.uiScale)
                height: parent.height * 0.72
                anchors.verticalCenter: parent.verticalCenter
                radius: width / 2
                color: "#d6b36a"

                Text {
                    visible: false
                    anchors.centerIn: parent
                    color: "#11151a"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: parent.height * 0.42
                    text: "M"
                }
            }

            Column {
                anchors.verticalCenter: parent.verticalCenter
                width: parent.width - headerStats.width - Math.max(5, 7 * overlay.uiScale)
                       - parent.spacing * 2
                spacing: 1

                Text {
                    color: "#f6f3ed"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: Math.max(20, 27 * overlay.uiScale)
                    text: "Adult Library"
                }
                Text {
                    color: "#737c86"
                    font.family: "DejaVu Sans"
                    font.pixelSize: Math.max(11, 13 * overlay.uiScale)
                    text: "MABELTV  /  PRIVATE"
                }
            }

            Row {
                id: headerStats
                anchors.verticalCenter: parent.verticalCenter
                spacing: Math.max(10, 14 * overlay.uiScale)

                Rectangle {
                    width: filmCountText.implicitWidth + Math.max(24, 32 * overlay.uiScale)
                    height: Math.max(30, 36 * overlay.uiScale)
                    radius: height / 2
                    color: "#12161b"
                    border.color: "#29313a"

                    Text {
                        id: filmCountText
                        anchors.centerIn: parent
                        color: "#9ba3ac"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: Math.max(11, 14 * overlay.uiScale)
                        text: controller.adultLibrary.length + " FILMS"
                    }
                }

                Rectangle {
                    width: privacyText.implicitWidth + Math.max(24, 32 * overlay.uiScale)
                    height: Math.max(30, 36 * overlay.uiScale)
                    radius: height / 2
                    color: "transparent"
                    border.color: "transparent"

                    Text {
                        id: privacyText
                        anchors.centerIn: parent
                        color: "#666f79"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.letterSpacing: 1.2
                        font.pixelSize: Math.max(10, 12 * overlay.uiScale)
                        text: "LOCAL MEDIA"
                    }
                }
            }
        }

        Text {
            id: collectionLabel
            anchors.left: parent.left
            anchors.top: adultHeader.bottom
            anchors.leftMargin: Math.max(28, 42 * overlay.uiScale)
            anchors.topMargin: Math.max(18, 24 * overlay.uiScale)
            color: "#69727c"
            font.family: "DejaVu Sans"
            font.bold: true
            font.letterSpacing: 1.8
            font.pixelSize: Math.max(10, 12 * overlay.uiScale)
            text: "LIBRARY"
        }

        ListView {
            id: collectionTabs
            anchors.left: parent.left
            anchors.top: collectionLabel.bottom
            anchors.bottom: adultFooter.top
            anchors.leftMargin: Math.max(24, 36 * overlay.uiScale)
            anchors.topMargin: Math.max(9, 12 * overlay.uiScale)
            anchors.bottomMargin: Math.max(14, 20 * overlay.uiScale)
            width: Math.max(190, parent.width * 0.17)
            orientation: ListView.Vertical
            spacing: Math.max(3, 5 * overlay.uiScale)
            clip: true
            model: overlay.collections
            currentIndex: overlay.selectedCollectionIndex
            onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

            delegate: Rectangle {
                required property int index
                required property var modelData
                readonly property bool selected: index === overlay.selectedCollectionIndex
                width: collectionTabs.width
                height: Math.max(42, 52 * overlay.uiScale)
                radius: Math.max(7, 9 * overlay.uiScale)
                color: selected
                       ? (overlay.navigationZone === 0 ? "#eeeae2" : "#20262d")
                       : "transparent"
                border.color: selected
                              ? (overlay.navigationZone === 0 ? "#ffffff" : "#343d47")
                              : "transparent"
                border.width: 1

                Row {
                    anchors.fill: parent
                    anchors.leftMargin: Math.max(13, 17 * overlay.uiScale)
                    anchors.rightMargin: Math.max(13, 17 * overlay.uiScale)
                    spacing: Math.max(8, 11 * overlay.uiScale)

                    Text {
                        id: tabName
                        anchors.verticalCenter: parent.verticalCenter
                        width: parent.width - tabCount.width - parent.spacing
                        color: selected && overlay.navigationZone === 0
                               ? "#15191e" : "#e2dfd9"
                        elide: Text.ElideRight
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: Math.max(12, 15 * overlay.uiScale)
                        text: modelData.name
                    }

                    Text {
                        id: tabCount
                        anchors.verticalCenter: parent.verticalCenter
                        color: selected && overlay.navigationZone === 0
                               ? "#65707a" : "#7f8994"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: Math.max(11, 13 * overlay.uiScale)
                        text: overlay.collectionFilmCount(modelData)
                    }
                }
            }
        }

        Item {
            id: libraryBody
            anchors.left: collectionTabs.right
            anchors.right: parent.right
            anchors.top: adultHeader.bottom
            anchors.bottom: adultFooter.top
            anchors.leftMargin: Math.max(24, 34 * overlay.uiScale)
            anchors.rightMargin: Math.max(28, 42 * overlay.uiScale)
            anchors.topMargin: Math.max(18, 24 * overlay.uiScale)
            anchors.bottomMargin: Math.max(10, 14 * overlay.uiScale)

            Rectangle {
                id: detailPanel
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                width: 0
                radius: Math.max(16, 22 * overlay.uiScale)
                color: "#151a20"
                border.color: "#303943"
                border.width: 1
                clip: true
                visible: false

                Rectangle {
                    id: detailArtwork
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    height: parent.height * 0.46
                    color: overlay.accentColor(overlay.selectedIndex)
                    gradient: Gradient {
                        GradientStop {
                            position: 0
                            color: Qt.lighter(overlay.accentColor(overlay.selectedIndex), 1.16)
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

                    Rectangle {
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.bottom: parent.bottom
                        height: parent.height * 0.38
                        gradient: Gradient {
                            GradientStop { position: 0; color: "#00151a20" }
                            GradientStop { position: 1; color: "#f0151a20" }
                        }
                    }

                    Text {
                        anchors.left: parent.left
                        anchors.bottom: parent.bottom
                        anchors.margins: Math.max(16, 22 * overlay.uiScale)
                        color: "#e7e2dc"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: Math.max(12, 15 * overlay.uiScale)
                        text: overlay.selectedSavedPosition >= 30
                              ? "CONTINUE AT " + overlay.formatTime(overlay.selectedSavedPosition)
                              : "READY TO PLAY"
                    }
                }

                Column {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: detailArtwork.bottom
                    anchors.bottom: parent.bottom
                    anchors.margins: Math.max(18, 24 * overlay.uiScale)
                    spacing: Math.max(7, 10 * overlay.uiScale)

                    Text {
                        width: parent.width
                        color: "#f5f1ea"
                        maximumLineCount: 2
                        elide: Text.ElideRight
                        wrapMode: Text.Wrap
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: Math.max(22, 29 * overlay.uiScale)
                        text: overlay.currentFilm() ? overlay.currentFilm().name : ""
                    }

                    Text {
                        width: parent.width
                        color: "#8f99a5"
                        elide: Text.ElideRight
                        font.family: "DejaVu Sans"
                        font.pixelSize: Math.max(11, 14 * overlay.uiScale)
                        text: overlay.currentFilm()
                              ? (overlay.currentFilm().year
                                 ? overlay.currentFilm().year + "   •   " : "")
                                + overlay.formatFileSize(overlay.currentFilm().size)
                                + "   •   LOCAL"
                              : ""
                    }

                    Text {
                        width: parent.width
                        visible: overlay.currentFilm() && overlay.currentFilm().overview
                        color: "#b2bac3"
                        maximumLineCount: 3
                        elide: Text.ElideRight
                        wrapMode: Text.Wrap
                        font.family: "DejaVu Sans"
                        font.pixelSize: Math.max(11, 13 * overlay.uiScale)
                        lineHeight: 1.15
                        text: overlay.currentFilm() ? overlay.currentFilm().overview : ""
                    }

                    Item { width: 1; height: Math.max(2, 4 * overlay.uiScale) }

                    Rectangle {
                        width: parent.width
                        height: Math.max(42, 54 * overlay.uiScale)
                        radius: Math.max(10, 14 * overlay.uiScale)
                        color: "#f1eee7"

                        Text {
                            anchors.centerIn: parent
                            color: "#15191e"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: Math.max(14, 17 * overlay.uiScale)
                            text: overlay.selectedSavedPosition >= 30
                                  ? "OK   RESUME FILM" : "OK   PLAY FILM"
                        }
                    }
                }
            }

            GridView {
                id: posterGrid
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                visible: overlay.visibleFilms.length > 0
                clip: true
                readonly property int columns: 4
                cellWidth: width / columns
                cellHeight: height / 3
                model: overlay.visibleFilms
                currentIndex: overlay.selectedIndex
                highlightMoveDuration: 150
                onCurrentIndexChanged: positionViewAtIndex(currentIndex, GridView.Contain)

                delegate: Rectangle {
                    required property int index
                    required property var modelData
                    readonly property bool selected: index === overlay.selectedIndex
                    readonly property bool focused: selected && overlay.navigationZone === 1
                    width: posterGrid.cellWidth - Math.max(12, 16 * overlay.uiScale)
                    height: posterGrid.cellHeight - Math.max(6, 8 * overlay.uiScale)
                    radius: Math.max(8, 10 * overlay.uiScale)
                    color: "transparent"
                    border.color: "transparent"
                    border.width: 0
                    z: focused ? 2 : 1
                    scale: focused ? 1.02 : 1

                    Behavior on scale { NumberAnimation { duration: 120 } }

                    Rectangle {
                        id: posterArtwork
                        anchors.horizontalCenter: parent.horizontalCenter
                        anchors.top: parent.top
                        height: parent.height * 0.72
                        width: height * 0.68
                        color: "transparent"
                        border.width: 0

                        Image {
                            anchors.fill: parent
                            source: modelData.poster
                            fillMode: Image.PreserveAspectFit
                            visible: source.toString().length > 0
                            asynchronous: true
                            cache: true
                        }

                        Rectangle {
                            visible: false
                            anchors.left: parent.left
                            anchors.top: parent.top
                            anchors.margins: Math.max(5, 7 * overlay.uiScale)
                            width: numberText.implicitWidth + Math.max(12, 16 * overlay.uiScale)
                            height: Math.max(24, 30 * overlay.uiScale)
                            radius: height / 2
                            color: "#c80a0d11"

                            Text {
                                id: numberText
                                anchors.centerIn: parent
                                color: "#f1eee8"
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: Math.max(10, 12 * overlay.uiScale)
                                text: String(index + 1).padStart(2, "0")
                            }
                        }

                        Rectangle {
                            anchors.right: parent.right
                            anchors.bottom: parent.bottom
                            anchors.margins: Math.max(9, 12 * overlay.uiScale)
                            visible: controller.adultPlaybackPosition(modelData.id) >= 30
                            width: continueText.implicitWidth + Math.max(10, 13 * overlay.uiScale)
                            height: Math.max(18, 22 * overlay.uiScale)
                            radius: height / 2
                            color: "#e8e2d6"

                            Text {
                                id: continueText
                                anchors.centerIn: parent
                                color: "#17201b"
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: Math.max(8, 9 * overlay.uiScale)
                                text: "RESUME"
                            }
                        }
                    }

                    Column {
                        anchors.left: posterArtwork.left
                        anchors.right: posterArtwork.right
                        anchors.top: posterArtwork.bottom
                        anchors.bottom: parent.bottom
                        anchors.topMargin: Math.max(5, 7 * overlay.uiScale)
                        spacing: Math.max(1, 2 * overlay.uiScale)

                        Rectangle {
                            width: parent.width
                            height: Math.max(2, 3 * overlay.uiScale)
                            radius: height / 2
                            color: focused ? "#d6b36a" : "transparent"
                        }

                        Text {
                            width: parent.width
                            color: focused ? "#ffffff" : "#c7c7c3"
                            maximumLineCount: 1
                            elide: Text.ElideRight
                            font.family: "DejaVu Sans"
                            font.bold: focused
                            font.pixelSize: Math.max(10, 12 * overlay.uiScale)
                            text: modelData.name
                        }

                        Text {
                            width: parent.width
                            color: focused ? "#aeb5bc" : "#6e7781"
                            elide: Text.ElideRight
                            font.family: "DejaVu Sans"
                            font.pixelSize: Math.max(8, 9 * overlay.uiScale)
                            text: modelData.year ? modelData.year : "FILM"
                        }
                    }
                }
            }

            Column {
                anchors.centerIn: parent
                width: Math.min(parent.width * 0.78, 760)
                visible: controller.adultLibrary.length === 0
                spacing: Math.max(12, 16 * overlay.uiScale)

                Text {
                    width: parent.width
                    color: "#f4f0e9"
                    horizontalAlignment: Text.AlignHCenter
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: Math.max(30, 44 * overlay.uiScale)
                    text: "Your film library is ready"
                }

                Text {
                    width: parent.width
                    color: "#8f98a3"
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.Wrap
                    font.family: "DejaVu Sans"
                    font.pixelSize: Math.max(14, 18 * overlay.uiScale)
                    text: "Add films and collections from the Adult section in the parent web portal."
                }
            }
        }

        Row {
            id: adultFooter
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.leftMargin: Math.max(32, 48 * overlay.uiScale)
            anchors.rightMargin: Math.max(32, 48 * overlay.uiScale)
            anchors.bottomMargin: Math.max(14, 20 * overlay.uiScale)
            height: Math.max(22, 28 * overlay.uiScale)

            Text {
                width: parent.width * 0.78
                color: overlay.errorMessage.length > 0 ? "#ff9b89" : "#77818c"
                elide: Text.ElideRight
                font.family: "DejaVu Sans"
                font.pixelSize: Math.max(11, 13 * overlay.uiScale)
                text: overlay.errorMessage.length > 0
                      ? overlay.errorMessage
                      : (overlay.navigationZone === 0
                         ? "↑ ↓  CHOOSE COLLECTION     → / OK  OPEN FILMS     BACK  EXIT"
                         : "↑ ↓ ← →  MOVE     OK  PLAY     BACK  COLLECTIONS")
            }

            Text {
                width: parent.width * 0.22
                color: "#59626d"
                horizontalAlignment: Text.AlignRight
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: Math.max(10, 12 * overlay.uiScale)
                text: "MABELTV  •  ADULT"
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

    Timer {
        id: adultPositionTimer
        interval: 10000
        repeat: true
        running: overlay.playing && !overlay.stopping && !overlay.externalSession
        onTriggered: overlay.rememberCurrentFilmPosition()
    }

    Connections {
        target: controller

        function onAdultLibraryChanged() {
            overlay.rebuildCollections()
        }
    }
}
