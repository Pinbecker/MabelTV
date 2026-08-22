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
    property bool sidebarFocused: false
    property int sidebarSelection: 0
    property int restartSequenceStep: 0
    readonly property int rowCount: 16
    readonly property int settingsColumns: 2
    readonly property int settingsRows: rowCount / settingsColumns

    visible: controller.parentAccessState !== TvController.ParentClosed

    function pretty(value) {
        if (value === "continuous") return "Continuous broadcast"
        if (value === "resume") return "Resume where you left off"
        if (value === "channel") return "Follow each channel"
        if (value === "slim-black") return "Slim black"
        if (value === "silver-90s") return "Silver 90s"
        if (value === "charcoal-90s") return "Charcoal 90s"
        if (value === "vintage-black") return "Vintage black"
        return value
    }

    function episodeResetLabel(minutes) {
        if (minutes === 0) return "Off"
        if (minutes === 60) return "1 hour"
        if (minutes === 180) return "3 hours"
        return minutes + " minutes"
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
        case 7: return controller.volumeLimitEnabled ? "On" : "Off"
        case 8: return controller.configuredMaximumVolume + "%"
        case 9: return controller.soundEffectsEnabled ? "On" : "Off"
        case 10: return "Open library"
        case 11: return "Check now"
        case 12: return controller.libraryStatus.split("\n")[0].toUpperCase()
        case 13: return "Windows / development"
        case 14: return "Relaunch"
        case 15: return Qt.platform.os === "windows" ? "Pi only" : "Safe power off"
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
        }
    }

    function activateRow(index) {
        if (index <= 9) {
            adjustRow(index, 1)
        } else if (index === 10) {
            page = "library"
            programmePane = false
            clampLibrarySelection()
        } else if (index === 11) {
            controller.reloadLibrary()
        } else if (index === 13) {
            controller.requestParentCommand("exit")
        } else if (index === 14) {
            controller.requestParentCommand("restart")
        } else if (index === 15 && Qt.platform.os !== "windows") {
            controller.requestParentCommand("shutdown")
        }
    }

    function moveSettingsSelection(horizontal, vertical) {
        const column = selectedRow % settingsColumns
        const row = Math.floor(selectedRow / settingsColumns)
        const nextColumn = (column + horizontal + settingsColumns) % settingsColumns
        const nextRow = (row + vertical + settingsRows) % settingsRows
        selectedRow = nextRow * settingsColumns + nextColumn
    }

    function openSidebar() {
        sidebarFocused = true
        sidebarSelection = page === "library" ? 1 : 0
    }

    function activateSidebarSelection() {
        page = sidebarSelection === 0 ? "settings" : "library"
        programmePane = false
        if (page === "library")
            clampLibrarySelection()
        sidebarFocused = false
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
            if (key === Qt.Key_Left) {
                restartSequenceStep = 1
            } else if (key === Qt.Key_Right) {
                restartSequenceStep = restartSequenceStep === 1 ? 2 : 0
            } else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
                if (restartSequenceStep === 2) {
                    controller.restartCurrentProgramme()
                    controller.closeParent()
                } else {
                    restartSequenceStep = 0
                    controller.parentConfirm()
                }
            } else if (key === Qt.Key_Escape || key === Qt.Key_B) {
                restartSequenceStep = 0
                controller.closeParent()
            } else {
                restartSequenceStep = 0
                return false
            }
            return true
        }

        if (sidebarFocused) {
            if (key === Qt.Key_Up || key === Qt.Key_Down) {
                sidebarSelection = sidebarSelection === 0 ? 1 : 0
            } else if (key === Qt.Key_Right || key === Qt.Key_Return
                       || key === Qt.Key_Enter) {
                activateSidebarSelection()
            } else if (key === Qt.Key_Escape || key === Qt.Key_Backspace
                       || key === Qt.Key_B) {
                controller.closeParent()
            } else {
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
                if (programmePane)
                    programmePane = false
                else
                    openSidebar()
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
            moveSettingsSelection(0, -1)
        } else if (key === Qt.Key_Down) {
            moveSettingsSelection(0, 1)
        } else if (key === Qt.Key_Left) {
            if (selectedRow % settingsColumns === 0)
                openSidebar()
            else
                moveSettingsSelection(-1, 0)
        } else if (key === Qt.Key_Right) {
            moveSettingsSelection(1, 0)
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
            if (controller.parentAccessState !== TvController.ParentOpen) {
                overlay.page = "settings"
                overlay.programmePane = false
                overlay.sidebarFocused = false
            }
        }
    }


    Rectangle {
        anchors.fill: parent
        color: "#09110e"
        opacity: 0.42
    }

    Item {
        anchors.fill: parent
        visible: controller.parentAccessState === TvController.ParentConfirmation

        Rectangle {
            anchors.centerIn: parent
            width: Math.min(parent.width * 0.68, 760)
            height: Math.min(parent.height * 0.62, 450)
            radius: 26
            color: "#ffffff"
            border.color: "#dedfd9"
            border.width: 1

            Rectangle {
                anchors.left: parent.left
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                width: 12
                radius: 6
                color: "#ed6a4d"
            }

            Rectangle {
                id: lockIcon
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: parent.top
                anchors.topMargin: 38
                width: 58
                height: 58
                radius: 29
                color: "#fff0eb"

                Text {
                    anchors.centerIn: parent
                    color: "#ce4f34"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 27
                    text: "✓"
                }
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: lockIcon.bottom
                anchors.topMargin: 18
                color: "#18201d"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 32
                text: "Grown-ups only"
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: lockIcon.bottom
                anchors.topMargin: 62
                color: "#69716d"
                font.family: "DejaVu Sans"
                font.pixelSize: 18
                text: "Press OK three times to open the parent controls"
            }

            Row {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.verticalCenter: parent.verticalCenter
                anchors.verticalCenterOffset: 34
                spacing: 15

                Repeater {
                    model: 3

                    Rectangle {
                        required property int index
                        width: 21
                        height: 21
                        radius: 11
                        color: index < controller.parentConfirmationCount
                               ? "#ed6a4d" : "#e3e5e1"
                        border.color: index < controller.parentConfirmationCount
                                      ? "#ce4f34" : "#c8ceca"
                        border.width: 2
                    }
                }
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.bottom: parent.bottom
                anchors.bottomMargin: 67
                color: overlay.restartSequenceStep > 0 ? "#a96811" : "#8e9692"
                font.family: "DejaVu Sans"
                font.pixelSize: 14
                text: "Restart this programme:  Left  →  Right  →  OK"
            }

            Text {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.margins: 24
                color: "#69716d"
                elide: Text.ElideRight
                font.family: "DejaVu Sans"
                font.pixelSize: 14
                horizontalAlignment: Text.AlignHCenter
                text: controller.parentMessage + "   ·   Back to cancel"
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: controller.parentAccessState === TvController.ParentOpen

        Item {
            id: parentPanel
            anchors.centerIn: parent
            width: Math.min(parent.width * 0.82, 1040)
            height: Math.min(parent.height * 0.82, 600)

            Rectangle {
                anchors.fill: parent
                radius: 24
                color: "#f4efe7"
                border.color: "#d7dcd6"
                border.width: 1
            }
        }

        Rectangle {
            id: sideRail
            anchors.left: parentPanel.left
            anchors.top: parentPanel.top
            anchors.bottom: parentPanel.bottom
            width: Math.max(220, parentPanel.width * 0.2)
            color: "#151b19"

            Item {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                height: 112

                Rectangle {
                    anchors.left: parent.left
                    anchors.top: parent.top
                    anchors.leftMargin: 26
                    anchors.topMargin: 24
                    width: 38
                    height: 30
                    radius: 7
                    color: "transparent"
                    border.color: "#ffffff"
                    border.width: 2

                    Row {
                        anchors.centerIn: parent
                        spacing: 5
                        Repeater {
                            model: 2
                            Rectangle {
                                width: 4
                                height: 12
                                radius: 2
                                color: "#ed6a4d"
                            }
                        }
                    }
                }

                Text {
                    anchors.left: parent.left
                    anchors.top: parent.top
                    anchors.leftMargin: 76
                    anchors.topMargin: 28
                    color: "#ffffff"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 19
                    text: "MabelTV"
                }

                Text {
                    anchors.left: parent.left
                    anchors.top: parent.top
                    anchors.leftMargin: 27
                    anchors.topMargin: 72
                    color: "#8e9a95"
                    font.family: "DejaVu Sans"
                    font.pixelSize: 13
                    text: "PARENT CONTROLS"
                }
            }

            Column {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.topMargin: 124
                anchors.margins: 14
                spacing: 8

                Rectangle {
                    width: parent.width
                    height: 58
                    radius: 11
                    color: (overlay.sidebarFocused ? overlay.sidebarSelection === 0
                            : overlay.page === "settings") ? "#ffffff" : "transparent"
                    border.color: overlay.sidebarFocused && overlay.sidebarSelection === 0
                                  ? "#ff9c83" : "transparent"
                    border.width: overlay.sidebarFocused && overlay.sidebarSelection === 0 ? 3 : 0

                    Text {
                        anchors.left: parent.left
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.leftMargin: 16
                        color: (overlay.sidebarFocused ? overlay.sidebarSelection === 0
                                : overlay.page === "settings") ? "#18201d" : "#b6c0bc"
                        font.family: "DejaVu Sans"
                        font.bold: overlay.sidebarFocused ? overlay.sidebarSelection === 0
                                                           : overlay.page === "settings"
                        font.pixelSize: 16
                        text: "⌂   TV settings"
                    }
                }

                Rectangle {
                    width: parent.width
                    height: 58
                    radius: 11
                    color: (overlay.sidebarFocused ? overlay.sidebarSelection === 1
                            : overlay.page === "library") ? "#ffffff" : "transparent"
                    border.color: overlay.sidebarFocused && overlay.sidebarSelection === 1
                                  ? "#ff9c83" : "transparent"
                    border.width: overlay.sidebarFocused && overlay.sidebarSelection === 1 ? 3 : 0

                    Text {
                        anchors.left: parent.left
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.leftMargin: 16
                        color: (overlay.sidebarFocused ? overlay.sidebarSelection === 1
                                : overlay.page === "library") ? "#18201d" : "#b6c0bc"
                        font.family: "DejaVu Sans"
                        font.bold: overlay.sidebarFocused ? overlay.sidebarSelection === 1
                                                           : overlay.page === "library"
                        font.pixelSize: 16
                        text: "▶   Channels"
                    }
                }
            }

            Text {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.margins: 26
                color: overlay.sidebarFocused ? "#ffb09d" : "#8e9a95"
                wrapMode: Text.WordWrap
                font.family: "DejaVu Sans"
                font.bold: overlay.sidebarFocused
                font.pixelSize: 13
                text: overlay.sidebarFocused
                      ? "SIDEBAR FOCUS\n↑ ↓ choose · OK open"
                      : "Use the arrow keys to move\nOK to choose · Back to close"
            }
        }

        Item {
            id: settingsPage
            anchors.left: sideRail.right
            anchors.right: parentPanel.right
            anchors.top: parentPanel.top
            anchors.bottom: parentPanel.bottom
            anchors.margins: 26
            visible: overlay.page === "settings"
            opacity: overlay.sidebarFocused ? 0.55 : 1

            Text {
                id: settingsTitle
                anchors.left: parent.left
                anchors.top: parent.top
                color: "#18201d"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 34
                text: "TV settings"
            }

            Text {
                anchors.left: parent.left
                anchors.top: settingsTitle.bottom
                anchors.topMargin: 3
                color: "#69716d"
                font.family: "DejaVu Sans"
                font.pixelSize: 15
                text: "Make MabelTV feel right for your family"
            }

            Rectangle {
                anchors.right: parent.right
                anchors.top: parent.top
                width: helpText.implicitWidth + 26
                height: 36
                radius: 18
                color: "#ffffff"
                border.color: "#dfe3de"

                Text {
                    id: helpText
                    anchors.centerIn: parent
                    color: "#69716d"
                    font.family: "DejaVu Sans"
                    font.pixelSize: 13
                    text: "↑ ↓ move   ← → change   OK choose"
                }
            }

            Grid {
                id: settingsGrid
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: settingsTitle.bottom
                anchors.bottom: settingsFooter.top
                anchors.topMargin: 42
                anchors.bottomMargin: 12
                columns: 2
                columnSpacing: 10
                rowSpacing: 7

                Repeater {
                    model: ["Playback", "Reset unwatched episodes", "Picture size",
                            "TV frame", "CRT glass", "90s picture wobble",
                            "Display quality", "Volume limit", "Maximum volume",
                            "TV sounds", "Channels & programmes", "Check library",
                            "Diagnostics", "Exit MabelTV", "Restart MabelTV",
                            "Shut down Raspberry Pi"]

                    Rectangle {
                        required property int index
                        required property string modelData
                        width: (settingsGrid.width - settingsGrid.columnSpacing) / 2
                        height: Math.max(46, (settingsGrid.height
                               - settingsGrid.rowSpacing * 7) / 8)
                        radius: 11
                        color: index === overlay.selectedRow && !overlay.sidebarFocused
                               ? "#fff0eb" : "#ffffff"
                        border.color: index === overlay.selectedRow && !overlay.sidebarFocused
                                      ? "#ed6a4d" : "#dfe3de"
                        border.width: index === overlay.selectedRow && !overlay.sidebarFocused ? 2 : 1

                        Rectangle {
                            anchors.left: parent.left
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: 13
                            width: 8
                            height: 8
                            radius: 4
                            color: index < 3 ? "#3d6d8a"
                                  : index < 7 ? "#8058a5"
                                  : index < 10 ? "#27735d"
                                  : index < 13 ? "#ed6a4d" : "#69716d"
                        }

                        Text {
                            anchors.left: parent.left
                            anchors.right: valueText.left
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: 30
                            anchors.rightMargin: 8
                            color: "#18201d"
                            elide: Text.ElideRight
                            font.family: "DejaVu Sans"
                            font.bold: index === overlay.selectedRow && !overlay.sidebarFocused
                            font.pixelSize: 14
                            text: modelData
                        }

                        Text {
                            id: valueText
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.rightMargin: 13
                            width: parent.width * 0.39
                            color: index === overlay.selectedRow && !overlay.sidebarFocused
                                   ? "#ce4f34" : "#69716d"
                            elide: Text.ElideRight
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 12
                            horizontalAlignment: Text.AlignRight
                            text: overlay.valueForRow(index)
                        }
                    }
                }
            }

            Text {
                id: settingsFooter
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                color: "#69716d"
                elide: Text.ElideRight
                font.family: "DejaVu Sans"
                font.pixelSize: 13
                text: controller.parentMessage
            }
        }

        Item {
            id: libraryPage
            anchors.left: sideRail.right
            anchors.right: parentPanel.right
            anchors.top: parentPanel.top
            anchors.bottom: parentPanel.bottom
            anchors.margins: 26
            visible: overlay.page === "library"
            opacity: overlay.sidebarFocused ? 0.55 : 1

            Text {
                id: libraryTitle
                anchors.left: parent.left
                anchors.top: parent.top
                color: "#18201d"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 34
                text: "Channels & programmes"
            }

            Text {
                anchors.left: parent.left
                anchors.top: libraryTitle.bottom
                anchors.topMargin: 3
                color: "#69716d"
                font.family: "DejaVu Sans"
                font.pixelSize: 15
                text: "Choose exactly what appears on the television"
            }

            Rectangle {
                id: channelPanel
                anchors.left: parent.left
                anchors.top: libraryTitle.bottom
                anchors.bottom: libraryFooter.top
                anchors.topMargin: 48
                anchors.bottomMargin: 14
                width: parent.width * 0.37
                radius: 15
                color: "#ffffff"
                border.width: overlay.programmePane ? 1 : 2
                border.color: overlay.programmePane ? "#dfe3de" : "#ed6a4d"

                Text {
                    id: channelHeader
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 17
                    color: "#69716d"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 13
                    text: "CHANNELS"
                }

                ListView {
                    id: channelList
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: channelHeader.bottom
                    anchors.bottom: parent.bottom
                    anchors.margins: 10
                    anchors.topMargin: 14
                    clip: true
                    currentIndex: overlay.selectedChannel
                    model: controller.parentLibrary

                    delegate: Rectangle {
                        required property int index
                        required property var modelData
                        width: channelList.width
                        height: 58
                        radius: 10
                        color: index === overlay.selectedChannel ? "#fff0eb" : "transparent"
                        border.color: index === overlay.selectedChannel ? "#ed6a4d" : "transparent"

                        Rectangle {
                            anchors.left: parent.left
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: 10
                            width: 40
                            height: 34
                            radius: 8
                            color: modelData.enabled ? "#151b19" : "#e7e9e5"

                            Text {
                                anchors.centerIn: parent
                                color: modelData.enabled ? "#ffffff" : "#69716d"
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: 12
                                text: "CH " + modelData.number
                            }
                        }

                        Text {
                            anchors.left: parent.left
                            anchors.right: channelStatus.left
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: 60
                            anchors.rightMargin: 8
                            color: modelData.enabled ? "#18201d" : "#8e9692"
                            elide: Text.ElideRight
                            font.family: "DejaVu Sans"
                            font.bold: index === overlay.selectedChannel
                            font.pixelSize: 15
                            text: modelData.name
                        }

                        Text {
                            id: channelStatus
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.rightMargin: 10
                            color: modelData.enabled ? "#27735d" : "#b74339"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 12
                            text: modelData.enabled ? "Shown" : "Hidden"
                        }
                    }
                }
            }

            Rectangle {
                anchors.left: channelPanel.right
                anchors.right: parent.right
                anchors.top: channelPanel.top
                anchors.bottom: channelPanel.bottom
                anchors.leftMargin: 13
                radius: 15
                color: "#ffffff"
                border.width: overlay.programmePane ? 2 : 1
                border.color: overlay.programmePane ? "#ed6a4d" : "#dfe3de"

                Text {
                    id: programmeHeader
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 17
                    color: "#69716d"
                    elide: Text.ElideRight
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 13
                    text: {
                        const channel = overlay.currentChannel()
                        return channel ? "PROGRAMMES  ·  " + channel.enabledProgrammeCount
                                + " OF " + channel.programmeCount + " SHOWN" : "PROGRAMMES"
                    }
                }

                ListView {
                    id: programmeList
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: programmeHeader.bottom
                    anchors.bottom: parent.bottom
                    anchors.margins: 10
                    anchors.topMargin: 14
                    clip: true
                    currentIndex: overlay.selectedProgramme
                    model: overlay.currentProgrammes()

                    delegate: Rectangle {
                        required property int index
                        required property var modelData
                        width: programmeList.width
                        height: 52
                        radius: 9
                        color: index === overlay.selectedProgramme ? "#fff0eb" : "transparent"
                        border.color: index === overlay.selectedProgramme ? "#ed6a4d" : "transparent"

                        Text {
                            anchors.left: parent.left
                            anchors.right: programmeStatus.left
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: 13
                            anchors.rightMargin: 9
                            color: modelData.enabled ? "#18201d" : "#8e9692"
                            elide: Text.ElideRight
                            font.family: "DejaVu Sans"
                            font.pixelSize: 14
                            text: modelData.name
                        }

                        Text {
                            id: programmeStatus
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.rightMargin: 12
                            color: modelData.enabled ? "#27735d" : "#b74339"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 12
                            text: modelData.enabled ? "Shown" : "Hidden"
                        }
                    }

                    Text {
                        anchors.centerIn: parent
                        visible: programmeList.count === 0
                        color: "#8e9692"
                        font.family: "DejaVu Sans"
                        font.pixelSize: 16
                        text: "No programmes in this channel yet"
                    }
                }
            }

            Text {
                id: libraryFooter
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                color: "#69716d"
                elide: Text.ElideRight
                font.family: "DejaVu Sans"
                font.pixelSize: 13
                text: controller.parentMessage
                      + "   ·   Left / right changes panel   ·   OK shows or hides"
            }
        }
    }
}
