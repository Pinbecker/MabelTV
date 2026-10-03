import QtQuick

Item {
    required property var appRoot
    required property var controller
    required property var guide
    required property var myTvOverlay

    function start() {
        if (appRoot.poweringOff || appRoot.pendingPowerAction.length > 0) return
        guide.close()
        controller.closeParent()
        if (myTvOverlay.active) {
            myTvOverlay.close()
            appRoot.pendingQueueStart = true
        } else if (controller.standby || appRoot.introPlaying || appRoot.warmingUp) {
            appRoot.pendingQueueStart = true
        } else {
            controller.startMabelQueue()
        }
    }

    Timer {
        interval: 250
        repeat: true
        running: appRoot.pendingQueueStart && !myTvOverlay.active
        onTriggered: {
            if (controller.standby || appRoot.introPlaying || appRoot.warmingUp) return
            appRoot.pendingQueueStart = false
            controller.startMabelQueue()
        }
    }
}
