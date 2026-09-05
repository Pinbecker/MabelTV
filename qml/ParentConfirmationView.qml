pragma ComponentBehavior: Bound

import QtQuick
import MabelTV 1.0
Item {
    required property var host
    required property var tvController

    anchors.fill: parent
    visible: tvController.parentAccessState === TvController.ParentConfirmation

    Rectangle {
        id: confirmationPanel
        anchors.centerIn: parent
        width: Math.min(parent.width - 100 * host.uiScale, 1380 * host.uiScale)
        height: Math.min(parent.height - 92 * host.uiScale, 830 * host.uiScale)
        radius: 22 * host.uiScale
        color: "#f2171b20"
        border.color: "#555e66"
        border.width: 1

        Row {
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.top: parent.top
            anchors.topMargin: 42 * host.uiScale
            spacing: 12 * host.uiScale

            Rectangle {
                width: 38 * host.uiScale
                height: 31 * host.uiScale
                radius: 7 * host.uiScale
                color: "#ff6b57"

                Text {
                    anchors.centerIn: parent
                    color: "#15181d"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 20 * host.uiScale
                    text: "M"
                }
            }

            Text {
                anchors.verticalCenter: parent.verticalCenter
                color: "#f8f5ef"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 25 * host.uiScale
                text: "MabelTV"
            }
        }

        Item {
            id: lockIcon
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.top: parent.top
            anchors.topMargin: 110 * host.uiScale
            width: 88 * host.uiScale
            height: 88 * host.uiScale

            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.bottom: parent.bottom
                width: 64 * host.uiScale
                height: 50 * host.uiScale
                radius: 11 * host.uiScale
                color: "transparent"
                border.color: "#ff7562"
                border.width: 3
            }

            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: parent.top
                width: 42 * host.uiScale
                height: 48 * host.uiScale
                radius: 21 * host.uiScale
                color: "transparent"
                border.color: "#f3efe8"
                border.width: 3
            }

            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.verticalCenter: parent.verticalCenter
                anchors.verticalCenterOffset: 20 * host.uiScale
                width: 7 * host.uiScale
                height: 14 * host.uiScale
                radius: width / 2
                color: "#f3efe8"
            }
        }

        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.top: lockIcon.bottom
            anchors.topMargin: 22 * host.uiScale
            color: "#f8f5ef"
            font.family: "DejaVu Sans"
            font.bold: true
            font.pixelSize: 47 * host.uiScale
            text: "GROWN-UPS ONLY"
        }

        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.top: lockIcon.bottom
            anchors.topMargin: 87 * host.uiScale
            color: "#c0c5c8"
            font.family: "DejaVu Sans"
            font.pixelSize: 22 * host.uiScale
            text: host.adultShortcutFocused
                  ? "Adult mode selected — press OK to open"
                  : "Press OK three times to open Parent Controls"
        }

        Rectangle {
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.verticalCenter: parent.verticalCenter
            anchors.verticalCenterOffset: 4 * host.uiScale
            width: 430 * host.uiScale
            height: 62 * host.uiScale
            radius: 12 * host.uiScale
            color: host.adultShortcutFocused ? "#fff0eb" : "#171c22"
            border.color: host.adultShortcutFocused ? "#ff6b57" : "#4b535b"
            border.width: host.adultShortcutFocused ? 3 : 1

            Text {
                anchors.centerIn: parent
                color: host.adultShortcutFocused ? "#20252a" : "#f8f5ef"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 19 * host.uiScale
                text: "↑  Adult mode     OK  Open"
            }
        }

        Row {
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.verticalCenter: parent.verticalCenter
            anchors.verticalCenterOffset: 88 * host.uiScale
            spacing: 18 * host.uiScale

            Repeater {
                model: 3

                Rectangle {
                    required property int index
                    width: 36 * host.uiScale
                    height: 36 * host.uiScale
                    radius: width / 2
                    color: index < tvController.parentConfirmationCount
                           ? "#ff6b57" : "transparent"
                    border.color: index < tvController.parentConfirmationCount
                                  ? "#ff8a78" : "#646c73"
                    border.width: 2
                }
            }

            Text {
                anchors.verticalCenter: parent.verticalCenter
                color: "#7dd4ca"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 20 * host.uiScale
                text: tvController.parentConfirmationCount + " of 3"
            }
        }

        Rectangle {
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.bottom: parent.bottom
            anchors.bottomMargin: 114 * host.uiScale
            width: 430 * host.uiScale
            height: 72 * host.uiScale
            radius: 12 * host.uiScale
            color: "#171c22"
            border.color: "#ff6b57"
            border.width: 3

            Text {
                anchors.centerIn: parent
                color: "#f8f5ef"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 22 * host.uiScale
                text: tvController.parentConfirmationCount === 2
                      ? "OK   Press once more" : "OK   Confirm"
            }
        }

        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.bottom: parent.bottom
            anchors.bottomMargin: 65 * host.uiScale
            color: "#aeb5b9"
            font.family: "DejaVu Sans"
            font.pixelSize: 16 * host.uiScale
            text: "Back   Cancel"
        }

        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.bottom: parent.bottom
            anchors.bottomMargin: 25 * host.uiScale
            color: host.restartSequenceStep > 0 ? "#ff8a78" : "#7dd4ca"
            font.family: "DejaVu Sans"
            font.pixelSize: 15 * host.uiScale
            text: "Restart this programme   ←  →  OK"
        }
    }
}
