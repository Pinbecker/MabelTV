pragma ComponentBehavior: Bound

import QtQuick

Item {
    id: guide

    required property var controller
    property var rows: []
    property int selectedRow: 0
    property string clockText: ""

    visible: false

    function refresh() {
        rows = controller.guideSchedule()
        selectedRow = rows.length === 0
                ? 0 : Math.max(0, Math.min(selectedRow, rows.length - 1))
        clockText = Qt.formatDateTime(new Date(), "ddd d MMM  HH:mm")
    }

    function open() {
        if (!controller.tvGuideEnabled)
            return
        refresh()
        const current = rows.findIndex(row => row.current)
        selectedRow = current >= 0 ? current : 0
        visible = true
    }

    function close() {
        visible = false
    }

    function handleKey(key) {
        if (!visible)
            return false
        if (key === Qt.Key_Up || key === Qt.Key_PageUp) {
            if (rows.length > 0)
                selectedRow = (selectedRow + rows.length - 1) % rows.length
        } else if (key === Qt.Key_Down || key === Qt.Key_PageDown) {
            if (rows.length > 0)
                selectedRow = (selectedRow + 1) % rows.length
        } else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
            if (rows.length > 0) {
                controller.tuneGuideChannel(rows[selectedRow].number)
                close()
            }
        } else if (key === Qt.Key_B || key === Qt.Key_Backspace
                   || key === Qt.Key_Escape) {
            close()
        } else {
            return false
        }
        return true
    }

    onVisibleChanged: if (visible) refresh()

    Connections {
        target: guide.controller
        function onTvGuideEnabledChanged() {
            if (!guide.controller.tvGuideEnabled)
                guide.close()
        }
    }

    Timer {
        interval: 15000
        repeat: true
        running: guide.visible
        triggeredOnStart: false
        onTriggered: guide.refresh()
    }

    Rectangle {
        anchors.fill: parent
        color: "#f3efe7"
        opacity: 0.99
    }

    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: 118
        color: "#151b19"

        Row {
            anchors.left: parent.left
            anchors.leftMargin: 34
            anchors.verticalCenter: parent.verticalCenter
            spacing: 17

            Rectangle {
                width: 50
                height: 40
                radius: 9
                color: "transparent"
                border.color: "#ffffff"
                border.width: 2

                Row {
                    anchors.centerIn: parent
                    spacing: 7
                    Repeater {
                        model: 2
                        Rectangle {
                            width: 5
                            height: 16
                            radius: 3
                            color: "#ed6a4d"
                        }
                    }
                }
            }

            Column {
                anchors.verticalCenter: parent.verticalCenter
                spacing: 1
                Text {
                    color: "#ffffff"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 29
                    text: "What's on"
                }
                Text {
                    color: "#aeb8b4"
                    font.family: "DejaVu Sans"
                    font.pixelSize: 15
                    text: "MabelTV programme guide"
                }
            }
        }

        Rectangle {
            anchors.right: parent.right
            anchors.rightMargin: 34
            anchors.verticalCenter: parent.verticalCenter
            width: guideClock.implicitWidth + 34
            height: 46
            radius: 23
            color: "#26302d"

            Text {
                id: guideClock
                anchors.centerIn: parent
                color: "#ffffff"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 17
                text: guide.clockText
            }
        }
    }

    Item {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        anchors.topMargin: 118
        anchors.bottomMargin: 62

        Rectangle {
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            width: 220
            color: "#e9e8e2"

            Text {
                anchors.left: parent.left
                anchors.leftMargin: 32
                anchors.top: parent.top
                anchors.topMargin: 22
                color: "#69716d"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 13
                text: "CHANNEL"
            }
        }

        Text {
            anchors.left: parent.left
            anchors.leftMargin: 244
            anchors.top: parent.top
            anchors.topMargin: 22
            color: "#69716d"
            font.family: "DejaVu Sans"
            font.bold: true
            font.pixelSize: 13
            text: "NOW AND NEXT"
        }

        ListView {
            id: scheduleRows
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            anchors.topMargin: 54
            clip: true
            spacing: 7
            model: guide.rows
            currentIndex: guide.selectedRow
            boundsBehavior: Flickable.StopAtBounds
            interactive: false

            onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

            delegate: Item {
                id: channelRow
                required property var modelData
                required property int index
                width: scheduleRows.width
                height: 92

                    Rectangle {
                        anchors.fill: parent
                        color: channelRow.index === guide.selectedRow ? "#fff0eb" : "transparent"
                        border.color: channelRow.index === guide.selectedRow ? "#ed6a4d" : "transparent"
                        border.width: 2
                    }

                    Rectangle {
                        anchors.left: parent.left
                        anchors.leftMargin: 22
                        anchors.verticalCenter: parent.verticalCenter
                        width: 54
                        height: 42
                        radius: 10
                        color: channelRow.modelData.current ? "#ed6a4d" : "#151b19"

                        Text {
                            anchors.centerIn: parent
                            color: "#ffffff"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 15
                            text: channelRow.modelData.number
                        }
                    }

                    Column {
                        anchors.left: parent.left
                        anchors.leftMargin: 88
                        anchors.right: parent.left
                        anchors.rightMargin: -208
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 2
                        Text {
                            width: parent.width
                            elide: Text.ElideRight
                            color: "#18201d"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 17
                            text: channelRow.modelData.name
                        }
                        Text {
                            color: channelRow.modelData.current ? "#ce4f34" : "#69716d"
                            font.family: "DejaVu Sans"
                            font.pixelSize: 12
                            text: channelRow.modelData.current
                                ? "YOU'RE WATCHING" : "CHANNEL " + channelRow.modelData.number
                        }
                    }

                    Row {
                        id: programmeSlots
                        anchors.left: parent.left
                        anchors.leftMargin: 220
                        anchors.right: parent.right
                        anchors.rightMargin: 24
                        anchors.top: parent.top
                        anchors.bottom: parent.bottom
                        anchors.topMargin: 8
                        anchors.bottomMargin: 8
                        spacing: 8

                        Repeater {
                            model: channelRow.modelData.programmes

                            Rectangle {
                                id: programmeCard
                                required property var modelData
                                required property int index
                                width: (programmeSlots.width - programmeSlots.spacing * 3) / 4
                                height: programmeSlots.height
                                radius: 10
                                color: programmeCard.index === 0 ? "#ffffff" : "#f8f8f5"
                                border.color: programmeCard.index === 0 ? "#cfd5d0" : "#e1e4df"

                                Column {
                                    anchors.fill: parent
                                    anchors.margins: 11
                                    spacing: 3
                                    Text {
                                        color: programmeCard.index === 0 ? "#ce4f34" : "#69716d"
                                        font.family: "DejaVu Sans"
                                        font.bold: true
                                        font.pixelSize: 11
                                        text: programmeCard.index === 0
                                            ? "NOW  ·  " + programmeCard.modelData.end
                                            : programmeCard.modelData.start
                                    }
                                    Text {
                                        width: parent.width
                                        elide: Text.ElideRight
                                        color: "#18201d"
                                        font.family: "DejaVu Sans"
                                        font.bold: programmeCard.index === 0
                                        font.pixelSize: 14
                                        text: programmeCard.modelData.name
                                    }
                                }

                                Rectangle {
                                    visible: programmeCard.index === 0
                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.bottom: parent.bottom
                                    anchors.leftMargin: 11
                                    anchors.rightMargin: 11
                                    anchors.bottomMargin: 7
                                    height: 3
                                    radius: 2
                                    color: "#e2e5e1"
                                    Rectangle {
                                        width: parent.width * programmeCard.modelData.progress
                                        height: parent.height
                                        radius: parent.radius
                                        color: "#ed6a4d"
                                    }
                                }
                            }
                        }
                    }
            }
        }

        Text {
            visible: guide.rows.length === 0
            anchors.centerIn: parent
            color: "#69716d"
            font.family: "DejaVu Sans"
            font.pixelSize: 21
            text: "There aren't any channels to show yet"
        }
    }

    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: 62
        color: "#ffffff"
        border.color: "#dfe3de"

        Text {
            anchors.centerIn: parent
            color: "#69716d"
            font.family: "DejaVu Sans"
            font.pixelSize: 15
            text: "↑ ↓ choose a channel     ·     OK watch     ·     Back close"
        }
    }
}
