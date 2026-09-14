import QtQuick

Item {
    id: card
    required property var host
    required property var modelData
    required property bool selected
    property bool wide: false
    width: wide ? 345 * host.uiScale : 185 * host.uiScale
    height: wide ? 190 * host.uiScale : 310 * host.uiScale
    scale: selected ? 1.035 : 1
    z: selected ? 2 : 1
    Behavior on scale { NumberAnimation { duration: 110 } }

    Rectangle {
        id: artwork
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        height: card.wide ? parent.height : 248 * host.uiScale
        radius: 14 * host.uiScale
        color: "#e5e9ed"
        border.width: card.selected ? 4 * host.uiScale : 1
        border.color: card.selected ? host.accent : "#d8dde3"
        clip: true
        layer.enabled: true

        Image {
            anchors.fill: parent
            source: host.artworkUrl(card.modelData, card.wide)
            fillMode: Image.PreserveAspectCrop
            asynchronous: true
            cache: true
        }

        Row {
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.margins: 10 * host.uiScale
            spacing: 6 * host.uiScale
            Repeater {
                model: host.providerBadges(card.modelData)
                delegate: MyTvProviderIcon {
                    required property var modelData
                    provider: modelData
                    badgeSize: 34 * card.host.uiScale
                }
            }
        }

        Rectangle {
            visible: card.wide
            anchors.fill: parent
            gradient: Gradient {
                GradientStop { position: 0.35; color: "#00000000" }
                GradientStop { position: 1; color: "#db080b0e" }
            }
        }

        Column {
            visible: card.wide
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.margins: 16 * host.uiScale
            spacing: 5 * host.uiScale
            Text {
                width: parent.width
                color: host.accent
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 12 * host.uiScale
                text: host.progressLabel(card.modelData).toUpperCase()
            }
            Text {
                width: parent.width
                color: "white"
                elide: Text.ElideRight
                font.family: "DejaVu Sans"
                font.bold: true
                font.pixelSize: 22 * host.uiScale
                text: card.modelData.title || "Untitled"
            }
            Rectangle {
                visible: host.progressRatio(card.modelData) > 0
                width: parent.width
                height: 4 * host.uiScale
                radius: height / 2
                color: "#55ffffff"
                Rectangle {
                    height: parent.height
                    width: parent.width * host.progressRatio(card.modelData)
                    radius: parent.radius
                    color: host.accent
                }
            }
        }
    }

    Column {
        visible: !card.wide
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: artwork.bottom
        anchors.topMargin: 8 * host.uiScale
        spacing: 3 * host.uiScale
        Text {
            width: parent.width
            color: "#151922"
            elide: Text.ElideRight
            font.family: "DejaVu Sans"
            font.bold: true
            font.pixelSize: 15 * host.uiScale
            text: card.modelData.title || "Untitled"
        }
        Text {
            width: parent.width
            color: "#727b88"
            elide: Text.ElideRight
            font.family: "DejaVu Sans"
            font.pixelSize: 12 * host.uiScale
            text: [card.modelData.year || "", card.modelData.media_type === "tv" ? "Series" : "Film"]
                .filter(value => value).join("  ·  ")
        }
    }
}
