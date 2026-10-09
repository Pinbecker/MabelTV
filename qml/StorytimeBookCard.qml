pragma ComponentBehavior: Bound
import QtQuick

Item {
    id: card
    required property var story
    property string childName: "Mabel"
    property bool selected: false
    property bool revealEnabled: true
    property bool docking: false
    property int coverIndex: 0
    property real uiScale: 1
    property real previewProgress: 0
    readonly property bool opening: previewAnimation.running
    signal activated()
    signal rustled()
    function settlePreview() {
        previewDelay.stop(); previewAnimation.stop()
        previewAnimation.to = selected && revealEnabled && story.ready ? 1 : 0
        previewAnimation.duration = previewAnimation.to ? 1150 : 380
        previewAnimation.start()
        if (previewAnimation.to && previewProgress < .4) rustled()
    }
    function cancelPreview() {
        previewDelay.stop(); previewAnimation.stop()
        previewAnimation.to = 0; previewAnimation.duration = 380; previewAnimation.start()
    }
    onSelectedChanged: { if (selected) previewDelay.restart(); else cancelPreview() }
    onRevealEnabledChanged: { if (revealEnabled && selected) previewDelay.restart(); else cancelPreview() }
    scale: selected ? 1.035 : 1
    z: selected ? 2 : 0
    Behavior on scale { NumberAnimation { duration: 260; easing.type: Easing.OutCubic } }
    Rectangle {
        anchors.horizontalCenter: parent.horizontalCenter; y: 21 * card.uiScale
        width: parent.width - 18 * card.uiScale; height: parent.height - 41 * card.uiScale
        radius: 32 * card.uiScale; color: "#163d2e"; opacity: card.selected ? .33 : 0
        border.width: 2 * card.uiScale; border.color: "#d6bd78"
        Behavior on opacity { NumberAnimation { duration: 220 } }
    }
    Storybook {
        id: volume; objectName: "storytimePreviewBook"
        width: height * 1.4; height: 270 * card.uiScale
        anchors.horizontalCenter: parent.horizontalCenter; y: 36 * card.uiScale
        childName: card.childName; storyTitle: card.story.title || "Your next story"
        coverTitle: storyTitle; illustration: card.story.illustration || ""
        coverIndex: card.coverIndex
        preview: true; progress: card.previewProgress; visible: !card.docking
    }
    MyTvText {
        anchors.horizontalCenter: parent.horizontalCenter; y: volume.y + volume.height + 20 * card.uiScale
        width: parent.width - 36 * card.uiScale; text: card.story.title || ""
        color: card.selected ? "#fff0c5" : "#e8dfc9"; font.weight: Font.DemiBold
        font.pixelSize: 23 * card.uiScale; horizontalAlignment: Text.AlignHCenter; elide: Text.ElideRight
    }
    MyTvText {
        anchors.horizontalCenter: parent.horizontalCenter; y: volume.y + volume.height + 52 * card.uiScale
        text: !card.story.ready ? "Still being prepared" : Number(card.story.position || 0) > 10 ? "Continue your story" : "A little adventure awaits"
        color: "#c5c2ad"; font.pixelSize: 17 * card.uiScale
    }
    MouseArea { anchors.fill: parent; onClicked: card.activated() }
    Timer { id: previewDelay; interval: 220; onTriggered: card.settlePreview() }
    NumberAnimation { id: previewAnimation; target: card; property: "previewProgress"; easing.type: Easing.InOutCubic }
}
