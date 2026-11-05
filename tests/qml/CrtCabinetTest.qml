import QtQuick
import "../../qml"
Item {
    id: root
    width: 960; height: 600
    property bool cached: false
    property string styleName: "charcoal-90s"
    readonly property string tvDisplayName: "Mabel"
    readonly property bool fullscreen: false
    readonly property bool usesDecorativeSurround: false
    readonly property bool isSlim: styleName === "slim-black"
    readonly property bool isSilver: styleName === "silver-90s"
    readonly property bool isCharcoal: styleName === "charcoal-90s"
    readonly property bool isVintage: styleName === "vintage-black"
    readonly property real radius: 50
    readonly property real fasciaTop: 470
    readonly property real lipWidth: 16
    readonly property color lipColor: isSilver ? "#484a47" : "#111311"
    Item { id: pictureTube; x: 60; y: 30; width: 840; height: 425; property real radius: 55 }
    CrtCabinet { anchors.fill: parent; cabinet: root; tube: pictureTube; cacheEnabled: root.cached }
}
