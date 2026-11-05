import QtQuick
Item {
    id: root
    required property var cabinet
    required property var tube
    property bool cacheEnabled: true
    // The artwork changes only with the cabinet settings or geometry. Keep its
    // original vectors, but avoid repainting every gradient for each video frame.
    layer.enabled: cacheEnabled
    layer.smooth: true
    Item {
        id: cabinetArtwork
        anchors.fill: parent
        Rectangle {
            anchors.fill: parent
            radius: cabinet.radius
    color: cabinet.fullscreen || cabinet.usesDecorativeSurround ? "transparent" : "#151a16"
    border.color: cabinet.fullscreen || cabinet.usesDecorativeSurround ? "transparent" : (cabinet.isSlim ? "#454c46"
        : (cabinet.isSilver ? "#f5f3eb"
           : (cabinet.isCharcoal ? "#555a55" : "#333632")))
    border.width: cabinet.fullscreen ? 0 : 2
    antialiasing: true

    gradient: Gradient {
        GradientStop {
            position: 0
            color: cabinet.fullscreen || cabinet.usesDecorativeSurround ? "transparent" : (cabinet.isSlim ? "#252a26"
                : (cabinet.isSilver ? "#deded7"
                   : (cabinet.isCharcoal ? "#3f433f" : "#2d302d")))
        }
        GradientStop {
            position: 1
            color: cabinet.fullscreen || cabinet.usesDecorativeSurround ? "transparent" : (cabinet.isSlim ? "#0d100e"
                : (cabinet.isSilver ? "#979992"
                   : (cabinet.isCharcoal ? "#171a18" : "#101210")))
        }
    }
        }

    Rectangle {
        anchors.fill: parent
        anchors.margins: 3
        visible: !cabinet.usesDecorativeSurround && !cabinet.fullscreen
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

        visible: cabinet.isSilver && !cabinet.fullscreen
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

        visible: cabinet.isCharcoal && !cabinet.fullscreen
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

        visible: cabinet.isVintage && !cabinet.fullscreen
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
        visible: cabinet.isVintage && !cabinet.fullscreen
        x: cabinet.width * 0.16
        y: cabinet.height - height * 0.35
        width: cabinet.width * 0.10
        height: cabinet.width * 0.022
        radius: height / 2
        color: "#080a08"
    }

    Rectangle {
        visible: cabinet.isVintage && !cabinet.fullscreen
        x: cabinet.width * 0.74
        y: cabinet.height - height * 0.35
        width: cabinet.width * 0.10
        height: cabinet.width * 0.022
        radius: height / 2
        color: "#080a08"
    }

    Rectangle {
        id: bezelLip

        visible: !cabinet.usesDecorativeSurround && !cabinet.fullscreen
        x: tube.x - cabinet.lipWidth
        y: tube.y - cabinet.lipWidth
        width: tube.width + cabinet.lipWidth * 2
        height: tube.height + cabinet.lipWidth * 2
        radius: tube.radius + cabinet.lipWidth
        color: cabinet.lipColor
        border.color: cabinet.isSilver ? "#757872" : "#050605"
        border.width: 2
        antialiasing: true
    }

    }

}
