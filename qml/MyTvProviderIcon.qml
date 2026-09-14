import QtQuick

Rectangle {
    id: badge
    required property var provider
    property real badgeSize: 42
    width: badgeSize
    height: badgeSize
    radius: badgeSize * 0.28
    color: "#ffffff"
    border.width: Math.max(2, badgeSize * 0.06)
    border.color: "#ffffff"
    clip: true

    Image {
        anchors.fill: parent
        anchors.margins: badge.provider.local === true ? parent.width * 0.08 : 0
        source: badge.provider.asset || ""
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        cache: true
    }
}
