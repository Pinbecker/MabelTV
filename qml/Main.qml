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
    title: "Mabel TV"
    property bool warmingUp: true
    property real warmProgress: 0
    property real flickerAmount: 0
    property real distortionPhase: 0
    property bool poweringOff: false
    property bool powerOffShutsDown: false
    property real powerOffProgress: 0
    property bool previousHeldForParent: false
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
        introCompletesStandbyWake = isStandbyWake
        introPlaying = true
        player.play(startupIntroUrl, 0)
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
        if (introPlaying || poweringOff)
            return
        syncPlaybackPosition()
        player.togglePause()
    }

    function beginPowerOff(shutDownPi) {
        if (poweringOff || tvController.standby)
            return
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

    function showRemoteLockState() {
        remoteLockMessage.text = tvController.remoteLocked
                ? "REMOTE LOCKED\nHOLD MUTE TO UNLOCK"
                : "REMOTE UNLOCKED"
        remoteLockOsd.opacity = 1
        remoteLockOsdTimer.restart()
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
        readonly property real sideInset: Math.max(54, width * (
            styleName === "slim-black" ? 0.070
            : (styleName === "charcoal" ? 0.085
               : (styleName === "walnut" ? 0.095 : 0.082))))
        readonly property real lipWidth: Math.max(12, width * (
            styleName === "walnut" ? 0.018 : 0.015))
        readonly property color lipColor: styleName === "slim-black" ? "#060807"
            : (styleName === "charcoal" ? "#171b18"
               : (styleName === "walnut" ? "#24170f" : "#554d40"))

        anchors.centerIn: parent
        width: Math.min(root.width - 48, (root.height - 48) * 4 / 3)
        height: width * 3 / 4
        radius: styleName === "slim-black" ? Math.max(38, width * 0.055)
            : Math.max(44, width * 0.067)
        color: "#151a16"
        border.color: styleName === "slim-black" ? "#454c46"
            : (styleName === "charcoal" ? "#646a62"
               : (styleName === "walnut" ? "#a2774e" : "#f0e4c8"))
        border.width: 2
        antialiasing: true

        gradient: Gradient {
            GradientStop {
                position: 0
                color: cabinet.styleName === "slim-black" ? "#252a26"
                    : (cabinet.styleName === "charcoal" ? "#4a4e48"
                       : (cabinet.styleName === "walnut" ? "#875c3a" : "#e0d4b8"))
            }
            GradientStop {
                position: 1
                color: cabinet.styleName === "slim-black" ? "#0d100e"
                    : (cabinet.styleName === "charcoal" ? "#181b18"
                       : (cabinet.styleName === "walnut" ? "#3b2518" : "#a99d82"))
            }
        }

        Rectangle {
            anchors.fill: parent
            anchors.margins: 3
            radius: Math.max(0, cabinet.radius - 3)
            color: "transparent"
            border.color: cabinet.styleName === "walnut" ? "#55e0b77e"
                : (cabinet.styleName === "cream" ? "#66fff8dc" : "#36ffffff")
            border.width: 1
            antialiasing: true
        }

        Rectangle {
            id: bezelLip

            anchors.centerIn: parent
            width: screen.width + cabinet.lipWidth * 2
            height: screen.height + cabinet.lipWidth * 2
            radius: screen.radius + cabinet.lipWidth
            color: cabinet.lipColor
            border.color: cabinet.styleName === "cream" ? "#877d69" : "#050605"
            border.width: 2
            antialiasing: true
        }

        Rectangle {
            id: screen

            anchors.centerIn: parent
            width: cabinet.width - cabinet.sideInset * 2
            height: width * 3 / 4
            radius: cabinet.styleName === "slim-black" ? Math.max(38, width * 0.065)
                : Math.max(42, width * 0.075)
            color: "#010201"
            clip: true
            antialiasing: true
            layer.enabled: true
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

                anchors.fill: parent
                volume: tvController.volume
                muted: tvController.muted
                aspectMode: tvController.currentAspectMode

                onPausedChanged: {
                    if (!root.introPlaying && !directMediaMode
                            && (status === "Playing" || status === "Paused"))
                        tvController.updatePlaybackPosition(positionSeconds(), paused)
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
                anchors.margins: Math.max(18, screen.width * 0.035)
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
                    text: "MABEL TV"
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

    ParentOverlay {
        id: parentOverlay
        anchors.fill: parent
        z: 200
        controller: tvController
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
        id: parentHoldTimer
        interval: 3500
        onTriggered: {
            root.previousHeldForParent = true
            tvController.requestParentAccess()
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
            player.play(source, startPositionSeconds)
        }
        function onStopPlaybackRequested() {
            player.stop()
        }
        function onChannelDisplayRequested(number, name) {
            root.showChannel(number, name)
            if (tvController.soundEffectsEnabled)
                soundEffects.playTuningNoise()
        }
        function onVolumeDisplayRequested(value, isMuted) {
            root.showVolume(value, isMuted)
        }
        function onStandbyChanged() {
            if (tvController.soundEffectsEnabled && !tvController.standby)
                soundEffects.playPowerClick()
            if (!tvController.standby) {
                root.poweringOff = false
                root.beginWarmup()
                if (directMediaMode)
                    player.play(startupMediaUrl, 0)
                else if (startupIntroUrl.toString().length > 0)
                    root.playWelcome(true)
                else
                    tvController.resumeFromStandby()
            }
        }
        function onRemoteLockedChanged() {
            root.showRemoteLockState()
        }
    }

    Item {
        anchors.fill: parent
        focus: true

        Keys.onPressed: event => {
            if (root.poweringOff) {
                event.accepted = true
            } else if (event.key === Qt.Key_M) {
                if (!event.isAutoRepeat) {
                    root.muteHeldForLock = false
                    muteHoldTimer.restart()
                }
                event.accepted = true
            } else if (tvController.remoteLocked) {
                event.accepted = true
            } else if (parentOverlay.visible && event.key === Qt.Key_B
                    && root.previousHeldForParent) {
                // Swallow the repeat tail of the same Back hold that opened
                // parent access. A fresh Back press still closes the overlay.
                event.accepted = true
            } else if (parentOverlay.visible) {
                event.accepted = parentOverlay.handleKey(event.key, event.modifiers)
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
            } else if (event.key === Qt.Key_B) {
                if (!event.isAutoRepeat) {
                    root.previousHeldForParent = false
                    parentHoldTimer.restart()
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
                if (root.acceptRepeat("channel", event.isAutoRepeat)) {
                    root.syncPlaybackPosition()
                    tvController.dispatch(TvController.ChannelUp)
                }
                event.accepted = true
            } else if (event.key === Qt.Key_Down) {
                if (root.acceptRepeat("channel", event.isAutoRepeat)) {
                    root.syncPlaybackPosition()
                    tvController.dispatch(TvController.ChannelDown)
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
            } else if (event.key === Qt.Key_Right && !event.isAutoRepeat
                       && !directMediaMode) {
                root.syncPlaybackPosition()
                tvController.dispatch(TvController.NextProgramme)
                event.accepted = true
            } else if (event.key === Qt.Key_Left && !event.isAutoRepeat
                       && !directMediaMode) {
                root.syncPlaybackPosition()
                tvController.dispatch(TvController.PreviousProgramme)
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
            if (event.key === Qt.Key_M && !event.isAutoRepeat) {
                if (muteHoldTimer.running) {
                    muteHoldTimer.stop()
                    if (!root.muteHeldForLock && !tvController.remoteLocked)
                        tvController.dispatch(TvController.ToggleMute)
                }
                root.muteHeldForLock = false
                event.accepted = true
            } else if (event.key === Qt.Key_B && !event.isAutoRepeat) {
                if (parentHoldTimer.running) {
                    parentHoldTimer.stop()
                    if (!root.previousHeldForParent && !parentOverlay.visible) {
                        root.syncPlaybackPosition()
                        tvController.dispatch(TvController.PreviousChannel)
                    }
                }
                root.previousHeldForParent = false
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
        if (directMediaMode)
            player.play(startupMediaUrl, 0)
        else if (startupIntroUrl.toString().length > 0) {
            root.playWelcome(false)
        } else {
            root.startTelevision()
        }
    }
}
