pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Shapes

Item {
    id: iconRoot

    property string icon: "check"
    property color color: "#ffffff"
    property real strokeWidth: 1.9

    readonly property string pathData: {
        switch (icon) {
        case "home":
            return "M3 11 L12 2 L21 11 M5 10 V21 H19 V10 M9 21 V15 H15 V21"
        case "play":
            return "M6 4 L20 12 L6 20 Z"
        case "picture":
            return "M5 3 H19 A2 2 0 0 1 21 5 V19 A2 2 0 0 1 19 21 H5 A2 2 0 0 1 3 19 V5 A2 2 0 0 1 5 3 M8.5 7 A1.5 1.5 0 1 1 8.49 7 M21 15 L16 10 L5 21"
        case "list":
            return "M4 6 H20 M4 12 H20 M4 18 H20"
        case "settings":
            return "M4 3 V10 M4 14 V21 M12 3 V6 M12 10 V21 M20 3 V14 M20 18 V21 M1 10 H7 M9 6 H15 M17 14 H23"
        case "chevron-left":
            return "M15 18 L9 12 L15 6"
        case "chevron-right":
            return "M9 18 L15 12 L9 6"
        case "circle-check":
            return "M21 12 A9 9 0 1 1 17.7 5 M8 12 L11 15 L22 4"
        case "circle-x":
            return "M21 12 A9 9 0 1 1 12 3 A9 9 0 0 1 21 12 M9 9 L15 15 M15 9 L9 15"
        default:
            return "M20 6 L9 17 L4 12"
        }
    }

    Shape {
        anchors.centerIn: parent
        width: 24
        height: 24
        scale: Math.min(iconRoot.width / 24, iconRoot.height / 24)

        ShapePath {
            strokeColor: iconRoot.color
            strokeWidth: iconRoot.strokeWidth
            fillColor: "transparent"
            capStyle: ShapePath.RoundCap
            joinStyle: ShapePath.RoundJoin

            PathSvg { path: iconRoot.pathData }
        }
    }
}
