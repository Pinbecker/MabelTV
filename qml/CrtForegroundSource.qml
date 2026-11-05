import QtQuick

ShaderEffectSource {
    property bool animating: false
    property string revision: ""
    function refresh() { Qt.callLater(scheduleUpdate) }
    live: animating
    smooth: true
    onRevisionChanged: refresh()
    // Capture the final transparent frame when an overlay finishes fading.
    onLiveChanged: refresh()
    Component.onCompleted: refresh()
}
