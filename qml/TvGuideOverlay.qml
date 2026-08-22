pragma ComponentBehavior: Bound

import QtQuick

Item {
    id: guide

    required property var controller
    property var rows: []
    property int selectedRow: 0
    property string clockText: ""
    readonly property bool classicStyle: controller.parentOverlayStyle === "classic"

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
        visible: !guide.classicStyle
        color: "#09110e"
        opacity: 0.42
    }

    Rectangle {
        id: guidePanel
        visible: !guide.classicStyle
        anchors.centerIn: parent
        width: Math.min(parent.width - 72, 1520)
        height: Math.min(parent.height - 58, 790)
        radius: 24
        color: "#f3efe7"
        border.color: "#d7dcd6"
        border.width: 1
    }

    Rectangle {
        visible: !guide.classicStyle
        anchors.left: guidePanel.left
        anchors.right: guidePanel.right
        anchors.top: guidePanel.top
        height: 96
        radius: guidePanel.radius
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
        visible: !guide.classicStyle
        anchors.left: guidePanel.left
        anchors.right: guidePanel.right
        anchors.top: guidePanel.top
        anchors.bottom: guidePanel.bottom
        anchors.topMargin: 96
        anchors.bottomMargin: 54

        Rectangle {
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            width: 200
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
            anchors.leftMargin: 224
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
                        anchors.rightMargin: -188
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
                        anchors.leftMargin: 200
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
                                            ? "NOW"
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
        visible: !guide.classicStyle
        anchors.left: guidePanel.left
        anchors.right: guidePanel.right
        anchors.bottom: guidePanel.bottom
        height: 54
        radius: guidePanel.radius
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

    Item {
        id: classicGuide
        anchors.fill: parent
        visible: guide.classicStyle

        Rectangle {
            anchors.fill: parent
            color: "#071007"
            opacity: 0.56
        }

        Rectangle {
            id: classicGuidePanel
            anchors.centerIn: parent
            width: Math.min(parent.width * 0.82, 1060)
            height: Math.min(parent.height * 0.86, 640)
            color: "#f20b130d"
            border.color: "#6f9971"
            border.width: 2

            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                height: 78
                color: "#d50b130d"
                border.color: "#658066"
                border.width: 1

                Text {
                    anchors.left: parent.left
                    anchors.leftMargin: 24
                    anchors.verticalCenter: parent.verticalCenter
                    color: "#dce9cd"
                    font.family: "Consolas"
                    font.bold: true
                    font.pixelSize: 23
                    text: "[ TV GUIDE ]"
                }

                Text {
                    anchors.right: parent.right
                    anchors.rightMargin: 24
                    anchors.verticalCenter: parent.verticalCenter
                    color: "#a6d49d"
                    font.family: "Consolas"
                    font.pixelSize: 16
                    text: guide.clockText
                }
            }

            Text {
                anchors.left: parent.left
                anchors.leftMargin: 24
                anchors.top: parent.top
                anchors.topMargin: 95
                color: "#8dbf88"
                font.family: "Consolas"
                font.bold: true
                font.pixelSize: 14
                text: "CHANNEL                 NOW / NEXT"
            }

            ListView {
                id: classicScheduleRows
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.bottom: classicGuideFooter.top
                anchors.leftMargin: 18
                anchors.rightMargin: 18
                anchors.topMargin: 124
                anchors.bottomMargin: 12
                clip: true
                spacing: 6
                model: guide.rows
                currentIndex: guide.selectedRow
                boundsBehavior: Flickable.StopAtBounds
                interactive: false

                onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

                delegate: Item {
                    id: classicChannelRow
                    required property var modelData
                    required property int index
                    width: classicScheduleRows.width
                    height: 76

                    Rectangle {
                        anchors.fill: parent
                        color: classicChannelRow.index === guide.selectedRow
                               ? "#3d683b" : "#0b130d"
                        opacity: classicChannelRow.index === guide.selectedRow ? 0.82 : 0.7
                        border.color: classicChannelRow.index === guide.selectedRow
                                      ? "#c4e8b9" : "#466c49"
                        border.width: classicChannelRow.index === guide.selectedRow ? 2 : 1
                    }

                    Text {
                        anchors.left: parent.left
                        anchors.leftMargin: 15
                        anchors.verticalCenter: parent.verticalCenter
                        width: 172
                        elide: Text.ElideRight
                        color: classicChannelRow.modelData.current ? "#e1f1cf" : "#b1d7aa"
                        font.family: "Consolas"
                        font.bold: true
                        font.pixelSize: 16
                        text: "CH " + classicChannelRow.modelData.number + "  "
                              + classicChannelRow.modelData.name
                    }

                    Row {
                        id: classicProgrammeSlots
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.leftMargin: 196
                        anchors.rightMargin: 12
                        anchors.verticalCenter: parent.verticalCenter
                        height: 54
                        spacing: 8

                        Repeater {
                            model: classicChannelRow.modelData.programmes

                            Rectangle {
                                id: classicProgrammeCard
                                required property var modelData
                                required property int index
                                width: (classicProgrammeSlots.width
                                        - classicProgrammeSlots.spacing * 3) / 4
                                height: classicProgrammeSlots.height
                                color: classicProgrammeCard.index === 0 ? "#315a34" : "#142716"
                                border.color: classicProgrammeCard.index === 0 ? "#b5ddb0" : "#547b56"
                                border.width: 1

                                Text {
                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.top: parent.top
                                    anchors.margins: 7
                                    color: classicProgrammeCard.index === 0 ? "#dff3d3" : "#9ac194"
                                    elide: Text.ElideRight
                                    font.family: "Consolas"
                                    font.bold: true
                                    font.pixelSize: 12
                                    text: classicProgrammeCard.index === 0 ? "NOW"
                                                                          : classicProgrammeCard.modelData.start
                                }

                                Text {
                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.bottom: parent.bottom
                                    anchors.margins: 7
                                    color: "#d0e6c6"
                                    elide: Text.ElideRight
                                    font.family: "Consolas"
                                    font.pixelSize: 12
                                    text: classicProgrammeCard.modelData.name
                                }
                            }
                        }
                    }
                }
            }

            Text {
                visible: guide.rows.length === 0
                anchors.centerIn: parent
                color: "#a6d49d"
                font.family: "Consolas"
                font.pixelSize: 19
                text: "NO CHANNELS AVAILABLE"
            }

            Rectangle {
                id: classicGuideFooter
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                height: 48
                color: "#d50b130d"
                border.color: "#658066"
                border.width: 1

                Text {
                    anchors.centerIn: parent
                    color: "#a6d49d"
                    font.family: "Consolas"
                    font.bold: true
                    font.pixelSize: 14
                    text: "↑ ↓ SELECT CHANNEL     OK WATCH     BACK CLOSE"
                }
            }
        }
    }
}
