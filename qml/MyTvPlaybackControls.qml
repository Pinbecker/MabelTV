pragma ComponentBehavior: Bound

import QtQuick
Rectangle {
    id: playbackControls

    required property var host
    required property var mediaPlayer
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    visible: host.playing
    height: Math.max(112, parent.height * 0.155)
    opacity: mediaPlayer.paused ? 1 : host.controlsOpacity
    color: "#ed0d131a"
    border.color: "#3b4652"
    border.width: 1

    Behavior on opacity { NumberAnimation { duration: 180 } }

    Column {
        anchors.fill: parent
        anchors.margins: Math.max(14, parent.height * 0.022)
        spacing: Math.max(6, 8 * host.uiScale)

        Row {
            width: parent.width
            height: Math.max(30, 36 * host.uiScale)
            spacing: Math.max(10, 12 * host.uiScale)

            Text {
                width: parent.width - (subtitleAction.visible
                                        ? subtitleAction.width + parent.spacing
                                        : (noSubtitlesMessage.visible
                                           ? noSubtitlesMessage.width + parent.spacing : 0))
                anchors.verticalCenter: parent.verticalCenter
                color: "#f4f1eb"
                elide: Text.ElideRight
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: Math.max(17, host.height * 0.026)
                text: host.currentFilm() ? host.currentFilm().name : ""
            }

            Rectangle {
                id: subtitleAction
                anchors.verticalCenter: parent.verticalCenter
                // Keep the status visible as soon as the scrubber opens.
                // Up/Down only moves selection; it must not make this
                // control suddenly appear.
                visible: host.scrubberActive && mediaPlayer.subtitlesAvailable
                width: subtitleActionLabel.implicitWidth + Math.max(30, 36 * host.uiScale)
                height: Math.max(28, 34 * host.uiScale)
                radius: height / 2
                color: host.scrubberFocus === 1 ? "#f1eee7" : "#28323d"
                border.width: host.scrubberFocus === 1 ? 2 : 1
                border.color: host.scrubberFocus === 1 ? "#ffffff" : "#596675"

                Text {
                    id: subtitleActionLabel
                    anchors.centerIn: parent
                    color: host.scrubberFocus === 1 ? "#131920" : "#edf1ec"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: Math.max(9, 11 * host.uiScale)
                    text: "SUBTITLES " + (mediaPlayer.subtitlesVisible ? "ON" : "OFF")
                }
            }

            Text {
                id: noSubtitlesMessage
                anchors.verticalCenter: parent.verticalCenter
                visible: host.scrubberActive && !mediaPlayer.subtitlesAvailable
                color: "#aeb8c1"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: Math.max(9, 11 * host.uiScale)
                text: "NO SUBTITLES AVAILABLE"
            }
        }

        Item {
            width: parent.width
            height: Math.max(22, 28 * host.uiScale)

            Rectangle {
                id: timelineTrack
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                height: Math.max(8, 11 * host.uiScale)
                radius: height / 2
                color: "#3b4753"
                border.width: host.scrubberActive && host.scrubberFocus === 0 ? 2 : 0
                border.color: "#d6b36a"

                Rectangle {
                    width: parent.width * Math.min(1, host.playbackDuration > 0
                                                   ? host.playbackPosition / host.playbackDuration : 0)
                    height: parent.height
                    radius: parent.radius
                    color: "#d56d50"
                }
                Rectangle {
                    anchors.verticalCenter: parent.verticalCenter
                    x: Math.max(0, Math.min(parent.width - width,
                                             parent.width * Math.min(1, host.playbackDuration > 0
                                                                      ? host.playbackPosition / host.playbackDuration : 0) - width / 2))
                    width: Math.max(12, 16 * host.uiScale)
                    height: width
                    radius: width / 2
                    color: "#f5f1e9"
                    visible: host.scrubberActive
                }
            }
        }

        Row {
            width: parent.width
            Text {
                width: parent.width * 0.25
                color: "#dce3dd"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: Math.max(11, 14 * host.uiScale)
                text: host.formatTime(host.playbackPosition)
            }
            Text {
                width: parent.width * 0.5
                color: "#aeb8c1"
                horizontalAlignment: Text.AlignHCenter
                font.family: "DejaVu Sans"
                font.pixelSize: Math.max(10, 12 * host.uiScale)
                text: host.scrubberActive
                      ? (host.scrubberFocus === 1
                         ? "OK  TOGGLE SUBTITLES     ↓  TIMELINE     BACK  CLOSE"
                         : (mediaPlayer.subtitlesAvailable
                            ? "↑  SUBTITLES     ← →  15 SEC     OK  PAUSE"
                            : "NO SUBTITLES AVAILABLE     ← →  15 SEC     OK  PAUSE"))
                      : "↑ / ↓  CONTROLS     ← →  15 SEC     OK  PAUSE"
            }
            Text {
                width: parent.width * 0.25
                color: "#dce3dd"
                horizontalAlignment: Text.AlignRight
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: Math.max(11, 14 * host.uiScale)
                text: host.formatTime(host.playbackDuration)
            }
        }
    }
}
