pragma ComponentBehavior: Bound

import QtQuick
import MabelTV 1.0

Item {
    id: overlay

    required property var controller
    property string page: "overview"
    property int selectedRow: 0
    property int selectedChannel: 0
    property int selectedProgramme: 0
    property bool programmePane: false
    property bool sidebarFocused: false
    property int sidebarSelection: 0
    property int restartSequenceStep: 0
    property bool adultShortcutFocused: false
    readonly property real uiScale: Math.max(0.66, Math.min(width / 1920, height / 1080))
    readonly property var navPages: ["overview", "playback", "picture", "channels", "system"]

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

    function pageLabel(value) {
        if (value === "overview") return "Overview"
        if (value === "playback") return "Playback"
        if (value === "picture") return "Picture & sound"
        if (value === "channels") return "Channels"
        return "System"
    }

    function pageIcon(value) {
        if (value === "overview") return "⌂"
        if (value === "playback") return "▶"
        if (value === "picture") return "◫"
        if (value === "channels") return "≡"
        return "⚙"
    }

    function pageTitle(value) {
        if (value === "overview") return "Parent Controls"
        if (value === "playback") return "Playback"
        if (value === "picture") return "Picture & sound"
        if (value === "channels") return "Channels & programmes"
        return "System"
    }

    function pageSubtitle(value) {
        if (value === "overview") return "Everything you need to manage MabelTV"
        if (value === "playback") return "Choose how programmes behave on this TV"
        if (value === "picture") return "Tune the television experience for this screen"
        if (value === "channels") return "Choose exactly what appears on MabelTV"
        return "Library health, diagnostics and power controls"
    }

    function setPage(value) {
        page = value
        selectedRow = 0
        programmePane = false
        sidebarFocused = false
        if (value === "channels")
            clampLibrarySelection()
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
        case 10: return controller.scrubbingEnabled ? "On" : "Off"
        case 11: return "Open library"
        case 12: return "Check now"
        case 13: return controller.libraryStatus.split("\n")[0].toUpperCase()
        case 14: return controller.adultLibrary.length + " films"
        case 15: return "Relaunch"
        case 16: return Qt.platform.os === "windows" ? "Pi only" : "Safe power off"
        }
        return ""
    }

    function sliderValueForRow(index) {
        if (index === 4)
            return controller.crtGlass
        if (index === 5)
            return controller.videoDistortion
        if (index === 8)
            return controller.configuredMaximumVolume
        return 0
    }

    function labelForRow(index) {
        switch (index) {
        case 0: return "Playback mode"
        case 1: return "Reset unvisited episodes"
        case 2: return "Picture size"
        case 3: return "TV frame"
        case 4: return "CRT glass"
        case 5: return "90s picture wobble"
        case 6: return "Display quality"
        case 7: return "Volume limit"
        case 8: return "Maximum volume"
        case 9: return "TV sounds"
        case 10: return "Playback scrubbing"
        case 11: return "Channels & programmes"
        case 12: return "Check library"
        case 13: return "Diagnostics"
        case 14: return "Adult mode"
        case 15: return "Restart MabelTV"
        case 16: return "Shut down Raspberry Pi"
        }
        return ""
    }

    function descriptionForRow(index) {
        switch (index) {
        case 0: return "Channels continue playing in the background, just like live television."
        case 1: return "A partly watched episode can become unvisited again after a quiet period."
        case 2: return "Choose whether MabelTV follows the channel's preferred picture shape."
        case 3: return "Select the frame drawn around the television picture."
        case 4: return "Add a restrained curved-glass effect to the picture."
        case 5: return "Control the amount of deliberate analogue picture movement."
        case 6: return "Choose the display resolution used after MabelTV relaunches."
        case 7: return "Keep the television below the family's chosen maximum volume."
        case 8: return "Set the loudest volume MabelTV is allowed to use."
        case 9: return "Enable or silence the tuning and power sound effects."
        case 10: return "Allow left and right to move through the current programme."
        case 12: return "Reload the channel library and check that programmes are ready."
        case 13: return "View the latest library and player health information."
        case 14: return "Open the separate grown-up film library."
        case 15: return "Safely relaunch the television player without rebooting the Pi."
        case 16: return "Safely power off the Raspberry Pi and television player."
        }
        return ""
    }

    function rowsForPage(value) {
        if (value === "playback") return [0, 1, 10]
        if (value === "picture") return [2, 3, 4, 5, 7, 8, 9]
        if (value === "system") return [12, 13, 14, 15, 16]
        return []
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
            setPage("channels")
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

    function overviewValue(index) {
        if (index === 0) return pretty(controller.playbackMode)
        if (index === 1) return pretty(controller.pictureMode)
        if (index === 2) return controller.parentLibrary.length + " channels"
        return controller.libraryStatus.split("\n")[0]
    }

    function overviewDescription(index) {
        if (index === 0) return "Programme behaviour, episode reset and scrubbing"
        if (index === 1) return "Picture shape, frame, effects and volume"
        if (index === 2) return "Choose the channels and programmes shown on TV"
        return "Library checks, diagnostics, adult mode and power"
    }

    function openSidebar() {
        sidebarFocused = true
        sidebarSelection = Math.max(0, navPages.indexOf(page))
    }

    function activateSidebarSelection() {
        setPage(navPages[sidebarSelection])
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

    function moveOverview(horizontal, vertical) {
        const column = selectedRow % 2
        const row = Math.floor(selectedRow / 2)
        const nextColumn = (column + horizontal + 2) % 2
        const nextRow = (row + vertical + 2) % 2
        selectedRow = nextRow * 2 + nextColumn
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

        if (sidebarFocused) {
            if (key === Qt.Key_Up) {
                sidebarSelection = (sidebarSelection + navPages.length - 1) % navPages.length
            } else if (key === Qt.Key_Down) {
                sidebarSelection = (sidebarSelection + 1) % navPages.length
            } else if (key === Qt.Key_Right || key === Qt.Key_Return
                       || key === Qt.Key_Enter) {
                activateSidebarSelection()
            } else if (key === Qt.Key_Escape || key === Qt.Key_Backspace
                       || key === Qt.Key_B) {
                sidebarFocused = false
            } else {
                return false
            }
            return true
        }

        if (page === "channels") {
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
                setPage("overview")
            } else {
                return false
            }
            return true
        }

        if (page === "overview") {
            if (key === Qt.Key_Up) {
                moveOverview(0, -1)
            } else if (key === Qt.Key_Down) {
                moveOverview(0, 1)
            } else if (key === Qt.Key_Left) {
                if (selectedRow % 2 === 0)
                    openSidebar()
                else
                    moveOverview(-1, 0)
            } else if (key === Qt.Key_Right) {
                moveOverview(1, 0)
            } else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
                setPage(["playback", "picture", "channels", "system"][selectedRow])
            } else if (key === Qt.Key_Escape || key === Qt.Key_Backspace
                       || key === Qt.Key_B) {
                controller.closeParent()
            } else {
                return false
            }
            return true
        }

        const rows = rowsForPage(page)
        if (key === Qt.Key_Up) {
            if (rows.length > 0)
                selectedRow = (selectedRow + rows.length - 1) % rows.length
        } else if (key === Qt.Key_Down) {
            if (rows.length > 0)
                selectedRow = (selectedRow + 1) % rows.length
        } else if (key === Qt.Key_Left) {
            if (page === "system")
                openSidebar()
            else if (rows.length > 0)
                adjustRow(rows[selectedRow], -1)
        } else if (key === Qt.Key_Right) {
            if (page !== "system" && rows.length > 0)
                adjustRow(rows[selectedRow], 1)
        } else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
            if (rows.length > 0)
                activateRow(rows[selectedRow])
        } else if (key === Qt.Key_Escape || key === Qt.Key_Backspace
                   || key === Qt.Key_B) {
            setPage("overview")
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
                overlay.page = "overview"
                overlay.selectedRow = 0
                overlay.programmePane = false
                overlay.sidebarFocused = false
            }
        }
    }

    Rectangle {
        anchors.fill: parent
        color: "#020407"
        opacity: controller.parentAccessState === TvController.ParentConfirmation ? 0.76 : 0.94
    }

    Item {
        anchors.fill: parent
        visible: controller.parentAccessState === TvController.ParentConfirmation

        Rectangle {
            id: confirmationPanel
            anchors.centerIn: parent
            width: Math.min(parent.width - 100 * overlay.uiScale, 1380 * overlay.uiScale)
            height: Math.min(parent.height - 92 * overlay.uiScale, 830 * overlay.uiScale)
            radius: 22 * overlay.uiScale
            color: "#f2171b20"
            border.color: "#555e66"
            border.width: 1

            Row {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: parent.top
                anchors.topMargin: 42 * overlay.uiScale
                spacing: 12 * overlay.uiScale

                Rectangle {
                    width: 38 * overlay.uiScale
                    height: 31 * overlay.uiScale
                    radius: 7 * overlay.uiScale
                    color: "#ff6b57"

                    Text {
                        anchors.centerIn: parent
                        color: "#15181d"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: 20 * overlay.uiScale
                        text: "M"
                    }
                }

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    color: "#f8f5ef"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 25 * overlay.uiScale
                    text: "MabelTV"
                }
            }

            Item {
                id: lockIcon
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: parent.top
                anchors.topMargin: 110 * overlay.uiScale
                width: 88 * overlay.uiScale
                height: 88 * overlay.uiScale

                Rectangle {
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.bottom: parent.bottom
                    width: 64 * overlay.uiScale
                    height: 50 * overlay.uiScale
                    radius: 11 * overlay.uiScale
                    color: "transparent"
                    border.color: "#ff7562"
                    border.width: 3
                }

                Rectangle {
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.top: parent.top
                    width: 42 * overlay.uiScale
                    height: 48 * overlay.uiScale
                    radius: 21 * overlay.uiScale
                    color: "transparent"
                    border.color: "#f3efe8"
                    border.width: 3
                }

                Rectangle {
                    anchors.horizontalCenter: parent.horizontalCenter
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.verticalCenterOffset: 20 * overlay.uiScale
                    width: 7 * overlay.uiScale
                    height: 14 * overlay.uiScale
                    radius: width / 2
                    color: "#f3efe8"
                }
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: lockIcon.bottom
                anchors.topMargin: 22 * overlay.uiScale
                color: "#f8f5ef"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 47 * overlay.uiScale
                text: "GROWN-UPS ONLY"
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: lockIcon.bottom
                anchors.topMargin: 87 * overlay.uiScale
                color: "#c0c5c8"
                font.family: "DejaVu Sans"
                font.pixelSize: 22 * overlay.uiScale
                text: overlay.adultShortcutFocused
                      ? "Adult mode selected — press OK to open"
                      : "Press OK three times to open Parent Controls"
            }

            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.verticalCenter: parent.verticalCenter
                anchors.verticalCenterOffset: 4 * overlay.uiScale
                width: 430 * overlay.uiScale
                height: 62 * overlay.uiScale
                radius: 12 * overlay.uiScale
                color: overlay.adultShortcutFocused ? "#fff0eb" : "#171c22"
                border.color: overlay.adultShortcutFocused ? "#ff6b57" : "#4b535b"
                border.width: overlay.adultShortcutFocused ? 3 : 1

                Text {
                    anchors.centerIn: parent
                    color: overlay.adultShortcutFocused ? "#20252a" : "#f8f5ef"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 19 * overlay.uiScale
                    text: "↑  Adult mode     OK  Open"
                }
            }

            Row {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.verticalCenter: parent.verticalCenter
                anchors.verticalCenterOffset: 88 * overlay.uiScale
                spacing: 18 * overlay.uiScale

                Repeater {
                    model: 3

                    Rectangle {
                        required property int index
                        width: 36 * overlay.uiScale
                        height: 36 * overlay.uiScale
                        radius: width / 2
                        color: index < controller.parentConfirmationCount
                               ? "#ff6b57" : "transparent"
                        border.color: index < controller.parentConfirmationCount
                                      ? "#ff8a78" : "#646c73"
                        border.width: 2
                    }
                }

                Text {
                    anchors.verticalCenter: parent.verticalCenter
                    color: "#7dd4ca"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 20 * overlay.uiScale
                    text: controller.parentConfirmationCount + " of 3"
                }
            }

            Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.bottom: parent.bottom
                anchors.bottomMargin: 114 * overlay.uiScale
                width: 430 * overlay.uiScale
                height: 72 * overlay.uiScale
                radius: 12 * overlay.uiScale
                color: "#171c22"
                border.color: "#ff6b57"
                border.width: 3

                Text {
                    anchors.centerIn: parent
                    color: "#f8f5ef"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 22 * overlay.uiScale
                    text: controller.parentConfirmationCount === 2
                          ? "OK   Press once more" : "OK   Confirm"
                }
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.bottom: parent.bottom
                anchors.bottomMargin: 65 * overlay.uiScale
                color: "#aeb5b9"
                font.family: "DejaVu Sans"
                font.pixelSize: 16 * overlay.uiScale
                text: "Back   Cancel"
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.bottom: parent.bottom
                anchors.bottomMargin: 25 * overlay.uiScale
                color: overlay.restartSequenceStep > 0 ? "#ff8a78" : "#7dd4ca"
                font.family: "DejaVu Sans"
                font.pixelSize: 15 * overlay.uiScale
                text: "Restart this programme   ←  →  OK"
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: controller.parentAccessState === TvController.ParentOpen

        Rectangle {
            anchors.fill: parent
            color: "#080b0f"
        }

        Rectangle {
            id: sideRail
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.bottom: footer.top
            width: 365 * overlay.uiScale
            color: "#0b0e12"
            border.color: "#2b3138"
            border.width: 1

            Row {
                anchors.left: parent.left
                anchors.top: parent.top
                anchors.leftMargin: 42 * overlay.uiScale
                anchors.topMargin: 44 * overlay.uiScale
                spacing: 12 * overlay.uiScale

                Text {
                    color: "#f8f5ef"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 35 * overlay.uiScale
                    text: "Mabel"
                }
                Text {
                    anchors.baseline: parent.children[0].baseline
                    color: "#ff6b57"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 35 * overlay.uiScale
                    text: "TV"
                }
            }

            Text {
                anchors.left: parent.left
                anchors.top: parent.top
                anchors.leftMargin: 44 * overlay.uiScale
                anchors.topMargin: 94 * overlay.uiScale
                color: "#808890"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 14 * overlay.uiScale
                text: "PARENT CONTROLS"
            }

            Column {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.topMargin: 170 * overlay.uiScale
                spacing: 8 * overlay.uiScale

                Repeater {
                    model: overlay.navPages

                    Rectangle {
                        id: navItem
                        required property string modelData
                        required property int index
                        readonly property bool selected: overlay.sidebarFocused
                                ? overlay.sidebarSelection === index
                                : overlay.page === modelData
                        width: parent.width
                        height: 78 * overlay.uiScale
                        color: selected ? "#181d23" : "transparent"
                        border.color: overlay.sidebarFocused
                                      && overlay.sidebarSelection === index
                                      ? "#ff6b57" : "transparent"
                        border.width: overlay.sidebarFocused
                                      && overlay.sidebarSelection === index ? 2 : 0

                        Rectangle {
                            anchors.left: parent.left
                            anchors.top: parent.top
                            anchors.bottom: parent.bottom
                            width: 7 * overlay.uiScale
                            color: navItem.selected ? "#ff6b57" : "transparent"
                        }

                        Text {
                            anchors.left: parent.left
                            anchors.leftMargin: 48 * overlay.uiScale
                            anchors.verticalCenter: parent.verticalCenter
                            width: 42 * overlay.uiScale
                            color: navItem.selected ? "#ff7562" : "#bbc1c5"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 25 * overlay.uiScale
                            horizontalAlignment: Text.AlignHCenter
                            text: overlay.pageIcon(navItem.modelData)
                        }

                        Text {
                            anchors.left: parent.left
                            anchors.leftMargin: 114 * overlay.uiScale
                            anchors.right: parent.right
                            anchors.rightMargin: 20 * overlay.uiScale
                            anchors.verticalCenter: parent.verticalCenter
                            color: navItem.selected ? "#ff7562" : "#c5cace"
                            elide: Text.ElideRight
                            font.family: "DejaVu Sans"
                            font.bold: navItem.selected
                            font.pixelSize: 20 * overlay.uiScale
                            text: overlay.pageLabel(navItem.modelData)
                        }
                    }
                }
            }

            Text {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.margins: 38 * overlay.uiScale
                color: overlay.sidebarFocused ? "#ff8a78" : "#747d84"
                wrapMode: Text.WordWrap
                font.family: "DejaVu Sans"
                font.pixelSize: 15 * overlay.uiScale
                text: overlay.sidebarFocused
                      ? "SIDEBAR FOCUS\n↑ ↓ choose   ·   OK open"
                      : "Back returns to Overview\nLeft from Overview opens this menu"
            }
        }

        Item {
            id: content
            anchors.left: sideRail.right
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.bottom: footer.top
            opacity: overlay.sidebarFocused ? 0.46 : 1

            Text {
                id: contentTitle
                anchors.left: parent.left
                anchors.top: parent.top
                anchors.leftMargin: 56 * overlay.uiScale
                anchors.topMargin: 50 * overlay.uiScale
                color: "#f8f5ef"
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 50 * overlay.uiScale
                text: overlay.pageTitle(overlay.page)
            }

            Text {
                anchors.left: contentTitle.left
                anchors.top: contentTitle.bottom
                anchors.topMargin: 6 * overlay.uiScale
                color: "#aeb5b9"
                font.family: "DejaVu Sans"
                font.pixelSize: 21 * overlay.uiScale
                text: overlay.pageSubtitle(overlay.page)
            }

            Rectangle {
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.rightMargin: 52 * overlay.uiScale
                anchors.topMargin: 56 * overlay.uiScale
                width: savedText.implicitWidth + 54 * overlay.uiScale
                height: 50 * overlay.uiScale
                radius: height / 2
                color: "#11171a"
                border.color: "#303b3c"
                border.width: 1

                Text {
                    id: savedText
                    anchors.centerIn: parent
                    color: "#7dd4ca"
                    font.family: "DejaVu Sans"
                    font.pixelSize: 16 * overlay.uiScale
                    text: "✓   All changes saved"
                }
            }

            Grid {
                id: overviewGrid
                visible: overlay.page === "overview"
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                anchors.leftMargin: 54 * overlay.uiScale
                anchors.rightMargin: 52 * overlay.uiScale
                anchors.topMargin: 190 * overlay.uiScale
                anchors.bottomMargin: 38 * overlay.uiScale
                columns: 2
                columnSpacing: 18 * overlay.uiScale
                rowSpacing: 18 * overlay.uiScale

                Repeater {
                    model: ["Playback", "Picture & sound", "Channels", "System"]

                    Rectangle {
                        id: overviewCard
                        required property string modelData
                        required property int index
                        width: (overviewGrid.width - overviewGrid.columnSpacing) / 2
                        height: (overviewGrid.height - overviewGrid.rowSpacing) / 2
                        radius: 14 * overlay.uiScale
                        color: index === overlay.selectedRow && !overlay.sidebarFocused
                               ? "#1a2026" : "#11161b"
                        border.color: index === overlay.selectedRow && !overlay.sidebarFocused
                                      ? "#ff6b57" : "#303840"
                        border.width: index === overlay.selectedRow && !overlay.sidebarFocused ? 3 : 1

                        Rectangle {
                            anchors.left: parent.left
                            anchors.top: parent.top
                            anchors.leftMargin: 26 * overlay.uiScale
                            anchors.topMargin: 24 * overlay.uiScale
                            width: 54 * overlay.uiScale
                            height: 54 * overlay.uiScale
                            radius: 10 * overlay.uiScale
                            color: index === overlay.selectedRow ? "#ff6b57" : "#252c33"

                            Text {
                                anchors.centerIn: parent
                                color: index === overlay.selectedRow ? "#12161b" : "#d8dcde"
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: 25 * overlay.uiScale
                                text: overlay.pageIcon(["playback", "picture", "channels", "system"][overviewCard.index])
                            }
                        }

                        Text {
                            anchors.left: parent.left
                            anchors.top: parent.top
                            anchors.leftMargin: 100 * overlay.uiScale
                            anchors.topMargin: 27 * overlay.uiScale
                            color: "#f6f3ed"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 25 * overlay.uiScale
                            text: overviewCard.modelData
                        }

                        Text {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.top: parent.top
                            anchors.leftMargin: 26 * overlay.uiScale
                            anchors.rightMargin: 26 * overlay.uiScale
                            anchors.topMargin: 100 * overlay.uiScale
                            color: index === overlay.selectedRow ? "#ff8a78" : "#7dd4ca"
                            elide: Text.ElideRight
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 20 * overlay.uiScale
                            text: overlay.overviewValue(overviewCard.index)
                        }

                        Text {
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.top: parent.top
                            anchors.leftMargin: 26 * overlay.uiScale
                            anchors.rightMargin: 26 * overlay.uiScale
                            anchors.topMargin: 142 * overlay.uiScale
                            color: "#9ea6ab"
                            wrapMode: Text.WordWrap
                            font.family: "DejaVu Sans"
                            font.pixelSize: 16 * overlay.uiScale
                            text: overlay.overviewDescription(overviewCard.index)
                        }

                        Text {
                            anchors.right: parent.right
                            anchors.bottom: parent.bottom
                            anchors.margins: 24 * overlay.uiScale
                            color: index === overlay.selectedRow ? "#f8f5ef" : "#687179"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 15 * overlay.uiScale
                            text: "OK   Open"
                        }
                    }
                }
            }

            Item {
                id: settingsPage
                visible: overlay.page === "playback" || overlay.page === "picture"
                         || overlay.page === "system"
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                anchors.leftMargin: 54 * overlay.uiScale
                anchors.rightMargin: 52 * overlay.uiScale
                anchors.topMargin: 180 * overlay.uiScale
                anchors.bottomMargin: 32 * overlay.uiScale

                Rectangle {
                    id: informationPanel
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    height: 118 * overlay.uiScale
                    radius: 12 * overlay.uiScale
                    color: "#11161b"
                    border.color: "#2d353c"
                    border.width: 1

                    Text {
                        anchors.left: parent.left
                        anchors.top: parent.top
                        anchors.leftMargin: 26 * overlay.uiScale
                        anchors.topMargin: 20 * overlay.uiScale
                        color: "#757e85"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: 13 * overlay.uiScale
                        text: overlay.page === "system" ? "ABOUT THIS ACTION" : "HOW THIS WORKS"
                    }

                    Text {
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.bottom: parent.bottom
                        anchors.leftMargin: 26 * overlay.uiScale
                        anchors.rightMargin: 26 * overlay.uiScale
                        anchors.bottomMargin: 21 * overlay.uiScale
                        color: "#d4d8da"
                        elide: Text.ElideRight
                        font.family: "DejaVu Sans"
                        font.pixelSize: 17 * overlay.uiScale
                        text: {
                            const rows = overlay.rowsForPage(overlay.page)
                            if (rows.length === 0)
                                return ""
                            return overlay.descriptionForRow(rows[overlay.selectedRow])
                        }
                    }
                }

                ListView {
                    id: settingsList
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.bottom: informationPanel.top
                    anchors.bottomMargin: 18 * overlay.uiScale
                    clip: true
                    spacing: 10 * overlay.uiScale
                    model: overlay.rowsForPage(overlay.page)
                    currentIndex: overlay.selectedRow
                    boundsBehavior: Flickable.StopAtBounds
                    interactive: false

                    onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

                    delegate: Rectangle {
                        id: settingRow
                        required property int modelData
                        required property int index
                        readonly property bool selected: index === overlay.selectedRow
                                && !overlay.sidebarFocused
                        readonly property bool hasSlider: modelData === 4 || modelData === 5
                                                         || modelData === 8
                        width: settingsList.width
                        height: 94 * overlay.uiScale
                        radius: 11 * overlay.uiScale
                        color: selected ? "#1a2026" : "#12171c"
                        border.color: selected ? "#ff6b57" : "#30373e"
                        border.width: selected ? 3 : 1

                        Text {
                            anchors.left: parent.left
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: 28 * overlay.uiScale
                            color: "#f4f1ec"
                            font.family: "DejaVu Sans"
                            font.bold: true
                            font.pixelSize: 22 * overlay.uiScale
                            text: overlay.labelForRow(settingRow.modelData)
                        }

                        Row {
                            anchors.right: parent.right
                            anchors.rightMargin: 26 * overlay.uiScale
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 22 * overlay.uiScale

                            Text {
                                visible: settingRow.modelData <= 10
                                anchors.verticalCenter: parent.verticalCenter
                                color: settingRow.selected ? "#ff7562" : "#747d84"
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: 28 * overlay.uiScale
                                text: "‹"
                            }

                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                visible: !settingRow.hasSlider
                                color: settingRow.selected ? "#f8f5ef" : "#c6cbce"
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: 20 * overlay.uiScale
                                text: overlay.valueForRow(settingRow.modelData)
                            }

                            Item {
                                visible: settingRow.hasSlider
                                width: 220 * overlay.uiScale
                                height: 36 * overlay.uiScale

                                Rectangle {
                                    anchors.left: parent.left
                                    anchors.right: valueLabel.left
                                    anchors.rightMargin: 14 * overlay.uiScale
                                    anchors.verticalCenter: parent.verticalCenter
                                    height: 8 * overlay.uiScale
                                    radius: height / 2
                                    color: "#3a4249"

                                    Rectangle {
                                        width: parent.width * overlay.sliderValueForRow(settingRow.modelData) / 100
                                        height: parent.height
                                        radius: parent.radius
                                        color: settingRow.selected ? "#ff6b57" : "#a6afb4"
                                    }
                                }

                                Text {
                                    id: valueLabel
                                    anchors.right: parent.right
                                    anchors.verticalCenter: parent.verticalCenter
                                    color: settingRow.selected ? "#f8f5ef" : "#c6cbce"
                                    font.family: "DejaVu Sans"
                                    font.bold: true
                                    font.pixelSize: 20 * overlay.uiScale
                                    text: overlay.valueForRow(settingRow.modelData)
                                }
                            }

                            Text {
                                visible: settingRow.modelData <= 10
                                anchors.verticalCenter: parent.verticalCenter
                                color: settingRow.selected ? "#ff7562" : "#747d84"
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: 28 * overlay.uiScale
                                text: "›"
                            }
                        }
                    }
                }
            }

            Item {
                id: channelsPage
                visible: overlay.page === "channels"
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                anchors.leftMargin: 54 * overlay.uiScale
                anchors.rightMargin: 52 * overlay.uiScale
                anchors.topMargin: 180 * overlay.uiScale
                anchors.bottomMargin: 34 * overlay.uiScale

                Rectangle {
                    id: channelPanel
                    anchors.left: parent.left
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    width: parent.width * 0.39
                    radius: 13 * overlay.uiScale
                    color: "#101419"
                    border.color: !overlay.programmePane && !overlay.sidebarFocused
                                  ? "#ff6b57" : "#30373e"
                    border.width: !overlay.programmePane && !overlay.sidebarFocused ? 3 : 1

                    Text {
                        id: channelHeading
                        anchors.left: parent.left
                        anchors.top: parent.top
                        anchors.leftMargin: 24 * overlay.uiScale
                        anchors.topMargin: 22 * overlay.uiScale
                        color: "#f1eee8"
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: 20 * overlay.uiScale
                        text: "CHANNELS"
                    }

                    ListView {
                        id: channelList
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: channelHeading.bottom
                        anchors.bottom: parent.bottom
                        anchors.margins: 14 * overlay.uiScale
                        anchors.topMargin: 20 * overlay.uiScale
                        clip: true
                        spacing: 6 * overlay.uiScale
                        currentIndex: overlay.selectedChannel
                        model: controller.parentLibrary
                        boundsBehavior: Flickable.StopAtBounds
                        interactive: false

                        onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

                        delegate: Rectangle {
                            id: channelEntry
                            required property int index
                            required property var modelData
                            width: channelList.width
                            height: 82 * overlay.uiScale
                            radius: 10 * overlay.uiScale
                            color: index === overlay.selectedChannel ? "#1c2228" : "transparent"
                            border.color: index === overlay.selectedChannel
                                          && !overlay.programmePane ? "#ff6b57" : "transparent"
                            border.width: index === overlay.selectedChannel
                                          && !overlay.programmePane ? 2 : 0

                            Rectangle {
                                anchors.left: parent.left
                                anchors.leftMargin: 14 * overlay.uiScale
                                anchors.verticalCenter: parent.verticalCenter
                                width: 56 * overlay.uiScale
                                height: 56 * overlay.uiScale
                                radius: 9 * overlay.uiScale
                                color: index === overlay.selectedChannel ? "#ff6b57" : "#242b32"

                                Text {
                                    anchors.centerIn: parent
                                    color: index === overlay.selectedChannel ? "#11151a" : "#f3f1ec"
                                    font.family: "DejaVu Sans"
                                    font.bold: true
                                    font.pixelSize: 25 * overlay.uiScale
                                    text: channelEntry.modelData.number
                                }
                            }

                            Text {
                                anchors.left: parent.left
                                anchors.right: channelStatus.left
                                anchors.leftMargin: 88 * overlay.uiScale
                                anchors.rightMargin: 12 * overlay.uiScale
                                anchors.verticalCenter: parent.verticalCenter
                                color: channelEntry.modelData.enabled ? "#f0eee8" : "#7f878d"
                                elide: Text.ElideRight
                                font.family: "DejaVu Sans"
                                font.bold: index === overlay.selectedChannel
                                font.pixelSize: 18 * overlay.uiScale
                                text: channelEntry.modelData.name
                            }

                            Text {
                                id: channelStatus
                                anchors.right: parent.right
                                anchors.rightMargin: 14 * overlay.uiScale
                                anchors.verticalCenter: parent.verticalCenter
                                color: channelEntry.modelData.enabled ? "#7dd4ca" : "#df7d78"
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: 14 * overlay.uiScale
                                text: channelEntry.modelData.enabled ? "◉  Shown" : "⊘  Hidden"
                            }
                        }
                    }
                }

                Rectangle {
                    anchors.left: channelPanel.right
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.bottom: parent.bottom
                    anchors.leftMargin: 18 * overlay.uiScale
                    radius: 13 * overlay.uiScale
                    color: "#101419"
                    border.color: overlay.programmePane && !overlay.sidebarFocused
                                  ? "#ff6b57" : "#30373e"
                    border.width: overlay.programmePane && !overlay.sidebarFocused ? 3 : 1

                    Text {
                        id: programmeHeading
                        anchors.left: parent.left
                        anchors.top: parent.top
                        anchors.leftMargin: 24 * overlay.uiScale
                        anchors.topMargin: 20 * overlay.uiScale
                        color: "#f1eee8"
                        elide: Text.ElideRight
                        font.family: "DejaVu Sans"
                        font.bold: true
                        font.pixelSize: 21 * overlay.uiScale
                        text: {
                            const channel = overlay.currentChannel()
                            return channel ? channel.name.toUpperCase() : "PROGRAMMES"
                        }
                    }

                    Text {
                        anchors.left: parent.left
                        anchors.top: programmeHeading.bottom
                        anchors.leftMargin: 24 * overlay.uiScale
                        anchors.topMargin: 5 * overlay.uiScale
                        color: "#9ba3a8"
                        font.family: "DejaVu Sans"
                        font.pixelSize: 15 * overlay.uiScale
                        text: {
                            const channel = overlay.currentChannel()
                            return channel ? channel.enabledProgrammeCount + " of "
                                    + channel.programmeCount + " shown" : ""
                        }
                    }

                    Rectangle {
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.leftMargin: 24 * overlay.uiScale
                        anchors.rightMargin: 24 * overlay.uiScale
                        anchors.topMargin: 82 * overlay.uiScale
                        height: 4 * overlay.uiScale
                        radius: height / 2
                        color: "#30373d"

                        Rectangle {
                            width: {
                                const channel = overlay.currentChannel()
                                if (!channel || channel.programmeCount === 0)
                                    return 0
                                return parent.width * channel.enabledProgrammeCount
                                        / channel.programmeCount
                            }
                            height: parent.height
                            radius: parent.radius
                            color: "#7dd4ca"
                        }
                    }

                    ListView {
                        id: programmeList
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.bottom: parent.bottom
                        anchors.leftMargin: 14 * overlay.uiScale
                        anchors.rightMargin: 14 * overlay.uiScale
                        anchors.topMargin: 108 * overlay.uiScale
                        anchors.bottomMargin: 14 * overlay.uiScale
                        clip: true
                        spacing: 5 * overlay.uiScale
                        currentIndex: overlay.selectedProgramme
                        model: overlay.currentProgrammes()
                        boundsBehavior: Flickable.StopAtBounds
                        interactive: false

                        onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)

                        delegate: Rectangle {
                            id: programmeEntry
                            required property int index
                            required property var modelData
                            readonly property bool selected: index === overlay.selectedProgramme
                                    && overlay.programmePane
                            width: programmeList.width
                            height: 72 * overlay.uiScale
                            radius: 9 * overlay.uiScale
                            color: selected ? "#1b2127" : "#12171b"
                            border.color: selected ? "#ff6b57" : "#282f35"
                            border.width: selected ? 3 : 1

                            Text {
                                anchors.left: parent.left
                                anchors.right: programmeState.left
                                anchors.leftMargin: 20 * overlay.uiScale
                                anchors.rightMargin: 12 * overlay.uiScale
                                anchors.verticalCenter: parent.verticalCenter
                                color: programmeEntry.modelData.enabled ? "#f2efe9" : "#7f878d"
                                elide: Text.ElideRight
                                font.family: "DejaVu Sans"
                                font.bold: programmeEntry.selected
                                font.pixelSize: 17 * overlay.uiScale
                                text: programmeEntry.modelData.name
                            }

                            Text {
                                id: programmeState
                                anchors.right: parent.right
                                anchors.rightMargin: 18 * overlay.uiScale
                                anchors.verticalCenter: parent.verticalCenter
                                color: programmeEntry.modelData.enabled ? "#7dd4ca" : "#df7d78"
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: 14 * overlay.uiScale
                                text: programmeEntry.selected
                                      ? (programmeEntry.modelData.enabled ? "OK  Hide" : "OK  Show")
                                      : (programmeEntry.modelData.enabled ? "◉  Shown" : "⊘  Hidden")
                            }
                        }

                        Text {
                            anchors.centerIn: parent
                            visible: programmeList.count === 0
                            color: "#838c92"
                            font.family: "DejaVu Sans"
                            font.pixelSize: 18 * overlay.uiScale
                            text: "No programmes in this channel yet"
                        }
                    }
                }
            }
        }

        Rectangle {
            id: footer
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: 82 * overlay.uiScale
            color: "#090c10"
            border.color: "#2c3238"
            border.width: 1

            Row {
                anchors.centerIn: parent
                spacing: 50 * overlay.uiScale

                Text {
                    color: "#d8dcde"
                    font.family: "DejaVu Sans"
                    font.pixelSize: 16 * overlay.uiScale
                    text: "↑  ↓   Move"
                }
                Text {
                    color: "#d8dcde"
                    font.family: "DejaVu Sans"
                    font.pixelSize: 16 * overlay.uiScale
                    text: overlay.page === "channels" ? "←  →   Change panel" : "←  →   Change"
                }
                Text {
                    color: "#f7f4ee"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 16 * overlay.uiScale
                    text: overlay.page === "channels" ? "OK   Show or hide" : "OK   Select"
                }
                Text {
                    color: "#d8dcde"
                    font.family: "DejaVu Sans"
                    font.pixelSize: 16 * overlay.uiScale
                    text: overlay.page === "overview" ? "Back   Close" : "Back   Overview"
                }
            }

            Text {
                anchors.right: parent.right
                anchors.rightMargin: 32 * overlay.uiScale
                anchors.verticalCenter: parent.verticalCenter
                width: 300 * overlay.uiScale
                color: "#7dd4ca"
                elide: Text.ElideRight
                horizontalAlignment: Text.AlignRight
                font.family: "DejaVu Sans"
                font.pixelSize: 13 * overlay.uiScale
                text: controller.parentMessage
            }
        }
    }
}
