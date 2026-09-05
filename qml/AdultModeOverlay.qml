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
    readonly property bool subtitlesAvailable: adultPlayer.subtitlesAvailable
    readonly property bool subtitlesVisible: adultPlayer.subtitlesVisible
    readonly property string currentFilmName: currentFilm() ? currentFilm().name : ""
    readonly property real uiScale: Math.max(0.62, Math.min(width / 1920, height / 1080))
    property real controlsOpacity: 1
    property real selectedSavedPosition: 0
    property bool playChoiceVisible: false
    property int playChoiceIndex: 0
    property bool scrubberActive: false
    property int scrubberFocus: 0 // 0 = timeline, 1 = subtitles
    property int libraryProgressRevision: 0
    property string errorMessage: ""
    property bool externalSession: false
    property url externalSource: ""
    property string externalTitle: ""
    property url queuedExternalSource: ""
    property string queuedExternalTitle: ""
    property string queuedLibraryFilmPath: ""
    property real queuedLibraryFilmPosition: 0

    signal closed()
    signal powerRequested()

    onSelectedIndexChanged: refreshSelectedFilmPosition()

    visible: active
    z: 180

    function open() {
        rebuildCollections()
        libraryFilmStartTimer.stop()
        queuedLibraryFilmPath = ""
        queuedLibraryFilmPosition = 0
        playing = false
        stopping = false
        closing = false
        backPressHeld = false
        ignoreLibraryBackBeforeMs = 0
        errorMessage = ""
        controlsOpacity = 1
        playChoiceVisible = false
        scrubberActive = false
        scrubberFocus = 0
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

    function requestLibraryFilm(filePath, startPosition) {
        queuedLibraryFilmPath = filePath
        queuedLibraryFilmPosition = Math.max(0, Number(startPosition) || 0)
        if (playing || stopping) {
            stopFilm()
        } else {
            libraryFilmStartTimer.restart()
        }
    }

    function playLibraryFilm(filePath, startPosition) {
        rebuildCollections()
        selectedCollectionIndex = 0
        applySelectedCollection()
        for (let index = 0; index < visibleFilms.length; ++index) {
            if (visibleFilms[index].path === filePath) {
                selectedIndex = index
                startSelectedFilm(Math.max(0, Number(startPosition) || 0))
                return
            }
        }
        errorMessage = "That film is no longer in the Adult library."
    }

    function playExternal(source, title) {
        externalSession = true
        externalSource = source
        externalTitle = title || "USB video"
        queuedExternalSource = ""
        queuedExternalTitle = ""
        queuedLibraryFilmPath = ""
        queuedLibraryFilmPosition = 0
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
        libraryFilmStartTimer.stop()
        queuedExternalSource = ""
        queuedExternalTitle = ""
        queuedLibraryFilmPath = ""
        queuedLibraryFilmPosition = 0
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
        // The playback layer is a transient navigation level. Back closes it
        // before it can ever stop the film and fall through to the library.
        if (playing && scrubberActive) {
            scrubberActive = false
            scrubberFocus = 0
            controlsTimer.stop()
            controlsOpacity = 0
            return
        }
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

    function startSelectedFilm(startPosition) {
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
        scrubberActive = false
        scrubberFocus = 0
        selectedSavedPosition = startPosition
        adultPlayer.play(film.source, startPosition)
        controlsTimer.restart()
    }

    function playSelected() {
        const film = currentFilm()
        if (!film)
            return
        const savedPosition = controller.adultPlaybackPosition(film.id)
        if (savedPosition >= 30) {
            playChoiceIndex = 0
            playChoiceVisible = true
            return
        }
        startSelectedFilm(0)
    }

    function confirmPlaybackChoice() {
        const film = currentFilm()
        if (!film)
            return
        const resume = playChoiceIndex === 0
        const startPosition = resume ? controller.adultPlaybackPosition(film.id) : 0
        playChoiceVisible = false
        if (!resume)
            controller.setAdultPlaybackPosition(film.id, 0)
        startSelectedFilm(startPosition)
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

    function openScrubber() {
        scrubberActive = true
        scrubberFocus = 0
        showControls()
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
        // Pause is one of the three deliberate ways into the full scrubber.
        // The subtitle state is therefore visible immediately, rather than
        // requiring a second navigation press just to reveal it.
        openScrubber()
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
        openScrubber()
        adultPlayer.seekRelative(seconds)
        showControls()
    }

    function toggleSubtitles() {
        if (adultPlayer.subtitlesAvailable)
            adultPlayer.toggleSubtitles()
        scrubberActive = true
        scrubberFocus = 1
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
            if (playChoiceVisible) {
                if ((key === Qt.Key_Up || key === Qt.Key_Left) && !isAutoRepeat)
                    playChoiceIndex = 0
                else if ((key === Qt.Key_Down || key === Qt.Key_Right) && !isAutoRepeat)
                    playChoiceIndex = 1
                else if ((key === Qt.Key_Return || key === Qt.Key_Enter) && !isAutoRepeat)
                    confirmPlaybackChoice()
                else if (isBackKey(key) && !isAutoRepeat)
                    playChoiceVisible = false
                else
                    return true
                return true
            }
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

        if (scrubberActive && scrubberFocus === 1
                && (key === Qt.Key_Return || key === Qt.Key_Enter) && !isAutoRepeat) {
            toggleSubtitles()
        } else if (scrubberActive && key === Qt.Key_Up && !isAutoRepeat
                   && adultPlayer.subtitlesAvailable) {
            scrubberFocus = 1
            showControls()
        } else if (scrubberActive && key === Qt.Key_Down && !isAutoRepeat
                   && scrubberFocus === 1) {
            scrubberFocus = 0
            showControls()
        } else if (scrubberActive && key === Qt.Key_Down && !isAutoRepeat) {
            showControls()
        } else if ((key === Qt.Key_Return || key === Qt.Key_Enter) && !isAutoRepeat) {
            togglePause()
        } else if (key === Qt.Key_Left) {
            seek(-15)
        } else if (key === Qt.Key_Right) {
            seek(15)
        } else if (!scrubberActive && (key === Qt.Key_Up || key === Qt.Key_Down)
                   && !isAutoRepeat) {
            openScrubber()
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
            else if (overlay.queuedLibraryFilmPath.length > 0) {
                overlay.playing = false
                overlay.stopping = false
                libraryFilmStartTimer.restart()
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
            else if (overlay.queuedLibraryFilmPath.length > 0) {
                overlay.playing = false
                overlay.stopping = false
                libraryFilmStartTimer.restart()
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
            else if (overlay.queuedLibraryFilmPath.length > 0) {
                overlay.playing = false
                overlay.stopping = false
                libraryFilmStartTimer.restart()
            }
            else {
                overlay.externalSession = false
                overlay.playing = false
                overlay.stopping = false
                overlay.controlsOpacity = 1
            }
        }
        onPausedChanged: overlay.showControls()
        onPlaybackDurationChanged: {
            const film = overlay.currentFilm()
            if (film && !overlay.externalSession && adultPlayer.playbackDuration >= 10)
                controller.setAdultPlaybackDuration(film.id, adultPlayer.playbackDuration)
        }
    }

    AdultLibraryView {
        host: overlay
        tvController: controller
    }

    Rectangle {
        id: playbackChoiceModal
        anchors.fill: parent
        visible: overlay.playChoiceVisible
        z: 20
        color: "#c9000000"

        Rectangle {
            anchors.centerIn: parent
            width: Math.min(parent.width * 0.48, 760)
            height: Math.min(parent.height * 0.52, 520)
            radius: Math.max(18, 24 * overlay.uiScale)
            color: "#171d24"
            border.width: 1
            border.color: "#3a4654"

            Column {
                anchors.fill: parent
                anchors.margins: Math.max(28, 36 * overlay.uiScale)
                spacing: Math.max(12, 16 * overlay.uiScale)

                Text {
                    width: parent.width
                    color: "#87919d"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.letterSpacing: 1.6
                    font.pixelSize: Math.max(10, 13 * overlay.uiScale)
                    text: "CONTINUE WATCHING"
                }

                Text {
                    width: parent.width
                    color: "#f3f0ea"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    maximumLineCount: 2
                    elide: Text.ElideRight
                    wrapMode: Text.Wrap
                    font.pixelSize: Math.max(24, 32 * overlay.uiScale)
                    text: overlay.currentFilm() ? overlay.currentFilm().name : ""
                }

                Item { width: 1; height: Math.max(6, 10 * overlay.uiScale) }

                Repeater {
                    model: 2
                    delegate: Rectangle {
                        required property int index
                        readonly property bool selected: index === overlay.playChoiceIndex
                        width: parent.width
                        height: Math.max(64, 82 * overlay.uiScale)
                        radius: Math.max(10, 14 * overlay.uiScale)
                        color: selected ? "#f0ede6" : "#202831"
                        border.width: selected ? 2 : 1
                        border.color: selected ? "#ffffff" : "#35404c"

                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.margins: Math.max(16, 21 * overlay.uiScale)
                            spacing: 2
                            Text {
                                color: selected ? "#151a20" : "#edf0ec"
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: Math.max(15, 19 * overlay.uiScale)
                                text: index === 0 ? "Resume" : "Play from start"
                            }
                            Text {
                                color: selected ? "#58636e" : "#9aa5b1"
                                font.family: "DejaVu Sans"
                                font.pixelSize: Math.max(11, 14 * overlay.uiScale)
                                text: index === 0
                                      ? "Continue at " + overlay.formatTime(overlay.selectedSavedPosition)
                                      : "Start this film from 0:00"
                            }
                        }
                    }
                }

                Item { width: 1; height: 1 }
                Text {
                    width: parent.width
                    color: "#89939f"
                    font.family: "DejaVu Sans"
                    horizontalAlignment: Text.AlignHCenter
                    font.pixelSize: Math.max(10, 13 * overlay.uiScale)
                    text: "↑ ↓  CHOOSE OPTION     OK  CONFIRM     BACK  CANCEL"
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

    Timer {
        id: libraryFilmStartTimer
        interval: 350
        repeat: false
        onTriggered: {
            if (!overlay.closing && overlay.queuedLibraryFilmPath.length > 0) {
                const file = overlay.queuedLibraryFilmPath
                const position = overlay.queuedLibraryFilmPosition
                overlay.queuedLibraryFilmPath = ""
                overlay.queuedLibraryFilmPosition = 0
                overlay.playLibraryFilm(file, position)
            }
        }
    }

    AdultPlaybackControls {
        host: overlay
        mediaPlayer: adultPlayer
    }

    Rectangle {
        // A distinct Adult volume rail: available while the controls are up,
        // but never mixed into the navigation/scrubbing dock.
        id: adultVolumeRail
        anchors.left: parent.left
        anchors.leftMargin: Math.max(22, 30 * overlay.uiScale)
        anchors.verticalCenter: parent.verticalCenter
        visible: overlay.playing && (adultPlayer.paused || overlay.controlsOpacity > 0)
        z: 3
        width: Math.max(52, 62 * overlay.uiScale)
        height: Math.max(172, parent.height * 0.30)
        radius: width / 2
        color: "#e8202832"
        border.width: 1
        border.color: "#4c5865"

        Column {
            anchors.fill: parent
            anchors.topMargin: Math.max(12, 15 * overlay.uiScale)
            anchors.bottomMargin: Math.max(10, 13 * overlay.uiScale)
            spacing: Math.max(5, 7 * overlay.uiScale)

            Text {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                color: "#aeb8c2"
                font.family: "DejaVu Sans"
                font.bold: true
                font.letterSpacing: 1.1
                font.pixelSize: Math.max(8, 10 * overlay.uiScale)
                text: "VOL"
            }
            Item {
                width: parent.width
                height: parent.height - volumeLabel.height - parent.spacing
                Rectangle {
                    id: adultVolumeTrack
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.verticalCenter: parent.verticalCenter
                    width: Math.max(5, 6 * overlay.uiScale)
                    height: parent.height - Math.max(28, 34 * overlay.uiScale)
                    radius: width / 2
                    color: "#4b5662"
                    Rectangle {
                        anchors.bottom: parent.bottom
                        width: parent.width
                        height: parent.height * (controller.muted ? 0 : controller.volume / 100)
                        radius: parent.radius
                        color: "#d6b36a"
                    }
                    Rectangle {
                        anchors.horizontalCenter: parent.horizontalCenter
                        y: Math.max(0, Math.min(parent.height - height,
                                                 parent.height * (1 - (controller.muted ? 0 : controller.volume / 100)) - height / 2))
                        width: Math.max(12, 15 * overlay.uiScale)
                        height: width
                        radius: width / 2
                        color: "#f5f1e9"
                    }
                }
            }
            Text {
                id: volumeLabel
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                color: "#f4f1eb"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: Math.max(10, 12 * overlay.uiScale)
                text: controller.muted ? "MUTE" : controller.volume + "%"
            }
        }
    }

    Timer {
        id: controlsTimer
        interval: 3500
        onTriggered: {
            if (!adultPlayer.paused) {
                overlay.controlsOpacity = 0
                overlay.scrubberActive = false
                overlay.scrubberFocus = 0
            }
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
        function onAdultPlaybackStateChanged() {
            overlay.libraryProgressRevision += 1
            overlay.refreshSelectedFilmPosition()
        }
    }
}
