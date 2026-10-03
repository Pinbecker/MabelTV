pragma ComponentBehavior: Bound

import QtQuick
import MabelTV 1.0

Item {
    id: overlay
    objectName: "mabeltvMyTvMode"

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
    readonly property real playbackPosition: myTvPlayer.playbackPosition
    readonly property real playbackDuration: myTvPlayer.playbackDuration
    readonly property bool paused: myTvPlayer.paused
    readonly property var nextEpisode: episodePlayback.nextEpisode
    readonly property string episodeLabel: episodePlayback.episodeLabel
    readonly property bool subtitlesAvailable: myTvPlayer.subtitlesAvailable
    readonly property bool subtitlesVisible: myTvPlayer.subtitlesVisible
    readonly property string currentFilmName: currentFilm() ? currentFilm().name : ""
    readonly property real uiScale: Math.max(0.62, Math.min(width / 1920, height / 1080))
    property real controlsOpacity: 1
    property bool controlsHidden: false
    readonly property string backActionLabel: scrubberActive ? "Close controls" : "Return to library"
    onControlsOpacityChanged: if (controlsOpacity > 0) controlsHidden = false
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
    property real queuedExternalPosition: 0
    property string queuedLibraryFilmPath: ""
    property real queuedLibraryFilmPosition: 0

    signal closed()
    signal powerRequested()

    onSelectedIndexChanged: refreshSelectedFilmPosition()
    onPlayingChanged: if (!playing && active && !closing) libraryView.loadHome()

    visible: active
    z: 180

    function open() {
        episodePlayback.cancel()
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
        libraryView.open()
        externalSession = false
        externalSource = ""
        externalTitle = ""
        navigationZone = visibleFilms.length > 0 ? 1 : 0
        refreshSelectedFilmPosition()
    }

    function openExternal(source, title, startPosition) {
        open()
        playExternal(source, title, startPosition)
    }

    function requestExternal(source, title, startPosition) {
        episodePlayback.cancel()
        queuedExternalSource = source
        queuedExternalTitle = title
        queuedExternalPosition = Math.max(0, Number(startPosition) || 0)
        if (playing || stopping) {
            stopFilm()
        } else {
            externalStartTimer.restart()
        }
    }

    function requestLibraryFilm(filePath, startPosition) {
        episodePlayback.cancel()
        queuedLibraryFilmPath = filePath
        queuedLibraryFilmPosition = Math.max(0, Number(startPosition) || 0)
        if (playing || stopping) {
            stopFilm()
        } else {
            libraryFilmStartTimer.restart()
        }
    }

    function playLibraryFilm(filePath, startPosition) {
        libraryView.selectedPlayback = null
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
        errorMessage = "That film is no longer in the My TV library."
    }

    function playExternal(source, title, startPosition) {
        episodePlayback.cancel()
        externalSession = true
        externalSource = source
        externalTitle = title || "USB video"
        queuedExternalSource = ""
        queuedExternalTitle = ""
        queuedExternalPosition = 0
        queuedLibraryFilmPath = ""
        queuedLibraryFilmPosition = 0
        errorMessage = ""
        playing = true
        stopping = false
        controlsOpacity = 1
        myTvPlayer.play(source, Math.max(0, Number(startPosition) || 0))
        controlsTimer.restart()
    }

    function close() {
        if (closing)
            return
        closing = true
        episodePlayback.cancel()
        controlsOpacity = 1
        stopFilm()
    }

    function finishClose() {
        externalStartTimer.stop()
        libraryFilmStartTimer.stop()
        queuedExternalSource = ""
        queuedExternalTitle = ""
        queuedExternalPosition = 0
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

    // My TV has two real navigation levels. Back from a film returns to
    // this library; only a fresh Back from the library leaves My TV.
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
            controlsHidden = true
            return
        }
        if (playing || stopping) {
            episodePlayback.cancel()
            backPressHeld = waitForRelease
            ignoreLibraryBackBeforeMs = Date.now() + 750
            controlsOpacity = 1
            stopFilm()
            return
        }
        if (backPressHeld || Date.now() < ignoreLibraryBackBeforeMs)
            return
        if (libraryView.back())
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
        if (libraryView.selectedPlayback)
            return libraryView.selectedPlayback
        const films = visibleFilms
        return selectedIndex >= 0 && selectedIndex < films.length
                ? films[selectedIndex] : null
    }

    function clampLibrarySelection() {
        selectedIndex = Math.max(0, Math.min(selectedIndex, visibleFilms.length - 1))
        refreshSelectedFilmPosition()
    }

    function rebuildCollections() {
        const films = controller.myTvLibrary
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
            if (controller.myTvPlaybackPosition(film.id) >= 30)
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
        const films = controller.myTvLibrary
        const collection = collections.length > selectedCollectionIndex
                ? collections[selectedCollectionIndex] : null
        const filtered = []
        for (let index = 0; index < films.length; ++index) {
            const film = films[index]
            if (!collection || collection.folder === "*"
                    || (collection.folder === "@continue"
                        && controller.myTvPlaybackPosition(film.id) >= 30)
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
        const films = controller.myTvLibrary
        let count = 0
        for (let index = 0; index < films.length; ++index) {
            if (collection.folder === "*"
                    || (collection.folder === "@continue"
                        && controller.myTvPlaybackPosition(films[index].id) >= 30)
                    || films[index].folder === collection.folder)
                ++count
        }
        return count
    }

    function refreshSelectedFilmPosition() {
        const film = currentFilm()
        selectedSavedPosition = film
                ? controller.myTvPlaybackPosition(film.id) : 0
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
        episodePlayback.cancel()
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
        myTvPlayer.play(film.source, startPosition)
        controlsTimer.restart()
    }

    function startNativePlayback(item, startPosition) {
        if (!item || !item.source)
            return
        libraryView.selectedPlayback = item
        episodePlayback.begin(item)
        errorMessage = ""
        externalSession = false
        playing = true
        stopping = false
        controlsOpacity = 1
        scrubberActive = false
        scrubberFocus = 0
        myTvPlayer.play(item.source, Math.max(0, Number(startPosition) || 0))
        selectedSavedPosition = Math.max(0, Number(startPosition) || 0)
        controlsTimer.restart()
    }

    function appendRemoteText(value) {
        if (!playing)
            libraryView.appendRemoteText(value)
    }

    function showLibrary() {
        episodePlayback.cancel(); externalStartTimer.stop(); libraryFilmStartTimer.stop()
        queuedExternalSource = ""; queuedLibraryFilmPath = ""; playChoiceVisible = false
        if (playing && !stopping) stopFilm()
        libraryView.open()
    }

    function playSelected() {
        const film = currentFilm()
        if (!film)
            return
        const savedPosition = controller.myTvPlaybackPosition(film.id)
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
        const startPosition = resume ? controller.myTvPlaybackPosition(film.id) : 0
        playChoiceVisible = false
        if (!resume)
            controller.setMyTvPlaybackPosition(film.id, 0)
        startSelectedFilm(startPosition)
    }

    function rememberCurrentFilmPosition() {
        if (externalSession)
            return
        const film = currentFilm()
        if (!film || myTvPlayer.playbackPosition < 2)
            return
        if (film.mabel?.kind === "films")
            controller.setChannelFilmPlaybackState(film.mabel.channel, film.mabel.file, myTvPlayer.playbackPosition, myTvPlayer.playbackDuration)
        else controller.setMyTvPlaybackPosition(film.id, myTvPlayer.playbackPosition)
        selectedSavedPosition = myTvPlayer.playbackPosition
    }

    function stopFilm() {
        if (stopping)
            return
        rememberCurrentFilmPosition()
        stopping = true
        myTvPlayer.stop()
    }

    function showControls() {
        controlsHidden = false
        controlsOpacity = 1
        controlsTimer.restart()
    }

    function openScrubber() {
        episodePlayback.promptSelected = false
        scrubberActive = true
        scrubberFocus = 0
        showControls()
    }

    function selectRelative(offset) {
        if (playing && offset > 0 && nextEpisode) { episodePlayback.skip(); return }
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
        myTvPlayer.togglePause()
        showControls()
    }

    function restartFilm() {
        if (!playing || stopping)
            return
        myTvPlayer.seekAbsolute(0)
        showControls()
    }

    function seek(seconds) {
        openScrubber()
        myTvPlayer.seekRelative(seconds)
        showControls()
    }

    function toggleSubtitles() {
        if (myTvPlayer.subtitlesAvailable)
            myTvPlayer.toggleSubtitles()
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
            if (!isAutoRepeat && libraryView.handleKey(key))
                return true
            if (isBackKey(key)) {
                if (!isAutoRepeat)
                    back(true)
                return true
            }
            return false
        }

        if (stopping)
            return true

        if (episodePlayback.handleKey(key, isAutoRepeat)) return true
        if (key === Qt.Key_MediaNext && !isAutoRepeat) { episodePlayback.skip(); return true }
        if (scrubberActive && scrubberFocus > 0 && !isAutoRepeat) {
            if (key === Qt.Key_Left || key === Qt.Key_Right) {
                const actions = [2].concat(myTvPlayer.subtitlesAvailable ? [1] : []).concat(nextEpisode ? [3] : [])
                scrubberFocus = actions[Math.max(0, Math.min(actions.length - 1,
                    actions.indexOf(scrubberFocus) + (key === Qt.Key_Right ? 1 : -1)))]
                showControls(); return true
            }
            if ((key === Qt.Key_Return || key === Qt.Key_Enter) && scrubberFocus === 2) {
                togglePause(); scrubberFocus = 2; return true
            }
            if ((key === Qt.Key_Return || key === Qt.Key_Enter) && scrubberFocus === 3)
                return episodePlayback.skip()
        }

        if (scrubberActive && scrubberFocus === 1
                && (key === Qt.Key_Return || key === Qt.Key_Enter) && !isAutoRepeat) {
            toggleSubtitles()
        } else if (scrubberActive && key === Qt.Key_Up && !isAutoRepeat
                   && myTvPlayer.subtitlesAvailable) {
            scrubberFocus = 1
            showControls()
        } else if (scrubberActive && key === Qt.Key_Up && !isAutoRepeat) {
            scrubberFocus = 2
            showControls()
        } else if (scrubberActive && key === Qt.Key_Down && !isAutoRepeat
                   && scrubberFocus > 0) {
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
        id: myTvPlayer
        objectName: "mabeltvMyTvPlayer"
        anchors.fill: parent
        visible: overlay.playing
        volume: controller.volume
        muted: controller.muted
        aspectMode: "fit"
        subtitleDefaultOn: true

        onPlaybackFinished: {
            if (episodePlayback.finished()) return
            const film = overlay.currentFilm()
            if (film && !overlay.externalSession) {
                if (film.mabel?.kind === "films") controller.setChannelFilmPlaybackState(film.mabel.channel, film.mabel.file, 0, myTvPlayer.playbackDuration)
                else controller.setMyTvPlaybackPosition(film.id, 0)
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
            if (episodePlayback.stopped()) return
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
            episodePlayback.cancel()
            overlay.errorMessage = message
            libraryView.notify(message)
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
            if (film && !overlay.externalSession && myTvPlayer.playbackDuration >= 10) {
                if (film.mabel?.kind === "films") controller.setChannelFilmPlaybackState(film.mabel.channel, film.mabel.file, Math.max(myTvPlayer.playbackPosition, overlay.selectedSavedPosition), myTvPlayer.playbackDuration)
                else controller.setMyTvPlaybackDuration(film.id, myTvPlayer.playbackDuration)
            }
        }
    }

    MyTvLibraryView {
        id: libraryView
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
            color: "#f3f5f7"
            border.width: 1
            border.color: "#d8e1e6"

            Column {
                anchors.fill: parent
                anchors.margins: Math.max(28, 36 * overlay.uiScale)
                spacing: Math.max(12, 16 * overlay.uiScale)

                MyTvText {
                    width: parent.width
                    color: "#008b79"
                    font.weight: Font.DemiBold
                    font.letterSpacing: 1.6
                    font.pixelSize: Math.max(10, 13 * overlay.uiScale)
                    text: "CONTINUE WATCHING"
                }

                MyTvText {
                    width: parent.width
                    color: "#17242d"
                    font.weight: Font.DemiBold
                    maximumLineCount: 2
                    elide: Text.ElideRight
                    wrapMode: Text.Wrap
                    font.pixelSize: Math.max(24, 32 * overlay.uiScale)
                    text: overlay.currentFilm() ? overlay.currentFilm().name : ""
                }

                Item { width: 1; height: Math.max(6, 10 * overlay.uiScale) }

                Repeater {
                    model: 2
                    delegate: MyTvControl {
                        required property int index
                        readonly property bool selected: index === overlay.playChoiceIndex
                        width: parent.width
                        height: Math.max(64, 82 * overlay.uiScale)
                        radius: Math.max(10, 14 * overlay.uiScale)
                        uiScale: overlay.uiScale; highlighted: selected; checked: selected

                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.margins: Math.max(16, 21 * overlay.uiScale)
                            spacing: 2
                            MyTvText {
                                color: "#17242d"
                                font.weight: Font.DemiBold
                                font.pixelSize: Math.max(15, 19 * overlay.uiScale)
                                text: index === 0 ? "Resume" : "Play from start"
                            }
                            MyTvText {
                                color: "#667780"
                                font.pixelSize: Math.max(11, 14 * overlay.uiScale)
                                text: index === 0
                                      ? "Continue at " + overlay.formatTime(overlay.selectedSavedPosition)
                                      : "Start this film from 0:00"
                            }
                        }
                    }
                }

                Item { width: 1; height: 1 }
                MyTvText {
                    width: parent.width
                    color: "#667780"
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
                                     overlay.queuedExternalTitle,
                                     overlay.queuedExternalPosition)
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

    MyTvPlaybackControls {
        id: playbackControls
        host: overlay
        mediaPlayer: myTvPlayer
    }

    MyTvEpisodePlayback { id: episodePlayback; host: overlay; library: libraryView }
    MyTvNextEpisode { host: overlay; sequence: episodePlayback }

    Rectangle {
        // A distinct MyTv volume rail: available while the controls are up,
        // but never mixed into the navigation/scrubbing dock.
        id: myTvVolumeRail
        anchors.left: parent.left
        anchors.leftMargin: Math.max(22, 30 * overlay.uiScale)
        anchors.verticalCenter: parent.verticalCenter
        visible: overlay.playing && !overlay.controlsHidden && (myTvPlayer.paused || overlay.controlsOpacity > 0)
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

            MyTvText {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                color: "#aeb8c2"
                font.weight: Font.DemiBold
                font.letterSpacing: 1.1
                font.pixelSize: Math.max(8, 10 * overlay.uiScale)
                text: "VOL"
            }
            Item {
                width: parent.width
                height: parent.height - volumeLabel.height - parent.spacing
                Rectangle {
                    id: myTvVolumeTrack
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
                        color: "#04c6a8"
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
            MyTvText {
                id: volumeLabel
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                color: "#f4f1eb"
                font.weight: Font.DemiBold
                font.pixelSize: Math.max(10, 12 * overlay.uiScale)
                text: controller.muted ? "MUTE" : controller.volume + "%"
            }
        }
    }

    Timer {
        id: controlsTimer
        interval: 3500
        onTriggered: {
            if (!myTvPlayer.paused) {
                overlay.controlsOpacity = 0
                overlay.scrubberActive = false
                overlay.scrubberFocus = 0
            }
        }
    }

    Timer {
        id: myTvPositionTimer
        interval: 10000
        repeat: true
        running: overlay.playing && !overlay.stopping && !overlay.externalSession
        onTriggered: overlay.rememberCurrentFilmPosition()
    }

    Connections {
        target: controller

        function onMyTvLibraryChanged() {
            overlay.rebuildCollections()
        }
        function onMyTvPlaybackStateChanged() {
            overlay.libraryProgressRevision += 1
            overlay.refreshSelectedFilmPosition()
        }
    }
}
