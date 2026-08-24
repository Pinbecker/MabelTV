import QtQuick
import MabelTV 1.0

Item {
    id: overlay

    required property var controller
    property string page: "settings"
    property int selectedRow: 0
    property int selectedChannel: 0
    property int selectedProgramme: 0
    property bool programmePane: false
    property int restartSequenceStep: 0
    property bool adultShortcutFocused: false
    readonly property int rowCount: 17

    visible: controller.parentAccessState !== TvController.ParentClosed

    function pretty(value) {
        if (value === "continuous") return "CONTINUOUS BROADCAST"
        if (value === "resume") return "RESUME WHEN RETURNING"
        if (value === "channel") return "PER CHANNEL"
        if (value === "slim-black") return "SLIM BLACK"
        if (value === "silver-90s") return "SILVER 90s"
        if (value === "charcoal-90s") return "CHARCOAL 90s"
        if (value === "vintage-black") return "VINTAGE BLACK"
        return value.toUpperCase()
    }

    function episodeResetLabel(minutes) {
        if (minutes === 0) return "OFF"
        if (minutes === 60) return "1 HOUR"
        if (minutes === 180) return "3 HOURS"
        return minutes + " MINUTES"
    }

    function valueForRow(index) {
        switch (index) {
        case 0: return pretty(controller.playbackMode)
        case 1: return episodeResetLabel(controller.episodeResetMinutes)
        case 2: return pretty(controller.pictureMode)
        case 3: return pretty(controller.tvBorderStyle)
        case 4: return controller.crtGlass + "%"
        case 5: return controller.videoDistortion + "%"
        case 6: return controller.displayResolution.toUpperCase()
        case 7: return controller.volumeLimitEnabled ? "ON" : "OFF"
        case 8: return controller.configuredMaximumVolume + "%"
        case 9: return controller.soundEffectsEnabled ? "ON" : "OFF"
        case 10: return controller.scrubbingEnabled ? "ON" : "OFF"
        case 11: return "OPEN"
        case 12: return "RUN NOW"
        case 13: return controller.libraryStatus.split("\n")[0].toUpperCase()
        case 14: return controller.adultLibrary.length + " FILMS"
        case 15: return "RELAUNCH"
        case 16: return Qt.platform.os === "windows" ? "PI ONLY" : "SAFE POWEROFF"
        }
        return ""
    }

    function adjustRow(index, direction) {
        switch (index) {
        case 0: controller.cyclePlaybackMode(direction); break
        case 1: controller.cycleEpisodeResetMinutes(direction); break
        case 2: controller.cyclePictureMode(direction); break
        case 3: controller.cycleTvBorderStyle(direction); break
        case 4: controller.adjustCrtGlass(direction); break
        case 5: controller.adjustVideoDistortion(direction); break
        case 6: controller.cycleDisplayResolution(direction); break
        case 7: controller.toggleVolumeLimit(); break
        case 8: controller.adjustMaximumVolume(direction); break
        case 9: controller.toggleSoundEffects(); break
        case 10: controller.toggleScrubbing(); break
        }
    }

    function activateRow(index) {
        if (index <= 10) {
            adjustRow(index, 1)
        } else if (index === 11) {
            page = "library"
            programmePane = false
            clampLibrarySelection()
        } else if (index === 12) {
            controller.reloadLibrary()
        } else if (index === 14) {
            controller.requestParentCommand("adult")
        } else if (index === 15) {
            controller.requestParentCommand("restart")
        } else if (index === 16 && Qt.platform.os !== "windows") {
            controller.requestParentCommand("shutdown")
        }
    }

    function currentChannel() {
        const channels = controller.parentLibrary
        if (channels.length === 0 || selectedChannel < 0
                || selectedChannel >= channels.length)
            return null
        return channels[selectedChannel]
    }

    function currentProgrammes() {
        const channel = currentChannel()
        return channel ? channel.programmes : []
    }

    function clampLibrarySelection() {
        const channelCount = controller.parentLibrary.length
        selectedChannel = channelCount === 0
                ? 0 : Math.max(0, Math.min(selectedChannel, channelCount - 1))
        const programmeCount = currentProgrammes().length
        selectedProgramme = programmeCount === 0
                ? 0 : Math.max(0, Math.min(selectedProgramme, programmeCount - 1))
        if (programmeCount === 0)
            programmePane = false
    }

    function moveLibrarySelection(direction) {
        if (programmePane) {
            const count = currentProgrammes().length
            if (count > 0)
                selectedProgramme = (selectedProgramme + direction + count) % count
        } else {
            const count = controller.parentLibrary.length
            if (count > 0) {
                selectedChannel = (selectedChannel + direction + count) % count
                selectedProgramme = 0
                clampLibrarySelection()
            }
        }
    }

    function activateLibrarySelection() {
        const channel = currentChannel()
        if (!channel)
            return
        if (!programmePane) {
            controller.toggleChannelEnabled(channel.number)
            return
        }
        const programmes = currentProgrammes()
        if (programmes.length > 0)
            controller.toggleProgrammeEnabled(channel.number,
                                                programmes[selectedProgramme].fileName)
    }

    function handleKey(key, modifiers) {
        if (controller.parentAccessState === TvController.ParentConfirmation) {
            if (key === Qt.Key_Up) {
                restartSequenceStep = 0
                adultShortcutFocused = true
            } else if (key === Qt.Key_Down) {
                adultShortcutFocused = false
            } else if (key === Qt.Key_Left) {
                adultShortcutFocused = false
                restartSequenceStep = 1
            } else if (key === Qt.Key_Right) {
                adultShortcutFocused = false
                restartSequenceStep = restartSequenceStep === 1 ? 2 : 0
            } else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
                if (adultShortcutFocused) {
                    controller.requestAdultModeShortcut()
                } else if (restartSequenceStep === 2) {
                    controller.restartCurrentProgramme()
                    controller.closeParent()
                } else {
                    restartSequenceStep = 0
                    controller.parentConfirm()
                }
            } else if (key === Qt.Key_Escape || key === Qt.Key_B) {
                restartSequenceStep = 0
                adultShortcutFocused = false
                controller.closeParent()
            } else {
                restartSequenceStep = 0
                return false
            }
            return true
        }

        if (page === "library") {
            if (key === Qt.Key_Up) {
                moveLibrarySelection(-1)
            } else if (key === Qt.Key_Down) {
                moveLibrarySelection(1)
            } else if (key === Qt.Key_Left) {
                programmePane = false
            } else if (key === Qt.Key_Right) {
                if (currentProgrammes().length > 0)
                    programmePane = true
            } else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
                activateLibrarySelection()
            } else if (key === Qt.Key_Escape || key === Qt.Key_Backspace
                       || key === Qt.Key_B) {
                page = "settings"
                programmePane = false
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

    Connections {
        target: controller

        function onParentLibraryChanged() {
            overlay.clampLibrarySelection()
        }
        function onParentAccessStateChanged() {
            overlay.restartSequenceStep = 0
            overlay.adultShortcutFocused = false
            if (controller.parentAccessState !== TvController.ParentOpen) {
                overlay.page = "settings"
                overlay.programmePane = false
            }
        }
    }

    Rectangle {
        anchors.fill: parent
        color: "#ee020503"
    }

    Rectangle {
        anchors.centerIn: parent
        width: Math.min(parent.width * 0.82, 980)
        height: Math.min(parent.height * 0.9, 670)
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
                anchors.bottomMargin: 102
                color: "#bdd0ad"
                font.family: "Consolas"
                font.pixelSize: 21
                text: overlay.adultShortcutFocused
                      ? "ADULT MODE SELECTED: PRESS OK"
                      : "PRESS OK THREE TIMES"
            }

            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.verticalCenter: parent.verticalCenter
                anchors.verticalCenterOffset: -36
                width: 360
                height: 48
                color: overlay.adultShortcutFocused ? "#334d34" : "#10180f"
                border.color: overlay.adultShortcutFocused ? "#d4c78e" : "#547054"
                border.width: overlay.adultShortcutFocused ? 2 : 1

                Text {
                    anchors.centerIn: parent
                    color: overlay.adultShortcutFocused ? "#f1e7b7" : "#bdd0ad"
                    font.family: "Consolas"
                    font.bold: true
                    font.pixelSize: 18
                    text: "↑  ADULT MODE     OK  OPEN"
                }
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.bottom: parent.bottom
                anchors.bottomMargin: 68
                color: overlay.restartSequenceStep > 0 ? "#d4c78e" : "#718a71"
                font.family: "Consolas"
                font.pixelSize: 16
                text: "RESTART CURRENT PROGRAMME:  LEFT  →  RIGHT  →  OK"
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
            id: settingsPage
            anchors.fill: parent
            anchors.margins: 26
            visible: controller.parentAccessState === TvController.ParentOpen
                     && overlay.page === "settings"

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
                text: "ARROWS + OK   BACK TO CLOSE"
            }

            Column {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parentTitle.bottom
                anchors.topMargin: 18
                spacing: 1

                Repeater {
                    model: ["PLAYBACK MODE", "RESET UNVISITED EPISODES", "PICTURE MODE",
                            "TV BORDER", "CRT GLASS", "90s DISTORTION", "DISPLAY OUTPUT", "VOLUME LIMIT",
                            "MAXIMUM VOLUME", "TV SOUNDS", "PLAYBACK SCRUBBING",
                            "CHANNELS & PROGRAMMES", "RELOAD LIBRARY", "DIAGNOSTICS", "ADULT MODE",
                            "RESTART MABEL TV", "SHUT DOWN PI"]

                    Rectangle {
                        required property int index
                        required property string modelData
                        width: parent.width
                        height: 30
                        color: index === overlay.selectedRow ? "#334d34" : "transparent"
                        border.color: index === overlay.selectedRow ? "#709372" : "transparent"

                        Text {
                            anchors.left: parent.left
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: 13
                            color: index === overlay.selectedRow ? "#eff5de" : "#a4b9a1"
                            font.family: "Consolas"
                            font.bold: index === overlay.selectedRow
                            font.pixelSize: 16
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
                            font.pixelSize: 14
                            horizontalAlignment: Text.AlignRight
                            visible: index !== 4 && index !== 5
                            text: overlay.valueForRow(index)
                        }

                        Item {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: parent.width * 0.58
                            anchors.rightMargin: 12
                            height: 22
                            visible: index === 4 || index === 5

                            Rectangle {
                                anchors.left: parent.left
                                anchors.right: distortionValue.left
                                anchors.verticalCenter: parent.verticalCenter
                                anchors.rightMargin: 12
                                height: 9
                                radius: 4.5
                                color: "#263529"
                                border.color: "#658066"
                                antialiasing: true

                                Rectangle {
                                    anchors.left: parent.left
                                    anchors.top: parent.top
                                    anchors.bottom: parent.bottom
                                    width: parent.width * (index === 4
                                        ? controller.crtGlass
                                        : controller.videoDistortion) / 100
                                    radius: parent.radius
                                    color: index === overlay.selectedRow ? "#a6d49d" : "#6d936b"
                                    antialiasing: true
                                }
                            }

                            Text {
                                id: distortionValue
                                anchors.right: parent.right
                                anchors.verticalCenter: parent.verticalCenter
                                width: 50
                                color: index === overlay.selectedRow ? "#b9e0ad" : "#718a71"
                                font.family: "Consolas"
                                font.pixelSize: 14
                                horizontalAlignment: Text.AlignRight
                                text: (index === 4 ? controller.crtGlass
                                                   : controller.videoDistortion) + "%"
                            }
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

        Item {
            id: libraryPage
            anchors.fill: parent
            anchors.margins: 24
            visible: controller.parentAccessState === TvController.ParentOpen
                     && overlay.page === "library"

            Text {
                id: libraryTitle
                anchors.left: parent.left
                anchors.top: parent.top
                color: "#dce9cd"
                font.family: "Consolas"
                font.bold: true
                font.pixelSize: 27
                text: "CHANNELS & PROGRAMMES"
            }

            Text {
                anchors.right: parent.right
                anchors.baseline: libraryTitle.baseline
                color: "#779477"
                font.family: "Consolas"
                font.pixelSize: 14
                text: "← → PANE   ↑ ↓ SELECT   OK TOGGLE   BACK"
            }

            Rectangle {
                id: channelPanel
                anchors.left: parent.left
                anchors.top: libraryTitle.bottom
                anchors.bottom: libraryFooter.top
                anchors.topMargin: 18
                anchors.bottomMargin: 14
                width: parent.width * 0.37
                color: "#6b101a12"
                border.width: overlay.programmePane ? 1 : 2
                border.color: overlay.programmePane ? "#355138" : "#82a782"

                Text {
                    id: channelHeader
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 12
                    color: "#91b890"
                    font.family: "Consolas"
                    font.bold: true
                    font.pixelSize: 15
                    text: "CHANNELS"
                }

                ListView {
                    id: channelList
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: channelHeader.bottom
                    anchors.bottom: parent.bottom
                    anchors.margins: 8
                    anchors.topMargin: 10
                    clip: true
                    currentIndex: overlay.selectedChannel
                    model: controller.parentLibrary

                    delegate: Rectangle {
                        required property int index
                        required property var modelData
                        width: channelList.width
                        height: 47
                        color: index === overlay.selectedChannel ? "#344e35" : "transparent"
                        border.color: index === overlay.selectedChannel ? "#678569" : "transparent"

                        Text {
                            anchors.left: parent.left
                            anchors.right: status.left
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: 10
                            anchors.rightMargin: 6
                            color: modelData.enabled ? "#e4efd8" : "#687969"
                            elide: Text.ElideRight
                            font.family: "Consolas"
                            font.bold: index === overlay.selectedChannel
                            font.pixelSize: 15
                            text: "CH " + modelData.number + "  " + modelData.name.toUpperCase()
                        }

                        Text {
                            id: status
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.rightMargin: 9
                            color: modelData.enabled ? "#99cf91" : "#9b6969"
                            font.family: "Consolas"
                            font.bold: true
                            font.pixelSize: 13
                            text: modelData.enabled ? "ON" : "OFF"
                        }
                    }
                }
            }

            Rectangle {
                anchors.left: channelPanel.right
                anchors.right: parent.right
                anchors.top: channelPanel.top
                anchors.bottom: channelPanel.bottom
                anchors.leftMargin: 12
                color: "#6b101a12"
                border.width: overlay.programmePane ? 2 : 1
                border.color: overlay.programmePane ? "#82a782" : "#355138"

                Text {
                    id: programmeHeader
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 12
                    color: "#91b890"
                    elide: Text.ElideRight
                    font.family: "Consolas"
                    font.bold: true
                    font.pixelSize: 15
                    text: {
                        const channel = overlay.currentChannel()
                        return channel ? "PROGRAMMES  " + channel.enabledProgrammeCount
                                + "/" + channel.programmeCount + " ON" : "PROGRAMMES"
                    }
                }

                ListView {
                    id: programmeList
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: programmeHeader.bottom
                    anchors.bottom: parent.bottom
                    anchors.margins: 8
                    anchors.topMargin: 10
                    clip: true
                    currentIndex: overlay.selectedProgramme
                    model: overlay.currentProgrammes()

                    delegate: Rectangle {
                        required property int index
                        required property var modelData
                        width: programmeList.width
                        height: 43
                        color: index === overlay.selectedProgramme ? "#344e35" : "transparent"
                        border.color: index === overlay.selectedProgramme ? "#678569" : "transparent"

                        Text {
                            anchors.left: parent.left
                            anchors.right: programmeStatus.left
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: 10
                            anchors.rightMargin: 8
                            color: modelData.enabled ? "#dce9d2" : "#687969"
                            elide: Text.ElideRight
                            font.family: "Consolas"
                            font.pixelSize: 14
                            text: modelData.name
                        }

                        Text {
                            id: programmeStatus
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.rightMargin: 9
                            color: modelData.enabled ? "#99cf91" : "#9b6969"
                            font.family: "Consolas"
                            font.bold: true
                            font.pixelSize: 13
                            text: modelData.enabled ? "ON" : "OFF"
                        }
                    }

                    Text {
                        anchors.centerIn: parent
                        visible: programmeList.count === 0
                        color: "#718a71"
                        font.family: "Consolas"
                        font.pixelSize: 16
                        text: "NO MEDIA FOUND"
                    }
                }
            }

            Text {
                id: libraryFooter
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                color: "#779477"
                elide: Text.ElideRight
                font.family: "Consolas"
                font.pixelSize: 14
                text: controller.parentMessage
                      + "   ·   A DISABLED CHANNEL IS SKIPPED BY CHANNEL + / -"
            }
        }
    }
}
