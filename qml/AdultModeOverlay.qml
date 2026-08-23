import QtQuick
import MabelTV 1.0

Item {
    id: overlay

    required property var controller
    property bool active: false
    property bool playing: false
    property int selectedIndex: 0
    readonly property real playbackPosition: adultPlayer.playbackPosition
    readonly property real playbackDuration: adultPlayer.playbackDuration
    property real controlsOpacity: 1
    property string errorMessage: ""

    signal closed()
    signal powerRequested()

    visible: active
    z: 180

    function open() {
        selectedIndex = Math.max(0, Math.min(selectedIndex,
                                             controller.adultLibrary.length - 1))
        playing = false
        errorMessage = ""
        controlsOpacity = 1
        active = true
    }

    function close() {
        adultPlayer.stop()
        active = false
        playing = false
        closed()
    }

    function currentFilm() {
        const films = controller.adultLibrary
        return selectedIndex >= 0 && selectedIndex < films.length
                ? films[selectedIndex] : null
    }

    function playSelected() {
        const film = currentFilm()
        if (!film)
            return
        errorMessage = ""
        playing = true
        controlsOpacity = 1
        adultPlayer.play(film.source, 0)
        controlsTimer.restart()
    }

    function showControls() {
        controlsOpacity = 1
        controlsTimer.restart()
    }

    function seek(seconds) {
        adultPlayer.seekRelative(seconds)
        showControls()
    }

    function formatTime(seconds) {
        const value = Math.max(0, Math.floor(seconds || 0))
        const hours = Math.floor(value / 3600)
        const minutes = Math.floor((value % 3600) / 60)
        const remaining = value % 60
        return (hours > 0 ? hours + ":" + String(minutes).padStart(2, "0")
                          : String(minutes))
                + ":" + String(remaining).padStart(2, "0")
    }

    function handleKey(key, isAutoRepeat) {
        if (!playing) {
            const count = controller.adultLibrary.length
            if (key === Qt.Key_Up && count > 0) {
                selectedIndex = (selectedIndex + count - 1) % count
            } else if (key === Qt.Key_Down && count > 0) {
                selectedIndex = (selectedIndex + 1) % count
            } else if ((key === Qt.Key_Return || key === Qt.Key_Enter) && !isAutoRepeat) {
                playSelected()
            } else if ((key === Qt.Key_Escape || key === Qt.Key_Backspace
                        || key === Qt.Key_B) && !isAutoRepeat) {
                close()
            } else {
                return false
            }
            return true
        }

        if ((key === Qt.Key_Return || key === Qt.Key_Enter) && !isAutoRepeat) {
            adultPlayer.togglePause()
            showControls()
        } else if (key === Qt.Key_Left) {
            seek(isAutoRepeat ? -30 : -15)
        } else if (key === Qt.Key_Right) {
            seek(isAutoRepeat ? 30 : 15)
        } else if (key === Qt.Key_Up && !isAutoRepeat) {
            seek(300)
        } else if (key === Qt.Key_Down && !isAutoRepeat) {
            seek(-300)
        } else if (key === Qt.Key_Plus || key === Qt.Key_Equal) {
            controller.dispatch(TvController.VolumeUp)
            showControls()
        } else if (key === Qt.Key_Minus) {
            controller.dispatch(TvController.VolumeDown)
            showControls()
        } else if ((key === Qt.Key_Escape || key === Qt.Key_Backspace
                    || key === Qt.Key_B) && !isAutoRepeat) {
            adultPlayer.stop()
            playing = false
            controlsOpacity = 1
        } else {
            showControls()
            return false
        }
        return true
    }

    Rectangle {
        anchors.fill: parent
        color: "#050706"
    }

    MpvVideo {
        id: adultPlayer
        objectName: "mabeltvAdultPlayer"
        anchors.fill: parent
        visible: overlay.playing
        volume: controller.volume
        muted: controller.muted
        aspectMode: "fit"

        onPlaybackFinished: {
            overlay.playing = false
            overlay.controlsOpacity = 1
        }
        onPlaybackFailed: message => {
            overlay.errorMessage = message
            overlay.playing = false
            overlay.controlsOpacity = 1
        }
        onPausedChanged: overlay.showControls()
    }

    Item {
        anchors.fill: parent
        visible: !overlay.playing

        Rectangle {
            anchors.fill: parent
            color: "#111512"
        }

        Column {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.margins: Math.max(34, parent.width * 0.055)
            spacing: 7

            Text {
                color: "#ee775d"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: Math.max(13, overlay.height * 0.025)
                text: "PARENT LIBRARY"
            }
            Text {
                color: "#ffffff"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: Math.max(34, overlay.height * 0.068)
                text: "Adult mode"
            }
            Text {
                color: "#8e9993"
                font.family: "DejaVu Sans"
                font.pixelSize: Math.max(14, overlay.height * 0.026)
                text: controller.adultLibrary.length === 0
                      ? "Add films from the Adult mode section of the parent portal."
                      : "Choose a film with ↑ ↓ and press OK to play."
            }
        }

        ListView {
            id: filmList
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.bottom: footer.top
            anchors.leftMargin: Math.max(34, parent.width * 0.055)
            anchors.rightMargin: Math.max(34, parent.width * 0.055)
            anchors.topMargin: Math.max(180, parent.height * 0.29)
            anchors.bottomMargin: 22
            clip: true
            spacing: 9
            model: controller.adultLibrary
            currentIndex: overlay.selectedIndex
            onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

            delegate: Rectangle {
                required property int index
                required property var modelData
                width: filmList.width
                height: Math.max(58, overlay.height * 0.092)
                radius: 12
                color: index === overlay.selectedIndex ? "#fff0eb" : "#1d2420"
                border.color: index === overlay.selectedIndex ? "#ed6a4d" : "#303a35"
                border.width: index === overlay.selectedIndex ? 2 : 1

                Text {
                    anchors.left: parent.left
                    anchors.right: playMark.left
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.leftMargin: 20
                    anchors.rightMargin: 16
                    color: index === overlay.selectedIndex ? "#18201d" : "#edf2ef"
                    elide: Text.ElideRight
                    font.family: "DejaVu Sans"
                    font.bold: index === overlay.selectedIndex
                    font.pixelSize: Math.max(17, overlay.height * 0.03)
                    text: modelData.name
                }

                Text {
                    id: playMark
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.rightMargin: 20
                    color: index === overlay.selectedIndex ? "#ce4f34" : "#7f8a84"
                    font.pixelSize: 22
                    text: "▶"
                }
            }
        }

        Text {
            id: footer
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.margins: Math.max(24, parent.width * 0.04)
            color: overlay.errorMessage.length > 0 ? "#ff9b89" : "#8e9993"
            elide: Text.ElideRight
            font.family: "DejaVu Sans"
            font.pixelSize: 14
            text: overlay.errorMessage.length > 0
                  ? overlay.errorMessage : "BACK returns to MabelTV"
        }
    }

    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        visible: overlay.playing
        height: Math.max(118, parent.height * 0.19)
        opacity: adultPlayer.paused ? 1 : overlay.controlsOpacity
        color: "#e8111512"

        Behavior on opacity { NumberAnimation { duration: 180 } }

        Column {
            anchors.fill: parent
            anchors.margins: Math.max(20, parent.height * 0.04)
            spacing: 12

            Row {
                width: parent.width
                spacing: 16
                Text {
                    width: parent.width - transportHelp.width - 16
                    color: "white"
                    elide: Text.ElideRight
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: Math.max(18, overlay.height * 0.032)
                    text: overlay.currentFilm() ? overlay.currentFilm().name : ""
                }
                Text {
                    id: transportHelp
                    color: "#c1cbc5"
                    font.family: "DejaVu Sans"
                    font.pixelSize: Math.max(13, overlay.height * 0.022)
                    text: adultPlayer.paused ? "PAUSED" : "OK pause"
                }
            }

            Rectangle {
                width: parent.width
                height: 10
                radius: 5
                color: "#4c5751"
                Rectangle {
                    width: parent.width * Math.min(1, overlay.playbackDuration > 0
                                                   ? overlay.playbackPosition / overlay.playbackDuration : 0)
                    height: parent.height
                    radius: parent.radius
                    color: "#ed6a4d"
                }
            }

            Row {
                width: parent.width
                Text {
                    width: parent.width * 0.33
                    color: "#d8dfdb"
                    font.family: "DejaVu Sans"
                    text: overlay.formatTime(overlay.playbackPosition)
                }
                Text {
                    width: parent.width * 0.34
                    color: "#d8dfdb"
                    horizontalAlignment: Text.AlignHCenter
                    font.family: "DejaVu Sans"
                    text: "↓ −5 min   ← −15 sec   OK   +15 sec →   +5 min ↑"
                }
                Text {
                    width: parent.width * 0.33
                    color: "#d8dfdb"
                    horizontalAlignment: Text.AlignRight
                    font.family: "DejaVu Sans"
                    text: overlay.formatTime(overlay.playbackDuration)
                }
            }
        }
    }

    Timer {
        id: controlsTimer
        interval: 3500
        onTriggered: {
            if (!adultPlayer.paused)
                overlay.controlsOpacity = 0
        }
    }
}
