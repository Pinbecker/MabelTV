pragma ComponentBehavior: Bound
import QtQuick

// A portal request shares the library player and its decoder hand-off.
Item {
    id: bridge
    required property var appRoot
    required property var host
    property var pending: null
    property int generation: 0

    function request(payload) {
        const token = ++generation
        const fields = ["kind", "file", "series", "position"].filter(key => payload[key] !== undefined)
            .map(key => key + "=" + encodeURIComponent(payload[key])).join("&")
        host.loadPortalPlayback("/api/native/my-tv/playback?" + fields, result => {
            if (token !== generation || appRoot.poweringOff || appRoot.pendingPowerAction.length) return
            pending = { item: result.item, position: result.position }
            host.portalTransitionPending = true
            appRoot.familyMedia.close(false)
            appRoot.channelOverlay.close()
            if (host.active) prepare()
            else appRoot.enterMyTvMode()
        })
    }
    function prepare() {
        if (!pending) return
        if (host.playing || host.stopping) host.stopFilm()
        else handoff.restart()
    }
    Timer {
        id: handoff
        interval: 400
        onTriggered: {
            if (!bridge.pending || !bridge.host.active || bridge.host.closing) return
            const choice = bridge.pending
            bridge.pending = null
            bridge.host.startNativePlayback(choice.item, choice.position)
            bridge.host.portalTransitionPending = false
        }
    }
    Connections {
        target: bridge.host
        function onActiveChanged() { if (bridge.host.active) bridge.prepare() }
        function onStoppingChanged() { if (!bridge.host.stopping && bridge.pending) bridge.prepare() }
        function onClosed() {
            bridge.generation++; bridge.pending = null; handoff.stop()
            bridge.host.portalTransitionPending = false
        }
    }
}
