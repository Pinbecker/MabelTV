pragma ComponentBehavior: Bound
import QtQuick

Rectangle {
    id: prompt
    required property var host
    required property var sequence
    readonly property real uiScale: host.uiScale
    anchors.right: parent.right
    anchors.rightMargin: 42 * uiScale
    anchors.bottom: parent.bottom
    anchors.bottomMargin: (host.scrubberActive || host.controlsOpacity > 0 ? 312 : 54) * uiScale
    width: 560 * uiScale; height: 178 * uiScale
    radius: 22 * uiScale; color: "#f2141e27"
    border.color: sequence.promptSelected ? "#84ead9" : "#46515c"
    border.width: sequence.promptSelected ? 2 : 1
    visible: sequence.promptVisible
    z: 8
    Column {
        anchors.fill: parent; anchors.margins: 22 * prompt.uiScale
        spacing: 10 * prompt.uiScale
        MyTvText { color: "#8adfd1"; font.pixelSize: 18 * prompt.uiScale; font.weight: Font.DemiBold; text: "UP NEXT · S" + (prompt.sequence.nextEpisode?.season || "") + " E" + (prompt.sequence.nextEpisode?.number || "") }
        MyTvText { width: parent.width; color: "#ffffff"; font.pixelSize: 25 * prompt.uiScale; font.weight: Font.DemiBold; elide: Text.ElideRight; text: prompt.sequence.nextEpisode?.episodeTitle || "Next episode" }
        Row {
            width: parent.width; spacing: 18 * prompt.uiScale
            MyTvControl {
                width: 238 * prompt.uiScale; height: 46 * prompt.uiScale
                uiScale: prompt.uiScale; primary: true; highlighted: prompt.sequence.promptSelected
                Row {
                    anchors.centerIn: parent; spacing: 10 * prompt.uiScale
                    MyTvIcon { name: "play"; width: 20 * prompt.uiScale; height: width; anchors.verticalCenter: parent.verticalCenter }
                    MyTvText { font.pixelSize: 19 * prompt.uiScale; font.weight: Font.DemiBold; text: "Next episode" }
                }
            }
            MyTvText {
                anchors.verticalCenter: parent.verticalCenter
                color: "#c1ccd4"; font.pixelSize: 18 * prompt.uiScale
                text: prompt.host.paused ? "Ready when you are" : "Starts in " + Math.max(0, Math.ceil(prompt.host.playbackDuration - prompt.host.playbackPosition)) + " sec"
            }
        }
    }
}
