pragma ComponentBehavior: Bound

import QtQuick
import MabelTV 1.0
Item {
    required property var host
    required property var tvController

    id: libraryScreen
    anchors.fill: parent
    visible: !host.playing

    Rectangle {
        anchors.fill: parent
        color: "#080a0d"
        gradient: Gradient {
            GradientStop { position: 0; color: "#10141a" }
            GradientStop { position: 0.58; color: "#090c10" }
            GradientStop { position: 1; color: "#06080a" }
        }
    }

    Image {
        anchors.right: parent.right
        anchors.top: parent.top
        width: parent.width * 0.42
        height: parent.height * 0.48
        source: host.currentFilm() ? host.currentFilm().poster : ""
        fillMode: Image.PreserveAspectCrop
        opacity: 0.055
        visible: source.toString().length > 0
        asynchronous: true
        cache: true
    }

    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: "#0010141a" }
            GradientStop { position: 0.63; color: "#85080a0d" }
            GradientStop { position: 1; color: "#d6080a0d" }
        }
    }

    Row {
        id: adultHeader
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.leftMargin: Math.max(28, 42 * host.uiScale)
        anchors.rightMargin: Math.max(28, 42 * host.uiScale)
        anchors.topMargin: Math.max(20, 27 * host.uiScale)
        height: Math.max(48, 60 * host.uiScale)
        spacing: Math.max(12, 16 * host.uiScale)

        Rectangle {
            width: Math.max(5, 7 * host.uiScale)
            height: parent.height * 0.72
            anchors.verticalCenter: parent.verticalCenter
            radius: width / 2
            color: "#d6b36a"

            Text {
                visible: false
                anchors.centerIn: parent
                color: "#11151a"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: parent.height * 0.42
                text: "M"
            }
        }

        Column {
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width - headerStats.width - Math.max(5, 7 * host.uiScale)
                   - parent.spacing * 2
            spacing: 1

            Text {
                color: "#f6f3ed"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: Math.max(20, 27 * host.uiScale)
                text: "Adult Library"
            }
            Text {
                color: "#737c86"
                font.family: "DejaVu Sans"
                font.pixelSize: Math.max(11, 13 * host.uiScale)
                text: "MABELTV  /  PRIVATE"
            }
        }

        Row {
            id: headerStats
            anchors.verticalCenter: parent.verticalCenter
            spacing: Math.max(10, 14 * host.uiScale)

            Rectangle {
                width: filmCountText.implicitWidth + Math.max(24, 32 * host.uiScale)
                height: Math.max(30, 36 * host.uiScale)
                radius: height / 2
                color: "#12161b"
                border.color: "#29313a"

                Text {
                    id: filmCountText
                    anchors.centerIn: parent
                    color: "#9ba3ac"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: Math.max(11, 14 * host.uiScale)
                    text: tvController.adultLibrary.length + " FILMS"
                }
            }

            Rectangle {
                width: privacyText.implicitWidth + Math.max(24, 32 * host.uiScale)
                height: Math.max(30, 36 * host.uiScale)
                radius: height / 2
                color: "transparent"
                border.color: "transparent"

                Text {
                    id: privacyText
                    anchors.centerIn: parent
                    color: "#666f79"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.letterSpacing: 1.2
                    font.pixelSize: Math.max(10, 12 * host.uiScale)
                    text: "LOCAL MEDIA"
                }
            }
        }
    }

    Text {
        id: collectionLabel
        anchors.left: parent.left
        anchors.top: adultHeader.bottom
        anchors.leftMargin: Math.max(28, 42 * host.uiScale)
        anchors.topMargin: Math.max(18, 24 * host.uiScale)
        color: "#69727c"
        font.family: "DejaVu Sans"
        font.bold: true
        font.letterSpacing: 1.8
        font.pixelSize: Math.max(10, 12 * host.uiScale)
        text: "LIBRARY"
    }

    ListView {
        id: collectionTabs
        anchors.left: parent.left
        anchors.top: collectionLabel.bottom
        anchors.bottom: adultFooter.top
        anchors.leftMargin: Math.max(24, 36 * host.uiScale)
        anchors.topMargin: Math.max(9, 12 * host.uiScale)
        anchors.bottomMargin: Math.max(14, 20 * host.uiScale)
        width: Math.max(190, parent.width * 0.17)
        orientation: ListView.Vertical
        spacing: Math.max(3, 5 * host.uiScale)
        clip: true
        model: host.collections
        currentIndex: host.selectedCollectionIndex
        onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

        delegate: Rectangle {
            required property int index
            required property var modelData
            readonly property bool selected: index === host.selectedCollectionIndex
            width: collectionTabs.width
            height: Math.max(42, 52 * host.uiScale)
            radius: Math.max(7, 9 * host.uiScale)
            color: selected
                   ? (host.navigationZone === 0 ? "#eeeae2" : "#20262d")
                   : "transparent"
            border.color: selected
                          ? (host.navigationZone === 0 ? "#ffffff" : "#343d47")
                          : "transparent"
            border.width: 1

            Row {
                anchors.fill: parent
                anchors.leftMargin: Math.max(13, 17 * host.uiScale)
                anchors.rightMargin: Math.max(13, 17 * host.uiScale)
                spacing: Math.max(8, 11 * host.uiScale)

                Text {
                    id: tabName
                    anchors.verticalCenter: parent.verticalCenter
                    width: parent.width - tabCount.width - parent.spacing
                    color: selected && host.navigationZone === 0
                           ? "#15191e" : "#e2dfd9"
                    elide: Text.ElideRight
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: Math.max(12, 15 * host.uiScale)
                    text: modelData.name
                }

                Text {
                    id: tabCount
                    anchors.verticalCenter: parent.verticalCenter
                    color: selected && host.navigationZone === 0
                           ? "#65707a" : "#7f8994"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: Math.max(11, 13 * host.uiScale)
                    text: host.collectionFilmCount(modelData)
                }
            }
        }
    }

    Item {
        id: libraryBody
        anchors.left: collectionTabs.right
        anchors.right: parent.right
        anchors.top: adultHeader.bottom
        anchors.bottom: adultFooter.top
        anchors.leftMargin: Math.max(24, 34 * host.uiScale)
        anchors.rightMargin: Math.max(28, 42 * host.uiScale)
        anchors.topMargin: Math.max(18, 24 * host.uiScale)
        anchors.bottomMargin: Math.max(10, 14 * host.uiScale)

        Rectangle {
            id: detailPanel
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            width: 0
            radius: Math.max(16, 22 * host.uiScale)
            color: "#151a20"
            border.color: "#303943"
            border.width: 1
            clip: true
            visible: false

            Rectangle {
                id: detailArtwork
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                height: parent.height * 0.46
                color: host.accentColor(host.selectedIndex)
                gradient: Gradient {
                    GradientStop {
                        position: 0
                        color: Qt.lighter(host.accentColor(host.selectedIndex), 1.16)
                    }
                    GradientStop {
                        position: 1
                        color: Qt.darker(host.accentColor(host.selectedIndex), 1.45)
                    }
                }

                Image {
                    anchors.fill: parent
                    source: host.currentFilm() ? host.currentFilm().poster : ""
                    fillMode: Image.PreserveAspectCrop
                    visible: source.toString().length > 0
                    asynchronous: true
                    cache: true
                }

                Rectangle {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    height: parent.height * 0.38
                    gradient: Gradient {
                        GradientStop { position: 0; color: "#00151a20" }
                        GradientStop { position: 1; color: "#f0151a20" }
                    }
                }

                Text {
                    anchors.left: parent.left
                    anchors.bottom: parent.bottom
                    anchors.margins: Math.max(16, 22 * host.uiScale)
                    color: "#e7e2dc"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: Math.max(12, 15 * host.uiScale)
                    text: host.selectedSavedPosition >= 30
                          ? "CONTINUE AT " + host.formatTime(host.selectedSavedPosition)
                          : "READY TO PLAY"
                }
            }

            Column {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: detailArtwork.bottom
                anchors.bottom: parent.bottom
                anchors.margins: Math.max(18, 24 * host.uiScale)
                spacing: Math.max(7, 10 * host.uiScale)

                Text {
                    width: parent.width
                    color: "#f5f1ea"
                    maximumLineCount: 2
                    elide: Text.ElideRight
                    wrapMode: Text.Wrap
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: Math.max(22, 29 * host.uiScale)
                    text: host.currentFilm() ? host.currentFilm().name : ""
                }

                Text {
                    width: parent.width
                    color: "#8f99a5"
                    elide: Text.ElideRight
                    font.family: "DejaVu Sans"
                    font.pixelSize: Math.max(11, 14 * host.uiScale)
                    text: host.currentFilm()
                          ? (host.currentFilm().year
                             ? host.currentFilm().year + "   •   " : "")
                            + host.formatFileSize(host.currentFilm().size)
                            + "   •   LOCAL"
                          : ""
                }

                Text {
                    width: parent.width
                    visible: host.currentFilm() && host.currentFilm().overview
                    color: "#b2bac3"
                    maximumLineCount: 3
                    elide: Text.ElideRight
                    wrapMode: Text.Wrap
                    font.family: "DejaVu Sans"
                    font.pixelSize: Math.max(11, 13 * host.uiScale)
                    lineHeight: 1.15
                    text: host.currentFilm() ? host.currentFilm().overview : ""
                }

                Item { width: 1; height: Math.max(2, 4 * host.uiScale) }

                Rectangle {
                    width: parent.width
                    height: Math.max(42, 54 * host.uiScale)
                    radius: Math.max(10, 14 * host.uiScale)
                    color: "#f1eee7"

                    Text {
                        anchors.centerIn: parent
                        color: "#15191e"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: Math.max(14, 17 * host.uiScale)
                        text: host.selectedSavedPosition >= 30
                              ? "OK   RESUME FILM" : "OK   PLAY FILM"
                    }
                }
            }
        }

        GridView {
            id: posterGrid
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            visible: host.visibleFilms.length > 0
            clip: true
            readonly property int columns: 5
            cellWidth: width / columns
            cellHeight: height / 2
            model: host.visibleFilms
            currentIndex: host.selectedIndex
            highlightMoveDuration: 150
            onCurrentIndexChanged: positionViewAtIndex(currentIndex, GridView.Contain)

            delegate: Rectangle {
                required property int index
                required property var modelData
                readonly property bool selected: index === host.selectedIndex
                readonly property bool focused: selected && host.navigationZone === 1
                width: posterGrid.cellWidth - Math.max(12, 16 * host.uiScale)
                height: posterGrid.cellHeight - Math.max(6, 8 * host.uiScale)
                radius: Math.max(8, 10 * host.uiScale)
                color: "transparent"
                border.color: "transparent"
                border.width: 0
                z: focused ? 2 : 1
                scale: focused ? 1.02 : 1

                Behavior on scale { NumberAnimation { duration: 120 } }

                Rectangle {
                    id: posterArtwork
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.top: parent.top
                    height: Math.min(parent.height * 0.84,
                                     (parent.width - Math.max(16, 22 * host.uiScale)) / 0.68)
                    width: height * 0.68
                    color: "transparent"
                    border.width: 0

                    Image {
                        anchors.fill: parent
                        source: modelData.poster
                        fillMode: Image.PreserveAspectFit
                        visible: source.toString().length > 0
                        asynchronous: true
                        cache: true
                    }

                    Rectangle {
                        visible: false
                        anchors.left: parent.left
                        anchors.top: parent.top
                        anchors.margins: Math.max(5, 7 * host.uiScale)
                        width: numberText.implicitWidth + Math.max(12, 16 * host.uiScale)
                        height: Math.max(24, 30 * host.uiScale)
                        radius: height / 2
                        color: "#c80a0d11"

                        Text {
                            id: numberText
                            anchors.centerIn: parent
                            color: "#f1eee8"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: Math.max(10, 12 * host.uiScale)
                            text: String(index + 1).padStart(2, "0")
                        }
                    }

                    Rectangle {
                        anchors.right: parent.right
                        anchors.bottom: parent.bottom
                        anchors.margins: Math.max(9, 12 * host.uiScale)
                        visible: tvController.adultPlaybackPosition(modelData.id) >= 30
                        width: continueText.implicitWidth + Math.max(10, 13 * host.uiScale)
                        height: Math.max(18, 22 * host.uiScale)
                        radius: height / 2
                        color: "#e8e2d6"

                        Text {
                            id: continueText
                            anchors.centerIn: parent
                            color: "#17201b"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: Math.max(8, 9 * host.uiScale)
                            text: "RESUME"
                        }
                    }
                }

                Rectangle {
                    id: filmProgressTrack
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    anchors.leftMargin: Math.max(8, 10 * host.uiScale)
                    anchors.rightMargin: Math.max(8, 10 * host.uiScale)
                    height: Math.max(3, 4 * host.uiScale)
                    radius: height / 2
                    color: "#27303a"
                    visible: tvController.adultPlaybackPosition(modelData.id) >= 30

                    property real duration: Math.max(
                        tvController.adultPlaybackDuration(modelData.id),
                        Number(modelData.runtime || 0) * 60)
                    property real progress: (duration >= 10
                                             ? Math.min(1, tvController.adultPlaybackPosition(modelData.id)
                                                        / duration) : 0)
                                            + host.libraryProgressRevision * 0

                    Rectangle {
                        width: parent.width * parent.progress
                        height: parent.height
                        radius: parent.radius
                        color: focused ? "#d6b36a" : "#b96c53"
                    }
                }

                Column {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: posterArtwork.bottom
                    anchors.bottom: parent.bottom
                    anchors.leftMargin: Math.max(4, 6 * host.uiScale)
                    anchors.rightMargin: Math.max(4, 6 * host.uiScale)
                    anchors.topMargin: Math.max(5, 7 * host.uiScale)
                    spacing: Math.max(1, 2 * host.uiScale)

                    Rectangle {
                        anchors.horizontalCenter: parent.horizontalCenter
                        width: posterArtwork.width
                        height: Math.max(2, 3 * host.uiScale)
                        radius: height / 2
                        color: focused ? "#d6b36a" : "transparent"
                    }

                    Text {
                        width: parent.width
                        color: focused ? "#ffffff" : "#c7c7c3"
                        maximumLineCount: 1
                        elide: Text.ElideRight
                        horizontalAlignment: Text.AlignHCenter
                        font.family: "DejaVu Sans"
                        font.bold: focused
                        font.pixelSize: Math.max(10, 12 * host.uiScale)
                        text: modelData.name
                    }

                    Text {
                        width: parent.width
                        color: focused ? "#aeb5bc" : "#6e7781"
                        elide: Text.ElideRight
                        horizontalAlignment: Text.AlignHCenter
                        font.family: "DejaVu Sans"
                        font.pixelSize: Math.max(8, 9 * host.uiScale)
                        text: modelData.year ? modelData.year : "FILM"
                    }
                }
            }
        }

        Column {
            anchors.centerIn: parent
            width: Math.min(parent.width * 0.78, 760)
            visible: tvController.adultLibrary.length === 0
            spacing: Math.max(12, 16 * host.uiScale)

            Text {
                width: parent.width
                color: "#f4f0e9"
                horizontalAlignment: Text.AlignHCenter
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: Math.max(30, 44 * host.uiScale)
                text: "Your film library is ready"
            }

            Text {
                width: parent.width
                color: "#8f98a3"
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.Wrap
                font.family: "DejaVu Sans"
                font.pixelSize: Math.max(14, 18 * host.uiScale)
                text: "Add films and collections from the Adult section in the parent web portal."
            }
        }
    }

    Row {
        id: adultFooter
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.leftMargin: Math.max(32, 48 * host.uiScale)
        anchors.rightMargin: Math.max(32, 48 * host.uiScale)
        anchors.bottomMargin: Math.max(14, 20 * host.uiScale)
        height: Math.max(22, 28 * host.uiScale)

        Text {
            width: parent.width * 0.78
            color: host.errorMessage.length > 0 ? "#ff9b89" : "#77818c"
            elide: Text.ElideRight
            font.family: "DejaVu Sans"
            font.pixelSize: Math.max(11, 13 * host.uiScale)
            text: host.errorMessage.length > 0
                  ? host.errorMessage
                  : (host.navigationZone === 0
                     ? "↑ ↓  CHOOSE COLLECTION     → / OK  OPEN FILMS     BACK  EXIT"
                     : "↑ ↓ ← →  MOVE     OK  PLAY     BACK  COLLECTIONS")
        }

        Text {
            width: parent.width * 0.22
            color: "#59626d"
            horizontalAlignment: Text.AlignRight
            font.family: "DejaVu Sans"
            font.bold: true
            font.pixelSize: Math.max(10, 12 * host.uiScale)
            text: "MABELTV  •  ADULT"
        }
    }
}
