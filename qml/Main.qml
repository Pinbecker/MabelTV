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
    property bool powerOffShutsDown: false
    property real powerOffProgress: 0
    property bool previousHeldForParent: false
    property bool previousHeldForRestart: false
    property bool powerHeldForShutdown: false
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
    property bool childWasPausedBeforeAdult: false
    property bool restoreChildPauseAfterAdult: false
    property bool openingAdultMode: false
    property url pendingExternalSource: ""
    property string pendingExternalTitle: ""
    property string pendingAdultLibraryPath: ""
    property int pendingPortalChannel: -1
    property string pendingPortalProgramme: ""
    property int pendingPortalTuneChannel: -1
    property string pendingPowerAction: ""
    property bool pendingPowerOnWake: false
    property bool filmCountdownActive: false
    property int filmCountdownValue: 10
    property real filmCountdownSpin: 0
    property real filmCountdownFlicker: 1
    property url pendingFilmSource: ""
    property double pendingFilmStart: 0
    readonly property real playbackOsdInsetX: Math.max(30, screen.width * 0.055)
    readonly property real playbackOsdInsetY: Math.max(28, screen.height * 0.065)
    readonly property int portalVolume: tvController.volume
    readonly property bool portalMuted: tvController.muted
    readonly property bool portalRemoteLocked: tvController.remoteLocked
    readonly property bool portalSubtitlesAvailable: adultMode.active
        && adultPlayer.subtitlesAvailable
    readonly property bool portalSubtitlesVisible: adultMode.active
        && adultPlayer.subtitlesVisible

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
        scrubLabel.text = (seconds < 0 ? "◀◀ " : "▶▶ ")
                + (Math.abs(seconds) === 300 ? "5 minutes"
                                              : Math.abs(seconds) + " seconds")
        scrubOsd.opacity = 1
        scrubOsdTimer.restart()
    }

    function beginPowerOff(shutDownPi) {
        if (poweringOff || pendingPowerAction.length > 0)
            return
        if (tvController.standby) {
            if (shutDownPi)
                tvController.requestSafeShutdown()
            else
                tvController.dispatch(TvController.ToggleStandby)
            return
        }
        cancelFilmCountdown()
        pendingPowerAction = shutDownPi ? "shutdown" : "standby"
        if (openingAdultMode)
            return
        if (adultMode.active) {
            adultMode.close()
            return
        }
        pendingPowerAction = ""
        performPowerOff(shutDownPi)
    }

    function performPowerOff(shutDownPi) {
        if (poweringOff)
            return
        cancelFilmCountdown()
        syncPlaybackPosition()
        if (player.status === "Playing" && !player.paused)
            player.togglePause()
        powerOffShutsDown = shutDownPi
        poweringOff = true
        powerOffProgress = 0
        if (tvController.soundEffectsEnabled)
            soundEffects.playPowerDown()
        powerOffAnimation.restart()
    }

    function showChannel(number, name) {
        channelNumber.text = (number < 10 ? "0" : "") + number
        channelName.text = name.toUpperCase()
        channelOsd.opacity = 1
        channelOsdTimer.restart()
    }

    function showVolume(value, isMuted) {
        volumeLabel.text = isMuted ? "MUTE" : "VOL " + value
        volumeLevel.width = isMuted ? 0 : volumeTrack.width * value / 100
        volumeOsd.opacity = 1
        volumeOsdTimer.restart()
    }

    function showProgramme(name) {
        if (name.length === 0)
            return
        programmeName.text = name.toUpperCase()
        programmeName.opacity = 1
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

    // Commands from the parent web portal arrive through the local Unix
    // socket owned by the player service. They intentionally reuse the same
    // paths as the physical remote, so locks, standby and channel rules stay
    // identical whichever remote is used.
    function portalNavigate(key) {
        if (adultMode.active) {
            adultMode.handleKey(key, false)
        } else if (guideOverlay.visible) {
            guideOverlay.handleKey(key)
        } else if (parentOverlay.visible) {
            parentOverlay.handleKey(key, Qt.NoModifier)
        } else if (key === Qt.Key_Up) {
            syncPlaybackPosition()
            tvController.dispatch(TvController.PreviousProgramme)
        } else if (key === Qt.Key_Down) {
            syncPlaybackPosition()
            tvController.dispatch(TvController.NextProgramme)
        } else if (key === Qt.Key_Left && tvController.scrubbingEnabled && !directMediaMode) {
            scrubPlayback(-15)
        } else if (key === Qt.Key_Right && tvController.scrubbingEnabled && !directMediaMode) {
            scrubPlayback(15)
        } else if (key === Qt.Key_Return && !directMediaMode) {
            togglePlaybackPause()
        }
    }

    function portalTuneChannel(channel) {
        if (tvController.remoteLocked || poweringOff
                || pendingPowerAction.length > 0)
            return
        guideOverlay.close()
        tvController.closeParent()
        if (adultMode.active) {
            pendingPortalTuneChannel = Number(channel)
            adultMode.close()
            return
        }
        tvController.tuneGuideChannel(Number(channel))
    }

    function portalCommand(command) {
        if (command === "toggle-remote-lock") {
            tvController.toggleRemoteLock()
            showRemoteLockState()
            return
        }
        if (tvController.remoteLocked || poweringOff
                || pendingPowerAction.length > 0)
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
                tvController.requestParentAccess()
            while (tvController.parentAccessState === TvController.ParentConfirmation)
                tvController.parentConfirm()
        } else if (command === "open-tv-guide") {
            if (adultMode.active)
                adultMode.close()
            tvController.closeParent()
            guideOverlay.open()
        } else if (command === "close-overlay") {
            if (adultMode.active)
                adultMode.back(false)
            else if (guideOverlay.visible)
                guideOverlay.close()
            else
                tvController.closeParent()
        } else if (command === "restart-programme") {
            if (adultMode.active) {
                adultMode.restartFilm()
            } else {
                syncPlaybackPosition()
                tvController.restartCurrentProgramme()
            }
        } else if (command === "enter-adult-mode") {
            if (!adultMode.active) {
                guideOverlay.close()
                enterAdultMode()
            }
        } else if (command === "channel-up") {
            if (adultMode.active)
                adultMode.selectRelative(-1)
            else {
                syncPlaybackPosition()
                tvController.dispatch(TvController.ChannelUp)
            }
        } else if (command === "channel-down") {
            if (adultMode.active)
                adultMode.selectRelative(1)
            else {
                syncPlaybackPosition()
                tvController.dispatch(TvController.ChannelDown)
            }
        } else if (command === "previous-programme") {
            if (adultMode.active)
                adultMode.selectRelative(-1)
            else {
                syncPlaybackPosition()
                tvController.dispatch(TvController.PreviousProgramme)
            }
        } else if (command === "next-programme") {
            if (adultMode.active)
                adultMode.selectRelative(1)
            else {
                syncPlaybackPosition()
                tvController.dispatch(TvController.NextProgramme)
            }
        } else if (command === "toggle-pause") {
            if (adultMode.active)
                adultMode.togglePause()
            else
                togglePlaybackPause()
        } else if (command === "toggle-subtitles") {
            if (adultMode.active)
                adultMode.toggleSubtitles()
        } else if (command === "volume-up") {
            tvController.dispatch(TvController.VolumeUp)
        } else if (command === "volume-down") {
            tvController.dispatch(TvController.VolumeDown)
        } else if (command === "toggle-mute") {
            tvController.dispatch(TvController.ToggleMute)
        } else if (command === "toggle-power") {
            beginPowerOff(false)
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
                const action = root.pendingPowerAction
                root.pendingPowerAction = ""
                root.performPowerOff(action === "shutdown")
            } else if (root.pendingPortalTuneChannel >= 0) {
                const channel = root.pendingPortalTuneChannel
                root.pendingPortalTuneChannel = -1
                tvController.tuneGuideChannel(channel)
            } else if (root.pendingPortalChannel >= 0
                       && root.pendingPortalProgramme.length > 0) {
                const channel = root.pendingPortalChannel
                const programme = root.pendingPortalProgramme
                root.pendingPortalChannel = -1
                root.pendingPortalProgramme = ""
                tvController.playPortalProgramme(channel, programme)
            } else {
                tvController.resumeFromStandby()
            }
        }
    }

    function portalExternalPlayback(source, title) {
        if (tvController.remoteLocked || poweringOff
                || pendingPowerAction.length > 0)
            return
        guideOverlay.close()
        tvController.closeParent()
        if (adultMode.active) {
            adultMode.requestExternal(source, title)
            return
        }
        pendingExternalSource = source
        pendingExternalTitle = title
        enterAdultMode()
    }

    function portalPlayChannelProgramme(channel, file) {
        if (tvController.remoteLocked || poweringOff
                || pendingPowerAction.length > 0)
            return
        guideOverlay.close()
        tvController.closeParent()
        if (adultMode.active) {
            pendingPortalChannel = Number(channel)
            pendingPortalProgramme = String(file)
            adultMode.close()
            return
        }
        tvController.playPortalProgramme(Number(channel), String(file))
    }

    function portalPlayAdultFilm(file) {
        if (tvController.remoteLocked || poweringOff
                || pendingPowerAction.length > 0)
            return
        guideOverlay.close()
        tvController.closeParent()
        if (adultMode.active) {
            adultMode.requestLibraryFilm(String(file))
            return
        }
        pendingAdultLibraryPath = String(file)
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

    Rectangle {
        id: cabinet

        readonly property string styleName: tvController.tvBorderStyle
        readonly property bool isSlim: styleName === "slim-black"
        readonly property bool isSilver: styleName === "silver-90s"
        readonly property bool isCharcoal: styleName === "charcoal-90s"
        readonly property bool isVintage: styleName === "vintage-black"
        // Keep Slim Black's original proportions exactly. The three physical
        // sets have a smaller tube so there is room for their real cabinet
        // furniture beneath it.
        readonly property real sideInset: Math.max(54, width * 0.070)
        readonly property real tubeWidth: isSlim ? width - sideInset * 2
            : (isSilver ? width * 0.790
               : (isCharcoal ? width * 0.770 : width * 0.740))
        readonly property real tubeHeight: tubeWidth * 3 / 4
        readonly property real tubeTop: isSlim ? (height - tubeHeight) / 2
            : (isVintage ? width * 0.052 : width * 0.044)
        readonly property real lipWidth: Math.max(12, width * (
            isSlim ? 0.015 : (isVintage ? 0.020 : 0.017)))
        readonly property color lipColor: isSlim ? "#060807"
            : (isSilver ? "#484a47"
               : (isCharcoal ? "#111311" : "#080908"))
        readonly property real fasciaTop: tubeTop + tubeHeight + lipWidth

        anchors.centerIn: parent
        width: Math.min(root.width - 48, (root.height - 48) * 4 / 3)
        height: width * 3 / 4
        radius: isSlim ? Math.max(38, width * 0.055)
            : Math.max(44, width * 0.067)
        color: "#151a16"
        border.color: isSlim ? "#454c46"
            : (isSilver ? "#f5f3eb"
               : (isCharcoal ? "#555a55" : "#333632"))
        border.width: 2
        antialiasing: true

        gradient: Gradient {
            GradientStop {
                position: 0
                color: cabinet.isSlim ? "#252a26"
                    : (cabinet.isSilver ? "#deded7"
                       : (cabinet.isCharcoal ? "#3f433f" : "#2d302d"))
            }
            GradientStop {
                position: 1
                color: cabinet.isSlim ? "#0d100e"
                    : (cabinet.isSilver ? "#979992"
                       : (cabinet.isCharcoal ? "#171a18" : "#101210"))
            }
        }

        Rectangle {
            anchors.fill: parent
            anchors.margins: 3
            radius: Math.max(0, cabinet.radius - 3)
            color: "transparent"
            border.color: cabinet.isSilver ? "#70ffffff" : "#36ffffff"
            border.width: 1
            antialiasing: true
        }

        // White/silver plastic set: a deep 1990s control shelf with the small
        // rectangular buttons and large power switch from the reference.
        Item {
            id: silverFascia

            visible: cabinet.isSilver
            x: cabinet.width * 0.11
            y: cabinet.fasciaTop + cabinet.width * 0.016
            width: cabinet.width * 0.78
            height: cabinet.height - y - cabinet.width * 0.035

            Text {
                text: "MABEL"
                color: "#454743"
                font.pixelSize: Math.max(10, silverFascia.height * 0.15)
                font.bold: true
                anchors.left: parent.left
                anchors.top: parent.top
                anchors.leftMargin: parent.width * 0.02
            }

            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                height: parent.height * 0.58
                radius: height * 0.22
                color: "#aaaca6"
                border.color: "#777a75"
                border.width: 1
            }

            Item {
                x: parent.width * 0.18
                y: parent.height * 0.52
                width: parent.width * 0.60
                height: parent.height * 0.34

                Repeater {
                    model: 6

                    delegate: Rectangle {
                        required property int index
                        x: index * parent.width / 6
                            + (parent.width / 6 - width) / 2
                        width: parent.width * 0.075
                        height: parent.height * 0.42
                        radius: 2
                        color: index < 2 ? "#797c77" : "#666965"
                        border.color: "#c9cac5"
                        border.width: 1
                    }
                }
            }

            Rectangle {
                width: parent.height * 0.27
                height: width
                radius: width / 2
                anchors.right: parent.right
                anchors.rightMargin: parent.width * 0.035
                anchors.bottom: parent.bottom
                anchors.bottomMargin: parent.height * 0.12
                color: "#555854"
                border.color: "#d4d5cf"
                border.width: 2
            }
        }

        // Dark late-90s set: twin speaker grilles and a compact central control
        // cluster give it the broad, heavy lower chin seen in the reference.
        Item {
            id: charcoalFascia

            visible: cabinet.isCharcoal
            x: cabinet.width * 0.095
            y: cabinet.fasciaTop + cabinet.width * 0.012
            width: cabinet.width * 0.81
            height: cabinet.height - y - cabinet.width * 0.03

            Rectangle {
                id: leftSpeaker
                width: parent.width * 0.32
                height: parent.height * 0.66
                anchors.left: parent.left
                anchors.bottom: parent.bottom
                radius: height * 0.08
                color: "#222522"
                border.color: "#4f544f"
                border.width: 1

                Repeater {
                    model: 6

                    delegate: Rectangle {
                        required property int index
                        x: 0
                        y: index * parent.height / 6
                        width: parent.width
                        height: Math.max(2, parent.height * 0.028)
                        radius: height / 2
                        color: "#080a09"
                        opacity: 0.78
                    }
                }
            }

            Rectangle {
                width: leftSpeaker.width
                height: leftSpeaker.height
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                radius: height * 0.08
                color: "#222522"
                border.color: "#4f544f"
                border.width: 1

                Repeater {
                    model: 6

                    delegate: Rectangle {
                        required property int index
                        x: 0
                        y: index * parent.height / 6
                        width: parent.width
                        height: Math.max(2, parent.height * 0.028)
                        radius: height / 2
                        color: "#080a09"
                        opacity: 0.78
                    }
                }
            }

            Text {
                text: "MABEL"
                color: "#aaada8"
                font.pixelSize: Math.max(9, parent.height * 0.16)
                font.bold: true
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: parent.top
            }

            Rectangle {
                width: parent.width * 0.19
                height: parent.height * 0.27
                radius: height * 0.28
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.bottom: parent.bottom
                anchors.bottomMargin: parent.height * 0.12
                color: "#0b0d0c"
                border.color: "#626762"
                border.width: 1
            }
        }

        // Older box set: wide speaker vents, two physical dials and small feet.
        Item {
            id: vintageFascia

            visible: cabinet.isVintage
            x: cabinet.width * 0.12
            y: cabinet.fasciaTop + cabinet.width * 0.012
            width: cabinet.width * 0.76
            height: cabinet.height - y - cabinet.width * 0.025

            Rectangle {
                id: vintageSpeaker
                width: parent.width * 0.52
                height: parent.height * 0.63
                anchors.left: parent.left
                anchors.bottom: parent.bottom
                radius: height * 0.08
                color: "#090b09"
                border.color: "#414440"
                border.width: 1

                Repeater {
                    model: 8

                    delegate: Rectangle {
                        required property int index
                        x: vintageSpeaker.width * 0.07
                        y: vintageSpeaker.height * (0.09 + index * 0.105)
                        width: vintageSpeaker.width * 0.86
                        height: Math.max(2, vintageSpeaker.height * 0.025)
                        radius: height / 2
                        color: "#4d514c"
                    }
                }
            }

            Text {
                text: tvDisplayName.toUpperCase()
                color: "#a3a69f"
                font.pixelSize: Math.max(9, parent.height * 0.14)
                font.bold: true
                anchors.left: vintageSpeaker.left
                anchors.bottom: vintageSpeaker.top
                anchors.bottomMargin: parent.height * 0.08
            }

            Column {
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                spacing: parent.height * 0.07

                Repeater {
                    model: 2

                    delegate: Rectangle {
                        required property int index
                        width: vintageFascia.height * 0.27
                        height: width
                        radius: width / 2
                        color: "#151815"
                        border.color: "#777b74"
                        border.width: 2

                        Rectangle {
                            width: parent.width * 0.08
                            height: parent.height * 0.35
                            radius: width / 2
                            color: "#94988f"
                            anchors.horizontalCenter: parent.horizontalCenter
                            anchors.top: parent.top
                            anchors.topMargin: parent.height * 0.08
                        }
                    }
                }
            }
        }

        Rectangle {
            visible: cabinet.isVintage
            x: cabinet.width * 0.16
            y: cabinet.height - height * 0.35
            width: cabinet.width * 0.10
            height: cabinet.width * 0.022
            radius: height / 2
            color: "#080a08"
        }

        Rectangle {
            visible: cabinet.isVintage
            x: cabinet.width * 0.74
            y: cabinet.height - height * 0.35
            width: cabinet.width * 0.10
            height: cabinet.width * 0.022
            radius: height / 2
            color: "#080a08"
        }

        Rectangle {
            id: bezelLip

            x: screen.x - cabinet.lipWidth
            y: screen.y - cabinet.lipWidth
            width: screen.width + cabinet.lipWidth * 2
            height: screen.height + cabinet.lipWidth * 2
            radius: screen.radius + cabinet.lipWidth
            color: cabinet.lipColor
            border.color: cabinet.isSilver ? "#757872" : "#050605"
            border.width: 2
            antialiasing: true
        }

        Rectangle {
            id: screen

            x: (cabinet.width - width) / 2
            y: cabinet.tubeTop
            width: cabinet.tubeWidth
            height: width * 3 / 4
            radius: cabinet.isSlim ? Math.max(38, width * 0.065)
                : Math.max(42, width * 0.075)
            color: "#010201"
            clip: true
            antialiasing: true
            // Preserve the full CRT appearance whenever any CRT control is in
            // use. Only bypass the off-screen texture and shader when the user
            // has explicitly turned both effects off and playback is not
            // paused; the normal KidsTV picture remains pixel-for-pixel the
            // same as before this optimisation.
            layer.enabled: tvController.crtGlass > 0
                           || tvController.videoDistortion > 0
                           || player.paused
            layer.smooth: true
            layer.effect: ShaderEffect {
                property variant source
                property real flicker: root.flickerAmount
                property real effectStrength: tvController.crtGlass / 100
                property real distortion: tvController.videoDistortion / 100
                property real phase: root.distortionPhase
                property real pausedEffect: player.paused && !root.introPlaying ? 1 : 0
                property real cornerRadius: screen.radius
                property real maskSoftness: 1.65
                property vector2d resolution: Qt.vector2d(screen.width, screen.height)
                fragmentShader: "qrc:/shaders/crt.frag.qsb"
            }

            MpvVideo {
                id: player
                objectName: "mabeltvPlayer"

                anchors.fill: parent
                // A hidden adult overlay used to leave this framebuffer player
                // rendering underneath the adult framebuffer player. On the Pi
                // that can block Qt's render thread inside libmpv, freezing all
                // remote input during an Adult Mode transition.
                visible: !adultMode.active
                volume: tvController.volume
                muted: tvController.muted
                aspectMode: tvController.currentAspectMode

                onPausedChanged: {
                    if (!root.introPlaying && !directMediaMode
                            && (status === "Playing" || status === "Paused"))
                        tvController.updatePlaybackPosition(positionSeconds(), paused)
                }

                onStatusChanged: {
                    if (root.restoreChildPauseAfterAdult && status === "Playing") {
                        root.restoreChildPauseAfterAdult = false
                        togglePause()
                    }
                }

                onPlaybackFinished: {
                    if (root.introPlaying)
                        root.finishIntro()
                    else if (!directMediaMode)
                        tvController.playbackEnded()
                }
                onPlaybackFailed: message => {
                    if (root.introPlaying)
                        root.finishIntro()
                    else if (!directMediaMode)
                        tvController.playbackFailed(message)
                }
                onPlaybackStopped: {
                    if (root.openingAdultMode) {
                        root.openingAdultMode = false
                        tvController.closeParent()
                        if (root.pendingPowerAction.length > 0) {
                            const action = root.pendingPowerAction
                            root.pendingPowerAction = ""
                            root.performPowerOff(action === "shutdown")
                        } else {
                            if (root.pendingExternalSource.toString().length > 0) {
                                const source = root.pendingExternalSource
                                const title = root.pendingExternalTitle
                                root.pendingExternalSource = ""
                                root.pendingExternalTitle = ""
                                adultMode.openExternal(source, title)
                            } else {
                                adultMode.open()
                                if (root.pendingAdultLibraryPath.length > 0) {
                                    const file = root.pendingAdultLibraryPath
                                    root.pendingAdultLibraryPath = ""
                                    adultMode.requestLibraryFilm(file)
                                }
                            }
                        }
                    }
                }
            }

            Rectangle {
                id: filmCountdownOverlay
                anchors.fill: parent
                visible: root.filmCountdownActive
                color: "#080909"
                z: 20

                Rectangle {
                    anchors.centerIn: parent
                    width: Math.min(parent.width, parent.height) * 0.42
                    height: width
                    radius: width / 2
                    color: "transparent"
                    border.color: "#d8d8c8"
                    border.width: Math.max(3, width * 0.018)

                    Rectangle {
                        anchors.centerIn: parent
                        width: parent.width * 0.92
                        height: Math.max(2, parent.width * 0.008)
                        color: "#d8d8c8"
                        opacity: 0.55
                    }
                    Rectangle {
                        anchors.centerIn: parent
                        width: Math.max(2, parent.width * 0.008)
                        height: parent.height * 0.92
                        color: "#d8d8c8"
                        opacity: 0.55
                    }
                    Rectangle {
                        anchors.horizontalCenter: parent.horizontalCenter
                        anchors.bottom: parent.verticalCenter
                        width: Math.max(3, parent.width * 0.014)
                        height: parent.height * 0.46
                        color: "#eeeede"
                        opacity: 0.76
                        transformOrigin: Item.Bottom
                        rotation: root.filmCountdownSpin
                    }

                    Text {
                        anchors.centerIn: parent
                        color: "#eeeede"
                        text: root.filmCountdownValue
                        font.family: "Courier New"
                        font.bold: true
                        font.pixelSize: parent.width * 0.42
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        anchors.bottom: parent.bottom
                        anchors.bottomMargin: parent.height * 0.16
                        color: "#b8b8aa"
                        text: "PRESS OK TO SKIP"
                        font.family: "Courier New"
                        font.pixelSize: Math.max(12, parent.width * 0.055)
                        font.bold: true
                    }
                }

                Rectangle {
                    anchors.fill: parent
                    color: "#ffffff"
                    opacity: 0.025 * root.filmCountdownFlicker
                }
            }

            Item {
                id: staticNoise

                anchors.fill: parent
                visible: root.showStatic

                Canvas {
                    id: staticCanvas

                    width: 160
                    height: 120
                    anchors.centerIn: parent
                    scale: parent.width / width
                    transformOrigin: Item.Center
                    smooth: false

                    onPaint: {
                        const context = getContext("2d")
                        const block = 2
                        context.fillStyle = "#111411"
                        context.fillRect(0, 0, width, height)
                        for (let y = 0; y < height; y += block) {
                            for (let x = 0; x < width; x += block) {
                                const value = Math.floor(25 + Math.random() * 145)
                                context.fillStyle = "rgb(" + value + "," + value + "," + value + ")"
                                context.fillRect(x, y, block, block)
                            }
                        }
                    }
                }
            }

            Timer {
                interval: 125
                repeat: true
                running: staticNoise.visible
                onTriggered: staticCanvas.requestPaint()
            }

            Text {
                anchors.centerIn: parent
                visible: root.showStatic && tvController.noSignal && !tvController.tuning
                         && !firstRunSetupRequired
                color: "#e6e3c4"
                style: Text.Outline
                styleColor: "#4b4b40"
                font.family: "Consolas"
                font.bold: true
                font.pixelSize: Math.max(24, cabinet.height * 0.055)
                text: "NO SIGNAL"
            }

            Rectangle {
                anchors.fill: parent
                visible: firstRunSetupRequired
                color: "#e9e2c8"

                Column {
                    width: parent.width * 0.78
                    spacing: Math.max(8, parent.height * 0.025)
                    anchors.centerIn: parent

                    Text {
                        width: parent.width
                        color: "#16221e"
                        font.family: "Georgia"
                        font.bold: true
                        font.pixelSize: Math.max(27, screen.height * 0.085)
                        horizontalAlignment: Text.AlignHCenter
                        wrapMode: Text.WordWrap
                        text: "WELCOME TO " + tvDisplayName.toUpperCase()
                    }

                    Text {
                        width: parent.width
                        color: "#40534b"
                        font.pixelSize: Math.max(15, screen.height * 0.035)
                        horizontalAlignment: Text.AlignHCenter
                        wrapMode: Text.WordWrap
                        text: "On a phone or computer connected to this Wi-Fi, open"
                    }

                    Text {
                        width: parent.width
                        color: "#176554"
                        font.family: "Consolas"
                        font.bold: true
                        font.pixelSize: Math.max(18, screen.height * 0.045)
                        horizontalAlignment: Text.AlignHCenter
                        wrapMode: Text.WrapAnywhere
                        text: firstRunLibraryUrl
                    }

                    Image {
                        width: Math.min(parent.width * 0.28, screen.height * 0.24)
                        height: visible ? width : 0
                        anchors.horizontalCenter: parent.horizontalCenter
                        visible: firstRunSetupQrUrl.toString().length > 0
                        source: firstRunSetupQrUrl
                        fillMode: Image.PreserveAspectFit
                        cache: false
                    }

                    Text {
                        width: parent.width
                        visible: firstRunLibraryIpUrl.length > 0
                        color: "#40534b"
                        font.pixelSize: Math.max(12, screen.height * 0.026)
                        horizontalAlignment: Text.AlignHCenter
                        wrapMode: Text.WrapAnywhere
                        text: "If .local does not open: " + firstRunLibraryIpUrl
                    }

                    Text {
                        width: parent.width
                        color: "#40534b"
                        font.pixelSize: Math.max(14, screen.height * 0.031)
                        horizontalAlignment: Text.AlignHCenter
                        text: "Then enter this one-time setup code:"
                    }

                    Rectangle {
                        width: parent.width * 0.62
                        height: codeText.implicitHeight + 18
                        anchors.horizontalCenter: parent.horizontalCenter
                        radius: 9
                        color: "#ffffff"
                        border.color: "#b7b39f"
                        border.width: 2

                        Text {
                            id: codeText
                            anchors.centerIn: parent
                            color: "#17221e"
                            font.family: "Consolas"
                            font.bold: true
                            font.letterSpacing: 7
                            font.pixelSize: Math.max(28, screen.height * 0.075)
                            text: firstRunSetupCode
                        }
                    }
                }
            }

            Rectangle {
                anchors.fill: parent
                color: "transparent"
                opacity: tvController.crtGlass / 100

                gradient: Gradient {
                    GradientStop { position: 0.0; color: "#60ffffff" }
                    GradientStop { position: 0.16; color: "#24ffffff" }
                    GradientStop { position: 0.46; color: "#03000000" }
                    GradientStop { position: 0.78; color: "#13000000" }
                    GradientStop { position: 1.0; color: "#36000000" }
                }
            }

            Rectangle {
                width: screen.width * 1.18
                height: screen.height * 0.23
                x: -screen.width * 0.12
                y: screen.height * 0.055
                rotation: -10
                transformOrigin: Item.Center
                opacity: 0.72 * Math.pow(tvController.crtGlass / 100, 1.3)
                color: "transparent"

                gradient: Gradient {
                    GradientStop { position: 0.0; color: "#00ffffff" }
                    GradientStop { position: 0.34; color: "#28ffffff" }
                    GradientStop { position: 0.50; color: "#64ffffff" }
                    GradientStop { position: 0.67; color: "#1cffffff" }
                    GradientStop { position: 1.0; color: "#00ffffff" }
                }
            }

            Text {
                anchors.left: parent.left
                anchors.top: parent.top
                anchors.leftMargin: root.playbackOsdInsetX
                anchors.topMargin: root.playbackOsdInsetY
                z: 70
                visible: player.paused && !root.introPlaying && !root.poweringOff
                color: "#e8e4d0"
                style: Text.Outline
                styleColor: "#5f5360"
                font.family: "Consolas"
                font.bold: true
                font.pixelSize: Math.max(19, screen.height * 0.045)
                text: "Ⅱ  PAUSE"
            }

            Rectangle {
                id: scrubOsd

                anchors.horizontalCenter: parent.horizontalCenter
                anchors.verticalCenter: parent.verticalCenter
                width: Math.max(176, scrubLabel.implicitWidth + 46)
                height: 54
                radius: 10
                z: 71
                color: "#d909100c"
                border.color: "#8aa789"
                border.width: 1
                opacity: 0

                Behavior on opacity { NumberAnimation { duration: 110 } }

                Text {
                    id: scrubLabel
                    anchors.centerIn: parent
                    color: "#e8f0dd"
                    font.family: "Consolas"
                    font.bold: true
                    font.pixelSize: Math.max(17, screen.height * 0.032)
                    text: "▶▶ 15 seconds"
                }
            }

            Text {
                id: programmeName

                anchors.right: parent.right
                anchors.top: parent.top
                anchors.rightMargin: root.playbackOsdInsetX
                anchors.topMargin: root.playbackOsdInsetY
                z: 70
                width: screen.width * 0.55
                opacity: 0
                color: "#e8e4d0"
                style: Text.Outline
                styleColor: "#5f5360"
                elide: Text.ElideRight
                horizontalAlignment: Text.AlignRight
                font.family: "Consolas"
                font.bold: true
                font.pixelSize: Math.max(16, screen.height * 0.028)

                Behavior on opacity { NumberAnimation { duration: 120 } }
            }

            Item {
                anchors.fill: parent
                z: 95
                visible: root.poweringOff

                readonly property real closing: Math.min(1, root.powerOffProgress / 0.72)
                readonly property real lineCollapse: Math.max(
                    0, 1 - Math.max(0, root.powerOffProgress - 0.70) / 0.25)

                Rectangle {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    height: parent.height * 0.5 * parent.closing
                    color: "black"
                }

                Rectangle {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    height: parent.height * 0.5 * parent.closing
                    color: "black"
                }

                Rectangle {
                    anchors.centerIn: parent
                    width: parent.width * parent.lineCollapse
                    height: Math.max(2, parent.height * 0.009 * parent.lineCollapse)
                    radius: height / 2
                    visible: root.powerOffProgress > 0.54
                    color: "#eaf2dc"
                    opacity: parent.lineCollapse * 0.92
                }
            }

            Rectangle {
                id: channelOsd

                anchors.top: parent.top
                anchors.right: parent.right
                anchors.margins: Math.max(20, screen.width * 0.035)
                width: Math.max(230, channelName.implicitWidth + 48)
                height: 94
                color: "#b5070d08"
                border.color: "#789878"
                border.width: 1
                opacity: 0

                Behavior on opacity { NumberAnimation { duration: 120 } }

                Text {
                    id: channelNumber
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.leftMargin: 17
                    color: "#dfe8cb"
                    font.family: "Consolas"
                    font.bold: true
                    font.pixelSize: 43
                    text: "01"
                }

                Text {
                    id: channelName
                    anchors.left: channelNumber.right
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.leftMargin: 16
                    anchors.rightMargin: 14
                    color: "#a9c99f"
                    elide: Text.ElideRight
                    font.family: "Consolas"
                    font.bold: true
                    font.pixelSize: 17
                    text: tvDisplayName.toUpperCase()
                }
            }

            Text {
                anchors.top: parent.top
                anchors.right: parent.right
                anchors.margins: Math.max(20, screen.width * 0.035)
                visible: tvController.numericEntry.length > 0
                color: "#e4e8ce"
                style: Text.Outline
                styleColor: "#283128"
                font.family: "Consolas"
                font.bold: true
                font.pixelSize: 54
                text: tvController.numericEntry
            }

            Rectangle {
                id: volumeOsd

                anchors.horizontalCenter: parent.horizontalCenter
                anchors.bottom: parent.bottom
                anchors.bottomMargin: Math.max(28, screen.height * 0.07)
                width: Math.min(480, screen.width * 0.6)
                height: 78
                color: "#be070d08"
                border.color: "#789878"
                border.width: 1
                opacity: 0

                Behavior on opacity { NumberAnimation { duration: 120 } }

                Text {
                    id: volumeLabel
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.leftMargin: 20
                    width: 100
                    color: "#dfe8cb"
                    font.family: "Consolas"
                    font.bold: true
                    font.pixelSize: 22
                    text: "VOL 20"
                }

                Rectangle {
                    id: volumeTrack
                    anchors.left: volumeLabel.right
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.leftMargin: 8
                    anchors.rightMargin: 22
                    height: 18
                    color: "#29362c"
                    border.color: "#637b64"

                    Rectangle {
                        id: volumeLevel
                        anchors.left: parent.left
                        anchors.top: parent.top
                        anchors.bottom: parent.bottom
                        width: parent.width * tvController.volume / 100
                        color: "#83ba7d"
                    }
                }
            }

            Text {
                anchors.left: parent.left
                anchors.bottom: parent.bottom
                anchors.margins: 14
                visible: !tvController.standby
                color: "#6f8b70"
                opacity: 0.72
                font.family: "Consolas"
                font.pixelSize: 12
                text: directMediaMode ? player.status.toUpperCase()
                                      : "CH " + tvController.currentChannelNumber
                                        + "  /  " + player.status.toUpperCase()
            }

            Item {
                anchors.fill: parent
                z: 90
                visible: root.warmingUp

                Rectangle {
                    anchors.fill: parent
                    color: "black"
                    opacity: 1 - Math.pow(root.warmProgress, 1.7)
                }

                Rectangle {
                    anchors.centerIn: parent
                    width: parent.width * (0.16 + root.warmProgress * 0.84)
                    height: Math.max(2, parent.height * Math.pow(root.warmProgress, 3.7))
                    radius: height / 2
                    color: "#e8f1df"
                    opacity: (1 - root.warmProgress) * 0.8
                }
            }
        }
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
        onPowerRequested: root.beginPowerOff(false)
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
        id: powerHoldTimer
        interval: 5000
        onTriggered: {
            root.powerHeldForShutdown = true
            root.beginPowerOff(true)
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
                if (root.powerOffShutsDown) {
                    tvController.requestSafeShutdown()
                } else {
                    tvController.dispatch(TvController.ToggleStandby)
                    root.poweringOff = false
                }
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
        onTriggered: channelOsd.opacity = 0
    }

    Timer {
        id: programmeOsdTimer
        interval: 2200
        onTriggered: programmeName.opacity = 0
    }

    Timer {
        id: scrubOsdTimer
        interval: 900
        onTriggered: scrubOsd.opacity = 0
    }

    Timer {
        id: volumeOsdTimer
        interval: 1300
        onTriggered: volumeOsd.opacity = 0
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

    Item {
        anchors.fill: parent
        focus: true

        Keys.onPressed: event => {
            if (root.poweringOff || root.pendingPowerAction.length > 0) {
                event.accepted = true
            } else if (event.key === Qt.Key_M) {
                if (!event.isAutoRepeat) {
                    root.muteHeldForLock = false
                    muteHoldTimer.restart()
                }
                event.accepted = true
            } else if (tvController.remoteLocked) {
                event.accepted = true
            } else if (adultMode.active) {
                if (event.key === Qt.Key_P) {
                    if (!event.isAutoRepeat) {
                        root.powerHeldForShutdown = false
                        powerHoldTimer.restart()
                    }
                    event.accepted = true
                } else {
                    event.accepted = adultMode.handleKey(event.key, event.isAutoRepeat)
                }
            } else if (guideOverlay.visible && root.okHeldForGuide
                       && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter)) {
                // Ignore the repeat tail of the same OK hold that opened the
                // guide. Otherwise it immediately tunes and closes the guide.
                event.accepted = true
            } else if (guideOverlay.visible) {
                event.accepted = guideOverlay.handleKey(event.key)
            } else if (parentOverlay.visible && event.key === Qt.Key_B
                    && root.previousHeldForParent) {
                // Swallow the repeat tail of the same Back hold that opened
                // parent access. A fresh Back press still closes the overlay.
                event.accepted = true
            } else if (parentOverlay.visible) {
                event.accepted = parentOverlay.handleKey(event.key, event.modifiers)
            } else if (Qt.platform.os === "windows"
                       && event.key === Qt.Key_G
                       && (event.modifiers & Qt.ControlModifier) !== 0
                       && tvController.tvGuideEnabled && !directMediaMode) {
                guideOverlay.open()
                event.accepted = true
            } else if (event.key === Qt.Key_P
                       && (event.modifiers & Qt.ControlModifier) !== 0) {
                tvController.requestParentAccess()
                event.accepted = true
            } else if (root.introPlaying
                       && event.key !== Qt.Key_F11
                       && event.key !== Qt.Key_Escape
                       && !(event.key === Qt.Key_F4
                            && (event.modifiers & Qt.AltModifier) !== 0)) {
                event.accepted = true
            } else if (!event.isAutoRepeat && tvController.tvGuideEnabled
                       && !directMediaMode && !tvController.standby
                       && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
                       && tvController.numericEntry.length === 0) {
                root.okHeldForGuide = false
                guideHoldTimer.restart()
                event.accepted = true
            } else if (event.key === Qt.Key_B) {
                if (!event.isAutoRepeat) {
                    root.previousHeldForParent = false
                    root.previousHeldForRestart = false
                    parentHoldTimer.restart()
                    emergencyRestartTimer.restart()
                }
                event.accepted = true
            } else if (event.key === Qt.Key_P) {
                if (!event.isAutoRepeat) {
                    root.powerHeldForShutdown = false
                    powerHoldTimer.restart()
                }
                event.accepted = true
            } else if (event.key >= Qt.Key_0 && event.key <= Qt.Key_9
                       && !event.isAutoRepeat && !directMediaMode) {
                tvController.enterDigit(event.key - Qt.Key_0)
                event.accepted = true
            } else if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
                       && tvController.numericEntry.length > 0) {
                tvController.confirmNumericEntry()
                event.accepted = true
            } else if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
                       && !event.isAutoRepeat && !directMediaMode) {
                root.togglePlaybackPause()
                event.accepted = true
            } else if (tvController.scrubbingEnabled && !directMediaMode
                       && !tvController.standby
                       && (event.key === Qt.Key_Left || event.key === Qt.Key_Right)) {
                if (event.key === Qt.Key_Left) {
                    root.scrubPlayback(event.isAutoRepeat ? -30 : -15)
                } else {
                    root.scrubPlayback(event.isAutoRepeat ? 30 : 15)
                }
                event.accepted = true
            } else if (event.key === Qt.Key_PageUp) {
                if (root.acceptRepeat("channel", event.isAutoRepeat)) {
                    root.syncPlaybackPosition()
                    tvController.dispatch(TvController.ChannelUp)
                }
                event.accepted = true
            } else if (event.key === Qt.Key_PageDown) {
                if (root.acceptRepeat("channel", event.isAutoRepeat)) {
                    root.syncPlaybackPosition()
                    tvController.dispatch(TvController.ChannelDown)
                }
                event.accepted = true
            } else if (event.key === Qt.Key_Up) {
                if (!event.isAutoRepeat) {
                    root.syncPlaybackPosition()
                    tvController.dispatch(TvController.PreviousProgramme)
                }
                event.accepted = true
            } else if (event.key === Qt.Key_Down) {
                if (!event.isAutoRepeat) {
                    root.syncPlaybackPosition()
                    tvController.dispatch(TvController.NextProgramme)
                }
                event.accepted = true
            } else if (event.key === Qt.Key_Plus || event.key === Qt.Key_Equal) {
                if (root.acceptRepeat("volume", event.isAutoRepeat))
                    tvController.dispatch(TvController.VolumeUp)
                event.accepted = true
            } else if (event.key === Qt.Key_Minus) {
                if (root.acceptRepeat("volume", event.isAutoRepeat))
                    tvController.dispatch(TvController.VolumeDown)
                event.accepted = true
            } else if ((event.key === Qt.Key_Left || event.key === Qt.Key_Right)
                       && !directMediaMode) {
                // Left/Right are deliberately inert when scrubbing is off.
                // Programme navigation lives on Up/Down, so a distant or
                // accidental press cannot change what Mabel is watching.
                event.accepted = true
            } else if (event.key === Qt.Key_R && !event.isAutoRepeat && !directMediaMode) {
                root.syncPlaybackPosition()
                tvController.dispatch(TvController.RandomEpisode)
                event.accepted = true
            } else if (event.key === Qt.Key_Space && directMediaMode) {
                root.togglePlaybackPause()
                event.accepted = true
            } else if (event.key === Qt.Key_F11) {
                root.visibility = root.visibility === Window.FullScreen
                        ? Window.Windowed : Window.FullScreen
                event.accepted = true
            } else if (event.key === Qt.Key_Escape && root.visibility === Window.FullScreen) {
                root.visibility = Window.Windowed
                event.accepted = true
            }
        }

        Keys.onReleased: event => {
            if (adultMode.active
                    && adultMode.handleKeyReleased(event.key, event.isAutoRepeat)) {
                event.accepted = true
            } else if (event.key === Qt.Key_M && !event.isAutoRepeat) {
                if (muteHoldTimer.running) {
                    muteHoldTimer.stop()
                    if (!root.muteHeldForLock && !tvController.remoteLocked)
                        tvController.dispatch(TvController.ToggleMute)
                }
                root.muteHeldForLock = false
                event.accepted = true
            } else if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
                       && !event.isAutoRepeat
                       && (guideHoldTimer.running || root.okHeldForGuide)) {
                if (guideHoldTimer.running)
                    guideHoldTimer.stop()
                if (!root.okHeldForGuide && !tvController.remoteLocked
                        && !guideOverlay.visible && !directMediaMode)
                    root.togglePlaybackPause()
                root.okHeldForGuide = false
                event.accepted = true
            } else if (event.key === Qt.Key_B && !event.isAutoRepeat) {
                if (emergencyRestartTimer.running)
                    emergencyRestartTimer.stop()
                if (parentHoldTimer.running)
                    parentHoldTimer.stop()
                root.previousHeldForParent = false
                root.previousHeldForRestart = false
                event.accepted = true
            } else if (event.key === Qt.Key_P && !event.isAutoRepeat) {
                if (powerHoldTimer.running) {
                    powerHoldTimer.stop()
                    if (!root.powerHeldForShutdown)
                        root.beginPowerOff(false)
                }
                root.powerHeldForShutdown = false
                event.accepted = true
            }
        }
    }

    Component.onCompleted: {
        if (tvController.soundEffectsEnabled)
            soundEffects.playPowerClick()
        root.beginWarmup()
        root.schedulePlaybackAfterPowerClick(false)
    }
}
