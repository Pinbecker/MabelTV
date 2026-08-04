import QtQuick
import MabelTV 1.0

Item {
    id: overlay

    required property var controller
    property int selectedRow: 0
    readonly property int rowCount: 12

    visible: controller.parentAccessState !== TvController.ParentClosed

    function pretty(value) {
        if (value === "continuous") return "CONTINUOUS BROADCAST"
        if (value === "resume") return "RESUME WHEN RETURNING"
        if (value === "restart") return "NEW EPISODE FROM START"
        if (value === "channel") return "PER CHANNEL"
        return value.toUpperCase()
    }

    function valueForRow(index) {
        switch (index) {
        case 0: return pretty(controller.playbackMode)
        case 1: return pretty(controller.pictureMode)
        case 2: return controller.crtEffectLevel.toUpperCase()
        case 3: return controller.displayResolution.toUpperCase()
        case 4: return controller.volumeLimitEnabled ? "ON" : "OFF"
        case 5: return controller.configuredMaximumVolume + "%"
        case 6: return controller.soundEffectsEnabled ? "ON" : "OFF"
        case 7: return "RUN NOW"
        case 8: return controller.libraryStatus
        case 9: return "WINDOWS / DEVELOPMENT"
        case 10: return "RELAUNCH"
        case 11: return Qt.platform.os === "windows" ? "PI ONLY" : "SAFE POWEROFF"
        }
        return ""
    }

    function adjustRow(index, direction) {
        switch (index) {
        case 0: controller.cyclePlaybackMode(direction); break
        case 1: controller.cyclePictureMode(direction); break
        case 2: controller.cycleCrtEffectLevel(direction); break
        case 3: controller.cycleDisplayResolution(direction); break
        case 4: controller.toggleVolumeLimit(); break
        case 5: controller.adjustMaximumVolume(direction); break
        case 6: controller.toggleSoundEffects(); break
        }
    }

    function activateRow(index) {
        if (index <= 6) {
            adjustRow(index, 1)
        } else if (index === 7) {
            controller.reloadLibrary()
        } else if (index === 9) {
            controller.requestParentCommand("exit")
        } else if (index === 10) {
            controller.requestParentCommand("restart")
        } else if (index === 11 && Qt.platform.os !== "windows") {
            controller.requestParentCommand("shutdown")
        }
    }

    function handleKey(key, modifiers) {
        if (controller.parentAccessState === TvController.ParentConfirmation) {
            if (key === Qt.Key_Return || key === Qt.Key_Enter) {
                controller.parentConfirm()
            } else if (key === Qt.Key_Escape || key === Qt.Key_B) {
                controller.closeParent()
            } else {
                return false
            }
            return true
        }

        if (key === Qt.Key_Up) {
            selectedRow = (selectedRow + rowCount - 1) % rowCount
        } else if (key === Qt.Key_Down) {
            selectedRow = (selectedRow + 1) % rowCount
        } else if (key === Qt.Key_Left) {
            adjustRow(selectedRow, -1)
        } else if (key === Qt.Key_Right) {
            adjustRow(selectedRow, 1)
        } else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
            activateRow(selectedRow)
        } else if (key === Qt.Key_Escape || key === Qt.Key_Backspace || key === Qt.Key_B) {
            controller.closeParent()
        } else {
            return false
        }
        return true
    }

    Rectangle {
        anchors.fill: parent
        color: "#ee020503"
    }

    Rectangle {
        anchors.centerIn: parent
        width: Math.min(parent.width * 0.76, 880)
        height: Math.min(parent.height * 0.86, 650)
        color: "#f20b130d"
        border.color: "#6f9971"
        border.width: 2

        Item {
            anchors.fill: parent
            anchors.margins: 30
            visible: controller.parentAccessState === TvController.ParentConfirmation

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                y: 32
                color: "#9fc89e"
                font.family: "Consolas"
                font.bold: true
                font.pixelSize: 26
                text: "MABEL TV / PARENT ACCESS"
            }

            Text {
                anchors.centerIn: parent
                color: "#edf2d9"
                font.family: "Consolas"
                font.bold: true
                font.pixelSize: 52
                font.letterSpacing: 8
                text: "●".repeat(controller.parentConfirmationCount)
                    + "○".repeat(3 - controller.parentConfirmationCount)
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.bottom: parent.bottom
                anchors.bottomMargin: 78
                color: "#bdd0ad"
                font.family: "Consolas"
                font.pixelSize: 21
                text: "PRESS OK THREE TIMES"
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.bottom: parent.bottom
                anchors.bottomMargin: 28
                color: "#789379"
                font.family: "Consolas"
                font.pixelSize: 16
                text: controller.parentMessage + "   ·   BACK: CANCEL"
            }
        }

        Item {
            anchors.fill: parent
            anchors.margins: 26
            visible: controller.parentAccessState === TvController.ParentOpen

            Text {
                id: parentTitle
                anchors.left: parent.left
                anchors.top: parent.top
                color: "#dce9cd"
                font.family: "Consolas"
                font.bold: true
                font.pixelSize: 28
                text: "MABEL TV / PARENT CONTROL"
            }

            Text {
                anchors.right: parent.right
                anchors.baseline: parentTitle.baseline
                color: "#779477"
                font.family: "Consolas"
                font.pixelSize: 15
                text: "ARROWS + ENTER   ESC TO CLOSE"
            }

            Column {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parentTitle.bottom
                anchors.topMargin: 22
                spacing: 3

                Repeater {
                    model: ["PLAYBACK MODE", "PICTURE MODE", "CRT EFFECTS", "DISPLAY OUTPUT",
                            "VOLUME LIMIT", "MAXIMUM VOLUME", "TV SOUNDS", "RELOAD LIBRARY",
                            "DIAGNOSTICS", "EXIT MABEL TV", "RESTART MABEL TV", "SHUT DOWN PI"]

                    Rectangle {
                        required property int index
                        required property string modelData
                        width: parent.width
                        height: 37
                        color: index === overlay.selectedRow ? "#334d34" : "transparent"
                        border.color: index === overlay.selectedRow ? "#709372" : "transparent"

                        Text {
                            anchors.left: parent.left
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: 13
                            color: index === overlay.selectedRow ? "#eff5de" : "#a4b9a1"
                            font.family: "Consolas"
                            font.bold: index === overlay.selectedRow
                            font.pixelSize: 17
                            text: modelData
                        }

                        Text {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: parent.width * 0.43
                            anchors.rightMargin: 12
                            color: index === overlay.selectedRow ? "#b9e0ad" : "#718a71"
                            elide: Text.ElideRight
                            font.family: "Consolas"
                            font.pixelSize: 15
                            horizontalAlignment: Text.AlignRight
                            text: overlay.valueForRow(index)
                        }
                    }
                }
            }

            Text {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                color: "#779477"
                elide: Text.ElideRight
                font.family: "Consolas"
                font.pixelSize: 14
                text: controller.parentMessage
            }
        }
    }
}
