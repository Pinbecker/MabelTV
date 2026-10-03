pragma ComponentBehavior: Bound
import QtQuick

Item {
    id: library
    required property var host
    required property var tvController
    readonly property real s: host.uiScale
    Rectangle {
        id: channelsPanel
        width: parent.width * 0.36; height: parent.height; radius: 24 * library.s
        color: "white"; border.color: "#d8e1e6"
        MyTvText { x: 26 * library.s; y: 24 * library.s; font.pixelSize: 24 * library.s; font.weight: Font.Bold; text: "Your channels" }
        ListView {
            id: channels
            x: 14 * library.s; y: 72 * library.s; width: parent.width - 28 * library.s; height: parent.height - y - 14 * library.s
            model: library.tvController.parentLibrary; currentIndex: library.host.selectedChannel
            spacing: 8 * library.s; clip: true; interactive: false; boundsBehavior: Flickable.StopAtBounds
            onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)
            delegate: MyTvControl {
                id: channel
                required property int index
                required property var modelData
                width: channels.width; height: 88 * library.s; uiScale: library.s
                highlighted: index === library.host.selectedChannel && !library.host.programmePane && !library.host.sidebarFocused
                color: index === library.host.selectedChannel ? "#e4f6f2" : "white"
                Rectangle {
                    x: 14 * library.s; y: 17 * library.s; width: 54 * library.s; height: width; radius: 17 * library.s; color: "#d9f0e9"
                    MyTvText { anchors.centerIn: parent; font.pixelSize: 23 * library.s; font.weight: Font.Bold; color: "#008b79"; text: channel.modelData.number }
                }
                Column {
                    x: 84 * library.s; y: 18 * library.s; width: parent.width - x - 70 * library.s; spacing: 5 * library.s
                    MyTvText { width: parent.width; font.pixelSize: 21 * library.s; font.weight: Font.DemiBold; elide: Text.ElideRight; text: channel.modelData.name }
                    MyTvText { color: "#647580"; font.pixelSize: 17 * library.s; text: channel.modelData.enabled ? "Shown on TV" : "Hidden from TV" }
                }
                SignalIcon { anchors.right: parent.right; anchors.rightMargin: 20 * library.s; anchors.verticalCenter: parent.verticalCenter; width: 26 * library.s; height: width; icon: channel.modelData.enabled ? "circle-check" : "circle-x"; color: channel.modelData.enabled ? "#008b79" : "#97a3aa" }
            }
        }
    }
    Rectangle {
        x: channelsPanel.width + 26 * library.s; width: parent.width - x; height: parent.height; radius: 24 * library.s
        color: "white"; border.color: "#d8e1e6"
        MyTvText { x: 26 * library.s; y: 24 * library.s; width: parent.width - 52 * library.s; elide: Text.ElideRight; font.pixelSize: 26 * library.s; font.weight: Font.Bold; text: library.host.currentChannel()?.name || "Choose a channel" }
        MyTvText { x: 26 * library.s; y: 63 * library.s; color: "#647580"; font.pixelSize: 18 * library.s; text: { const channel = library.host.currentChannel(); return channel ? channel.enabledProgrammeCount + " of " + channel.programmeCount + " programmes shown · OK to show or hide" : "" } }
        ListView {
            id: programmes
            x: 14 * library.s; y: 105 * library.s; width: parent.width - 28 * library.s; height: parent.height - y - 14 * library.s
            model: library.host.currentProgrammes(); currentIndex: library.host.selectedProgramme
            spacing: 7 * library.s; clip: true; interactive: false; boundsBehavior: Flickable.StopAtBounds
            onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)
            delegate: MyTvControl {
                id: programme
                required property int index
                required property var modelData
                width: programmes.width; height: 74 * library.s; uiScale: library.s
                highlighted: library.host.programmePane && !library.host.sidebarFocused && index === library.host.selectedProgramme
                MyTvText { x: 22 * library.s; anchors.verticalCenter: parent.verticalCenter; width: parent.width - 200 * library.s; font.pixelSize: 21 * library.s; elide: Text.ElideRight; color: programme.modelData.enabled ? "#17242d" : "#82919a"; text: programme.modelData.name }
                Row {
                    anchors.right: parent.right; anchors.rightMargin: 20 * library.s; anchors.verticalCenter: parent.verticalCenter; spacing: 10 * library.s
                    SignalIcon { width: 22 * library.s; height: width; color: programme.modelData.enabled ? "#008b79" : "#97a3aa"; icon: programme.modelData.enabled ? "circle-check" : "circle-x" }
                    MyTvText { width: 65 * library.s; font.pixelSize: 18 * library.s; color: programme.modelData.enabled ? "#008b79" : "#82919a"; text: programme.modelData.enabled ? "Shown" : "Hidden" }
                }
            }
        }
        MyTvText { anchors.centerIn: parent; visible: !library.host.currentProgrammes().length; color: "#647580"; font.pixelSize: 24 * library.s; text: "No programmes in this channel yet" }
    }
}
