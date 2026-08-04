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
    property bool previousHeldForParent: false
    property bool powerHeldForShutdown: false
    property bool introPlaying: false
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
        startTelevision()
    }

    function beginWarmup() {
        warmingUp = true
        warmProgress = 0
        warmupAnimation.restart()
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

        anchors.centerIn: parent
        width: Math.min(root.width - 48, (root.height - 48) * 4 / 3)
        height: width * 3 / 4
        radius: Math.max(24, width * 0.035)
        color: "#151a16"
        border.color: "#293029"
        border.width: 2

        Rectangle {
            id: screen

            anchors.fill: parent
            anchors.margins: Math.max(12, cabinet.width * 0.016)
            radius: Math.max(18, cabinet.radius - anchors.margins)
            color: "#010201"
            clip: true
            layer.enabled: true
            layer.smooth: true
            layer.effect: ShaderEffect {
                property variant source
                property real flicker: root.flickerAmount
                property real effectStrength: tvController.crtEffectLevel === "off" ? 0
                    : (tvController.crtEffectLevel === "high" ? 1.65 : 1)
                property vector2d resolution: Qt.vector2d(screen.width, screen.height)
                fragmentShader: "qrc:/shaders/crt.frag.qsb"
            }

            MpvVideo {
                id: player

                anchors.fill: parent
                volume: tvController.volume
                muted: tvController.muted
                aspectMode: tvController.currentAspectMode

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

            Canvas {
                id: staticNoise

                anchors.fill: parent
                visible: !directMediaMode && (tvController.tuning || tvController.noSignal)
                onPaint: {
                    const context = getContext("2d")
                    const block = Math.max(3, width / 180)
                    context.fillStyle = "#111411"
                    context.fillRect(0, 0, width, height)
                    for (let y = 0; y < height; y += block) {
                        for (let x = 0; x < width; x += block) {
                            const value = Math.floor(25 + Math.random() * 145)
                            context.fillStyle = "rgb(" + value + "," + value + "," + value + ")"
                            context.fillRect(x, y, block + 1, block + 1)
                        }
                    }
                }
            }

            Timer {
                interval: 55
                repeat: true
                running: staticNoise.visible
                onTriggered: staticNoise.requestPaint()
            }

            Text {
                anchors.centerIn: parent
                visible: !directMediaMode && tvController.noSignal && !tvController.tuning
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
                border.color: "#30000000"
                border.width: 9

                gradient: Gradient {
                    GradientStop { position: 0.0; color: "#18ffffff" }
                    GradientStop { position: 0.17; color: "#05000000" }
                    GradientStop { position: 0.78; color: "#09000000" }
                    GradientStop { position: 1.0; color: "#1d000000" }
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
            tvController.requestSafeShutdown()
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
            if (tvController.soundEffectsEnabled)
                soundEffects.playPowerClick()
            if (!tvController.standby)
                root.beginWarmup()
        }
    }

    Item {
        anchors.fill: parent
        focus: true

        Keys.onPressed: event => {
            if (parentOverlay.visible) {
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
            } else if (event.key === Qt.Key_Up || event.key === Qt.Key_PageUp) {
                if (root.acceptRepeat("channel", event.isAutoRepeat))
                    tvController.dispatch(TvController.ChannelUp)
                event.accepted = true
            } else if (event.key === Qt.Key_Down || event.key === Qt.Key_PageDown) {
                if (root.acceptRepeat("channel", event.isAutoRepeat))
                    tvController.dispatch(TvController.ChannelDown)
                event.accepted = true
            } else if (event.key === Qt.Key_Right || event.key === Qt.Key_Plus
                       || event.key === Qt.Key_Equal) {
                if (root.acceptRepeat("volume", event.isAutoRepeat))
                    tvController.dispatch(TvController.VolumeUp)
                event.accepted = true
            } else if (event.key === Qt.Key_Left || event.key === Qt.Key_Minus) {
                if (root.acceptRepeat("volume", event.isAutoRepeat))
                    tvController.dispatch(TvController.VolumeDown)
                event.accepted = true
            } else if (event.key === Qt.Key_M && !event.isAutoRepeat) {
                tvController.dispatch(TvController.ToggleMute)
                event.accepted = true
            } else if (event.key === Qt.Key_R && !event.isAutoRepeat && !directMediaMode) {
                tvController.dispatch(TvController.RandomEpisode)
                event.accepted = true
            } else if (event.key === Qt.Key_Space && directMediaMode) {
                player.togglePause()
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
            if (event.key === Qt.Key_B && !event.isAutoRepeat) {
                if (parentHoldTimer.running) {
                    parentHoldTimer.stop()
                    if (!root.previousHeldForParent && !parentOverlay.visible)
                        tvController.dispatch(TvController.PreviousChannel)
                }
                root.previousHeldForParent = false
                event.accepted = true
            } else if (event.key === Qt.Key_P && !event.isAutoRepeat) {
                if (powerHoldTimer.running) {
                    powerHoldTimer.stop()
                    if (!root.powerHeldForShutdown)
                        tvController.dispatch(TvController.ToggleStandby)
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
            root.introPlaying = true
            player.play(startupIntroUrl, 0)
        } else {
            root.startTelevision()
        }
    }
}
