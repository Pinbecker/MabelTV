pragma ComponentBehavior: Bound
import QtQuick

Item {
    id: guide
    required property var controller
    property var rows: []
    property int selectedRow: 0
    property int selectedProgramme: 0
    readonly property real uiScale: Math.min(width / 1280, height / 960)
    readonly property int columns: width / Math.max(1, height) > 1.55 ? 3 : 2
    readonly property var selectedChannel: rows[selectedRow] || null
    visible: false

    function selectedChannelData() { return selectedChannel }
    function nowProgrammeIndex(channel) {
        const index = (channel?.programmes || []).findIndex(value => value.now)
        return Math.max(0, index)
    }
    function selectedProgrammeData() {
        return selectedChannel?.programmes?.[nowProgrammeIndex(selectedChannel)] || null
    }
    function refresh() {
        const number = selectedChannel?.number
        rows = controller.guideSchedule()
        const retained = rows.findIndex(row => row.number === number)
        selectedRow = retained >= 0 ? retained : Math.max(0, Math.min(selectedRow, rows.length - 1))
        selectedProgramme = nowProgrammeIndex(selectedChannel); artwork.refresh()
    }
    function open() {
        if (!controller.tvGuideEnabled) return
        refresh()
        const current = rows.findIndex(row => row.current)
        selectedRow = Math.max(0, current); selectedProgramme = nowProgrammeIndex(selectedChannel)
        visible = true
    }
    function close() { visible = false }
    function handleKey(key, parentPortalAuthorized) {
        if (!visible) return false
        let direction = 0
        if (key === Qt.Key_Up || key === Qt.Key_PageUp) direction = -columns
        else if (key === Qt.Key_Down || key === Qt.Key_PageDown) direction = columns
        else if (key === Qt.Key_Left) direction = -1
        else if (key === Qt.Key_Right) direction = 1
        else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
            if (selectedChannel) {
                if (parentPortalAuthorized === true) controller.tunePortalChannel(selectedChannel.number)
                else controller.tuneGuideChannel(selectedChannel.number)
                close()
            }
        } else if (key === Qt.Key_B || key === Qt.Key_Backspace || key === Qt.Key_Escape) close()
        else return false
        if (direction && rows.length) {
            selectedRow = Math.max(0, Math.min(rows.length - 1, selectedRow + direction))
            selectedProgramme = nowProgrammeIndex(selectedChannel)
        }
        return true
    }
    Connections {
        target: guide.controller
        function onTvGuideEnabledChanged() { if (!guide.controller.tvGuideEnabled) guide.close() }
    }
    Timer { interval: 15000; repeat: true; running: guide.visible; onTriggered: guide.refresh() }
    FontLoader { source: "qrc:/fonts/inter/InterVariable.ttf" }
    MabelChannelArtwork { id: artwork }
    MyTvArtworkQueue { id: downloads }
    // A few translucent rounded layers give depth without a costly blur pass.
    Repeater {
        model: 3
        Rectangle {
            required property int index
            x: panel.x - (3 - index) * 4 * guide.uiScale
            y: panel.y + (index + 1) * 5 * guide.uiScale
            width: panel.width + (3 - index) * 8 * guide.uiScale
            height: panel.height + (3 - index) * 8 * guide.uiScale
            radius: panel.radius + 8 * guide.uiScale
            color: "#142d35"; opacity: 0.055
        }
    }
    Rectangle {
        id: panel
        objectName: "channelMenuPanel"
        anchors.centerIn: parent
        width: parent.width * 0.88; height: parent.height * 0.84
        radius: 34 * guide.uiScale
        color: "#f7fbfa"; border.color: "#d0e9e3"; border.width: 2 * guide.uiScale
        Item {
            id: heading
            x: 32 * guide.uiScale; y: 24 * guide.uiScale
            width: parent.width - 64 * guide.uiScale; height: 90 * guide.uiScale
            Rectangle {
                width: 66 * guide.uiScale; height: width; radius: 23 * guide.uiScale
                color: "#04c6a8"; rotation: -5
                SignalIcon { anchors.centerIn: parent; width: 32 * guide.uiScale; height: width; icon: "play"; color: "#14362f" }
            }
            Column {
                x: 86 * guide.uiScale; width: parent.width - x - 120 * guide.uiScale
                spacing: 3 * guide.uiScale
                MyTvText { color: "#008b79"; font.pixelSize: 16 * guide.uiScale; font.weight: Font.DemiBold; font.letterSpacing: 2 * guide.uiScale; text: "LET'S FIND SOMETHING GOOD" }
                MyTvText { font.pixelSize: 38 * guide.uiScale; font.weight: Font.Bold; text: "Your channels" }
            }
            MyTvText { anchors.right: parent.right; y: 24 * guide.uiScale; font.pixelSize: 20 * guide.uiScale; color: "#647580"; text: guide.rows.length + " channels" }
        }
        GridView {
            id: channelGrid
            x: 26 * guide.uiScale; y: heading.y + heading.height
            width: parent.width - 52 * guide.uiScale
            height: parent.height - y - 106 * guide.uiScale
            clip: true; interactive: false; boundsBehavior: Flickable.StopAtBounds
            model: guide.rows; currentIndex: guide.selectedRow
            cellWidth: width / guide.columns; cellHeight: 188 * guide.uiScale
            onCurrentIndexChanged: positionViewAtIndex(currentIndex, GridView.Contain)
            delegate: Item {
                id: tile
                required property var modelData
                required property int index
                readonly property bool selected: index === guide.selectedRow
                readonly property var programme: modelData.programmes?.[guide.nowProgrammeIndex(modelData)] || null
                width: channelGrid.cellWidth; height: channelGrid.cellHeight
                MyTvControl {
                    x: 6 * guide.uiScale; y: 6 * guide.uiScale
                    width: parent.width - 12 * guide.uiScale; height: parent.height - 12 * guide.uiScale
                    uiScale: guide.uiScale; radius: 23 * uiScale; highlighted: tile.selected
                    MyTvArtwork {
                        id: picture
                        x: 12 * guide.uiScale; y: 12 * guide.uiScale
                        width: 92 * guide.uiScale; height: 138 * guide.uiScale; radius: 16 * guide.uiScale
                        artworkSource: artwork.source(tile.modelData.number)
                        title: tile.modelData.name; focalX: artwork.focalX(tile.modelData.name); queue: downloads
                    }
                    Column {
                        x: picture.x + picture.width + 16 * guide.uiScale; y: 18 * guide.uiScale
                        width: parent.width - x - 16 * guide.uiScale; spacing: 7 * guide.uiScale
                        MyTvText { color: "#008b79"; font.weight: Font.Bold; font.pixelSize: 15 * guide.uiScale; text: "CH " + tile.modelData.number + (tile.modelData.current ? "  ·  ON NOW" : "") }
                        MyTvText { width: parent.width; font.pixelSize: 24 * guide.uiScale; font.weight: Font.Bold; elide: Text.ElideRight; text: tile.modelData.name }
                        MyTvText { width: parent.width; height: 49 * guide.uiScale; font.pixelSize: 18 * guide.uiScale; color: "#647580"; wrapMode: Text.WordWrap; maximumLineCount: 2; elide: Text.ElideRight; text: tile.programme?.name || "Ready to watch" }
                        Rectangle {
                            width: parent.width; height: 5 * guide.uiScale; radius: height / 2; color: "#e3ece9"
                            Rectangle { width: parent.width * Math.max(0, Math.min(1, tile.programme?.progress || 0)); height: parent.height; radius: parent.radius; color: "#04c6a8" }
                        }
                    }
                }
            }
        }
        Rectangle { x: 32 * guide.uiScale; y: parent.height - 96 * guide.uiScale; width: parent.width - 64 * guide.uiScale; height: 1; color: "#d9e8e3" }
        Row {
            x: 32 * guide.uiScale; y: parent.height - 70 * guide.uiScale
            spacing: 22 * guide.uiScale
            MyTvControl {
                width: 150 * guide.uiScale; height: 46 * guide.uiScale; primary: true; uiScale: guide.uiScale
                MyTvText { anchors.centerIn: parent; font.pixelSize: 18 * guide.uiScale; font.weight: Font.Bold; text: "OK  ·  Watch" }
            }
            Column {
                width: panel.width - 440 * guide.uiScale; spacing: 3 * guide.uiScale
                MyTvText { width: parent.width; font.pixelSize: 18 * guide.uiScale; font.weight: Font.DemiBold; elide: Text.ElideRight; text: guide.selectedProgrammeData()?.name || "Choose a channel" }
                MyTvText { width: parent.width; color: "#647580"; font.pixelSize: 15 * guide.uiScale; elide: Text.ElideRight; text: { const channel = guide.selectedChannel; const next = channel?.programmes?.[guide.nowProgrammeIndex(channel) + 1]; return next ? "Next: " + next.name : "Enjoy something together" } }
            }
            MyTvText { y: 12 * guide.uiScale; font.pixelSize: 16 * guide.uiScale; color: "#647580"; text: "Back to close" }
        }
        MyTvText { visible: !guide.rows.length; anchors.centerIn: channelGrid; color: "#647580"; font.pixelSize: 24 * guide.uiScale; text: "Your channels will appear here" }
    }
}
