pragma ComponentBehavior: Bound

import QtQuick
import MabelTV 1.0
Rectangle {
    id: cabinet

    required property var appRoot
    readonly property var playerObject: player
    readonly property real screenWidth: screen.width
    readonly property real screenHeight: screen.height
    readonly property var channelNumberLabel: channelNumber
    readonly property var channelNameLabel: channelName
    readonly property var channelOsdItem: channelOsd
    readonly property var volumeLabelItem: volumeLabel
    readonly property var volumeLevelItem: volumeLevel
    readonly property var volumeTrackItem: volumeTrack
    readonly property var volumeOsdItem: volumeOsd
    readonly property var programmeNameItem: programmeName
    readonly property var scrubLabelItem: scrubLabel
    readonly property var scrubOsdItem: scrubOsd

    readonly property string styleName: tvController.tvBorderStyle
    readonly property bool isSlim: styleName === "slim-black"
    readonly property bool isSilver: styleName === "silver-90s"
    readonly property bool isCharcoal: styleName === "charcoal-90s"
    readonly property bool isVintage: styleName === "vintage-black"
    readonly property bool widescreen: appRoot.portalWidescreenEnabled
    // Keep Slim Black's original proportions exactly. The three physical
    // sets have a smaller tube so there is room for their real cabinet
    // furniture beneath it.
    readonly property real sideInset: Math.max(54, width * 0.070)
    readonly property real tubeWidth: widescreen ? width * 0.89
        : (isSlim ? width - sideInset * 2
           : (isSilver ? width * 0.790
              : (isCharcoal ? width * 0.770 : width * 0.740)))
    readonly property real tubeHeight: tubeWidth * (widescreen ? 9 / 16 : 3 / 4)
    readonly property real tubeTop: widescreen ? width * 0.030
        : (isSlim ? (height - tubeHeight) / 2
           : (isVintage ? width * 0.052 : width * 0.044))
    readonly property real lipWidth: Math.max(12, width * (
        isSlim ? 0.015 : (isVintage ? 0.020 : 0.017)))
    readonly property color lipColor: isSlim ? "#060807"
        : (isSilver ? "#484a47"
           : (isCharcoal ? "#111311" : "#080908"))
    readonly property real fasciaTop: tubeTop + tubeHeight + lipWidth

    anchors.centerIn: parent
    width: widescreen
        ? Math.min(appRoot.width - 48, (appRoot.height - 48) / 0.64)
        : Math.min(appRoot.width - 48, (appRoot.height - 48) * 4 / 3)
    height: width * (widescreen ? 0.64 : 3 / 4)
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
        height: cabinet.tubeHeight
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
            property real flicker: appRoot.flickerAmount
            property real effectStrength: tvController.crtGlass / 100
            property real distortion: tvController.videoDistortion / 100
            property real phase: appRoot.distortionPhase
            property real pausedEffect: player.paused && !appRoot.introPlaying ? 1 : 0
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

            onSourceChanged: appRoot.widescreenMode = false

            onVideoAspectRatioChanged: {
                if (!appRoot.widescreenContentAvailable)
                    appRoot.widescreenMode = false
            }

            onPausedChanged: {
                if (!appRoot.introPlaying && !directMediaMode
                        && (status === "Playing" || status === "Paused"))
                    tvController.updatePlaybackPosition(positionSeconds(), paused)
            }

            onStatusChanged: {
                if (appRoot.restoreChildPauseAfterAdult && status === "Playing") {
                    appRoot.restoreChildPauseAfterAdult = false
                    togglePause()
                }
            }

            onPlaybackFinished: {
                if (appRoot.introPlaying)
                    appRoot.finishIntro()
                else if (!directMediaMode)
                    tvController.playbackEnded()
            }
            onPlaybackFailed: message => {
                if (appRoot.introPlaying)
                    appRoot.finishIntro()
                else if (!directMediaMode)
                    tvController.playbackFailed(message)
            }
            onPlaybackStopped: {
                if (appRoot.openingAdultMode) {
                    appRoot.openingAdultMode = false
                    tvController.closeParent()
                    if (appRoot.pendingPowerAction.length > 0) {
                        appRoot.pendingPowerAction = ""
                        appRoot.performPowerOff()
                    } else {
                        if (appRoot.pendingExternalSource.toString().length > 0) {
                            const source = appRoot.pendingExternalSource
                            const title = appRoot.pendingExternalTitle
                            appRoot.pendingExternalSource = ""
                            appRoot.pendingExternalTitle = ""
                            adultMode.openExternal(source, title)
                        } else {
                            adultMode.open()
                            if (appRoot.pendingAdultLibraryPath.length > 0) {
                                const file = appRoot.pendingAdultLibraryPath
                                const position = appRoot.pendingAdultLibraryPosition
                                appRoot.pendingAdultLibraryPath = ""
                                appRoot.pendingAdultLibraryPosition = 0
                                adultMode.requestLibraryFilm(file, position)
                            }
                        }
                    }
                }
            }
        }

        Rectangle {
            id: filmCountdownOverlay
            anchors.fill: parent
            visible: appRoot.filmCountdownActive
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
                    rotation: appRoot.filmCountdownSpin
                }

                Text {
                    anchors.centerIn: parent
                    color: "#eeeede"
                    text: appRoot.filmCountdownValue
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
                opacity: 0.025 * appRoot.filmCountdownFlicker
            }
        }

        Item {
            id: staticNoise

            anchors.fill: parent
            visible: appRoot.showStatic

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
            visible: appRoot.showStatic && tvController.noSignal && !tvController.tuning
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
            anchors.leftMargin: appRoot.playbackOsdInsetX
            anchors.topMargin: appRoot.playbackOsdInsetY
            z: 70
            visible: player.paused && !appRoot.introPlaying && !appRoot.poweringOff
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
            anchors.rightMargin: appRoot.playbackOsdInsetX
            anchors.topMargin: appRoot.playbackOsdInsetY
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
            visible: appRoot.poweringOff

            readonly property real closing: Math.min(1, appRoot.powerOffProgress / 0.72)
            readonly property real lineCollapse: Math.max(
                0, 1 - Math.max(0, appRoot.powerOffProgress - 0.70) / 0.25)

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
                visible: appRoot.powerOffProgress > 0.54
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
            visible: appRoot.warmingUp

            Rectangle {
                anchors.fill: parent
                color: "black"
                opacity: 1 - Math.pow(appRoot.warmProgress, 1.7)
            }

            Rectangle {
                anchors.centerIn: parent
                width: parent.width * (0.16 + appRoot.warmProgress * 0.84)
                height: Math.max(2, parent.height * Math.pow(appRoot.warmProgress, 3.7))
                radius: height / 2
                color: "#e8f1df"
                opacity: (1 - appRoot.warmProgress) * 0.8
            }
        }
    }
}
