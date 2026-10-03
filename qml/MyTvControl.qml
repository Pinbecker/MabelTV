import QtQuick

// A shared visual surface; each view retains its existing remote behaviour.
Rectangle {
    id: control
    property real uiScale: 1
    property bool highlighted: false
    property bool primary: false
    property bool checked: false
    property color accent: "#04c6a8"
    radius: 18 * uiScale
    color: primary || checked ? accent : highlighted ? "#e4f6f2" : "#ffffff"
    border.width: highlighted ? 3 * uiScale : 1
    border.color: highlighted ? "#007b6b" : primary || checked ? accent : "#d8e1e6"
    Behavior on color { ColorAnimation { duration: 110 } }
    Behavior on border.color { ColorAnimation { duration: 110 } }
}
