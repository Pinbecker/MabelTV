pragma ComponentBehavior: Bound

import QtQuick

Item {
    id: overlay

    required property var controller
    property var summary: ({})
    property int selectedIndex: 0
    property bool playChoiceVisible: false
    property int playChoiceIndex: 0
    readonly property bool filmChannel: summary.contentType === "films"
    readonly property var programmes: summary.programmes || []
    readonly property real uiScale: Math.max(0.66, Math.min(width / 1920, height / 1080))
    readonly property int filmColumns: width >= 1500 ? 6 : 5

    visible: false

    function currentProgramme() {
        return selectedIndex >= 0 && selectedIndex < programmes.length
                ? programmes[selectedIndex] : null
    }

    function formatPosition(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0))
        const hours = Math.floor(total / 3600)
        const minutes = Math.floor((total % 3600) / 60)
        return hours > 0 ? hours + "h " + minutes + "m" : minutes + "m"
    }

    function refresh() {
        summary = controller.currentChannelSummary()
        const count = programmes.length
        selectedIndex = count > 0
                ? Math.max(0, Math.min(Number(summary.selectedIndex) || 0, count - 1)) : 0
        playChoiceVisible = false
        playChoiceIndex = 0
    }

    function open() {
        refresh()
        if (programmes.length === 0)
            return
        visible = true
    }

    function close() {
        playChoiceVisible = false
        visible = false
    }

    function moveSelection(offset) {
        if (programmes.length === 0)
            return
        selectedIndex = Math.max(0, Math.min(selectedIndex + offset,
                                             programmes.length - 1))
    }

    function playSelected(startFromBeginning) {
        const programme = currentProgramme()
        if (!programme)
            return
        const position = startFromBeginning ? 0 : Math.max(0, Number(programme.position) || 0)
        const channel = Number(summary.number)
        const fileName = String(programme.fileName)
        close()
        controller.playPortalProgramme(channel, fileName, position)
    }

    function chooseSelected() {
        const programme = currentProgramme()
        if (!programme)
            return
        const position = Number(programme.position) || 0
        const duration = Number(programme.duration) || 0
        if (filmChannel && position >= 30
                && (duration < 60 || position < duration - 60)) {
            playChoiceIndex = 0
            playChoiceVisible = true
        } else {
            playSelected(true)
        }
    }

    function handleKey(key) {
        if (!visible)
            return false

        if (playChoiceVisible) {
            if (key === Qt.Key_Left || key === Qt.Key_Up) {
                playChoiceIndex = 0
            } else if (key === Qt.Key_Right || key === Qt.Key_Down) {
                playChoiceIndex = 1
            } else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
                playSelected(playChoiceIndex === 1)
            } else if (key === Qt.Key_B || key === Qt.Key_Backspace
                       || key === Qt.Key_Escape || key === Qt.Key_Home) {
                playChoiceVisible = false
            } else {
                return false
            }
            return true
        }

        if (key === Qt.Key_B || key === Qt.Key_Backspace
                || key === Qt.Key_Escape || key === Qt.Key_Home) {
            close()
        } else if (filmChannel && key === Qt.Key_Left) {
            moveSelection(-1)
        } else if (filmChannel && key === Qt.Key_Right) {
            moveSelection(1)
        } else if (filmChannel && (key === Qt.Key_Up || key === Qt.Key_PageUp)) {
            moveSelection(-filmColumns)
        } else if (filmChannel && (key === Qt.Key_Down || key === Qt.Key_PageDown)) {
            moveSelection(filmColumns)
        } else if (!filmChannel && (key === Qt.Key_Up || key === Qt.Key_PageUp)) {
            moveSelection(-1)
        } else if (!filmChannel && (key === Qt.Key_Down || key === Qt.Key_PageDown)) {
            moveSelection(1)
        } else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
            chooseSelected()
        } else {
            return false
        }
        return true
    }

    Rectangle {
        anchors.fill: parent
        color: "#b0000000"
    }

    Rectangle {
        id: panel
        anchors.centerIn: parent
        width: Math.min(parent.width - 120 * overlay.uiScale, 1600 * overlay.uiScale)
        height: Math.min(parent.height - 90 * overlay.uiScale, 930 * overlay.uiScale)
        radius: 28 * overlay.uiScale
        color: "#fa0b0b10"
        border.color: "#5d47444b"
        border.width: 2 * overlay.uiScale
        clip: true

        Rectangle {
            id: channelHeader
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            height: 220 * overlay.uiScale
            color: "#14141a"
            clip: true

            Image {
                id: channelArtwork
                anchors.left: parent.left
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                width: Math.min(parent.width * 0.43, 640 * overlay.uiScale)
                source: overlay.summary.artwork || ""
                fillMode: Image.PreserveAspectCrop
                asynchronous: true
                cache: true

                Rectangle {
                    anchors.fill: parent
                    visible: channelArtwork.status !== Image.Ready
                    color: "#1a1820"

                    Rectangle {
                        anchors.centerIn: parent
                        width: 88 * overlay.uiScale
                        height: width
                        radius: 22 * overlay.uiScale
                        color: "#292531"

                        Text {
                            anchors.centerIn: parent
                            color: "#ff7424"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 42 * overlay.uiScale
                            text: "M"
                        }
                    }
                }

                Rectangle {
                    anchors.fill: parent
                    gradient: Gradient {
                        orientation: Gradient.Horizontal
                        GradientStop { position: 0; color: "#17000000" }
                        GradientStop { position: 0.72; color: "#25000000" }
                        GradientStop { position: 1; color: "#ff14141a" }
                    }
                }
            }

            Column {
                anchors.left: channelArtwork.right
                anchors.leftMargin: 28 * overlay.uiScale
                anchors.right: parent.right
                anchors.rightMargin: 36 * overlay.uiScale
                anchors.verticalCenter: parent.verticalCenter
                spacing: 9 * overlay.uiScale

                Text {
                    color: "#ff7424"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.letterSpacing: 2 * overlay.uiScale
                    font.pixelSize: 17 * overlay.uiScale
                    text: "CH " + overlay.summary.number + "  ·  "
                          + (overlay.filmChannel ? "FILM CHANNEL" : "SERIES CHANNEL")
                }

                Text {
                    width: parent.width
                    color: "#fffaf4"
                    elide: Text.ElideRight
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 48 * overlay.uiScale
                    text: overlay.summary.name || "Channel"
                }

                Text {
                    color: "#aaa6ae"
                    font.family: "DejaVu Sans"
                    font.pixelSize: 20 * overlay.uiScale
                    text: overlay.summary.programmeCount + (overlay.filmChannel ? " films" : " episodes")
                }
            }
        }

        Item {
            id: content
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: channelHeader.bottom
            anchors.bottom: footer.top
            anchors.margins: 24 * overlay.uiScale

            ListView {
                id: episodeList
                anchors.fill: parent
                visible: !overlay.filmChannel
                clip: true
                spacing: 8 * overlay.uiScale
                model: overlay.programmes
                currentIndex: overlay.selectedIndex
                interactive: false
                boundsBehavior: Flickable.StopAtBounds
                onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

                delegate: Rectangle {
                    id: episodeRow
                    required property var modelData
                    required property int index
                    width: episodeList.width
                    height: 82 * overlay.uiScale
                    radius: 13 * overlay.uiScale
                    color: index === overlay.selectedIndex ? "#242129" : "#141319"
                    border.color: index === overlay.selectedIndex ? "#ff7424" : "#302d35"
                    border.width: index === overlay.selectedIndex ? 2 * overlay.uiScale : 1

                    Rectangle {
                        anchors.left: parent.left
                        anchors.leftMargin: 18 * overlay.uiScale
                        anchors.verticalCenter: parent.verticalCenter
                        width: 44 * overlay.uiScale
                        height: width
                        radius: width / 2
                        color: episodeRow.index === overlay.selectedIndex ? "#ff7424" : "#25232a"

                        Text {
                            anchors.centerIn: parent
                            color: episodeRow.index === overlay.selectedIndex ? "#160d08" : "#908b95"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 17 * overlay.uiScale
                            text: episodeRow.index + 1
                        }
                    }

                    Text {
                        anchors.left: parent.left
                        anchors.leftMargin: 82 * overlay.uiScale
                        anchors.right: statusText.left
                        anchors.rightMargin: 20 * overlay.uiScale
                        anchors.verticalCenter: parent.verticalCenter
                        color: "#f8f4ef"
                        elide: Text.ElideRight
                        font.family: "DejaVu Sans"
                        font.bold: episodeRow.index === overlay.selectedIndex
                        font.pixelSize: 23 * overlay.uiScale
                        text: episodeRow.modelData.name
                    }

                    Text {
                        id: statusText
                        anchors.right: parent.right
                        anchors.rightMargin: 24 * overlay.uiScale
                        anchors.verticalCenter: parent.verticalCenter
                        color: episodeRow.modelData.current ? "#ff8c50" : "#706d75"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: 14 * overlay.uiScale
                        text: episodeRow.modelData.current ? "PLAYING NOW" : ""
                    }
                }
            }

            GridView {
                id: filmGrid
                anchors.fill: parent
                visible: overlay.filmChannel
                clip: true
                model: overlay.programmes
                currentIndex: overlay.selectedIndex
                interactive: false
                boundsBehavior: Flickable.StopAtBounds
                cellWidth: width / overlay.filmColumns
                cellHeight: 332 * overlay.uiScale
                onCurrentIndexChanged: positionViewAtIndex(currentIndex, GridView.Contain)

                delegate: Item {
                    id: filmCell
                    required property var modelData
                    required property int index
                    width: filmGrid.cellWidth
                    height: filmGrid.cellHeight

                    Rectangle {
                        anchors.fill: parent
                        anchors.margins: 7 * overlay.uiScale
                        radius: 14 * overlay.uiScale
                        color: "#15141a"
                        border.color: filmCell.index === overlay.selectedIndex ? "#ff7424" : "#302e35"
                        border.width: filmCell.index === overlay.selectedIndex ? 3 * overlay.uiScale : 1
                        clip: true

                        Image {
                            id: posterImage
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.top: parent.top
                            height: parent.height - 76 * overlay.uiScale
                            source: filmCell.modelData.poster || ""
                            fillMode: Image.PreserveAspectCrop
                            asynchronous: true
                            cache: true

                            Rectangle {
                                anchors.fill: parent
                                visible: posterImage.status !== Image.Ready
                                color: "#24212a"

                                Text {
                                    anchors.centerIn: parent
                                    color: "#827d88"
                                    font.family: "DejaVu Sans"
                                    font.bold: true
                                    font.pixelSize: 38 * overlay.uiScale
                                    text: "M"
                                }
                            }

                            Rectangle {
                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.bottom: parent.bottom
                                height: parent.height * 0.38
                                gradient: Gradient {
                                    GradientStop { position: 0; color: "#00000000" }
                                    GradientStop { position: 1; color: "#d9000000" }
                                }
                            }

                            Text {
                                visible: Number(filmCell.modelData.position) >= 30
                                anchors.left: parent.left
                                anchors.leftMargin: 12 * overlay.uiScale
                                anchors.bottom: parent.bottom
                                anchors.bottomMargin: 12 * overlay.uiScale
                                color: "#ff9a64"
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: 13 * overlay.uiScale
                                text: "RESUME · " + overlay.formatPosition(filmCell.modelData.position)
                            }

                            Rectangle {
                                visible: Number(filmCell.modelData.progress) > 0
                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.bottom: parent.bottom
                                height: 5 * overlay.uiScale
                                color: "#5a555d"

                                Rectangle {
                                    width: parent.width * Number(filmCell.modelData.progress)
                                    height: parent.height
                                    color: "#ff7424"
                                }
                            }
                        }

                        Text {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.top: posterImage.bottom
                            anchors.leftMargin: 13 * overlay.uiScale
                            anchors.rightMargin: 13 * overlay.uiScale
                            anchors.topMargin: 9 * overlay.uiScale
                            color: "#fbf7f2"
                            elide: Text.ElideRight
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 18 * overlay.uiScale
                            text: filmCell.modelData.name
                        }
                    }
                }
            }
        }

        Item {
            id: footer
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: 70 * overlay.uiScale

            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.leftMargin: 24 * overlay.uiScale
                anchors.rightMargin: 24 * overlay.uiScale
                height: 1
                color: "#302e35"
            }

            Text {
                anchors.left: parent.left
                anchors.leftMargin: 30 * overlay.uiScale
                anchors.verticalCenter: parent.verticalCenter
                color: "#8d8992"
                font.family: "DejaVu Sans"
                font.pixelSize: 16 * overlay.uiScale
                text: overlay.filmChannel ? "↑ ↓ ← →  Browse" : "↑ ↓  Browse"
            }

            Text {
                anchors.right: parent.right
                anchors.rightMargin: 30 * overlay.uiScale
                anchors.verticalCenter: parent.verticalCenter
                color: "#aaa6ae"
                font.family: "DejaVu Sans"
                font.pixelSize: 16 * overlay.uiScale
                text: "OK  Select     HOME / BACK  Close"
            }
        }

        Rectangle {
            visible: overlay.playChoiceVisible
            anchors.fill: parent
            color: "#d9000000"
            z: 20

            Rectangle {
                anchors.centerIn: parent
                width: Math.min(parent.width - 120 * overlay.uiScale, 760 * overlay.uiScale)
                height: 330 * overlay.uiScale
                radius: 24 * overlay.uiScale
                color: "#fc121117"
                border.color: "#5b555f"
                border.width: 2 * overlay.uiScale

                Column {
                    anchors.fill: parent
                    anchors.margins: 34 * overlay.uiScale
                    spacing: 22 * overlay.uiScale

                    Text {
                        width: parent.width
                        color: "#ff8d50"
                        elide: Text.ElideRight
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: 16 * overlay.uiScale
                        text: "CONTINUE WATCHING"
                    }

                    Text {
                        width: parent.width
                        color: "#fffaf4"
                        elide: Text.ElideRight
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: 34 * overlay.uiScale
                        text: overlay.currentProgramme() ? overlay.currentProgramme().name : "Film"
                    }

                    Row {
                        id: choiceRow
                        width: parent.width
                        height: 92 * overlay.uiScale
                        spacing: 14 * overlay.uiScale

                        Repeater {
                            model: ["Resume from " + (overlay.currentProgramme()
                                                      ? overlay.formatPosition(overlay.currentProgramme().position) : "0m"),
                                    "Play from beginning"]

                            Rectangle {
                                required property string modelData
                                required property int index
                                width: (choiceRow.width - choiceRow.spacing) / 2
                                height: parent.height
                                radius: 14 * overlay.uiScale
                                color: index === overlay.playChoiceIndex ? "#ff7424" : "#242129"
                                border.color: index === overlay.playChoiceIndex ? "#ff9b63" : "#46414a"
                                border.width: 2 * overlay.uiScale

                                Text {
                                    anchors.centerIn: parent
                                    color: parent.index === overlay.playChoiceIndex ? "#160d08" : "#eee9e4"
                                    font.family: "DejaVu Sans"
                                    font.bold: true
                                    font.pixelSize: 19 * overlay.uiScale
                                    text: parent.modelData
                                }
                            }
                        }
                    }

                    Text {
                        width: parent.width
                        horizontalAlignment: Text.AlignHCenter
                        color: "#77727c"
                        font.family: "DejaVu Sans"
                        font.pixelSize: 14 * overlay.uiScale
                        text: "← →  Choose     OK  Play     BACK  Cancel"
                    }
                }
            }
        }
    }
}
