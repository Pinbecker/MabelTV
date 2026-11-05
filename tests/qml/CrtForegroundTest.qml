import QtQuick
import "../../qml"
Item {
    id: root
    width: 100; height: 100
    property color colour: "red"
    property real sourceOpacity: 1
    property bool animating: false
    property int generation: 0
    Item {
        id: artwork
        anchors.fill: parent
        Rectangle { anchors.fill: parent; color: root.colour; opacity: root.sourceOpacity }
    }
    CrtForegroundSource {
        anchors.fill: parent
        sourceItem: artwork
        hideSource: true
        animating: root.animating
        revision: String(root.generation)
    }
}
