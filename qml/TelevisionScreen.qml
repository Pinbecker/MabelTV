pragma ComponentBehavior: Bound

import QtQuick
import MabelTV 1.0
Item {
    id: televisionCabinet

    required property var appRoot
    readonly property var playerObject: player
    readonly property var screenSurface: screen
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
    readonly property bool isDinosaur: styleName === "dinosaur-den"
    readonly property bool isOcean: styleName === "ocean-club"
    readonly property bool isNemo: styleName === "finding-nemo"
    readonly property bool usesDecorativeSurround: isDinosaur || isOcean || isNemo
    readonly property bool usesCharcoalGeometry: isCharcoal || usesDecorativeSurround
    readonly property bool fullscreen: appRoot.portalFullScreenEnabled
    readonly property bool widescreen: appRoot.portalWidescreenEnabled
    // Keep Slim Black's original proportions exactly. The three physical
    // sets have a smaller tube so there is room for their real cabinet
    // furniture beneath it.
    readonly property real sideInset: Math.max(54, width * 0.070)
    readonly property real tubeWidth: widescreen ? width * 0.89
        : (isSlim ? width - sideInset * 2
           : (isSilver ? width * 0.790
              : (usesCharcoalGeometry ? width * 0.770 : width * 0.740)))
    readonly property real tubeHeight: tubeWidth * (widescreen ? 9 / 16 : 3 / 4)
    readonly property real tubeTop: widescreen ? width * 0.030
        : (isSlim ? (height - tubeHeight) / 2
           : (isVintage ? width * 0.052 : width * 0.044))
    readonly property real lipWidth: Math.max(12, width * (
        isSlim ? 0.015 : (isVintage ? 0.020 : 0.017)))
    readonly property color lipColor: isSlim ? "#060807"
        : (isSilver ? "#484a47"
           : (usesCharcoalGeometry ? "#111311" : "#080908"))
    readonly property real fasciaTop: tubeTop + tubeHeight + lipWidth

    anchors.centerIn: parent
    width: fullscreen ? appRoot.width : widescreen
        ? Math.min(appRoot.width - 48, (appRoot.height - 48) / 0.64)
        : Math.min(appRoot.width - 48, (appRoot.height - 48) * 4 / 3)
    height: fullscreen ? appRoot.height : width * (widescreen ? 0.64 : 3 / 4)
    readonly property real radius: isSlim ? Math.max(38, width * 0.055)
        : Math.max(44, width * 0.067)
    CrtCabinet { anchors.fill: parent; cabinet: televisionCabinet; tube: screen }

    CrtGrain { id: crtGrain }

    Rectangle {
        id: screen

        x: (televisionCabinet.width - width) / 2
        y: televisionCabinet.fullscreen ? 0 : televisionCabinet.tubeTop
        width: televisionCabinet.fullscreen ? televisionCabinet.width : televisionCabinet.tubeWidth
        height: televisionCabinet.fullscreen ? televisionCabinet.height : televisionCabinet.tubeHeight
        radius: televisionCabinet.fullscreen ? 0 : televisionCabinet.isSlim ? Math.max(38, width * 0.065)
            : Math.max(42, width * 0.075)
        color: usesCrtLayer ? "transparent" : "#010201"
        clip: true
        antialiasing: true
        // Preserve the original curved tube, clipping and composition. Bypass
        // the effect only when both CRT controls are off and playback runs.
        readonly property bool usesCrtLayer: !televisionCabinet.fullscreen && (tvController.crtGlass > 0
                       || tvController.videoDistortion > 0 || player.paused)
        readonly property real sourceTextureScale: usesCrtLayer && typeof player.videoWidth === "number"
            && player.videoWidth > 0 && player.videoHeight > 0
            ? Math.min(1, Math.max(player.videoWidth / width, player.videoHeight / height)) : 1
        CrtForegroundSource {
            id: foregroundTexture
            sourceItem: screenForeground
            smooth: true
            hideSource: screen.usesCrtLayer
            animating: appRoot.showStatic || appRoot.warmingUp || appRoot.poweringOff
                || appRoot.filmCountdownActive || firstRunSetupRequired
                || channelOsd.opacity > 0 || volumeOsd.opacity > 0
                || programmeName.opacity > 0 || scrubOsd.opacity > 0
                || tvController.numericEntry.length > 0
            revision: [screen.width, screen.height, tvController.crtGlass,
                televisionCabinet.fullscreen, tvController.standby,
                tvController.currentChannelNumber, player.status, player.paused].join(':')
            visible: false
        }

        MpvVideo {
            id: player
            textureOnly: screen.usesCrtLayer
            objectName: "mabeltvPlayer"

            width: screen.width * screen.sourceTextureScale
            height: screen.height * screen.sourceTextureScale
            transform: Scale { xScale: 1 / screen.sourceTextureScale; yScale: 1 / screen.sourceTextureScale }
            // A hidden my_tv overlay used to leave this framebuffer player
            // rendering underneath the my_tv framebuffer player. On the Pi
            // that can block Qt's render thread inside libmpv, freezing all
            // remote input during an MyTv Mode transition.
            visible: !myTvMode.active
            volume: tvController.volume
            muted: tvController.muted
            aspectMode: televisionCabinet.fullscreen ? "fit" : tvController.currentAspectMode

            onPausedChanged: {
                if (!appRoot.introPlaying && !directMediaMode
                        && (status === "Playing" || status === "Paused"))
                    tvController.updatePlaybackPosition(positionSeconds(), paused)
            }

            onStatusChanged: {
                if (status === "Playing" && !appRoot.introPlaying && !directMediaMode)
                    tvController.queuePlaybackStarted(source)
                if (appRoot.restoreChildPauseAfterMyTv && status === "Playing") {
                    appRoot.restoreChildPauseAfterMyTv = false
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
                if (appRoot.openingMyTvMode) {
                    appRoot.openingMyTvMode = false
                    tvController.closeParent()
                    if (appRoot.pendingPowerAction.length > 0) {
                        appRoot.pendingPowerAction = ""
                        appRoot.performPowerOff()
                    } else {
                        if (appRoot.pendingExternalSource.toString().length > 0) {
                            const source = appRoot.pendingExternalSource
                            const title = appRoot.pendingExternalTitle
                            const position = appRoot.pendingExternalPosition
                            appRoot.pendingExternalSource = ""
                            appRoot.pendingExternalTitle = ""
                            appRoot.pendingExternalPosition = 0
                            myTvMode.openExternal(source, title, position)
                        } else {
                            myTvMode.open()
                            if (appRoot.pendingMyTvLibraryPath.length > 0) {
                                const file = appRoot.pendingMyTvLibraryPath
                                const position = appRoot.pendingMyTvLibraryPosition
                                appRoot.pendingMyTvLibraryPath = ""
                                appRoot.pendingMyTvLibraryPosition = 0
                                myTvMode.requestLibraryFilm(file, position)
                            }
                        }
                    }
                }
            }
        }

        ShaderEffect {
            anchors.fill: parent
            visible: screen.usesCrtLayer && !myTvMode.active
            property variant source: player
            property variant foreground: foregroundTexture
            property variant grainTexture: crtGrain.texture
            property real flicker: appRoot.flickerAmount
            property real effectStrength: tvController.crtGlass / 100
            property real glassCurve: Math.pow(effectStrength, 1.25)
            property real maskExponent: 7 - 3 * Math.pow(effectStrength, 0.8)
            property real distortion: tvController.videoDistortion / 100
            property real phase: appRoot.distortionPhase
            property real pausedEffect: player.paused && !appRoot.introPlaying ? 1 : 0
            property real cornerRadius: screen.radius
            property real maskSoftness: 1.65
            property vector2d resolution: Qt.vector2d(screen.width, screen.height)
            mesh: GridMesh { resolution: Qt.size(64, 36) }
            vertexShader: "qrc:/shaders/crt.vert.qsb"
            fragmentShader: tvController.videoDistortion <= 30 && !player.paused
                ? "qrc:/shaders/crt-fast.frag.qsb" : "qrc:/shaders/crt.frag.qsb"
        }
        Item {
            id: screenForeground
            anchors.fill: parent
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
            font.pixelSize: Math.max(24, televisionCabinet.height * 0.055)
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

        CrtReflection {
            anchors.fill: parent
            visible: !televisionCabinet.fullscreen && tvController.crtGlass > 0
            glass: tvController.crtGlass / 100
        }

        Text {
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.leftMargin: appRoot.playbackOsdInsetX
            anchors.topMargin: appRoot.playbackOsdInsetY
            z: 70
            visible: player.paused && !appRoot.introPlaying && !appRoot.poweringOff && !televisionCabinet.fullscreen
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
            property bool belowChannel: false

            anchors.right: parent.right
            anchors.top: parent.top
            anchors.rightMargin: appRoot.playbackOsdInsetX
            anchors.topMargin: belowChannel
                ? channelOsd.y + channelOsd.height + 12 : appRoot.playbackOsdInsetY
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
            anchors.topMargin: appRoot.playbackOsdInsetY
            anchors.rightMargin: appRoot.playbackOsdInsetX
            width: Math.min(screen.width - appRoot.playbackOsdInsetX * 2,
                Math.max(230, channelNumber.implicitWidth + channelName.implicitWidth + 48))
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
        } // screen foreground
    }

    Loader {
        anchors.fill: parent
        active: televisionCabinet.isDinosaur && !televisionCabinet.fullscreen
        visible: active
        z: 10

        sourceComponent: Component {
            DinosaurDenSurround {
                appRoot: televisionCabinet.appRoot
            }
        }
    }

    Loader {
        anchors.fill: parent
        active: (televisionCabinet.isOcean || televisionCabinet.isNemo) && !televisionCabinet.fullscreen
        visible: active
        z: 10

        sourceComponent: televisionCabinet.isNemo ? nemoSurround : oceanSurround
        Component {
            id: nemoSurround
            FindingNemo { appRoot: televisionCabinet.appRoot }
        }
        Component {
            id: oceanSurround
            OceanClubSurround { appRoot: televisionCabinet.appRoot }
        }
    }
}
