import QtQuick

Item {
    property url source: ""
    property string status: "Idle"
    property bool paused: false
    property bool muted: false
    property int volume: 50
    property string aspectMode: "fit"
    property real playbackPosition: 0
    property real playbackDuration: 300
    property bool subtitlesAvailable: false
    property bool subtitlesVisible: false
    property bool subtitleDefaultOn: false
    property bool cachedSubtitles: false
    property int starts: 0
    signal playbackFinished()
    signal playbackStopped()
    signal playbackReady()
    signal playbackFailed(string message)
    function play(value, position) { source = value; playbackPosition = position; starts++; paused = false; status = "Playing" }
    function stop() { status = "Idle"; paused = false }
    function togglePause() { paused = !paused }
    function seekAbsolute(value) { playbackPosition = value }
    function seekRelative(value) { playbackPosition = Math.max(0,playbackPosition + value) }
    function positionSeconds() { return playbackPosition }
}
