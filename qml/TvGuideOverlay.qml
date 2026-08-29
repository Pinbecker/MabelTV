pragma ComponentBehavior: Bound

import QtQuick

Item {
    id: guide

    required property var controller
    property var rows: []
    property int selectedRow: 0
    property int selectedProgramme: 0
    property int windowStartMinutes: 0
    property int nowMinutes: 0
    property string clockText: ""
    property string dateText: ""
    readonly property real uiScale: Math.max(0.66, Math.min(width / 1920, height / 1080))
    readonly property int scheduleMinutes: 120

    visible: false

    function minutesForTime(value) {
        const pieces = String(value).split(":")
        if (pieces.length !== 2)
            return 0
        return Number(pieces[0]) * 60 + Number(pieces[1])
    }

    function displayTime(minutes) {
        const wrapped = ((minutes % 1440) + 1440) % 1440
        const hours = Math.floor(wrapped / 60)
        const mins = wrapped % 60
        return String(hours).padStart(2, "0") + ":" + String(mins).padStart(2, "0")
    }

    function programmeOffset(start) {
        let value = minutesForTime(start)
        while (value < windowStartMinutes - 720)
            value += 1440
        while (value > windowStartMinutes + 720)
            value -= 1440
        return value - windowStartMinutes
    }

    function programmeDuration(start, end) {
        let duration = minutesForTime(end) - minutesForTime(start)
        if (duration <= 0)
            duration += 1440
        return Math.max(1, duration)
    }

    function selectedChannelData() {
        if (rows.length === 0 || selectedRow < 0 || selectedRow >= rows.length)
            return null
        return rows[selectedRow]
    }

    function selectedProgrammeData() {
        const channel = selectedChannelData()
        if (!channel || !channel.programmes || channel.programmes.length === 0)
            return null
        const index = Math.max(0, Math.min(selectedProgramme,
                                           channel.programmes.length - 1))
        return channel.programmes[index]
    }

    function nowProgrammeIndex(channel) {
        if (!channel || !channel.programmes)
            return 0
        const index = channel.programmes.findIndex(programme => programme.now)
        return index >= 0 ? index : 0
    }

    function clampSelection() {
        selectedRow = rows.length === 0
                ? 0 : Math.max(0, Math.min(selectedRow, rows.length - 1))
        const channel = selectedChannelData()
        const count = channel && channel.programmes ? channel.programmes.length : 0
        selectedProgramme = count === 0
                ? 0 : Math.max(0, Math.min(selectedProgramme, count - 1))
    }

    function refresh() {
        rows = controller.guideSchedule()
        const now = new Date()
        nowMinutes = now.getHours() * 60 + now.getMinutes()
        windowStartMinutes = Math.floor(nowMinutes / 30) * 30
        clockText = Qt.formatDateTime(now, "HH:mm")
        dateText = Qt.formatDateTime(now, "dddd d MMMM").toUpperCase()
        clampSelection()
    }

    function open() {
        if (!controller.tvGuideEnabled)
            return
        refresh()
        const current = rows.findIndex(row => row.current)
        selectedRow = current >= 0 ? current : 0
        selectedProgramme = nowProgrammeIndex(selectedChannelData())
        visible = true
    }

    function close() {
        visible = false
    }

    function handleKey(key, parentPortalAuthorized) {
        if (!visible)
            return false
        if (key === Qt.Key_Up || key === Qt.Key_PageUp) {
            if (rows.length > 0) {
                selectedRow = (selectedRow + rows.length - 1) % rows.length
                selectedProgramme = nowProgrammeIndex(selectedChannelData())
            }
        } else if (key === Qt.Key_Down || key === Qt.Key_PageDown) {
            if (rows.length > 0) {
                selectedRow = (selectedRow + 1) % rows.length
                selectedProgramme = nowProgrammeIndex(selectedChannelData())
            }
        } else if (key === Qt.Key_Left || key === Qt.Key_Right) {
            // Future programmes are schedule information only. Focus remains
            // on the live "Now" programme so OK always has one clear meaning:
            // tune to this channel and start its current programme.
            selectedProgramme = nowProgrammeIndex(selectedChannelData())
        } else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
            if (rows.length > 0) {
                if (parentPortalAuthorized === true)
                    controller.tunePortalChannel(rows[selectedRow].number)
                else
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
        onTriggered: guide.refresh()
    }

    Rectangle {
        anchors.fill: parent
        color: "#05070a"
        opacity: 0.9
    }

    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            GradientStop { position: 0; color: "#f20a0e13" }
            GradientStop { position: 0.65; color: "#fa080b0f" }
            GradientStop { position: 1; color: "#ff05070a" }
        }
    }

    Item {
        id: header
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: 116 * guide.uiScale

        Row {
            anchors.left: parent.left
            anchors.leftMargin: 48 * guide.uiScale
            anchors.verticalCenter: parent.verticalCenter
            spacing: 18 * guide.uiScale

            Rectangle {
                width: 48 * guide.uiScale
                height: 38 * guide.uiScale
                radius: 10 * guide.uiScale
                color: "#ff6b57"

                Text {
                    anchors.centerIn: parent
                    color: "#101318"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 24 * guide.uiScale
                    text: "M"
                }
            }

            Text {
                anchors.verticalCenter: parent.verticalCenter
                color: "#f8f5ef"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 30 * guide.uiScale
                text: "MabelTV"
            }

            Rectangle {
                anchors.verticalCenter: parent.verticalCenter
                width: 1
                height: 42 * guide.uiScale
                color: "#56606a"
            }

            Text {
                anchors.verticalCenter: parent.verticalCenter
                color: "#f8f5ef"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 34 * guide.uiScale
                text: "TV GUIDE"
            }
        }

        Text {
            anchors.centerIn: parent
            color: "#d8d9d8"
            font.family: "DejaVu Sans"
            font.pixelSize: 22 * guide.uiScale
            text: guide.dateText
        }

        Text {
            anchors.right: parent.right
            anchors.rightMargin: 52 * guide.uiScale
            anchors.verticalCenter: parent.verticalCenter
            color: "#f8f5ef"
            font.family: "DejaVu Sans"
            font.bold: true
            font.pixelSize: 31 * guide.uiScale
            text: guide.clockText
        }

        Rectangle {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.leftMargin: 44 * guide.uiScale
            anchors.rightMargin: 44 * guide.uiScale
            height: 1
            color: "#424950"
        }
    }

    Item {
        id: scheduleArea
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: header.bottom
        anchors.bottom: detailPanel.top
        anchors.leftMargin: 44 * guide.uiScale
        anchors.rightMargin: 44 * guide.uiScale

        readonly property real channelWidth: 330 * guide.uiScale
        readonly property real timelineWidth: width - channelWidth

        Item {
            id: timeRuler
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            height: 58 * guide.uiScale

            Text {
                anchors.left: parent.left
                anchors.leftMargin: 24 * guide.uiScale
                anchors.verticalCenter: parent.verticalCenter
                color: "#808991"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 14 * guide.uiScale
                text: "CHANNELS"
            }

            Repeater {
                model: 4

                Item {
                    required property int index
                    x: scheduleArea.channelWidth
                       + index * scheduleArea.timelineWidth / 4
                    width: scheduleArea.timelineWidth / 4
                    height: timeRuler.height

                    Text {
                        anchors.left: parent.left
                        anchors.leftMargin: 18 * guide.uiScale
                        anchors.verticalCenter: parent.verticalCenter
                        color: "#d8d9d8"
                        font.family: "DejaVu Sans"
                        font.pixelSize: 19 * guide.uiScale
                        text: guide.displayTime(guide.windowStartMinutes
                                                + parent.index * 30)
                    }
                }
            }
        }

        ListView {
            id: channelRows
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: timeRuler.bottom
            anchors.bottom: parent.bottom
            clip: true
            spacing: 4 * guide.uiScale
            model: guide.rows
            currentIndex: guide.selectedRow
            boundsBehavior: Flickable.StopAtBounds
            interactive: false

            onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

            delegate: Item {
                id: channelRow
                required property var modelData
                required property int index
                width: channelRows.width
                height: 112 * guide.uiScale

                Rectangle {
                    anchors.left: parent.left
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    width: scheduleArea.channelWidth - 4 * guide.uiScale
                    color: channelRow.index === guide.selectedRow ? "#171c22" : "#101419"
                    border.color: channelRow.index === guide.selectedRow ? "#ff6b57" : "#293038"
                    border.width: channelRow.index === guide.selectedRow ? 2 : 1

                    Rectangle {
                        anchors.left: parent.left
                        anchors.leftMargin: 18 * guide.uiScale
                        anchors.verticalCenter: parent.verticalCenter
                        width: 62 * guide.uiScale
                        height: 62 * guide.uiScale
                        radius: 10 * guide.uiScale
                        color: channelRow.modelData.current ? "#ff6b57" : "#222931"

                        Text {
                            anchors.centerIn: parent
                            color: channelRow.modelData.current ? "#101318" : "#f8f5ef"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 28 * guide.uiScale
                            text: channelRow.modelData.number
                        }
                    }

                    Column {
                        anchors.left: parent.left
                        anchors.leftMargin: 98 * guide.uiScale
                        anchors.right: parent.right
                        anchors.rightMargin: 16 * guide.uiScale
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 5 * guide.uiScale

                        Text {
                            width: parent.width
                            color: "#f3f1ec"
                            elide: Text.ElideRight
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 20 * guide.uiScale
                            text: channelRow.modelData.name
                        }

                        Text {
                            color: channelRow.modelData.current ? "#ff8a78" : "#7f8992"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 12 * guide.uiScale
                            text: channelRow.modelData.current ? "YOU'RE WATCHING" : "CHANNEL " + channelRow.modelData.number
                        }
                    }
                }

                Item {
                    id: timelineRow
                    anchors.left: parent.left
                    anchors.leftMargin: scheduleArea.channelWidth
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    clip: true

                    Repeater {
                        model: channelRow.modelData.programmes

                        Rectangle {
                            id: programmeCard
                            required property var modelData
                            required property int index
                            readonly property bool selected: channelRow.index === guide.selectedRow
                                    && index === guide.selectedProgramme
                            x: guide.programmeOffset(modelData.start)
                               * timelineRow.width / guide.scheduleMinutes
                            width: Math.max(8 * guide.uiScale,
                                            guide.programmeDuration(modelData.start, modelData.end)
                                            * timelineRow.width / guide.scheduleMinutes - 4 * guide.uiScale)
                            height: timelineRow.height
                            color: selected ? "#1c2229"
                                            : modelData.now ? "#171c22" : "#12171c"
                            border.color: selected ? "#ff6b57" : "#303740"
                            border.width: selected ? 3 : 1

                            Column {
                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.verticalCenter: parent.verticalCenter
                                anchors.leftMargin: 18 * guide.uiScale
                                anchors.rightMargin: 14 * guide.uiScale
                                spacing: 5 * guide.uiScale

                                Text {
                                    color: programmeCard.selected ? "#ff8a78" : "#82909a"
                                    font.family: "DejaVu Sans"
                                    font.bold: true
                                    font.pixelSize: 12 * guide.uiScale
                                    text: programmeCard.modelData.now ? "NOW" : programmeCard.modelData.start
                                }

                                Text {
                                    width: parent.width
                                    color: "#f4f1ec"
                                    elide: Text.ElideRight
                                    font.family: "DejaVu Sans"
                                    font.bold: programmeCard.selected
                                    font.pixelSize: 18 * guide.uiScale
                                    text: programmeCard.modelData.name
                                }
                            }

                            Rectangle {
                                visible: programmeCard.modelData.now
                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.bottom: parent.bottom
                                anchors.leftMargin: 16 * guide.uiScale
                                anchors.rightMargin: 16 * guide.uiScale
                                anchors.bottomMargin: 9 * guide.uiScale
                                height: 3 * guide.uiScale
                                radius: height / 2
                                color: "#394149"

                                Rectangle {
                                    width: parent.width * programmeCard.modelData.progress
                                    height: parent.height
                                    radius: parent.radius
                                    color: "#ff6b57"
                                }
                            }
                        }
                    }
                }
            }
        }

        Rectangle {
            visible: guide.rows.length > 0
                     && guide.nowMinutes >= guide.windowStartMinutes
                     && guide.nowMinutes <= guide.windowStartMinutes + guide.scheduleMinutes
            x: scheduleArea.channelWidth
               + (guide.nowMinutes - guide.windowStartMinutes)
               * scheduleArea.timelineWidth / guide.scheduleMinutes
            anchors.top: timeRuler.bottom
            anchors.bottom: parent.bottom
            width: 2 * guide.uiScale
            color: "#ff6b57"
            z: 20

            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: parent.top
                anchors.topMargin: -8 * guide.uiScale
                width: 12 * guide.uiScale
                height: 12 * guide.uiScale
                rotation: 45
                color: "#ff6b57"
            }
        }

        Text {
            visible: guide.rows.length === 0
            anchors.centerIn: parent
            color: "#89929a"
            font.family: "DejaVu Sans"
            font.pixelSize: 24 * guide.uiScale
            text: "There aren't any channels to show yet"
        }
    }

    Rectangle {
        id: detailPanel
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: footer.top
        anchors.leftMargin: 44 * guide.uiScale
        anchors.rightMargin: 44 * guide.uiScale
        height: guide.rows.length > 0 ? 210 * guide.uiScale : 0
        color: "#d90d1116"
        border.color: "#343b43"
        border.width: 1
        clip: true

        Rectangle {
            id: artwork
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            anchors.margins: 18 * guide.uiScale
            width: 310 * guide.uiScale
            radius: 10 * guide.uiScale
            gradient: Gradient {
                GradientStop { position: 0; color: "#40231f" }
                GradientStop { position: 0.52; color: "#222a31" }
                GradientStop { position: 1; color: "#102d2c" }
            }

            Text {
                anchors.centerIn: parent
                color: "#ff7b68"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 72 * guide.uiScale
                text: {
                    const channel = guide.selectedChannelData()
                    return channel ? channel.number : ""
                }
            }

            Text {
                anchors.left: parent.left
                anchors.bottom: parent.bottom
                anchors.margins: 14 * guide.uiScale
                color: "#d7ddd9"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 12 * guide.uiScale
                text: "MABELTV"
            }
        }

        Column {
            anchors.left: artwork.right
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: 30 * guide.uiScale
            anchors.rightMargin: 28 * guide.uiScale
            spacing: 10 * guide.uiScale

            Text {
                width: parent.width
                color: "#f8f5ef"
                elide: Text.ElideRight
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 31 * guide.uiScale
                text: {
                    const programme = guide.selectedProgrammeData()
                    return programme ? programme.name : ""
                }
            }

            Text {
                color: guide.selectedProgramme === 0 ? "#7dd4ca" : "#ff8a78"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 17 * guide.uiScale
                text: {
                    const programme = guide.selectedProgrammeData()
                    if (!programme)
                        return ""
                    return (guide.selectedProgramme === 0 ? "NOW" : "UP NEXT")
                            + "  ·  " + programme.start + "–" + programme.end
                }
            }

            Text {
                width: parent.width
                color: "#b7bec3"
                elide: Text.ElideRight
                font.family: "DejaVu Sans"
                font.pixelSize: 17 * guide.uiScale
                text: {
                    const channel = guide.selectedChannelData()
                    if (!channel)
                        return ""
                    return "On " + channel.name
                            + "  ·  Press OK to watch this channel"
                }
            }
        }
    }

    Rectangle {
        id: footer
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: 76 * guide.uiScale
        color: "#f7070a0e"
        border.color: "#30363d"
        border.width: 1

        Row {
            anchors.centerIn: parent
            spacing: 56 * guide.uiScale

            Text {
                color: "#d9dcdd"
                font.family: "DejaVu Sans"
                font.pixelSize: 17 * guide.uiScale
                text: "↑  ↓   Channel"
            }
            Text {
                color: "#f8f5ef"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 17 * guide.uiScale
                text: "OK   Watch now"
            }
            Text {
                color: "#d9dcdd"
                font.family: "DejaVu Sans"
                font.pixelSize: 17 * guide.uiScale
                text: "Back   Close"
            }
        }
    }
}
