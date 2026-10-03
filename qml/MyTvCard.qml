pragma ComponentBehavior: Bound
import QtQuick

Item {
    id: card
    required property var host
    required property var modelData
    required property bool selected
    property bool wide: false
    readonly property real uiScale: host.uiScale
    MyTvArtwork {
        id: frame
        x: 4 * card.uiScale; y: 4 * card.uiScale
        width: parent.width - 8 * card.uiScale
        height: card.wide ? parent.height - 12 * card.uiScale : width * 1.5
        radius: 20 * card.uiScale
        artworkSource: card.host.artworkUrl(card.modelData, card.wide)
        focalX: card.host.artworkFocus(card.modelData).x
        focalY: card.host.artworkFocus(card.modelData).y
        queue: card.host.artworkQueue
        title: card.modelData.title || ""
        Rectangle {
            visible: card.wide
            anchors.fill: parent
            gradient: Gradient {
                GradientStop { position: 0.25; color: "#00000000" }
                GradientStop { position: 1; color: "#ee101a20" }
            }
        }
        Column {
            visible: card.wide
            anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom
            anchors.margins: 20 * card.uiScale
            anchors.bottomMargin: 22 * card.uiScale
            spacing: 4 * card.uiScale
            MyTvText { color: card.host.accent; font.weight: Font.DemiBold; font.pixelSize: 17 * card.uiScale; text: card.host.progressLabel(card.modelData) }
            MyTvText { width: parent.width; color: "white"; font.weight: Font.DemiBold; font.pixelSize: 24 * card.uiScale; elide: Text.ElideRight; text: card.modelData.title || "" }
            MyTvText { width: parent.width; color: "#d7e3e8"; font.pixelSize: 18 * card.uiScale; elide: Text.ElideRight; text: card.modelData.series_progress?.state === "next" ? card.modelData.series_progress.next_episode.name : [card.modelData.progress?.episode?.name, card.host.remainingLabel(card.modelData.progress)].filter(value => value).join(" · ") }
        }
        Rectangle {
            visible: card.wide
            anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom
            height: 5 * card.uiScale
            color: "#606c73"
            Rectangle { width: parent.width * card.host.progressRatio(card.modelData); height: parent.height; color: card.host.accent }
        }
    }
    Rectangle {
        x: frame.x; y: frame.y; width: frame.width; height: frame.height
        radius: frame.radius; color: "transparent"
        border.width: card.selected ? 4 * card.uiScale : 1
        border.color: card.selected ? "#008b79" : "#200e2731"
        Behavior on border.color { ColorAnimation { duration: 110 } }
    }
    Column {
        visible: !card.wide
        x: 5 * card.uiScale; y: frame.y + frame.height + 10 * card.uiScale
        width: parent.width - 10 * card.uiScale
        spacing: 6 * card.uiScale
        MyTvText { width: parent.width; color: card.selected ? "#007b6b" : "#17212a"; font.weight: Font.DemiBold; font.pixelSize: 24 * card.uiScale; elide: Text.ElideRight; text: card.modelData.title || "Untitled" }
        MyTvText { width: parent.width; color: "#657580"; font.pixelSize: 19 * card.uiScale; elide: Text.ElideRight; text: card.modelData.subtitle || (card.modelData.year || "") + (card.modelData.media_type === "tv" ? " · Series" : " · Film") }
    }
}
