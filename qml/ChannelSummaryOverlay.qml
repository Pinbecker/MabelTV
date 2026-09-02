pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Effects

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
    readonly property int filmColumns: 5

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

    function episodeCode(number) {
        const episode = Math.max(0, Math.floor(Number(number) || 0))
        return episode > 0 ? "E" + (episode < 10 ? "0" : "") + episode : "PLAY"
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
        if (filmChannel && position >= 30) {
            playChoiceIndex = 0
            playChoiceVisible = true
        } else {
            playSelected(true)
        }
    }

    function handleKey(key, isAutoRepeat) {
        if (!visible)
            return false

        if (playChoiceVisible) {
            if (key === Qt.Key_Left || key === Qt.Key_Up) {
                playChoiceIndex = 0
            } else if (key === Qt.Key_Right || key === Qt.Key_Down) {
                playChoiceIndex = 1
            } else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
                if (!isAutoRepeat)
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
        width: Math.min(parent.width - 140 * overlay.uiScale, 1120 * overlay.uiScale)
        height: Math.min(parent.height - 88 * overlay.uiScale, 932 * overlay.uiScale)
        radius: 30 * overlay.uiScale
        color: "#fc0c0c11"
        border.color: "#534b55"
        border.width: 2 * overlay.uiScale
        clip: true

        Rectangle {
            id: channelHeader
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            height: 190 * overlay.uiScale
            radius: panel.radius - panel.border.width
            color: "#151419"
            clip: true

            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                height: parent.radius
                color: parent.color
            }

            Image {
                id: channelArtwork
                anchors.left: parent.left
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                width: Math.min(parent.width * 0.41, 430 * overlay.uiScale)
                source: overlay.summary.artwork || ""
                fillMode: Image.PreserveAspectCrop
                asynchronous: true
                cache: true
                layer.enabled: true
                layer.effect: MultiEffect {
                    maskEnabled: true
                    maskSource: channelArtworkMask
                }

                Rectangle {
                    anchors.fill: parent
                    visible: channelArtwork.status !== Image.Ready
                    color: "#1a1820"

                    Rectangle {
                        anchors.centerIn: parent
                        width: 76 * overlay.uiScale
                        height: width
                        radius: 22 * overlay.uiScale
                        color: "#292531"

                        Text {
                            anchors.centerIn: parent
                            color: "#ff7424"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 36 * overlay.uiScale
                            text: "M"
                        }
                    }
                }

                Rectangle {
                    anchors.fill: parent
                    gradient: Gradient {
                        orientation: Gradient.Horizontal
                        GradientStop { position: 0; color: "#17000000" }
                        GradientStop { position: 0.62; color: "#25000000" }
                        GradientStop { position: 1; color: "#ff14141a" }
                    }
                }
            }

            Item {
                id: channelArtworkMask
                anchors.fill: channelArtwork
                visible: false
                layer.enabled: true

                Rectangle {
                    anchors.fill: parent
                    radius: panel.radius - panel.border.width
                    color: "white"
                }

                Rectangle {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    height: panel.radius
                    color: "white"
                }

                Rectangle {
                    anchors.top: parent.top
                    anchors.right: parent.right
                    width: panel.radius
                    height: panel.radius
                    color: "white"
                }
            }

            Column {
                anchors.left: channelArtwork.right
                anchors.leftMargin: 26 * overlay.uiScale
                anchors.right: parent.right
                anchors.rightMargin: 36 * overlay.uiScale
                anchors.verticalCenter: parent.verticalCenter
                spacing: 9 * overlay.uiScale

                Text {
                    color: "#ff7424"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.letterSpacing: 2 * overlay.uiScale
                    font.pixelSize: 15 * overlay.uiScale
                    text: "CH " + overlay.summary.number + "  ·  "
                          + (overlay.filmChannel ? "FILM CHANNEL" : "SERIES CHANNEL")
                }

                Text {
                    width: parent.width
                    color: "#fffaf4"
                    elide: Text.ElideRight
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 42 * overlay.uiScale
                    text: overlay.summary.name || "Channel"
                }

                Text {
                    color: "#aaa6ae"
                    font.family: "DejaVu Sans"
                    font.pixelSize: 18 * overlay.uiScale
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
            anchors.leftMargin: 22 * overlay.uiScale
            anchors.rightMargin: 22 * overlay.uiScale
            anchors.topMargin: 20 * overlay.uiScale
            anchors.bottomMargin: 18 * overlay.uiScale

            ListView {
                id: episodeList
                anchors.fill: parent
                visible: !overlay.filmChannel
                clip: true
                spacing: 4 * overlay.uiScale
                model: overlay.programmes
                currentIndex: overlay.selectedIndex
                interactive: false
                boundsBehavior: Flickable.StopAtBounds
                onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

                delegate: Item {
                    id: episodeItem
                    required property var modelData
                    required property int index
                    readonly property int seriesNumber: Number(modelData.seriesNumber) || 0
                    readonly property bool showSeriesHeader: {
                        if (seriesNumber <= 0)
                            return index === 0
                        if (index === 0)
                            return true
                        const previous = overlay.programmes[index - 1]
                        return !previous || Number(previous.seriesNumber) !== seriesNumber
                    }
                    width: episodeList.width
                    height: (showSeriesHeader ? 48 : 0) * overlay.uiScale
                            + 78 * overlay.uiScale

                    Text {
                        visible: episodeItem.showSeriesHeader
                        anchors.left: parent.left
                        anchors.top: parent.top
                        anchors.topMargin: 5 * overlay.uiScale
                        color: "#ff8441"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.letterSpacing: 1.6 * overlay.uiScale
                        font.pixelSize: 16 * overlay.uiScale
                        text: episodeItem.seriesNumber > 0
                              ? "SERIES " + episodeItem.seriesNumber : "EPISODES"
                    }

                    Rectangle {
                        id: episodeRow
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.bottom: parent.bottom
                        height: 70 * overlay.uiScale
                        radius: 14 * overlay.uiScale
                        color: episodeItem.index === overlay.selectedIndex ? "#282129" : "#17161c"
                        border.color: episodeItem.index === overlay.selectedIndex ? "#ff7424" : "#343039"
                        border.width: episodeItem.index === overlay.selectedIndex ? 2 * overlay.uiScale : 1

                        Rectangle {
                            anchors.left: parent.left
                            anchors.leftMargin: 14 * overlay.uiScale
                            anchors.verticalCenter: parent.verticalCenter
                            width: 68 * overlay.uiScale
                            height: 42 * overlay.uiScale
                            radius: 11 * overlay.uiScale
                            color: episodeItem.index === overlay.selectedIndex ? "#ff7424" : "#242129"

                            Text {
                                anchors.centerIn: parent
                                color: episodeItem.index === overlay.selectedIndex ? "#190e09" : "#ff8a4c"
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: 17 * overlay.uiScale
                                text: overlay.episodeCode(episodeItem.modelData.episodeNumber)
                            }
                        }

                        Text {
                            anchors.left: parent.left
                            anchors.leftMargin: 100 * overlay.uiScale
                            anchors.right: statusText.left
                            anchors.rightMargin: 18 * overlay.uiScale
                            anchors.verticalCenter: parent.verticalCenter
                            color: "#f8f4ef"
                            elide: Text.ElideRight
                            font.family: "DejaVu Sans"
                            font.bold: episodeItem.index === overlay.selectedIndex
                            font.pixelSize: 21 * overlay.uiScale
                            text: episodeItem.modelData.episodeTitle || episodeItem.modelData.name
                        }

                        Text {
                            id: statusText
                            anchors.right: parent.right
                            anchors.rightMargin: 20 * overlay.uiScale
                            anchors.verticalCenter: parent.verticalCenter
                            color: episodeItem.modelData.current ? "#ff9359" : "#706d75"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.letterSpacing: 0.8 * overlay.uiScale
                            font.pixelSize: 12 * overlay.uiScale
                            text: episodeItem.modelData.current ? "PLAYING NOW" : ""
                        }
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
                cellHeight: (filmGrid.cellWidth - 18 * overlay.uiScale) * 1.5
                            + 84 * overlay.uiScale
                onCurrentIndexChanged: positionViewAtIndex(currentIndex, GridView.Contain)

                delegate: Item {
                    id: filmCell
                    required property var modelData
                    required property int index
                    width: filmGrid.cellWidth
                    height: filmGrid.cellHeight

                    Rectangle {
                        id: filmCard
                        anchors.fill: parent
                        anchors.leftMargin: 7 * overlay.uiScale
                        anchors.rightMargin: 7 * overlay.uiScale
                        anchors.topMargin: 5 * overlay.uiScale
                        anchors.bottomMargin: 10 * overlay.uiScale
                        radius: 16 * overlay.uiScale
                        color: filmCell.index === overlay.selectedIndex ? "#211a20" : "#17161c"
                        border.color: "#302e35"
                        border.width: 1
                        clip: true

                        Image {
                            id: posterImage
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.top: parent.top
                            height: width * 1.5
                            source: filmCell.modelData.poster || ""
                            fillMode: Image.PreserveAspectCrop
                            asynchronous: true
                            cache: true
                            layer.enabled: true
                            layer.effect: MultiEffect {
                                maskEnabled: true
                                maskSource: posterMask
                            }

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
                                height: parent.height * 0.30
                                gradient: Gradient {
                                    GradientStop { position: 0; color: "#00000000" }
                                    GradientStop { position: 1; color: "#d9000000" }
                                }
                            }

                            Text {
                                id: resumeLabel
                                visible: Number(filmCell.modelData.position) >= 30
                                anchors.left: parent.left
                                anchors.leftMargin: 12 * overlay.uiScale
                                anchors.bottom: parent.bottom
                                anchors.bottomMargin: 14 * overlay.uiScale
                                color: "#ff9a64"
                                font.family: "DejaVu Sans"
                                font.bold: false
                                font.letterSpacing: 0.4 * overlay.uiScale
                                font.pixelSize: 13 * overlay.uiScale
                                style: Text.Outline
                                styleColor: "#b0000000"
                                text: "RESUME · " + overlay.formatPosition(filmCell.modelData.position)
                            }

                            Rectangle {
                                visible: Number(filmCell.modelData.progress) > 0
                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.bottom: parent.bottom
                                height: 6 * overlay.uiScale
                                color: "#59545c"

                                Rectangle {
                                    width: parent.width * Number(filmCell.modelData.progress)
                                    height: parent.height
                                    color: "#ff7424"
                                }
                            }
                        }

                        Item {
                            id: posterMask
                            anchors.fill: posterImage
                            visible: false
                            layer.enabled: true

                            Rectangle {
                                anchors.fill: parent
                                radius: filmCard.radius
                                color: "white"
                            }

                            Rectangle {
                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.bottom: parent.bottom
                                height: filmCard.radius
                                color: "white"
                            }
                        }

                        Column {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.top: posterImage.bottom
                            anchors.leftMargin: 15 * overlay.uiScale
                            anchors.rightMargin: 15 * overlay.uiScale
                            anchors.topMargin: 8 * overlay.uiScale
                            spacing: 4 * overlay.uiScale

                            Text {
                                width: parent.width
                                color: "#fbf7f2"
                                elide: Text.ElideRight
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: 16 * overlay.uiScale
                                text: filmCell.modelData.name
                            }

                            Item {
                                width: parent.width
                                height: 18 * overlay.uiScale

                                Text {
                                    anchors.left: parent.left
                                    anchors.verticalCenter: parent.verticalCenter
                                    color: "#85818a"
                                    elide: Text.ElideRight
                                    font.family: "DejaVu Sans"
                                    font.pixelSize: 12 * overlay.uiScale
                                    text: filmCell.modelData.year || "Ready to play"
                                }

                                Text {
                                    anchors.right: parent.right
                                    anchors.verticalCenter: parent.verticalCenter
                                    color: "#85818a"
                                    font.family: "DejaVu Sans"
                                    font.pixelSize: 12 * overlay.uiScale
                                    text: Number(filmCell.modelData.duration) >= 60
                                          ? overlay.formatPosition(filmCell.modelData.duration) : ""
                                }
                            }
                        }

                        Rectangle {
                            anchors.fill: parent
                            radius: parent.radius
                            color: "transparent"
                            border.color: "#ff7424"
                            border.width: 4 * overlay.uiScale
                            visible: filmCell.index === overlay.selectedIndex
                            z: 10
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
            height: 64 * overlay.uiScale

            Rectangle {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.leftMargin: 22 * overlay.uiScale
                anchors.rightMargin: 22 * overlay.uiScale
                height: 1
                color: "#302e35"
            }

            Rectangle {
                anchors.right: parent.right
                anchors.rightMargin: 24 * overlay.uiScale
                anchors.verticalCenter: parent.verticalCenter
                width: closeHint.implicitWidth + 32 * overlay.uiScale
                height: 38 * overlay.uiScale
                radius: height / 2
                color: "#211f26"
                border.color: "#49454f"
                border.width: 1

                Text {
                    id: closeHint
                    anchors.centerIn: parent
                    color: "#d8d3dc"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 14 * overlay.uiScale
                    text: "BACK  ·  Close"
                }
            }
        }

        Rectangle {
            anchors.fill: parent
            radius: panel.radius
            color: "transparent"
            border.color: "#5d5862"
            border.width: 2 * overlay.uiScale
            z: 40
        }

        Rectangle {
            visible: overlay.playChoiceVisible
            anchors.fill: parent
            color: "#d9000000"
            z: 20

            Rectangle {
                anchors.centerIn: parent
                width: Math.min(parent.width - 90 * overlay.uiScale, 650 * overlay.uiScale)
                height: 400 * overlay.uiScale
                radius: 28 * overlay.uiScale
                color: "#fc121117"
                border.color: "#5b555f"
                border.width: 2 * overlay.uiScale

                Column {
                    anchors.fill: parent
                    anchors.margins: 34 * overlay.uiScale
                    spacing: 18 * overlay.uiScale

                    Text {
                        width: parent.width
                        color: "#ff8d50"
                        elide: Text.ElideRight
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: 16 * overlay.uiScale
                        text: "CHOOSE HOW TO PLAY"
                    }

                    Text {
                        width: parent.width
                        color: "#fffaf4"
                        elide: Text.ElideRight
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: 30 * overlay.uiScale
                        text: overlay.currentProgramme() ? overlay.currentProgramme().name : "Film"
                    }

                    Row {
                        id: choiceRow
                        width: parent.width
                        height: 178 * overlay.uiScale
                        spacing: 18 * overlay.uiScale

                        Repeater {
                            model: ["Resume", "Play from\nbeginning"]

                            Rectangle {
                                required property string modelData
                                required property int index
                                width: (choiceRow.width - choiceRow.spacing) / 2
                                height: parent.height
                                radius: 22 * overlay.uiScale
                                color: index === overlay.playChoiceIndex ? "#ff7424" : "#242129"
                                border.color: index === overlay.playChoiceIndex ? "#ff9b63" : "#46414a"
                                border.width: index === overlay.playChoiceIndex
                                              ? 4 * overlay.uiScale : 2 * overlay.uiScale

                                Text {
                                    anchors.centerIn: parent
                                    color: parent.index === overlay.playChoiceIndex ? "#160d08" : "#eee9e4"
                                    font.family: "DejaVu Sans"
                                    font.bold: true
                                    font.pixelSize: 24 * overlay.uiScale
                                    horizontalAlignment: Text.AlignHCenter
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
                        text: "BACK  ·  Return to films"
                    }
                }
            }
        }
    }
}
