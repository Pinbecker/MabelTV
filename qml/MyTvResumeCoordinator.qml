import QtQuick

// Release the My TV decoder before returning to the child player. A family
// presentation can claim playback during this delay and cancels that return.
Timer {
    required property var appRoot
    required property var controller
    required property var familyPlayer
    interval: 400
    repeat: false
    onTriggered: {
        if (appRoot.pendingPowerAction.length > 0) {
            appRoot.pendingPowerAction = ""
            appRoot.performPowerOff()
        } else if (familyPlayer.active) {
            appRoot.restoreChildPauseAfterMyTv = false
        } else if (appRoot.pendingPortalTuneChannel >= 0) {
            const channel = appRoot.pendingPortalTuneChannel
            appRoot.pendingPortalTuneChannel = -1
            controller.tunePortalChannel(channel)
        } else if (appRoot.pendingQueueStart) {
            appRoot.pendingQueueStart = false
            controller.startMabelQueue()
        } else if (appRoot.pendingPortalChannel >= 0 && appRoot.pendingPortalProgramme.length > 0) {
            const channel = appRoot.pendingPortalChannel
            const programme = appRoot.pendingPortalProgramme
            const position = appRoot.pendingPortalProgrammePosition
            appRoot.pendingPortalChannel = -1
            appRoot.pendingPortalProgramme = ""
            appRoot.pendingPortalProgrammePosition = 0
            controller.playPortalProgramme(channel, programme, position)
        } else controller.resumeFromStandby()
    }
}
