import QtQuick
import QtQuick.Window
import MabelTV 1.0

Window {
    id: root

    width: 1280
    height: 720
    minimumWidth: 800
    minimumHeight: 450
    visible: true
    color: "#030403"
    title: tvDisplayName
    property bool warmingUp: true
    property real warmProgress: 0
    property real flickerAmount: 0
    property real distortionPhase: 0
    property bool poweringOff: false
    property real powerOffProgress: 0
    property bool powerOffControlsConnectedTv: true
    property bool previousHeldForParent: false
    property bool previousHeldForRestart: false
    property bool muteHeldForLock: false
    readonly property bool showStatic: !directMediaMode
        && (tvController.tuning
            || (tvController.noSignal && player.status !== "Playing"))
    property bool introPlaying: false
    property bool introCompletesStandbyWake: false
    property bool televisionStarted: false
    property double lastChannelRepeatMs: 0
    property double lastVolumeRepeatMs: 0
    property bool okHeldForGuide: false
    property bool homeHeldForChannelSummary: false
    property bool childWasPausedBeforeAdult: false
    property bool restoreChildPauseAfterAdult: false
    property bool openingAdultMode: false
    property string currentProgrammeTitle: ""
    property url pendingExternalSource: ""
    property string pendingExternalTitle: ""
    property real pendingExternalPosition: 0
    property string pendingAdultLibraryPath: ""
    property real pendingAdultLibraryPosition: 0
    property int pendingPortalChannel: -1
    property string pendingPortalProgramme: ""
    property real pendingPortalProgrammePosition: 0
    property int pendingPortalTuneChannel: -1
    property string pendingPowerAction: ""
    property bool pendingPowerOnWake: false
    property bool filmCountdownActive: false
    property bool widescreenMode: false
    property int filmCountdownValue: 10
    property real filmCountdownSpin: 0
    property real filmCountdownFlicker: 1
    property url pendingFilmSource: ""
    property double pendingFilmStart: 0
    readonly property real playbackOsdInsetX: Math.max(30, television.screenWidth * 0.055)
    readonly property real playbackOsdInsetY: Math.max(28, television.screenHeight * 0.065)
    readonly property var player: television.playerObject
    readonly property int portalVolume: tvController.volume
    readonly property bool portalMuted: tvController.muted
    readonly property bool portalRemoteLocked: tvController.remoteLocked
    readonly property bool portalStandby: tvController.standby
    readonly property bool portalSubtitlesAvailable: adultMode.active
        && adultMode.subtitlesAvailable
    readonly property bool portalSubtitlesVisible: adultMode.active
        && adultMode.subtitlesVisible
    readonly property bool widescreenContentAvailable: !directMediaMode
        && !introPlaying && player.videoAspectRatio >= 1.70
    readonly property bool portalWidescreenAvailable: widescreenContentAvailable
    readonly property bool portalWidescreenEnabled: widescreenMode
        && widescreenContentAvailable
    readonly property bool portalAdultHandoffAvailable: !directMediaMode
        && !introPlaying && !filmCountdownActive && !openingAdultMode
        && !adultMode.active && !poweringOff && pendingPowerAction.length === 0
        && !tvController.standby && player.source.toString().length > 0
        && (player.status === "Playing" || player.paused)

    function acceptRepeat(kind, isAutoRepeat) {
        const now = Date.now()
        if (!isAutoRepeat) {
            if (kind === "channel")
                lastChannelRepeatMs = now
            else
                lastVolumeRepeatMs = now
            return true
        }
        const previous = kind === "channel" ? lastChannelRepeatMs : lastVolumeRepeatMs
        const minimumInterval = kind === "channel" ? 220 : 90
        if (now - previous < minimumInterval)
            return false
        if (kind === "channel")
            lastChannelRepeatMs = now
        else
            lastVolumeRepeatMs = now
        return true
    }

    function startTelevision() {
        if (!televisionStarted) {
            televisionStarted = true
            tvController.start()
        }
    }

    function finishIntro() {
        if (!introPlaying)
            return
        introPlaying = false
        if (introCompletesStandbyWake) {
            introCompletesStandbyWake = false
            tvController.resumeFromStandby()
        } else {
            startTelevision()
        }
    }

    function playWelcome(isStandbyWake) {
        cancelFilmCountdown()
        introCompletesStandbyWake = isStandbyWake
        introPlaying = true
        player.play(startupIntroUrl, 0)
    }

    function schedulePlaybackAfterPowerClick(isStandbyWake) {
        pendingPowerOnWake = isStandbyWake
        playbackAfterPowerClickTimer.restart()
    }

    function beginWarmup() {
        warmingUp = true
        warmProgress = 0
        warmupAnimation.restart()
    }

    function syncPlaybackPosition() {
        if (!directMediaMode && !introPlaying
                && (player.status === "Playing" || player.paused)) {
            tvController.updatePlaybackPosition(player.positionSeconds(), player.paused)
        }
    }

    function togglePlaybackPause() {
        if (filmCountdownActive) {
            finishFilmCountdown()
            return
        }
        if (introPlaying || poweringOff)
            return
        syncPlaybackPosition()
        player.togglePause()
    }

    function scrubPlayback(seconds) {
        if (introPlaying || poweringOff || tvController.standby
                || (player.status !== "Playing" && !player.paused))
            return
        syncPlaybackPosition()
        player.seekRelative(seconds)
        television.scrubLabelItem.text = (seconds < 0 ? "◀◀ " : "▶▶ ")
                + (Math.abs(seconds) === 300 ? "5 minutes"
                                              : Math.abs(seconds) + " seconds")
        television.scrubOsdItem.opacity = 1
        scrubOsdTimer.restart()
    }

    function beginPowerOff(controlConnectedTv) {
        if (poweringOff || pendingPowerAction.length > 0)
            return
        powerOffControlsConnectedTv = controlConnectedTv !== false
        if (tvController.standby) {
            // Explicit OFF is intentionally harmless when already in standby.
            if (powerOffControlsConnectedTv)
                tvController.turnOff()
            return
        }
        cancelFilmCountdown()
        pendingPowerAction = "standby"
        if (openingAdultMode)
            return
        if (adultMode.active) {
            adultMode.close()
            return
        }
        pendingPowerAction = ""
        performPowerOff()
    }

    function performPowerOff() {
        if (poweringOff)
            return
        cancelFilmCountdown()
        syncPlaybackPosition()
        if (player.status === "Playing" && !player.paused)
            player.togglePause()
        poweringOff = true
        powerOffProgress = 0
        if (tvController.soundEffectsEnabled)
            soundEffects.playPowerDown()
        powerOffAnimation.restart()
    }

    function showChannel(number, name) {
        television.channelNumberLabel.text = (number < 10 ? "0" : "") + number
        television.channelNameLabel.text = name.toUpperCase()
        television.channelOsdItem.opacity = 1
        channelOsdTimer.restart()
    }

    function showVolume(value, isMuted) {
        television.volumeLabelItem.text = isMuted ? "MUTE" : "VOL " + value
        television.volumeLevelItem.width = isMuted ? 0 : television.volumeTrackItem.width * value / 100
        television.volumeOsdItem.opacity = 1
        volumeOsdTimer.restart()
    }

    function showProgramme(name) {
        if (name.length === 0)
            return
        currentProgrammeTitle = name
        television.programmeNameItem.text = name.toUpperCase()
        television.programmeNameItem.opacity = 1
        programmeOsdTimer.restart()
    }

    function beginFilmCountdown(source, startPositionSeconds) {
        cancelFilmCountdown()
        filmCountdownActive = true
        filmCountdownValue = 10
        pendingFilmSource = source
        pendingFilmStart = startPositionSeconds
        player.stop()
        filmCountdownTimer.restart()
    }

    function cancelFilmCountdown() {
        filmCountdownTimer.stop()
        filmCountdownActive = false
        pendingFilmSource = ""
        pendingFilmStart = 0
    }

    function finishFilmCountdown() {
        if (!filmCountdownActive)
            return
        if (adultMode.active || openingAdultMode || poweringOff
                || pendingPowerAction.length > 0 || tvController.standby) {
            cancelFilmCountdown()
            return
        }
        filmCountdownActive = false
        filmCountdownTimer.stop()
        const source = pendingFilmSource
        const start = pendingFilmStart
        pendingFilmSource = ""
        pendingFilmStart = 0
        player.play(source, start)
    }

    // Commands from the authenticated parent portal arrive through the local
    // Unix socket owned by the player service. The child-remote lock applies
    // only to physical IR input: the portal must remain available so a parent
    // can control the TV and unlock that remote again.
    function portalNavigate(key) {
        if (adultMode.active) {
            adultMode.handleKey(key, false)
        } else if (channelSummaryOverlay.visible) {
            channelSummaryOverlay.handleKey(key, false)
        } else if (guideOverlay.visible) {
            guideOverlay.handleKey(key, true)
        } else if (parentOverlay.visible) {
            parentOverlay.handleKey(key, Qt.NoModifier)
        } else if (key === Qt.Key_Up) {
            syncPlaybackPosition()
            tvController.dispatchPortal(TvController.PreviousProgramme)
        } else if (key === Qt.Key_Down) {
            syncPlaybackPosition()
            tvController.dispatchPortal(TvController.NextProgramme)
        } else if (key === Qt.Key_Left && tvController.scrubbingEnabled && !directMediaMode) {
            scrubPlayback(-15)
        } else if (key === Qt.Key_Right && tvController.scrubbingEnabled && !directMediaMode) {
            scrubPlayback(15)
        } else if (key === Qt.Key_Return && !directMediaMode) {
            togglePlaybackPause()
        }
    }

    function portalTuneChannel(channel) {
        if (poweringOff || pendingPowerAction.length > 0)
            return
        guideOverlay.close()
        tvController.closeParent()
        if (adultMode.active) {
            pendingPortalTuneChannel = Number(channel)
            adultMode.close()
            return
        }
        tvController.tunePortalChannel(Number(channel))
    }

    function portalCommand(command) {
        if (command === "toggle-remote-lock") {
            tvController.toggleRemoteLock()
            showRemoteLockState()
            return
        }
        if (poweringOff || pendingPowerAction.length > 0)
            return
        if (command === "return-to-mabeltv") {
            guideOverlay.close()
            tvController.closeParent()
            if (adultMode.active)
                adultMode.close()
        } else if (command === "open-parent-menu") {
            if (adultMode.active)
                adultMode.close()
            guideOverlay.close()
            if (tvController.parentAccessState === TvController.ParentClosed)
                tvController.requestPortalParentAccess()
            while (tvController.parentAccessState === TvController.ParentConfirmation)
                tvController.parentConfirm()
        } else if (command === "open-tv-guide") {
            if (adultMode.active)
                adultMode.close()
            tvController.closeParent()
            guideOverlay.open()
        } else if (command === "open-channel-menu") {
            if (adultMode.active)
                adultMode.close()
            guideOverlay.close()
            tvController.closeParent()
            syncPlaybackPosition()
            channelSummaryOverlay.open()
        } else if (command === "close-overlay") {
            if (adultMode.active)
                adultMode.back(false)
            else if (channelSummaryOverlay.visible)
                channelSummaryOverlay.close()
            else if (guideOverlay.visible)
                guideOverlay.close()
            else
                tvController.closeParent()
        } else if (command === "restart-programme") {
            if (adultMode.active) {
                adultMode.restartFilm()
            } else {
                syncPlaybackPosition()
                tvController.restartPortalProgramme()
            }
        } else if (command === "enter-adult-mode") {
            if (!adultMode.active) {
                guideOverlay.close()
                enterAdultMode()
            }
        } else if (command === "continue-in-adult-mode") {
            continueCurrentInAdultMode()
        } else if (command === "channel-up") {
            if (adultMode.active)
                adultMode.selectRelative(-1)
            else {
                syncPlaybackPosition()
                tvController.dispatchPortal(TvController.ChannelUp)
            }
        } else if (command === "channel-down") {
            if (adultMode.active)
                adultMode.selectRelative(1)
            else {
                syncPlaybackPosition()
                tvController.dispatchPortal(TvController.ChannelDown)
            }
        } else if (command === "previous-programme") {
            if (adultMode.active)
                adultMode.selectRelative(-1)
            else {
                syncPlaybackPosition()
                tvController.dispatchPortal(TvController.PreviousProgramme)
            }
        } else if (command === "next-programme") {
            if (adultMode.active)
                adultMode.selectRelative(1)
            else {
                syncPlaybackPosition()
                tvController.dispatchPortal(TvController.NextProgramme)
            }
        } else if (command === "toggle-pause") {
            if (adultMode.active)
                adultMode.togglePause()
            else
                togglePlaybackPause()
        } else if (command === "toggle-subtitles") {
            if (adultMode.active)
                adultMode.toggleSubtitles()
        } else if (command === "toggle-widescreen-mode") {
            if (!adultMode.active && widescreenContentAvailable) {
                widescreenMode = !widescreenMode
                showProgramme(widescreenMode ? "WIDESCREEN MODE ON"
                                             : "WIDESCREEN MODE OFF")
            }
        } else if (command === "volume-up") {
            tvController.dispatchPortal(TvController.VolumeUp)
        } else if (command === "volume-down") {
            tvController.dispatchPortal(TvController.VolumeDown)
        } else if (command === "toggle-mute") {
            tvController.dispatchPortal(TvController.ToggleMute)
        } else if (command === "turn-on") {
            tvController.turnOn()
        } else if (command === "turn-on-mabel-only") {
            tvController.turnOnMabelOnly()
        } else if (command === "turn-off") {
            beginPowerOff()
        } else if (command === "turn-off-mabel-only") {
            beginPowerOff(false)
        } else if (command === "toggle-power") {
            // Compatibility for an older portal page. Use MabelTV state, not a
            // CEC power-toggle opcode, to choose the explicit operation.
            if (tvController.standby)
                tvController.turnOn()
            else
                beginPowerOff()
        } else if (command === "navigate-up") {
            portalNavigate(Qt.Key_Up)
        } else if (command === "navigate-down") {
            portalNavigate(Qt.Key_Down)
        } else if (command === "navigate-left") {
            portalNavigate(Qt.Key_Left)
        } else if (command === "navigate-right") {
            portalNavigate(Qt.Key_Right)
        } else if (command === "select") {
            portalNavigate(Qt.Key_Return)
        }
    }

    function showRemoteLockState() {
        remoteLockMessage.text = tvController.remoteLocked
                ? "REMOTE LOCKED\nHOLD MUTE TO UNLOCK"
                : "REMOTE UNLOCKED"
        remoteLockOsd.opacity = 1
        remoteLockOsdTimer.restart()
    }

    function enterAdultMode() {
        if (openingAdultMode || adultMode.active)
            return
        cancelFilmCountdown()
        syncPlaybackPosition()
        childWasPausedBeforeAdult = player.paused
        openingAdultMode = true
        player.stop()
    }

    function leaveAdultMode() {
        restoreChildPauseAfterAdult = pendingPowerAction.length === 0
                && childWasPausedBeforeAdult
        adultResumeTimer.restart()
    }

    // MPV's end-file event means the adult decoder has stopped. Give the Pi's
    // V4L2 device one final render turn to release its buffers before the
    // children's player asks for the same hardware decoder again.
    Timer {
        id: adultResumeTimer
        interval: 400
        repeat: false
        onTriggered: {
            if (root.pendingPowerAction.length > 0) {
                root.pendingPowerAction = ""
                root.performPowerOff()
            } else if (root.pendingPortalTuneChannel >= 0) {
                const channel = root.pendingPortalTuneChannel
                root.pendingPortalTuneChannel = -1
                tvController.tunePortalChannel(channel)
            } else if (root.pendingPortalChannel >= 0
                       && root.pendingPortalProgramme.length > 0) {
                const channel = root.pendingPortalChannel
                const programme = root.pendingPortalProgramme
                const position = root.pendingPortalProgrammePosition
                root.pendingPortalChannel = -1
                root.pendingPortalProgramme = ""
                root.pendingPortalProgrammePosition = 0
                tvController.playPortalProgramme(channel, programme, position)
            } else {
                tvController.resumeFromStandby()
            }
        }
    }

    function portalExternalPlayback(source, title) {
        if (poweringOff || pendingPowerAction.length > 0)
            return
        guideOverlay.close()
        tvController.closeParent()
        if (adultMode.active) {
            adultMode.requestExternal(source, title)
            return
        }
        pendingExternalSource = source
        pendingExternalTitle = title
        pendingExternalPosition = 0
        enterAdultMode()
    }

    function continueCurrentInAdultMode() {
        if (!portalAdultHandoffAvailable)
            return
        const source = player.source
        const title = currentProgrammeTitle.length > 0
                ? currentProgrammeTitle : tvController.currentChannelName
        const position = Math.max(0, player.positionSeconds())
        pendingExternalSource = source
        pendingExternalTitle = title
        pendingExternalPosition = position
        enterAdultMode()
    }

    function portalPlayChannelProgramme(channel, file, position) {
        if (poweringOff || pendingPowerAction.length > 0)
            return
        guideOverlay.close()
        tvController.closeParent()
        if (adultMode.active) {
            pendingPortalChannel = Number(channel)
            pendingPortalProgramme = String(file)
            pendingPortalProgrammePosition = Math.max(0, Number(position) || 0)
            adultMode.close()
            return
        }
        tvController.playPortalProgramme(Number(channel), String(file),
                                         Math.max(0, Number(position) || 0))
    }

    function portalSetChannelFilmPosition(channel, file, position, duration) {
        tvController.setChannelFilmPlaybackState(
            Number(channel), String(file), Math.max(0, Number(position) || 0),
            Math.max(0, Number(duration) || 0))
    }

    function portalPlayAdultFilm(file, position) {
        if (poweringOff || pendingPowerAction.length > 0)
            return
        const startPosition = Math.max(0, Number(position) || 0)
        guideOverlay.close()
        tvController.closeParent()
        if (adultMode.active) {
            adultMode.requestLibraryFilm(String(file), startPosition)
            return
        }
        pendingAdultLibraryPath = String(file)
        pendingAdultLibraryPosition = startPosition
        enterAdultMode()
    }

    // The generated power click and programme audio both use the Pi's
    // exclusive HDMI ALSA device. Let the 85 ms click close its audio output
    // before the intro/player opens the same device.
    Timer {
        id: playbackAfterPowerClickTimer
        interval: tvController.soundEffectsEnabled ? 250 : 0
        repeat: false
        onTriggered: {
            if (directMediaMode)
                player.play(startupMediaUrl, 0)
            else if (startupIntroUrl.toString().length > 0)
                root.playWelcome(root.pendingPowerOnWake)
            else if (root.pendingPowerOnWake)
                tvController.resumeFromStandby()
            else
                root.startTelevision()
        }
    }

    Rectangle {
        anchors.fill: parent
        color: "#030403"
    }

    SoundEffects {
        id: soundEffects
        volume: tvController.volume
        muted: tvController.muted
    }

    TelevisionScreen {
        id: television
        appRoot: root
    }

    Rectangle {
        anchors.fill: parent
        z: 100
        visible: opacity > 0
        color: "black"
        opacity: tvController.standby ? 1 : 0

        Behavior on opacity { NumberAnimation { duration: 180 } }
    }

    TvGuideOverlay {
        id: guideOverlay
        anchors.fill: parent
        z: 190
        controller: tvController
    }

    ChannelSummaryOverlay {
        id: channelSummaryOverlay
        anchors.fill: parent
        z: 195
        controller: tvController
    }

    ParentOverlay {
        id: parentOverlay
        anchors.fill: parent
        z: 200
        controller: tvController
    }

    AdultModeOverlay {
        id: adultMode
        anchors.fill: parent
        controller: tvController
        onClosed: root.leaveAdultMode()
        onPowerRequested: root.beginPowerOff()
    }

    Rectangle {
        id: remoteLockOsd
        anchors.centerIn: parent
        z: 310
        width: Math.min(500, parent.width * 0.62)
        height: tvController.remoteLocked ? 128 : 84
        color: "#f20b130d"
        border.color: "#91bc8e"
        border.width: 2
        opacity: 0

        Behavior on opacity { NumberAnimation { duration: 150 } }

        Text {
            id: remoteLockMessage
            anchors.fill: parent
            anchors.margins: 14
            color: "#e9f2dc"
            font.family: "Consolas"
            font.bold: true
            font.pixelSize: 24
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
    }

    Rectangle {
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.margins: 18
        z: 300
        width: lockBadge.implicitWidth + 24
        height: 34
        radius: 3
        visible: tvController.remoteLocked
        color: "#d50b130d"
        border.color: "#779b76"

        Text {
            id: lockBadge
            anchors.centerIn: parent
            color: "#dce9cd"
            font.family: "Consolas"
            font.bold: true
            font.pixelSize: 15
            text: "REMOTE LOCKED"
        }
    }

    Timer {
        id: filmCountdownTimer
        interval: 1000
        repeat: true
        onTriggered: {
            if (root.filmCountdownValue <= 1)
                root.finishFilmCountdown()
            else
                --root.filmCountdownValue
        }
    }

    // Match Adult TV's ten-second bookmark cadence, but only for film
    // channels. This makes a film already playing on the television appear at
    // its current point when the portal is opened, without turning ordinary
    // episode channels into resumable items.
    Timer {
        interval: 10000
        repeat: true
        running: !directMediaMode && !tvController.standby
                 && tvController.currentContentType === "films"
        onTriggered: root.syncPlaybackPosition()
    }

    Timer {
        id: filmCountdownMotionTimer
        interval: 40
        repeat: true
        running: root.filmCountdownActive
        onTriggered: {
            root.filmCountdownSpin = (root.filmCountdownSpin + 7) % 360
            root.filmCountdownFlicker = 0.4 + Math.random() * 1.4
        }
    }

    Timer {
        id: parentHoldTimer
        interval: 3500
        onTriggered: {
            root.previousHeldForParent = true
            tvController.requestParentAccess()
        }
    }

    Timer {
        id: guideHoldTimer
        interval: 3500
        onTriggered: {
            if (tvController.tvGuideEnabled && !directMediaMode
                    && !tvController.standby && !root.introPlaying
                    && !guideOverlay.visible) {
                root.okHeldForGuide = true
                guideOverlay.open()
            }
        }
    }

    Timer {
        id: emergencyRestartTimer
        interval: 6000
        onTriggered: {
            if (root.previousHeldForParent && parentOverlay.visible) {
                root.previousHeldForRestart = true
                tvController.requestParentCommand("restart")
            }
        }
    }

    Timer {
        id: muteHoldTimer
        // Mute is only mute; Adult playback now exposes subtitles directly in
        // its scrubber, so no hidden long-press subtitle gesture remains.
        interval: 3000
        onTriggered: {
            root.muteHeldForLock = true
            tvController.toggleRemoteLock()
        }
    }

    Timer {
        id: channelSummaryHoldTimer
        interval: 900
        onTriggered: {
            if (!directMediaMode && !tvController.standby && !root.introPlaying
                    && !root.filmCountdownActive && !adultMode.active
                    && !guideOverlay.visible && !parentOverlay.visible
                    && !channelSummaryOverlay.visible) {
                root.homeHeldForChannelSummary = true
                root.syncPlaybackPosition()
                channelSummaryOverlay.open()
            }
        }
    }

    SequentialAnimation {
        id: warmupAnimation

        PauseAnimation { duration: 180 }
        NumberAnimation {
            target: root
            property: "warmProgress"
            from: 0
            to: 1
            duration: 720
            easing.type: Easing.OutCubic
        }
        PauseAnimation { duration: 120 }
        ScriptAction { script: root.warmingUp = false }
    }

    SequentialAnimation {
        id: powerOffAnimation

        NumberAnimation {
            target: root
            property: "powerOffProgress"
            from: 0
            to: 1
            duration: 620
            easing.type: Easing.InCubic
        }
        PauseAnimation { duration: 70 }
        ScriptAction {
            script: {
                if (root.powerOffControlsConnectedTv)
                    tvController.turnOff()
                else
                    tvController.turnOffMabelOnly()
                root.poweringOff = false
            }
        }
    }

    SequentialAnimation {
        loops: Animation.Infinite
        running: !tvController.standby

        NumberAnimation {
            target: root
            property: "flickerAmount"
            from: 0
            to: 0.42
            duration: 75
        }
        NumberAnimation {
            target: root
            property: "flickerAmount"
            to: 0
            duration: 125
        }
        PauseAnimation { duration: 760 }
    }

    Timer {
        id: channelOsdTimer
        interval: 1700
        onTriggered: television.channelOsdItem.opacity = 0
    }

    Timer {
        id: programmeOsdTimer
        interval: 2200
        onTriggered: television.programmeNameItem.opacity = 0
    }

    Timer {
        id: scrubOsdTimer
        interval: 900
        onTriggered: television.scrubOsdItem.opacity = 0
    }

    Timer {
        id: volumeOsdTimer
        interval: 1300
        onTriggered: television.volumeOsdItem.opacity = 0
    }

    Timer {
        id: remoteLockOsdTimer
        interval: 2200
        onTriggered: remoteLockOsd.opacity = 0
    }

    Timer {
        interval: 50
        repeat: true
        running: (tvController.videoDistortion > 0 || player.paused)
                 && (player.status === "Playing" || player.paused)
                 && !tvController.standby
        onTriggered: root.distortionPhase = (root.distortionPhase + 0.05) % 1000
    }

    Connections {
        target: tvController

        function onPlaybackRequested(source, startPositionSeconds) {
            if (!adultMode.active && !root.openingAdultMode
                    && !root.poweringOff && root.pendingPowerAction.length === 0
                    && !tvController.standby) {
                if (tvController.currentContentType === "films"
                        && startPositionSeconds < 1)
                    root.beginFilmCountdown(source, startPositionSeconds)
                else {
                    root.cancelFilmCountdown()
                    player.play(source, startPositionSeconds)
                }
            }
        }
        function onStopPlaybackRequested() {
            root.cancelFilmCountdown()
            player.stop()
        }
        function onChannelDisplayRequested(number, name) {
            root.showChannel(number, name)
            if (tvController.soundEffectsEnabled)
                soundEffects.playTuningNoise()
        }
        function onProgrammeDisplayRequested(name) {
            root.showProgramme(name)
        }
        function onVolumeDisplayRequested(value, isMuted) {
            root.showVolume(value, isMuted)
        }
        function onStandbyChanged() {
            if (tvController.standby)
                root.cancelFilmCountdown()
            if (tvController.soundEffectsEnabled && !tvController.standby)
                soundEffects.playPowerClick()
            if (!tvController.standby) {
                root.poweringOff = false
                root.beginWarmup()
                root.schedulePlaybackAfterPowerClick(true)
            }
        }
        function onRemoteLockedChanged() {
            root.showRemoteLockState()
        }
        function onParentCommandRequested(command) {
            if (command === "adult")
                root.enterAdultMode()
        }
    }

    RemoteInputHandler {
        appRoot: root
        controllerObject: tvController
        adultOverlay: adultMode
        channelOverlay: channelSummaryOverlay
        guide: guideOverlay
        parentMenu: parentOverlay
        muteHold: muteHoldTimer
        guideHold: guideHoldTimer
        parentHold: parentHoldTimer
        emergencyRestart: emergencyRestartTimer
        channelSummaryHold: channelSummaryHoldTimer
    }

    Component.onCompleted: {
        if (tvController.soundEffectsEnabled)
            soundEffects.playPowerClick()
        root.beginWarmup()
        root.schedulePlaybackAfterPowerClick(false)
    }
}
