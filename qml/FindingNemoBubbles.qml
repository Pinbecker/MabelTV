pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Shapes

Item {
    required property var cabinet
    z: 1.5
    component Bubble: Item {
        id: bubble
        implicitWidth: 24
        implicitHeight: 24
        height: width
        Shape {
            anchors.fill: parent
            antialiasing: true
            ShapePath {
                strokeColor: "#e0f5e9"
                strokeWidth: bubble.width * 0.07
                fillGradient: LinearGradient {
                    x1: 0; y1: 0; x2: bubble.width; y2: bubble.height
                    GradientStop { position: 0; color: "#608be1df" }
                    GradientStop { position: 0.65; color: "#104fa7c3" }
                    GradientStop { position: 1; color: "#906abbc9" }
                }
                PathAngleArc {
                    centerX: bubble.width / 2; centerY: bubble.height / 2
                    radiusX: bubble.width * 0.44; radiusY: radiusX
                    startAngle: 0; sweepAngle: 360
                }
            }
            ShapePath {
                strokeColor: "#eefbee"
                strokeWidth: bubble.width * 0.10
                capStyle: ShapePath.RoundCap
                fillColor: "transparent"
                PathAngleArc {
                    centerX: bubble.width / 2; centerY: bubble.height / 2
                    radiusX: bubble.width * 0.28; radiusY: radiusX
                    startAngle: 204; sweepAngle: 50
                }
            }
        }
    }

    Bubble {
        objectName: "bubble:1"
        width: cabinet._sideSpace * 0.17
        x: cabinet._sideCenter + cabinet._sideSpace * -0.1 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.195 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:2"
        width: cabinet._sideSpace * 0.075
        x: cabinet._sideCenter + cabinet._sideSpace * 0.1 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.222 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:3"
        width: cabinet._sideSpace * 0.17
        x: cabinet._sideCenter + cabinet._sideSpace * 0.07 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.439 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:4"
        width: cabinet._sideSpace * 0.075
        x: cabinet._sideCenter + cabinet._sideSpace * -0.12 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.464 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:5"
        width: cabinet._sideSpace * 0.16
        x: cabinet._sideCenter + cabinet._sideSpace * -0.1 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.656 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:6"
        width: cabinet._sideSpace * 0.08
        x: cabinet._sideCenter + cabinet._sideSpace * 0.1 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.683 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:7"
        width: cabinet._sideSpace * 0.045
        x: cabinet._sideCenter + cabinet._sideSpace * -0.06 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.701 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:8"
        width: cabinet._sideSpace * 0.18
        x: cabinet._sideCenter + cabinet._sideSpace * 0.07 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.914 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:9"
        width: cabinet._sideSpace * 0.085
        x: cabinet._sideCenter + cabinet._sideSpace * -0.12 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.943 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:10"
        width: cabinet._sideSpace * 0.045
        x: cabinet._sideCenter + cabinet._sideSpace * 0.05 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.968 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:11"
        width: cabinet._sideSpace * 0.18
        x: cabinet.width - cabinet._sideCenter + cabinet._sideSpace * 0.05 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.251 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:12"
        width: cabinet._sideSpace * 0.08
        x: cabinet.width - cabinet._sideCenter + cabinet._sideSpace * -0.12 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.278 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:13"
        width: cabinet._sideSpace * 0.045
        x: cabinet.width - cabinet._sideCenter + cabinet._sideSpace * 0.12 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.293 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:14"
        width: cabinet._sideSpace * 0.16
        x: cabinet.width - cabinet._sideCenter + cabinet._sideSpace * -0.08 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.471 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:15"
        width: cabinet._sideSpace * 0.08
        x: cabinet.width - cabinet._sideCenter + cabinet._sideSpace * 0.12 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.499 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:16"
        width: cabinet._sideSpace * 0.045
        x: cabinet.width - cabinet._sideCenter + cabinet._sideSpace * -0.04 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.519 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:17"
        width: cabinet._sideSpace * 0.15
        x: cabinet.width - cabinet._sideCenter + cabinet._sideSpace * 0.1 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.696 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:18"
        width: cabinet._sideSpace * 0.075
        x: cabinet.width - cabinet._sideCenter + cabinet._sideSpace * -0.12 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.721 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:19"
        width: cabinet._sideSpace * 0.17
        x: cabinet.width - cabinet._sideCenter + cabinet._sideSpace * -0.09 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.927 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:20"
        width: cabinet._sideSpace * 0.085
        x: cabinet.width - cabinet._sideCenter + cabinet._sideSpace * 0.1 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.956 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:21"
        width: cabinet._sideSpace * 0.045
        x: cabinet.width - cabinet._sideCenter + cabinet._sideSpace * -0.05 - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.978 - height / 2
        z: 1.5
    }
    Bubble {
        objectName: "bubble:22"
        width: (cabinet.screenY - cabinet.lipWidth) * 0.5
        x: cabinet.width * 0.22
        y: (cabinet.screenY - cabinet.lipWidth) * 0.16
        z: 1.5
    }
    Bubble {
        objectName: "bubble:23"
        width: (cabinet.screenY - cabinet.lipWidth) * 0.22
        x: cabinet.width * 0.237
        y: (cabinet.screenY - cabinet.lipWidth) * 0.6
        z: 1.5
    }
    Bubble {
        objectName: "bubble:24"
        width: (cabinet.screenY - cabinet.lipWidth) * 0.38
        x: cabinet.width * 0.36
        y: (cabinet.screenY - cabinet.lipWidth) * 0.24
        z: 1.5
    }
    Bubble {
        objectName: "bubble:25"
        width: (cabinet.screenY - cabinet.lipWidth) * 0.19
        x: cabinet.width * 0.374
        y: (cabinet.screenY - cabinet.lipWidth) * 0.62
        z: 1.5
    }
    Bubble {
        objectName: "bubble:26"
        width: (cabinet.screenY - cabinet.lipWidth) * 0.55
        x: cabinet.width * 0.7
        y: (cabinet.screenY - cabinet.lipWidth) * 0.12
        z: 1.5
    }
    Bubble {
        objectName: "bubble:27"
        width: (cabinet.screenY - cabinet.lipWidth) * 0.24
        x: cabinet.width * 0.717
        y: (cabinet.screenY - cabinet.lipWidth) * 0.59
        z: 1.5
    }
    Bubble {
        objectName: "bubble:28"
        width: (cabinet.screenY - cabinet.lipWidth) * 0.32
        x: cabinet.width * 0.83
        y: (cabinet.screenY - cabinet.lipWidth) * 0.23
        z: 1.5
    }

}
