pragma ComponentBehavior: Bound

import QtQuick

// Presentation changes share Mabel TV's existing decoder, timeline and queue.
// Only the picture geometry and playback controls change; navigation stays here.
Item {
    id: presentation
    required property var appRoot
    required property var controller
    required property var mediaPlayer
    property string mode: "standard"
    readonly property bool available: !appRoot.introPlaying && !controller.standby
        && !appRoot.poweringOff && mediaPlayer.source.toString().length > 0
    readonly property bool playing: mediaPlayer.status === "Playing" || mediaPlayer.paused
    readonly property bool paused: mediaPlayer.paused
    readonly property real playbackPosition: mediaPlayer.playbackPosition
    readonly property real playbackDuration: mediaPlayer.playbackDuration
    readonly property var nextEpisode: null
    readonly property string episodeLabel: "CH " + controller.currentChannelNumber
        + " \u00b7 " + controller.currentChannelName
    readonly property string backActionLabel: "Close controls"
    readonly property real uiScale: Math.max(0.62, Math.min(width / 1920, height / 1080))
    property bool scrubberActive: false
    property int scrubberFocus: 0
    property real controlsOpacity: 0
    property bool controlsHidden: false
    visible: appRoot.portalFullScreenEnabled && !controller.standby
    z: 85

    onVisibleChanged: {
        if (visible) showControls()
        else { controlsTimer.stop(); scrubberActive = false; controlsOpacity = 0 }
    }
    function cycle() {
        if (!available && mode === "standard") return
        mode = mode === "standard" ? "widescreen" : mode === "widescreen" ? "fullscreen" : "standard"
        scrubberActive = false; scrubberFocus = 0
    }
    function currentFilm() { return {name: appRoot.currentProgrammeTitle} }
    function formatTime(seconds) {
        const value = Math.max(0, Math.floor(seconds || 0))
        const hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60)
        return (hours ? hours + ":" + String(minutes).padStart(2, "0") : String(minutes))
            + ":" + String(value % 60).padStart(2, "0")
    }
    function showControls() { controlsHidden = false; controlsOpacity = 1; controlsTimer.restart() }
    function toggleSubtitles() {
        if (mediaPlayer.subtitlesAvailable) mediaPlayer.toggleSubtitles()
        scrubberActive = true; scrubberFocus = 1; showControls()
    }
    function back() {
        // Close the controls, never enter the My TV library or stop the queue.
        scrubberActive = false; scrubberFocus = 0; controlsOpacity = 0; controlsHidden = true; controlsTimer.stop()
    }
    function handleKey(key, repeat) {
        if (!visible || !playing) return false
        if (key === Qt.Key_Escape || key === Qt.Key_Backspace || key === Qt.Key_B) {
            if (!repeat) back()
            return true
        }
        if (key === Qt.Key_PageUp || key === Qt.Key_PageDown || key === Qt.Key_Home
            || key === Qt.Key_P || key === Qt.Key_MediaNext || key === Qt.Key_MediaPrevious) return false
        if (key === Qt.Key_Left || key === Qt.Key_Right) {
            if (scrubberActive && scrubberFocus > 0) {
                if (!repeat) scrubberFocus = mediaPlayer.subtitlesAvailable
                    ? (key === Qt.Key_Right ? 1 : 2) : 2
            } else {
                appRoot.syncPlaybackPosition()
                mediaPlayer.seekRelative(key === Qt.Key_Left ? -15 : 15)
                scrubberActive = true; scrubberFocus = 0
            }
        } else if (key === Qt.Key_Up || key === Qt.Key_Down) {
            if (!repeat) {
                scrubberFocus = scrubberActive && key === Qt.Key_Up ? 2 : 0
                scrubberActive = true
            }
        } else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
            if (!repeat) {
                if (scrubberActive && scrubberFocus === 1) toggleSubtitles()
                else appRoot.togglePlaybackPause()
            }
        } else return false
        showControls(); return true
    }
    Timer {
        id: controlsTimer; interval: 5000
        onTriggered: if (!presentation.paused) {
            presentation.controlsOpacity = 0; presentation.scrubberActive = false; presentation.scrubberFocus = 0
        } else restart()
    }
    Connections {
        target: presentation.mediaPlayer
        function onSourceChanged() { if (presentation.visible) presentation.showControls() }
        function onPausedChanged() { if (presentation.visible) presentation.showControls() }
    }
    MyTvPlaybackControls { host: presentation; mediaPlayer: presentation.mediaPlayer }
}
