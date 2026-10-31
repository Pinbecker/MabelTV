pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Window

Rectangle {
    id: cover
    objectName: "familyAudioOnlyCover"
    required property var host
    anchors.fill: parent
    z: 10000
    color: "black"
    visible: host.active && host.audioOnly
    property int framesRemaining: 0
    property real wakeStarted: 0
    property bool ready: false
    signal readyToListen()
    function start() {
        settle.stop(); ready = false; wakeStarted = 0; framesRemaining = 2
        cover.Window.window?.update()
    }
    function cancel() { settle.stop(); ready = false; framesRemaining = 0; wakeStarted = 0 }
    onVisibleChanged: if (!visible) cancel()
    Connections {
        target: cover.Window.window
        function onFrameSwapped() {
            if (!cover.visible || cover.host.closing || cover.framesRemaining <= 0) return
            cover.framesRemaining--
            if (cover.framesRemaining > 0) { cover.Window.window.update(); return }
            cover.wakeStarted = Date.now()
            cover.host.controller.turnOn()
            settle.restart()
        }
    }
    Timer {
        id: settle
        interval: 250; repeat: true
        onTriggered: {
            if (!cover.visible || cover.host.closing) { stop(); return }
            const elapsed = Date.now() - cover.wakeStarted
            const power = cover.host.controller.connectedTvPower || "unknown"
            // CEC status follows wake + Active Source. The minimum also lets
            // an already-on television switch its HDMI audio input first.
            if (elapsed >= 2000 && power === "on" || elapsed >= 8000) {
                stop(); cover.ready = true; cover.readyToListen()
            }
        }
    }
}
