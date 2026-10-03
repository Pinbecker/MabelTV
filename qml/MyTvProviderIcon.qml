import QtQuick

MyTvRoundedClip {
    id: badge
    required property var provider
    property real badgeSize: 42
    width: badgeSize
    height: badgeSize
    radius: badgeSize * 0.28
    Rectangle { anchors.fill: parent; radius: badge.radius; color: "white" }
    clip: true

    Image {
        id: picture
        anchors.fill: parent
        anchors.margins: badge.provider.local === true ? parent.width * 0.08 : 0
        source: badge.provider.asset || ""
        fillMode: Image.PreserveAspectFit
        asynchronous: true
        cache: true
    }
    MyTvText {
        anchors.centerIn: parent
        visible: picture.status !== Image.Ready
        color: "#008b79"; font.weight: Font.DemiBold; font.pixelSize: badge.badgeSize * 0.3
        text: String(badge.provider.name || "TV").split(" ").map(word => word[0]).join("").slice(0, 3)
    }
}
