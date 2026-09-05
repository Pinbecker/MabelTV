pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Window
import MabelTV 1.0
Item {
    required property var appRoot
    required property var controllerObject
    required property var adultOverlay
    required property var channelOverlay
    required property var guide
    required property var parentMenu
    required property var muteHold
    required property var guideHold
    required property var parentHold
    required property var emergencyRestart
    required property var channelSummaryHold

    anchors.fill: parent
    focus: true

    Keys.onPressed: event => {
        if (appRoot.poweringOff || appRoot.pendingPowerAction.length > 0) {
            event.accepted = true
        } else if (event.key === Qt.Key_M) {
            if (!event.isAutoRepeat) {
                appRoot.muteHeldForLock = false
                muteHold.restart()
            }
            event.accepted = true
        } else if (controllerObject.remoteLocked) {
            event.accepted = true
        } else if (adultOverlay.active) {
            if (event.key === Qt.Key_P) {
                event.accepted = true
            } else {
                event.accepted = adultOverlay.handleKey(event.key, event.isAutoRepeat)
            }
        } else if (channelOverlay.visible
                   && appRoot.homeHeldForChannelSummary
                   && event.key === Qt.Key_Home) {
            // Ignore the repeat tail of the Home hold that opened this
            // overlay. A fresh Home press still closes it normally.
            event.accepted = true
        } else if (channelOverlay.visible) {
            event.accepted = channelOverlay.handleKey(event.key, event.isAutoRepeat)
        } else if (guide.visible && appRoot.okHeldForGuide
                   && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter)) {
            // Ignore the repeat tail of the same OK hold that opened the
            // guide. Otherwise it immediately tunes and closes the guide.
            event.accepted = true
        } else if (guide.visible) {
            event.accepted = guide.handleKey(event.key)
        } else if (parentMenu.visible && event.key === Qt.Key_B
                && appRoot.previousHeldForParent) {
            // Swallow the repeat tail of the same Back hold that opened
            // parent access. A fresh Back press still closes the overlay.
            event.accepted = true
        } else if (parentMenu.visible) {
            event.accepted = parentMenu.handleKey(event.key, event.modifiers)
        } else if (Qt.platform.os === "windows"
                   && event.key === Qt.Key_G
                   && (event.modifiers & Qt.ControlModifier) !== 0
                   && controllerObject.tvGuideEnabled && !directMediaMode) {
            guide.open()
            event.accepted = true
        } else if (event.key === Qt.Key_P
                   && (event.modifiers & Qt.ControlModifier) !== 0) {
            controllerObject.requestParentAccess()
            event.accepted = true
        } else if (appRoot.introPlaying
                   && event.key !== Qt.Key_F11
                   && event.key !== Qt.Key_Escape
                   && !(event.key === Qt.Key_F4
                        && (event.modifiers & Qt.AltModifier) !== 0)) {
            event.accepted = true
        } else if (!event.isAutoRepeat && controllerObject.tvGuideEnabled
                   && !directMediaMode && !controllerObject.standby
                   && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
                   && controllerObject.numericEntry.length === 0) {
            appRoot.okHeldForGuide = false
            guideHold.restart()
            event.accepted = true
        } else if (event.key === Qt.Key_B) {
            if (!event.isAutoRepeat) {
                appRoot.previousHeldForParent = false
                appRoot.previousHeldForRestart = false
                parentHold.restart()
                emergencyRestart.restart()
            }
            event.accepted = true
        } else if (event.key === Qt.Key_Home && !directMediaMode
                   && !controllerObject.standby) {
            if (!event.isAutoRepeat) {
                appRoot.homeHeldForChannelSummary = false
                channelSummaryHold.restart()
            }
            event.accepted = true
        } else if (event.key === Qt.Key_P) {
            event.accepted = true
        } else if (event.key >= Qt.Key_0 && event.key <= Qt.Key_9
                   && !event.isAutoRepeat && !directMediaMode) {
            controllerObject.enterDigit(event.key - Qt.Key_0)
            event.accepted = true
        } else if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
                   && controllerObject.numericEntry.length > 0) {
            controllerObject.confirmNumericEntry()
            event.accepted = true
        } else if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
                   && !event.isAutoRepeat && !directMediaMode) {
            appRoot.togglePlaybackPause()
            event.accepted = true
        } else if (controllerObject.scrubbingEnabled && !directMediaMode
                   && !controllerObject.standby
                   && (event.key === Qt.Key_Left || event.key === Qt.Key_Right)) {
            if (event.key === Qt.Key_Left) {
                appRoot.scrubPlayback(event.isAutoRepeat ? -30 : -15)
            } else {
                appRoot.scrubPlayback(event.isAutoRepeat ? 30 : 15)
            }
            event.accepted = true
        } else if (event.key === Qt.Key_PageUp) {
            if (appRoot.acceptRepeat("channel", event.isAutoRepeat)) {
                appRoot.syncPlaybackPosition()
                controllerObject.dispatch(TvController.ChannelUp)
            }
            event.accepted = true
        } else if (event.key === Qt.Key_PageDown) {
            if (appRoot.acceptRepeat("channel", event.isAutoRepeat)) {
                appRoot.syncPlaybackPosition()
                controllerObject.dispatch(TvController.ChannelDown)
            }
            event.accepted = true
        } else if (event.key === Qt.Key_Up) {
            if (!event.isAutoRepeat) {
                appRoot.syncPlaybackPosition()
                controllerObject.dispatch(TvController.PreviousProgramme)
            }
            event.accepted = true
        } else if (event.key === Qt.Key_Down) {
            if (!event.isAutoRepeat) {
                appRoot.syncPlaybackPosition()
                controllerObject.dispatch(TvController.NextProgramme)
            }
            event.accepted = true
        } else if (event.key === Qt.Key_Plus || event.key === Qt.Key_Equal) {
            if (appRoot.acceptRepeat("volume", event.isAutoRepeat))
                controllerObject.dispatch(TvController.VolumeUp)
            event.accepted = true
        } else if (event.key === Qt.Key_Minus) {
            if (appRoot.acceptRepeat("volume", event.isAutoRepeat))
                controllerObject.dispatch(TvController.VolumeDown)
            event.accepted = true
        } else if ((event.key === Qt.Key_Left || event.key === Qt.Key_Right)
                   && !directMediaMode) {
            // Left/Right are deliberately inert when scrubbing is off.
            // Programme navigation lives on Up/Down, so a distant or
            // accidental press cannot change what Mabel is watching.
            event.accepted = true
        } else if (event.key === Qt.Key_R && !event.isAutoRepeat && !directMediaMode) {
            appRoot.syncPlaybackPosition()
            controllerObject.dispatch(TvController.RandomEpisode)
            event.accepted = true
        } else if (event.key === Qt.Key_Space && directMediaMode) {
            appRoot.togglePlaybackPause()
            event.accepted = true
        } else if (event.key === Qt.Key_F11) {
            appRoot.visibility = appRoot.visibility === Window.FullScreen
                    ? Window.Windowed : Window.FullScreen
            event.accepted = true
        } else if (event.key === Qt.Key_Escape && appRoot.visibility === Window.FullScreen) {
            appRoot.visibility = Window.Windowed
            event.accepted = true
        }
    }

    Keys.onReleased: event => {
        if (adultOverlay.active
                && adultOverlay.handleKeyReleased(event.key, event.isAutoRepeat)) {
            event.accepted = true
        } else if (event.key === Qt.Key_M && !event.isAutoRepeat) {
            if (muteHold.running) {
                muteHold.stop()
                if (!appRoot.muteHeldForLock && !controllerObject.remoteLocked)
                    controllerObject.dispatch(TvController.ToggleMute)
            }
            appRoot.muteHeldForLock = false
            event.accepted = true
        } else if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
                   && !event.isAutoRepeat
                   && (guideHold.running || appRoot.okHeldForGuide)) {
            if (guideHold.running)
                guideHold.stop()
            if (!appRoot.okHeldForGuide && !controllerObject.remoteLocked
                    && !guide.visible && !directMediaMode)
                appRoot.togglePlaybackPause()
            appRoot.okHeldForGuide = false
            event.accepted = true
        } else if (event.key === Qt.Key_B && !event.isAutoRepeat) {
            if (emergencyRestart.running)
                emergencyRestart.stop()
            if (parentHold.running)
                parentHold.stop()
            appRoot.previousHeldForParent = false
            appRoot.previousHeldForRestart = false
            event.accepted = true
        } else if (event.key === Qt.Key_Home && !event.isAutoRepeat) {
            if (channelSummaryHold.running)
                channelSummaryHold.stop()
            appRoot.homeHeldForChannelSummary = false
            event.accepted = true
        } else if (event.key === Qt.Key_P && !event.isAutoRepeat) {
            if (!controllerObject.remoteLocked) {
                if (controllerObject.standby)
                    controllerObject.turnOn()
                else
                    appRoot.beginPowerOff()
            }
            event.accepted = true
        }
    }
}
