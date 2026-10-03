pragma ComponentBehavior: Bound
import QtQuick

Rectangle {
    id: playbackControls
    required property var host
    required property var mediaPlayer
    readonly property real uiScale: host.uiScale
    anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom
    anchors.leftMargin: 42 * uiScale; anchors.rightMargin: 42 * uiScale
    anchors.bottomMargin: 28 * uiScale
    visible: host.playing
    height: 262 * uiScale
    opacity: host.controlsHidden === true ? 0 : mediaPlayer.paused ? 1 : host.controlsOpacity
    radius: 22 * uiScale; color: "#f2141e27"; border.color: "#35424c"
    Behavior on opacity { NumberAnimation { duration: 180 } }

    Column {
        anchors.fill: parent; anchors.margins: 22 * playbackControls.uiScale
        spacing: 8 * playbackControls.uiScale
        Column {
            width: parent.width; height: 50 * playbackControls.uiScale; spacing: 4 * playbackControls.uiScale
            MyTvText {
                width: parent.width; color: "#ffffff"; font.weight: Font.DemiBold
                font.pixelSize: 27 * playbackControls.uiScale; elide: Text.ElideRight
                text: playbackControls.host.currentFilm()?.series?.title || playbackControls.host.currentFilm()?.name || ""
            }
            MyTvText {
                width: parent.width; color: "#c1ccd4"; font.pixelSize: 19 * playbackControls.uiScale
                elide: Text.ElideRight
                text: playbackControls.host.episodeLabel || (playbackControls.mediaPlayer.paused ? "Paused" : "Playing on My TV")
            }
        }
        Item {
            width: parent.width; height: 25 * playbackControls.uiScale
            Rectangle {
                id: timelineTrack
                anchors.left: parent.left; anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter
                height: 8 * playbackControls.uiScale; radius: height / 2; color: "#43505c"
                border.width: playbackControls.host.scrubberActive && playbackControls.host.scrubberFocus === 0 ? 2 : 0
                border.color: "#b5f3e9"
                readonly property real ratio: playbackControls.host.playbackDuration > 0
                    ? Math.min(1, Math.max(0, playbackControls.host.playbackPosition / playbackControls.host.playbackDuration)) : 0
                Rectangle { width: parent.width * timelineTrack.ratio; height: parent.height; radius: parent.radius; color: "#04c6a8" }
                Rectangle {
                    anchors.verticalCenter: parent.verticalCenter
                    x: Math.max(0, Math.min(parent.width - width, parent.width * timelineTrack.ratio - width / 2))
                    width: 18 * playbackControls.uiScale; height: width; radius: width / 2; color: "#ffffff"
                    visible: playbackControls.host.scrubberActive
                }
            }
        }
        Row {
            width: parent.width; height: 22 * playbackControls.uiScale
            MyTvText { width: parent.width / 2; color: "#e4ecf1"; font.pixelSize: 18 * playbackControls.uiScale; text: playbackControls.host.formatTime(playbackControls.host.playbackPosition) }
            MyTvText { width: parent.width / 2; horizontalAlignment: Text.AlignRight; color: "#c1ccd4"; font.pixelSize: 18 * playbackControls.uiScale; text: "−" + playbackControls.host.formatTime(Math.max(0, playbackControls.host.playbackDuration - playbackControls.host.playbackPosition)) + " remaining" }
        }
        Row {
            width: parent.width; height: 48 * playbackControls.uiScale; spacing: 14 * playbackControls.uiScale
            MyTvControl {
                width: 184 * playbackControls.uiScale; height: parent.height
                uiScale: playbackControls.uiScale; primary: true
                highlighted: playbackControls.host.scrubberActive && playbackControls.host.scrubberFocus === 2
                MyTvText { anchors.centerIn: parent; font.pixelSize: 20 * playbackControls.uiScale; font.weight: Font.DemiBold; text: playbackControls.mediaPlayer.paused ? "▶  Play" : "Ⅱ  Pause" }
            }
            MyTvControl {
                id: subtitleAction
                readonly property var host: playbackControls.host
                readonly property var mediaPlayer: playbackControls.mediaPlayer
                visible: host.scrubberActive && mediaPlayer.subtitlesAvailable
                width: 238 * playbackControls.uiScale; height: parent.height
                uiScale: playbackControls.uiScale; checked: mediaPlayer.subtitlesVisible
                highlighted: host.scrubberFocus === 1
                Row {
                    anchors.centerIn: parent; spacing: 10 * playbackControls.uiScale
                    MyTvIcon { name: "subtitles"; width: 24 * playbackControls.uiScale; height: width; anchors.verticalCenter: parent.verticalCenter }
                    MyTvText { font.pixelSize: 19 * playbackControls.uiScale; font.weight: Font.DemiBold; text: "Subtitles " + (subtitleAction.mediaPlayer.subtitlesVisible ? "on" : "off") }
                }
            }
            MyTvText {
                id: noSubtitlesMessage
                anchors.verticalCenter: parent.verticalCenter
                visible: playbackControls.host.scrubberActive && !playbackControls.mediaPlayer.subtitlesAvailable
                color: "#aeb8c1"; font.pixelSize: 16 * playbackControls.uiScale; text: "NO SUBTITLES AVAILABLE"
            }
            MyTvControl {
                visible: Boolean(playbackControls.host.nextEpisode)
                width: 232 * playbackControls.uiScale; height: parent.height
                uiScale: playbackControls.uiScale
                highlighted: playbackControls.host.scrubberActive && playbackControls.host.scrubberFocus === 3
                MyTvText { anchors.centerIn: parent; font.pixelSize: 19 * playbackControls.uiScale; font.weight: Font.DemiBold; text: "Next episode  →" }
            }
        }
        Rectangle { width: parent.width; height: 1; color: "#394954" }
        Row {
            spacing: 32 * playbackControls.uiScale
            readonly property bool choosing: playbackControls.host.scrubberActive && playbackControls.host.scrubberFocus > 0
            MyTvHint { keys: "← / →"; label: parent.choosing ? "Choose action" : "Seek 15 sec"; dark: true; uiScale: playbackControls.uiScale }
            MyTvHint { keys: parent.choosing ? "↓" : "↑"; label: parent.choosing ? "Timeline" : "Actions"; dark: true; uiScale: playbackControls.uiScale }
            MyTvHint { keys: "OK"; label: parent.choosing ? "Select" : "Play / Pause"; dark: true; uiScale: playbackControls.uiScale }
            MyTvHint { keys: "Back"; label: playbackControls.host.backActionLabel || "Close controls"; dark: true; uiScale: playbackControls.uiScale }
        }
    }
}
