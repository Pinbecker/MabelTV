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

    ParentConfirmationView {
        host: overlay
        tvController: controller
    }
    ParentDashboardView {
        host: overlay
        tvController: controller
    }
}
