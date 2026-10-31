pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Shapes

// Ocean Club, Mabel TV. One self-contained, entirely vector surround.
// Cabinet, aperture, fascia and speaker geometry: original charcoal-90s set
// from TelevisionScreen.qml. Animal artwork: sourced SVG Repo paths (CC0).
// Source URLs are beside each artwork component and in the supplied SOURCES.md.
// No raster images, generated pictures, network requests or external art files.
// Keep the existing video/player behind this frame, aligned to screenRect,
// or parent the picture content to screenItem. The empty aperture is transparent.

Item {
    id: cabinet
    objectName: "OceanClubSurround"

    property var appRoot: null
    property bool widescreen: appRoot ? appRoot.portalWidescreenEnabled : false
    readonly property string styleName: "Ocean Club"
    readonly property string geometryStyle: "charcoal-90s"
    readonly property bool isSlim: false
    readonly property bool isSilver: false
    readonly property bool isCharcoal: true
    readonly property bool isVintage: false

    implicitWidth: 1440
    implicitHeight: implicitWidth * (widescreen ? 0.64 : 3 / 4)
    anchors.centerIn: parent
    width: appRoot
        ? (widescreen
           ? Math.min(appRoot.width - 48, (appRoot.height - 48) / 0.64)
           : Math.min(appRoot.width - 48, (appRoot.height - 48) * 4 / 3))
        : implicitWidth
    height: width * (widescreen ? 0.64 : 3 / 4)
    readonly property real radius: isSlim ? Math.max(38, width * 0.055)
        : Math.max(44, width * 0.067)

    // Expressions retained directly from the original component.
    readonly property real sideInset: Math.max(54, width * 0.070)
    readonly property real tubeWidth: widescreen ? width * 0.89
        : (isSlim ? width - sideInset * 2
           : (isSilver ? width * 0.790
              : (isCharcoal ? width * 0.770 : width * 0.740)))
    readonly property real tubeHeight: tubeWidth * (widescreen ? 9 / 16 : 3 / 4)
    readonly property real tubeTop: widescreen ? width * 0.030
        : (isSlim ? (height - tubeHeight) / 2
           : (isVintage ? width * 0.052 : width * 0.044))
    readonly property real lipWidth: Math.max(12, width * (
        isSlim ? 0.015 : (isVintage ? 0.020 : 0.017)))
    readonly property color lipColor: isSlim ? "#060807"
        : (isSilver ? "#484a47"
           : (isCharcoal ? "#111311" : "#080908"))
    readonly property real fasciaTop: tubeTop + tubeHeight + lipWidth
    readonly property real screenX: (width - tubeWidth) / 2
    readonly property real screenY: tubeTop
    readonly property real screenWidth: tubeWidth
    readonly property real screenHeight: tubeHeight
    readonly property real screenRadius: isSlim ? Math.max(38, tubeWidth * 0.065)
        : Math.max(42, tubeWidth * 0.075)
    readonly property rect screenRect: Qt.rect(screenX, screenY, screenWidth, screenHeight)
    readonly property var screenItem: pictureSlot
    readonly property var fasciaItem: charcoalFascia
    readonly property var speakerItem: leftSpeaker
    readonly property bool ready: true

    readonly property real _unit: width / 1440
    readonly property real _sideSpace: screenX - lipWidth
    readonly property real _sideCenter: _sideSpace * 0.51
    readonly property var _theme: ({
        face: "#69babc", light: "#b3e0db", bottom: "#328694", grille: "#235464", ink: "#effbf3"
    })

    // Circular corner arcs, rather than an approximate screen silhouette.
    function roundedPath(x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2)
        return "M " + (x+r) + " " + y
            + " H " + (x+w-r) + " A " + r + " " + r + " 0 0 1 " + (x+w) + " " + (y+r)
            + " V " + (y+h-r) + " A " + r + " " + r + " 0 0 1 " + (x+w-r) + " " + (y+h)
            + " H " + (x+r) + " A " + r + " " + r + " 0 0 1 " + x + " " + (y+h-r)
            + " V " + (y+r) + " A " + r + " " + r + " 0 0 1 " + (x+r) + " " + y + " Z "
    }
    function aperturePath(expand) {
        return roundedPath(screenX-expand, screenY-expand,
                           screenWidth+expand*2, screenHeight+expand*2,
                           screenRadius+expand)
    }
    function casePath(inset) {
        return roundedPath(inset, inset, width-inset*2, height-inset*2, radius-inset)
    }

    Item {
        id: pictureSlot
        objectName: "pictureSlot"
        x: cabinet.screenX
        y: cabinet.screenY
        width: cabinet.screenWidth
        height: cabinet.screenHeight
        clip: true
        z: 0
    }

    // Moulded aqua cabinet. Every layer uses the same actual open aperture.
    Shape {
        anchors.fill: parent
        z: 1
        antialiasing: true
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: 0; x2: cabinet.width; y2: cabinet.height
                GradientStop { position: 0; color: "#a2deda" }
                GradientStop { position: 0.22; color: "#60b7bd" }
                GradientStop { position: 0.7; color: "#358d9a" }
                GradientStop { position: 1; color: "#175866" }
            }
            PathSvg { path: cabinet.casePath(0) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: 0; x2: cabinet.width * 0.3; y2: cabinet.height
                GradientStop { position: 0; color: "#cceee7" }
                GradientStop { position: 0.35; color: "#74c5c6" }
                GradientStop { position: 1; color: "#337f8c" }
            }
            PathSvg { path: cabinet.casePath(2 * cabinet._unit) + cabinet.casePath(4.4 * cabinet._unit) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: 0; x2: cabinet.width * 0.86; y2: cabinet.height
                GradientStop { position: 0; color: "#8acfcc" }
                GradientStop { position: 0.35; color: "#69b8bb" }
                GradientStop { position: 0.7; color: "#56a6ad" }
                GradientStop { position: 1; color: "#3e939e" }
            }
            PathSvg { path: cabinet.casePath(12 * cabinet._unit) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: 0; x2: cabinet.width; y2: 0
                GradientStop { position: 0; color: "#22effff7" }
                GradientStop { position: 0.18; color: "#00effff7" }
                GradientStop { position: 0.83; color: "#00153749" }
                GradientStop { position: 1; color: "#27153749" }
            }
            PathSvg { path: cabinet.casePath(12 * cabinet._unit) + cabinet.aperturePath(0) }
        }
        // A restrained, recessed seam where the rounded front meets the shell.
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: 0; x2: 0; y2: cabinet.height
                GradientStop { position: 0; color: "#2472b8b8" }
                GradientStop { position: 1; color: "#40316772" }
            }
            PathSvg { path: cabinet.casePath(11 * cabinet._unit) + cabinet.casePath(12.2 * cabinet._unit) }
        }

        // Smooth vector contours model the light across the recessed lip.
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#1d4c59" }
                GradientStop { position: 1; color: "#2c7e90" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 1) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#1b4854" }
                GradientStop { position: 1; color: "#2c7e90" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.96429) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#1a4551" }
                GradientStop { position: 1; color: "#2c7e90" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.92857) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#18424f" }
                GradientStop { position: 1; color: "#2c7d8f" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.89286) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#17404c" }
                GradientStop { position: 1; color: "#2b7c8e" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.85714) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#163e4a" }
                GradientStop { position: 1; color: "#2b7c8d" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.82143) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#153c48" }
                GradientStop { position: 1; color: "#2b7a8c" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.78571) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#143a45" }
                GradientStop { position: 1; color: "#2a798b" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.75) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#133843" }
                GradientStop { position: 1; color: "#297789" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.71429) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#123641" }
                GradientStop { position: 1; color: "#297687" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.67857) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#12343f" }
                GradientStop { position: 1; color: "#287485" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.64286) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#11333d" }
                GradientStop { position: 1; color: "#277183" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.60714) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#10313c" }
                GradientStop { position: 1; color: "#266f80" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.57143) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#0f2f3a" }
                GradientStop { position: 1; color: "#246c7d" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.53571) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#0e2d38" }
                GradientStop { position: 1; color: "#23697a" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.5) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#0e2c36" }
                GradientStop { position: 1; color: "#226677" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.46429) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#0d2a35" }
                GradientStop { position: 1; color: "#206273" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.42857) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#0c2933" }
                GradientStop { position: 1; color: "#1f5e6f" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.39286) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#0b2731" }
                GradientStop { position: 1; color: "#1d5a6b" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.35714) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#0b2630" }
                GradientStop { position: 1; color: "#1b5666" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.32143) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#0a242e" }
                GradientStop { position: 1; color: "#195162" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.28571) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#09232c" }
                GradientStop { position: 1; color: "#174c5d" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.25) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#08212b" }
                GradientStop { position: 1; color: "#154757" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.21429) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#082029" }
                GradientStop { position: 1; color: "#134252" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.17857) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#071e28" }
                GradientStop { position: 1; color: "#113c4c" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.14286) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#061d26" }
                GradientStop { position: 1; color: "#0e3746" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.10714) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#061b25" }
                GradientStop { position: 1; color: "#0c3040" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.07143) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#051a23" }
                GradientStop { position: 1; color: "#092a39" }
            }
            PathSvg { path: cabinet.aperturePath(cabinet.lipWidth * 0.03571) + cabinet.aperturePath(0) }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillGradient: LinearGradient {
                x1: 0; y1: cabinet.screenY; x2: 0; y2: cabinet.fasciaTop
                GradientStop { position: 0; color: "#76999e" }
                GradientStop { position: 0.35; color: "#327383" }
                GradientStop { position: 1; color: "#81bec2" }
            }
            PathSvg {
                path: cabinet.aperturePath(cabinet.lipWidth)
                    + cabinet.aperturePath(cabinet.lipWidth - Math.max(1, 1.4 * cabinet._unit))
            }
        }
        ShapePath {
            strokeWidth: 0
            fillRule: ShapePath.OddEvenFill
            fillColor: "#091f2b"
            PathSvg { path: cabinet.aperturePath(Math.max(1, cabinet._unit * 1.5)) + cabinet.aperturePath(0) }
        }
    }

    // Placement depends on the available cabinet, never on the video surface.
    // SVG silhouettes remain intact and fit the original 4:3 and wide cases.
    ClownfishArt {
        objectName: "clownfish"
        width: cabinet._sideSpace * 0.76
        height: width * implicitHeight / implicitWidth
        x: cabinet._sideCenter - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.18 - height / 2
        rotation: -12
        z: 2
    }
    ClownfishArt {
        objectName: "smallClownfish"
        width: cabinet._sideSpace * 0.44
        height: width * implicitHeight / implicitWidth
        x: cabinet._sideCenter - width * 0.30
        y: cabinet.screenY + cabinet.screenHeight * 0.30 - height / 2
        rotation: 11
        z: 2
    }
    JellyfishArt {
        objectName: "jellyfish"
        width: cabinet._sideSpace * 0.66
        height: width * implicitHeight / implicitWidth
        x: cabinet._sideCenter - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.52 - height / 2
        rotation: -5
        z: 2
    }
    SeahorseArt {
        objectName: "seahorse"
        width: cabinet._sideSpace * 0.53
        height: width * implicitHeight / implicitWidth
        x: cabinet._sideCenter - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.82 - height / 2
        rotation: 7
        z: 2
    }
    SharkArt {
        id: sharkSticker
        objectName: "shark"
        width: cabinet._sideSpace * 0.76
        height: width * implicitHeight / implicitWidth
        x: cabinet.width - cabinet._sideCenter - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.22 - height / 2
        rotation: -11
        transform: Scale { origin.x: sharkSticker.width / 2; xScale: -1 }
        z: 2
    }
    TurtleArt {
        objectName: "seaTurtle"
        width: cabinet._sideSpace * 0.68
        height: width * implicitHeight / implicitWidth
        x: cabinet.width - cabinet._sideCenter - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.55 - height / 2
        rotation: 20
        z: 2
    }
    StarfishArt {
        objectName: "starfish"
        width: cabinet._sideSpace * 0.61
        height: width * implicitHeight / implicitWidth
        x: cabinet.width - cabinet._sideCenter - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.85 - height / 2
        rotation: -15
        z: 2
    }

    // Geometric vector bubbles, with transparent centres and a curved glint.
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
    Bubble { x: cabinet._sideCenter - width * 0.85; y: cabinet.screenY + cabinet.screenHeight * 0.385; width: cabinet._sideSpace * 0.16; z: 2 }
    Bubble { x: cabinet._sideCenter + width * 0.25; y: cabinet.screenY + cabinet.screenHeight * 0.415; width: cabinet._sideSpace * 0.08; z: 2 }
    Bubble { x: cabinet._sideCenter + width * 0.10; y: cabinet.screenY + cabinet.screenHeight * 0.665; width: cabinet._sideSpace * 0.11; z: 2 }
    Bubble { x: cabinet.width - cabinet._sideCenter - width * 0.8; y: cabinet.screenY + cabinet.screenHeight * 0.375; width: cabinet._sideSpace * 0.16; z: 2 }
    Bubble { x: cabinet.width - cabinet._sideCenter + width * 0.65; y: cabinet.screenY + cabinet.screenHeight * 0.415; width: cabinet._sideSpace * 0.09; z: 2 }
    Bubble { x: cabinet.width - cabinet._sideCenter - width; y: cabinet.screenY + cabinet.screenHeight * 0.72; width: cabinet._sideSpace * 0.12; z: 2 }
    Bubble { x: cabinet.width - cabinet._sideCenter + width * 0.5; y: cabinet.screenY + cabinet.screenHeight * 0.747; width: cabinet._sideSpace * 0.065; z: 2 }

    Item {
        x: cabinet.width * 0.28
        y: (cabinet.screenY - cabinet.lipWidth) * 0.17
        width: (cabinet.screenY - cabinet.lipWidth) * 0.70
        height: width
        z: 2
        Bubble { width: parent.width * 0.68 }
        Bubble { x: parent.width * 0.9; y: parent.height * 0.43; width: parent.width * 0.34 }
    }
    Item {
        x: cabinet.width * 0.70
        y: (cabinet.screenY - cabinet.lipWidth) * 0.19
        width: (cabinet.screenY - cabinet.lipWidth) * 0.65
        height: width
        z: 2
        Bubble { width: parent.width * 0.65 }
        Bubble { x: parent.width * 0.84; y: parent.height * 0.45; width: parent.width * 0.32 }
    }

    Item {
        id: charcoalFascia

        z: 2
        objectName: "originalFascia"
        x: cabinet.width * 0.095
        y: cabinet.fasciaTop + cabinet.width * 0.012
        width: cabinet.width * 0.81
        height: cabinet.height - y - cabinet.width * 0.03

        Rectangle {
            id: leftSpeaker
            objectName: "leftSpeaker"
            width: parent.width * 0.32
            height: parent.height * 0.66
            anchors.left: parent.left
            anchors.bottom: parent.bottom
            radius: height * 0.08
            color: cabinet._theme.grille
            gradient: Gradient {
                GradientStop { position: 0; color: Qt.darker(cabinet._theme.grille, 1.35) }
                GradientStop { position: 0.22; color: cabinet._theme.grille }
                GradientStop { position: 1; color: Qt.lighter(cabinet._theme.grille, 1.13) }
            }
            border.color: Qt.darker(cabinet._theme.face, 1.25)
            border.width: 1

            Repeater {
                model: 6

                delegate: Rectangle {
                    required property int index
                    x: 0
                    y: index * parent.height / 6
                    width: parent.width
                    height: Math.max(2, parent.height * 0.028)
                    radius: height / 2
                    color: "#080a09"
                    opacity: 0.78
                }
            }
        }

        Rectangle {
            objectName: "rightSpeaker"
            width: leftSpeaker.width
            height: leftSpeaker.height
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            radius: height * 0.08
            color: cabinet._theme.grille
            gradient: Gradient {
                GradientStop { position: 0; color: Qt.darker(cabinet._theme.grille, 1.35) }
                GradientStop { position: 0.22; color: cabinet._theme.grille }
                GradientStop { position: 1; color: Qt.lighter(cabinet._theme.grille, 1.13) }
            }
            border.color: Qt.darker(cabinet._theme.face, 1.25)
            border.width: 1

            Repeater {
                model: 6

                delegate: Rectangle {
                    required property int index
                    x: 0
                    y: index * parent.height / 6
                    width: parent.width
                    height: Math.max(2, parent.height * 0.028)
                    radius: height / 2
                    color: "#080a09"
                    opacity: 0.78
                }
            }
        }

        Text {
            objectName: "brandLabel"
            text: "MABEL"
            color: cabinet._theme.ink
            font.letterSpacing: cabinet.width * 0.0014
            style: Text.Raised
            styleColor: Qt.darker(cabinet._theme.bottom, 1.6)
            font.pixelSize: Math.max(9, parent.height * 0.16)
            font.bold: true
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.top: parent.top
        }

        Rectangle {
            id: controlBay
            objectName: "controlBay"
            width: parent.width * 0.19
            height: parent.height * 0.27
            radius: height * 0.28
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.bottom: parent.bottom
            anchors.bottomMargin: parent.height * 0.12
            color: "#0b0d0c"
            border.color: Qt.lighter(cabinet._theme.grille, 1.6)
            border.width: 1

            Row {
                x: parent.width * 0.10
                anchors.verticalCenter: parent.verticalCenter
                spacing: controlBay.width * 0.035
                Repeater {
                    model: 4
                    delegate: Rectangle {
                        required property int index
                        width: controlBay.width * 0.12
                        height: controlBay.height * 0.42
                        radius: height * 0.25
                        color: cabinet._theme.face
                        gradient: Gradient {
                            GradientStop { position: 0; color: cabinet._theme.light }
                            GradientStop { position: 1; color: cabinet._theme.bottom }
                        }
                        border.color: cabinet._theme.light
                        border.width: 0.6
                    }
                }
            }
            Rectangle {
                x: parent.width * 0.80
                anchors.verticalCenter: parent.verticalCenter
                width: parent.height * 0.38
                height: width
                radius: width / 2
                color: cabinet._theme.face
                border.color: cabinet._theme.light
                border.width: 0.7
            }
            Rectangle {
                x: parent.width * 0.92
                anchors.verticalCenter: parent.verticalCenter
                width: Math.max(2, parent.height * 0.105)
                height: width
                radius: width / 2
                color: "#9ee36c"
            }
        }
    }

    Text {
        text: "OCEAN CLUB"
        anchors.horizontalCenter: parent.horizontalCenter
        y: charcoalFascia.y + charcoalFascia.height * 0.31
        font.pixelSize: Math.max(5, cabinet.width * 0.0055)
        font.letterSpacing: cabinet.width * 0.00105
        font.bold: true
        color: "#b8e4de"
        z: 3
    }

    // Downloaded artwork, compiled to native paths below. This is deliberately
    // self-contained: the source SVG folder is for provenance and editing only.
    // https://www.svgrepo.com/svg/153066/clown-fish | CC0, as listed by SVG Repo.
    // Changes: coordinated fill colours; cream vector backing; layout transforms.
    component ClownfishArt: Item {
        id: art
        implicitWidth: 544.256
        implicitHeight: 334.498
        Shape {
            width: 544.256
            height: 334.498
            antialiasing: true
            transform: [
                Translate { x: 16.128; y: -88.751 },
                Scale { xScale: art.width / art.implicitWidth; yScale: art.height / art.implicitHeight }
            ]
        ShapePath {
            strokeWidth: 23.04
            strokeColor: "#fff6e7"
            fillColor: "#fff6e7"
            fillRule: ShapePath.WindingFill
            joinStyle: ShapePath.RoundJoin
            capStyle: ShapePath.RoundCap
            PathSvg { path: "M479.947 182.883 L479.11953 182.06405 L478.28491 181.25498 L477.44321 180.4558 L476.59451 179.66656 L475.73888 178.88728 L474.87638 178.11799 L474.0071 177.35871 L473.13109 176.60949 L472.24844 175.87034 L471.35921 175.1413 L470.46347 174.42239 L469.56131 173.71365 L468.65277 173.01511 L467.73795 172.32678 L466.81691 171.64871 L465.88972 170.98092 L464.95646 170.32344 L464.01719 169.6763 L463.07198 169.03953 L462.12091 168.41315 L461.16405 167.79721 L460.20147 167.19172 L459.23325 166.59671 L458.25944 166.01222 L457.28013 165.43828 L456.29538 164.87491 L455.30528 164.32214 L454.30987 163.78 L453.30925 163.24852 L452.30348 162.72774 L451.29264 162.21767 L450.27678 161.71835 L449.256 161.2298 L448.23034 160.75207 L447.1999 160.28517 L446.16474 159.82913 L445.12492 159.38399 L444.08053 158.94977 L443.03163 158.52651 L441.9783 158.11422 L440.9206 157.71295 L439.85861 157.32272 L438.7924 156.94356 L437.72204 156.57549 L436.6476 156.21855 L435.56915 155.87277 L434.48677 155.53818 L433.40052 155.2148 L432.31048 154.90266 L431.21672 154.6018 L430.11931 154.31224 L429.01832 154.03401 L427.91382 153.76714 L426.80589 153.51167 L425.69459 153.26761 L424.58 153.035 L423.36461 151.58589 L422.13173 150.15672 L420.88158 148.74761 L419.61437 147.35865 L418.33031 145.98995 L417.02963 144.64162 L415.71255 143.31377 L414.37926 142.00648 L413.03001 140.71989 L411.66499 139.45408 L410.28442 138.20916 L408.88853 136.98524 L407.47753 135.78243 L406.05163 134.60083 L404.61105 133.44054 L403.156 132.30167 L401.68671 131.18433 L400.20339 130.08862 L398.70626 129.01465 L397.19552 127.96252 L395.67141 126.93233 L394.13412 125.9242 L392.58389 124.93823 L391.02093 123.97452 L389.44544 123.03318 L387.85766 122.11432 L386.25779 121.21803 L384.64605 120.34443 L383.02266 119.49362 L381.38784 118.66571 L379.74179 117.8608 L378.08474 117.07899 L376.4169 116.3204 L374.73849 115.58512 L373.04973 114.87327 L371.35082 114.18495 L369.642 113.52026 L367.92346 112.87931 L366.19544 112.2622 L364.45814 111.66904 L362.71179 111.09994 L360.95659 110.555 L359.19277 110.03433 L357.42054 109.53802 L355.64012 109.0662 L353.85172 108.61895 L352.05556 108.19639 L350.25185 107.79863 L348.44082 107.42577 L346.62267 107.0779 L344.79763 106.75515 L342.96591 106.45761 L341.12773 106.1854 L339.2833 105.9386 L337.43284 105.71734 L335.57657 105.52172 L333.71469 105.35183 L331.84744 105.20779 L329.97502 105.08971 L328.09765 104.99768 L326.21554 104.93182 L324.32892 104.89222 L322.438 104.879 L320.79869 104.91404 L319.17698 105.01819 L317.5743 105.19003 L315.99208 105.42813 L314.43175 105.73106 L312.89475 106.09738 L311.3825 106.52566 L309.89643 107.01447 L308.43798 107.56239 L307.00858 108.16797 L305.60966 108.8298 L304.24265 109.54643 L302.90898 110.31644 L301.61008 111.13839 L300.34738 112.01086 L299.12232 112.93241 L297.93632 113.90161 L296.79082 114.91704 L295.68725 115.97725 L294.62704 117.08082 L293.61161 118.22632 L292.64241 119.41232 L291.72086 120.63738 L290.84839 121.90008 L290.02644 123.19898 L289.25643 124.53265 L288.5398 125.89966 L287.87797 127.29858 L287.27239 128.72798 L286.72447 130.18643 L286.23566 131.6725 L285.80738 133.18475 L285.44106 134.72175 L285.13813 136.28208 L284.90003 137.8643 L284.72819 139.46698 L284.62404 141.08869 L284.589 142.728 L284.589 150.827 L259.527 150.827 L258.84431 149.86452 L258.14731 148.9161 L257.43619 147.98185 L256.71114 147.06187 L255.97235 146.15627 L255.22001 145.26515 L254.45431 144.38864 L253.67544 143.52683 L252.88359 142.67982 L252.07895 141.84774 L251.2617 141.03067 L250.43205 140.22874 L249.59017 139.44205 L248.73626 138.67071 L247.8705 137.91482 L246.9931 137.17448 L246.10423 136.44982 L245.20408 135.74093 L244.29285 135.04793 L243.37073 134.37091 L242.4379 133.70999 L241.49456 133.06527 L240.54089 132.43687 L239.57709 131.82488 L238.60334 131.22942 L237.61983 130.6506 L236.62676 130.08851 L235.62431 129.54327 L234.61267 129.01498 L233.59204 128.50376 L232.56259 128.00971 L231.52453 127.53293 L230.47804 127.07354 L229.42332 126.63163 L228.36054 126.20733 L227.28991 125.80073 L226.2116 125.41194 L225.12581 125.04107 L224.03274 124.68823 L222.93256 124.35353 L221.82548 124.03706 L220.71167 123.73895 L219.59133 123.45929 L218.46465 123.19819 L217.33181 122.95577 L216.19302 122.73212 L215.04845 122.52736 L213.8983 122.34159 L212.74275 122.17492 L211.58201 122.02745 L210.41624 121.8993 L209.24566 121.79057 L208.07044 121.70137 L206.89077 121.63181 L205.70685 121.58199 L204.51886 121.55201 L203.327 121.542 L201.54247 121.5649 L199.76905 121.63321 L198.0073 121.74638 L196.25779 121.90385 L194.52107 122.10506 L192.7977 122.34945 L191.08824 122.63646 L189.39324 122.96553 L187.71327 123.3361 L186.04889 123.74761 L184.40065 124.19951 L182.76911 124.69122 L181.15484 125.2222 L179.55838 125.79189 L177.9803 126.39972 L176.42116 127.04513 L174.88152 127.72756 L173.36193 128.44647 L171.86295 129.20127 L170.38515 129.99143 L168.92907 130.81637 L167.49529 131.67554 L166.08436 132.56838 L164.69683 133.49432 L163.33327 134.45281 L161.99423 135.4433 L160.68028 136.46521 L159.39197 137.51799 L158.12986 138.60108 L156.8945 139.71393 L155.68647 140.85596 L154.50632 142.02663 L153.3546 143.22537 L152.23187 144.45162 L151.1387 145.70483 L150.07564 146.98443 L149.04325 148.28986 L148.04209 149.62057 L147.07272 150.97599 L146.1357 152.35557 L145.23158 153.75875 L144.36093 155.18496 L143.5243 156.63365 L142.72225 158.10426 L141.95534 159.59623 L141.22413 161.10899 L140.52918 162.642 L139.87104 164.19468 L139.25029 165.76648 L138.66746 167.35685 L138.12313 168.96521 L137.61785 170.59102 L137.15218 172.23371 L136.72669 173.89272 L136.34191 175.56749 L135.99843 177.25747 L135.69679 178.96209 L135.43756 180.68079 L135.22128 182.41302 L135.04853 184.15822 L134.91986 185.91582 L134.83583 187.68527 L134.797 189.466 L134.03744 190.36888 L133.28745 191.27999 L132.54712 192.19924 L131.81651 193.12657 L131.09572 194.06188 L130.38481 195.00511 L129.68387 195.95618 L128.99297 196.91501 L128.31219 197.88151 L127.64162 198.85562 L126.98132 199.83725 L126.33137 200.82633 L125.69186 201.82278 L125.06286 202.82652 L124.44446 203.83747 L123.83672 204.85555 L123.23973 205.8807 L122.65356 206.91282 L122.0783 207.95184 L121.51401 208.99768 L120.96079 210.05027 L120.4187 211.10953 L119.88783 212.17538 L119.36825 213.24773 L118.86005 214.32652 L118.36329 215.41167 L117.87807 216.50309 L117.40444 217.60072 L116.94251 218.70446 L116.49233 219.81425 L116.054 220.93 L114.91885 220.36941 L113.80512 219.77588 L112.71335 219.15012 L111.64408 218.49284 L110.59787 217.80476 L109.57526 217.08657 L108.57679 216.33898 L107.60301 215.5627 L106.65447 214.75845 L105.73171 213.92692 L104.83528 213.06882 L103.96571 212.18487 L103.12357 211.27576 L102.30939 210.34222 L101.52372 209.38493 L100.7671 208.40463 L100.04008 207.402 L99.34321 206.37775 L98.67703 205.33261 L98.04209 204.26726 L97.43893 203.18243 L96.8681 202.07882 L96.33014 200.95713 L95.8256 199.81808 L95.35502 198.66236 L94.91896 197.4907 L94.51795 196.30379 L94.15255 195.10235 L93.82329 193.88707 L93.53072 192.65868 L93.2754 191.41788 L93.05785 190.16537 L92.87864 188.90186 L92.7383 187.62806 L92.63739 186.34468 L92.57644 185.05242 L92.556 183.752 L92.34422 181.91324 L91.74098 180.22535 L90.79439 178.73643 L89.55257 177.49461 L88.06365 176.54802 L86.37576 175.94478 L84.537 175.733 L83.42762 175.74008 L82.32051 175.7613 L81.2158 175.79661 L80.11358 175.84597 L79.01394 175.90934 L77.91701 175.98667 L76.82287 176.07792 L75.73164 176.18306 L74.64342 176.30202 L73.5583 176.43479 L72.4764 176.5813 L71.39781 176.74152 L70.32265 176.9154 L69.251 177.1029 L68.18299 177.30399 L67.1187 177.51861 L66.05825 177.74672 L65.00173 177.98828 L63.94925 178.24326 L62.90091 178.51159 L61.85682 178.79325 L60.81708 179.08819 L59.7818 179.39636 L58.75107 179.71773 L57.72499 180.05225 L56.70368 180.39987 L55.68724 180.76056 L54.67577 181.13428 L53.66937 181.52097 L52.66814 181.9206 L51.67219 182.33312 L50.68163 182.75849 L49.69655 183.19668 L48.71706 183.64762 L47.74326 184.11129 L46.77526 184.58764 L45.81316 185.07663 L44.85706 185.57821 L43.90707 186.09234 L42.96328 186.61898 L42.02581 187.15808 L41.09475 187.70961 L40.17021 188.27352 L39.2523 188.84976 L38.34111 189.4383 L37.43674 190.03909 L36.53931 190.65209 L35.64892 191.27726 L34.76566 191.91455 L33.88965 192.56391 L33.02098 193.22532 L32.15976 193.89872 L31.30609 194.58407 L30.46007 195.28133 L29.62182 195.99046 L28.79143 196.7114 L27.969 197.44413 L27.15464 198.1886 L26.34845 198.94476 L25.55054 199.71258 L24.761 200.492 L23.98148 201.28158 L23.21357 202.07954 L22.45732 202.88578 L21.71277 203.70018 L20.97995 204.52265 L20.25892 205.35308 L19.54972 206.19138 L18.85238 207.03743 L18.16696 207.89113 L17.49349 208.75239 L16.83201 209.62109 L16.18258 210.49713 L15.54523 211.38042 L14.92001 212.27084 L14.30695 213.1683 L13.70611 214.07269 L13.11751 214.9839 L12.54122 215.90184 L11.97726 216.8264 L11.42569 217.75747 L10.88654 218.69496 L10.35986 219.63876 L9.84569 220.58877 L9.34407 221.54488 L8.85505 222.50699 L8.37867 223.475 L7.91497 224.4488 L7.46399 225.4283 L7.02578 226.41338 L6.60038 227.40394 L6.18784 228.39989 L5.78818 229.40111 L5.40147 230.40751 L5.02774 231.41898 L4.66703 232.43542 L4.31938 233.45672 L3.98485 234.48278 L3.66347 235.5135 L3.35528 236.54878 L3.06033 237.5885 L2.77866 238.63258 L2.51032 239.68089 L2.25534 240.73335 L2.01376 241.78985 L1.78564 242.85028 L1.57102 243.91454 L1.36993 244.98254 L1.18242 246.05415 L1.00853 247.12929 L0.84831 248.20784 L0.70179 249.28971 L0.56903 250.37479 L0.45006 251.46298 L0.34493 252.55418 L0.25367 253.64828 L0.17634 254.74517 L0.11297 255.84476 L0.06361 256.94694 L0.0283 258.05161 L0.00708 259.15866 L0 260.268 L0.02855 262.48108 L0.11372 264.68031 L0.25482 266.86501 L0.45115 269.03446 L0.702 271.18797 L1.00667 273.32483 L1.36446 275.44434 L1.77466 277.54581 L2.23659 279.62853 L2.74953 281.69179 L3.31279 283.73491 L3.92565 285.75716 L4.58743 287.75787 L5.29742 289.73631 L6.05492 291.6918 L6.85922 293.62362 L7.70963 295.53109 L8.60545 297.41349 L9.54596 299.27012 L10.53048 301.10029 L11.5583 302.9033 L12.62871 304.67843 L13.74102 306.42499 L14.89453 308.14228 L16.08853 309.8296 L17.32232 311.48625 L18.59521 313.11151 L19.90648 314.7047 L21.25544 316.26511 L22.64139 317.79204 L24.06362 319.28479 L25.52144 320.74265 L27.01414 322.16493 L28.54101 323.55092 L30.10137 324.89993 L31.69451 326.21124 L33.31972 327.48417 L34.97631 328.718 L36.66357 329.91203 L38.3808 331.06558 L40.1273 332.17792 L41.90237 333.24837 L43.70531 334.27622 L45.53541 335.26076 L47.39198 336.20131 L49.27431 337.09715 L51.18171 337.94758 L53.11346 338.75191 L55.06888 339.50943 L57.04725 340.21944 L59.04787 340.88124 L61.07005 341.49412 L63.11308 342.05739 L65.17627 342.57035 L67.2589 343.03229 L69.36029 343.44251 L71.47972 343.80031 L73.61649 344.10498 L75.76991 344.35584 L77.93927 344.55217 L80.12388 344.69327 L82.32302 344.77845 L84.536 344.807 L86.37476 344.59495 L88.06265 343.99101 L89.55157 343.0435 L90.79339 341.80073 L91.73998 340.31101 L92.34322 338.62266 L92.555 336.784 L92.57544 335.48397 L92.63639 334.19207 L92.7373 332.90902 L92.87764 331.63553 L93.05685 330.3723 L93.27439 329.12004 L93.52972 327.87946 L93.82228 326.65127 L94.15153 325.43617 L94.51693 324.23489 L94.91793 323.04812 L95.35399 321.87657 L95.82455 320.72095 L96.32908 319.58197 L96.86703 318.46034 L97.43785 317.35677 L98.04099 316.27197 L98.67592 315.20664 L99.34208 314.16149 L100.03892 313.13724 L100.76592 312.13459 L101.52251 311.15424 L102.30815 310.19691 L103.1223 309.26331 L103.96441 308.35415 L104.83393 307.47013 L105.73032 306.61195 L106.65304 305.78035 L107.60153 304.976 L108.57526 304.19964 L109.57367 303.45196 L110.59623 302.73368 L111.64237 302.04551 L112.71157 301.38814 L113.80327 300.76229 L114.91693 300.16868 L116.052 299.608 L116.49043 300.72385 L116.94069 301.83372 L117.40271 302.93755 L117.8764 304.03525 L118.3617 305.12674 L118.85852 306.21195 L119.36679 307.2908 L119.88642 308.36321 L120.41734 309.42911 L120.95948 310.48841 L121.51274 311.54105 L122.07707 312.58693 L122.65236 313.62599 L123.23856 314.65814 L123.83558 315.68331 L124.44334 316.70142 L125.06177 317.71239 L125.69079 318.71615 L126.33031 319.71261 L126.98027 320.7017 L127.64058 321.68335 L128.31117 322.65746 L128.99195 323.62398 L129.68286 324.58281 L130.3838 325.53388 L131.09472 326.47711 L131.81551 327.41243 L132.54612 328.33976 L133.28645 329.25901 L134.03644 330.17012 L134.796 331.073 L134.83488 332.85369 L134.91896 334.62309 L135.04767 336.38065 L135.22046 338.1258 L135.43677 339.85799 L135.69605 341.57665 L135.99773 343.28123 L136.34125 344.97117 L136.72605 346.64591 L137.15158 348.30489 L137.61729 349.94754 L138.12259 351.57332 L138.66695 353.18165 L139.24981 354.77199 L139.87059 356.34376 L140.52875 357.89642 L141.22372 359.4294 L141.95495 360.94214 L142.72188 362.43408 L143.52395 363.90466 L144.36059 365.35333 L145.23126 366.77953 L146.13539 368.18268 L147.07243 369.56224 L148.04181 370.91765 L149.04298 372.24834 L150.07538 373.55376 L151.13844 374.83335 L152.23162 376.08654 L153.35435 377.31278 L154.50607 378.5115 L155.68622 379.68216 L156.89425 380.82418 L158.1296 381.93702 L159.39171 383.0201 L160.68001 384.07287 L161.99396 385.09478 L163.33299 386.08525 L164.69654 387.04374 L166.08405 387.96967 L167.49497 388.8625 L168.92874 389.72167 L170.3848 390.5466 L171.86258 391.33675 L173.36154 392.09156 L174.88111 392.81046 L176.42073 393.49289 L177.97985 394.1383 L179.5579 394.74612 L181.15433 395.3158 L182.76858 395.84678 L184.40008 396.3385 L186.04829 396.79039 L187.71264 397.2019 L189.39258 397.57247 L191.08753 397.90154 L192.79696 398.18855 L194.52029 398.43294 L196.25697 398.63415 L198.00644 398.79162 L199.76814 398.90479 L201.54151 398.9731 L203.326 398.996 L204.51791 398.98599 L205.70594 398.95602 L206.8899 398.90621 L208.0696 398.83665 L209.24485 398.74747 L210.41547 398.63876 L211.58125 398.51063 L212.74201 398.36319 L213.89757 398.19655 L215.04773 398.0108 L216.19231 397.80607 L217.3311 397.58246 L218.46393 397.34007 L219.59061 397.07901 L220.71094 396.79939 L221.82474 396.50132 L222.93182 396.1849 L224.03198 395.85024 L225.12504 395.49744 L226.2108 395.12662 L227.28909 394.73789 L228.3597 394.33134 L229.42246 393.90708 L230.47716 393.46523 L231.52362 393.00589 L232.56166 392.52916 L233.59108 392.03516 L234.61168 391.52399 L235.62329 390.99576 L236.62572 390.45057 L237.61876 389.88854 L238.60224 389.30976 L239.57597 388.71435 L240.53975 388.10242 L241.4934 387.47406 L242.43672 386.8294 L243.36952 386.16852 L244.29163 385.49156 L245.20284 384.7986 L246.10297 384.08975 L246.99183 383.36513 L247.86923 382.62484 L248.73497 381.86899 L249.58888 381.09768 L250.43076 380.31103 L251.26042 379.50913 L252.07767 378.6921 L252.88232 377.86004 L253.67418 377.01307 L254.45307 376.15128 L255.21879 375.27478 L255.97115 374.38369 L256.70997 373.47811 L257.43505 372.55814 L258.14621 371.62389 L258.84326 370.67548 L259.526 369.713 L284.6 369.713 L284.65305 371.33622 L284.77385 372.94172 L284.96099 374.5281 L285.21308 376.09397 L285.52872 377.63792 L285.90651 379.15855 L286.34505 380.65446 L286.84294 382.12425 L287.39878 383.56652 L288.01118 384.97986 L288.67873 386.36287 L289.40003 387.71416 L290.17369 389.03232 L290.99831 390.31595 L291.87248 391.56365 L292.79481 392.77402 L293.7639 393.94566 L294.77834 395.07716 L295.83675 396.16712 L296.93772 397.21415 L298.07985 398.21684 L299.26174 399.17379 L300.482 400.0836 L301.73922 400.94487 L303.032 401.7562 L304.35895 402.51618 L305.71867 403.22341 L307.10976 403.8765 L308.53081 404.47404 L309.98043 405.01462 L311.45723 405.49686 L312.95979 405.91935 L314.48672 406.28068 L316.03663 406.57946 L317.60811 406.81428 L319.19977 406.98375 L320.8102 407.08645 L322.438 407.121 L324.10784 407.11078 L325.77421 407.08017 L327.43697 407.02923 L329.096 406.95801 L330.75115 406.86656 L332.40228 406.75496 L334.04926 406.62326 L335.69195 406.47151 L337.33021 406.29978 L338.96391 406.10812 L340.59291 405.89659 L342.21706 405.66525 L343.83624 405.41416 L345.45031 405.14337 L347.05912 404.85295 L348.66255 404.54295 L350.26045 404.21343 L351.85268 403.86445 L353.43912 403.49607 L355.01961 403.10834 L356.59404 402.70133 L358.16225 402.27509 L359.72411 401.82969 L361.27948 401.36517 L362.82823 400.8816 L364.37021 400.37903 L365.9053 399.85753 L367.43335 399.31715 L368.95422 398.75795 L370.46779 398.17999 L371.9739 397.58333 L373.47243 396.96802 L374.96324 396.33413 L376.44619 395.68171 L377.92113 395.01081 L379.38795 394.32151 L380.84649 393.61386 L382.29662 392.88791 L383.7382 392.14372 L385.1711 391.38136 L386.59518 390.60088 L388.0103 389.80233 L389.41632 388.98579 L390.81311 388.15129 L392.20052 387.29892 L393.57843 386.42871 L394.94669 385.54073 L396.30517 384.63504 L397.65373 383.7117 L398.99223 382.77077 L400.32054 381.8123 L401.63851 380.83634 L402.94601 379.84297 L404.24291 378.83224 L405.52906 377.80421 L406.80433 376.75893 L408.06858 375.69646 L409.32168 374.61686 L410.56348 373.5202 L411.79385 372.40652 L413.01265 371.27589 L414.21975 370.12836 L415.415 368.964 L416.574 368.82303 L417.73018 368.66995 L418.88348 368.50479 L420.03381 368.32758 L421.1811 368.13836 L422.32527 367.93715 L423.46625 367.72398 L424.60397 367.49889 L425.73835 367.26191 L426.86931 367.01306 L427.99677 366.75238 L429.12067 366.47989 L430.24093 366.19564 L431.35747 365.89965 L432.47022 365.59194 L433.5791 365.27256 L434.68404 364.94153 L435.78496 364.59889 L436.88178 364.24465 L437.97444 363.87887 L439.06285 363.50156 L440.14694 363.11275 L441.22664 362.71248 L442.30187 362.30078 L443.37255 361.87768 L444.43861 361.44321 L445.49998 360.9974 L446.55657 360.54028 L447.60832 360.07188 L448.65515 359.59224 L449.69698 359.10138 L450.73374 358.59933 L451.76535 358.08613 L452.79174 357.5618 L453.81283 357.02639 L454.82855 356.47991 L455.83882 355.9224 L456.84357 355.35388 L457.84272 354.7744 L458.83619 354.18398 L459.82391 353.58265 L460.80581 352.97044 L461.78182 352.34739 L462.75184 351.71352 L463.71582 351.06887 L464.67367 350.41346 L465.62532 349.74733 L466.57069 349.07051 L467.50971 348.38302 L468.44231 347.6849 L469.3684 346.97619 L470.28792 346.2569 L471.20078 345.52708 L472.10692 344.78675 L473.00625 344.03594 L473.89871 343.27468 L474.78421 342.50301 L475.66269 341.72096 L476.53406 340.92855 L477.39825 340.12582 L478.25519 339.3128 L479.1048 338.48951 L479.947 337.656 L480.9243 336.66654 L481.88752 335.6669 L482.83659 334.6572 L483.77147 333.63757 L484.69211 332.60812 L485.59845 331.56899 L486.49046 330.52028 L487.36807 329.46213 L488.23124 328.39464 L489.07991 327.31796 L489.91404 326.23219 L490.73358 325.13745 L491.53847 324.03388 L492.32867 322.92158 L493.10412 321.80069 L493.86477 320.67132 L494.61059 319.5336 L495.3415 318.38764 L496.05747 317.23358 L496.75844 316.07152 L497.44437 314.90159 L498.1152 313.72392 L498.77088 312.53862 L499.41137 311.34582 L500.0366 310.14563 L500.64654 308.93819 L501.24113 307.7236 L501.82032 306.502 L502.38406 305.2735 L502.93231 304.03822 L503.465 302.7963 L503.98209 301.54784 L504.48354 300.29297 L504.96928 299.03181 L505.43927 297.76448 L505.89346 296.49111 L506.3318 295.21182 L506.75424 293.92672 L507.16072 292.63594 L507.55121 291.33961 L507.92564 290.03783 L508.28396 288.73074 L508.62614 287.41845 L508.95211 286.1011 L509.26183 284.77878 L509.55524 283.45164 L509.8323 282.11979 L510.09295 280.78336 L510.33715 279.44245 L510.56484 278.09721 L510.77598 276.74774 L510.97051 275.39417 L511.14839 274.03662 L511.30956 272.67521 L511.45397 271.31007 L511.58158 269.94131 L511.69233 268.56906 L511.78617 267.19344 L511.86305 265.81456 L511.92293 264.43256 L511.96574 263.04755 L511.99145 261.65966 L512 260.269 L511.99145 258.87839 L511.96575 257.49054 L511.92293 256.10558 L511.86306 254.72363 L511.78619 253.3448 L511.69235 251.96922 L511.58161 250.59702 L511.45402 249.22831 L511.30961 247.86321 L511.14845 246.50185 L510.97059 245.14434 L510.77607 243.79082 L510.56494 242.44139 L510.33726 241.09619 L510.09308 239.75533 L509.83244 238.41894 L509.5554 237.08713 L509.262 235.76003 L508.9523 234.43775 L508.62634 233.12043 L508.28419 231.80819 L507.92587 230.50113 L507.55146 229.19939 L507.16099 227.90309 L506.75452 226.61234 L506.3321 225.32728 L505.89378 224.04801 L505.4396 222.77467 L504.96962 221.50738 L504.48389 220.24625 L503.98246 218.9914 L503.46538 217.74297 L502.9327 216.50106 L502.38447 215.26581 L501.82073 214.03733 L501.24155 212.81574 L500.64697 211.60117 L500.03704 210.39374 L499.4118 209.19357 L498.77132 208.00077 L498.11564 206.81548 L497.44481 205.63781 L496.75889 204.46789 L496.05791 203.30584 L495.34194 202.15177 L494.61102 201.00581 L493.8652 199.86808 L493.10453 198.73871 L492.32907 197.61781 L491.53886 196.5055 L490.73395 195.40192 L489.9144 194.30717 L489.08025 193.22138 L488.23155 192.14467 L487.36836 191.07716 L486.49072 190.01898 L485.59869 188.97025 L484.69231 187.93108 L483.77164 186.9016 L482.83672 185.88193 L481.88761 184.87219 L480.92435 183.87251 L479.947 182.883" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#2d4d5c"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M 142.79899999999998 330.451 A 60.526 60.526 0 1 0 263.851 330.451 A 60.526 60.526 0 1 0 142.79899999999998 330.451 Z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#D68512"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M 158.184 330.451 A 45.141 45.141 0 1 0 248.46599999999998 330.451 A 45.141 45.141 0 1 0 158.184 330.451 Z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#2d4d5c"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M 142.79899999999998 190.089 A 60.526 60.526 0 1 0 263.851 190.089 A 60.526 60.526 0 1 0 142.79899999999998 190.089 Z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#D68512"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M 158.184 190.089 A 45.141 45.141 0 1 0 248.46599999999998 190.089 A 45.141 45.141 0 1 0 158.184 190.089 Z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#2d4d5c"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M168.464,302.02c-8.897-8.897-21.188-14.4-34.764-14.4c-27.153,0-49.164,22.011-49.164,49.164v0.004 c-42.258,0-76.517-34.259-76.517-76.52c-0.001-42.257,34.26-76.515,76.517-76.515c0,27.153,22.011,49.165,49.164,49.165 c13.576,0,25.868-5.504,34.764-14.401V302.02z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#D68512"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M133.7,232.919c-21.451,0-39.681-13.743-46.397-32.9h-2.768c-33.275,0-60.25,26.975-60.25,60.25 c0,33.276,26.975,60.251,60.25,60.251h2.768c6.715-19.158,24.946-32.9,46.397-32.9c13.576,0,25.868,5.503,34.764,14.4v-83.503 C159.567,227.413,147.277,232.919,133.7,232.919z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#2d4d5c"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M133.7,232.919c-11.848,0-22.71-4.199-31.194-11.18c5.735,11.621,8.97,24.695,8.97,38.53 c0,13.836-3.235,26.911-8.971,38.533c8.486-6.982,19.348-11.181,31.195-11.181c13.576,0,25.868,5.503,34.764,14.4v-83.503 C159.567,227.413,147.277,232.919,133.7,232.919z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#2d4d5c"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M292.607,251.968V142.729c0-16.448,13.382-29.83,29.83-29.83 c68.678,0,124.553,55.875,124.553,124.555v14.514H292.607z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#D68512"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M432.477,237.454c0-60.774-49.267-110.039-110.04-110.039c-8.46,0-15.315,6.856-15.315,15.315v94.725 h125.355V237.454z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#2d4d5c"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M292.607,260.033v109.239c0,16.449,13.382,29.83,29.83,29.83 c68.678,0,124.553-55.875,124.553-124.554v-14.515H292.607z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#D68512"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M432.477,274.548c0,60.773-49.267,110.039-110.04,110.039c-8.46,0-15.315-6.857-15.315-15.315 v-94.724H432.477z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#FF9E16"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M402.561,158.847H218.176c-56.011,0-101.422,45.409-101.422,101.422 c0,56.014,45.409,101.423,101.422,101.423h184.385c56.013,0,101.422-45.41,101.42-101.423 C503.983,204.257,458.573,158.847,402.561,158.847z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#fff4df"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M142.771,192.459c-16.169,17.968-26.017,41.735-26.017,67.81c0,26.074,9.848,49.845,26.017,67.813 V192.459z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#fff4df"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M 254.774 158.848 h 37.827 v 202.844 h -37.827 Z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#fff4df"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M378.243,260.269c0-37.561,11.758-72.424,31.77-101.12c-2.462-0.179-4.942-0.303-7.451-0.303h-8.181 c-18.567,29.383-29.332,64.169-29.332,101.422c0,37.254,10.763,72.039,29.333,101.423h8.18c2.509,0,4.989-0.125,7.452-0.304 C390,332.693,378.243,297.832,378.243,260.269z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#2d4d5c"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M283.935,203.483c-26.776,26.776-26.776,70.191,0,96.969l48.487-48.485L283.935,203.483z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#D68512"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M292.344,211.892c-10.256,10.257-16.598,24.425-16.598,40.075c0,15.651,6.343,29.819,16.6,40.075 l40.076-40.075L292.344,211.892z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M479.947,182.883c-15.379-15.379-34.531-25.613-55.367-29.848 c-25.338-30.64-62.389-48.156-102.142-48.156c-20.87,0-37.849,16.979-37.849,37.849v8.099h-25.062 c-12.834-18.42-33.519-29.285-56.2-29.285c-37.588,0-68.193,30.414-68.53,67.924c-7.898,9.287-14.275,19.904-18.743,31.464 c-14.13-6.708-23.498-21.092-23.498-37.178c0-4.429-3.59-8.019-8.019-8.019c-22.58,0-43.808,8.793-59.776,24.759 C8.793,216.461,0,237.689,0,260.268c0,46.615,37.923,84.539,84.536,84.539c4.429,0,8.019-3.595,8.019-8.023 c0-16.081,9.368-30.467,23.497-37.176c4.469,11.561,10.846,22.178,18.744,31.465c0.338,37.509,30.943,67.923,68.53,67.923 c22.682,0,43.365-10.863,56.2-29.283H284.6c0.237,20.667,17.115,37.408,37.838,37.408c35.102,0,68.002-13.529,92.977-38.157 c24.368-2.833,46.924-13.697,64.532-31.308c20.671-20.671,32.054-48.155,32.053-77.387 C512.001,231.038,500.619,203.555,479.947,182.883z M111.363,284.135c-18.29,7.757-31.303,24.585-34.225,44.237 c-34.303-3.7-61.1-32.832-61.1-68.104c0-18.296,7.125-35.497,20.063-48.434c11.177-11.177,25.538-18.017,41.037-19.671 c2.921,19.656,15.932,36.484,34.227,44.24c-1.716,7.685-2.628,15.671-2.628,23.865C108.735,268.464,109.647,276.45,111.363,284.135z M143.321,316.076c-11.645-15.581-18.548-34.903-18.548-55.807s6.903-40.226,18.548-55.806V316.076z M203.325,137.582 c13.163,0,25.433,4.795,34.892,13.247h-20.041c-23.858,0-45.952,7.679-63.955,20.688C161.74,151.705,180.91,137.582,203.325,137.582 z M203.325,382.957c-22.414,0-41.584-14.122-49.103-33.931c18.002,13.009,40.097,20.686,63.954,20.686h20.04 C228.757,378.162,216.487,382.957,203.325,382.957z M239.461,353.674h-21.285c-22.274,0-42.748-7.841-58.818-20.903V187.769 c16.069-13.061,36.543-20.902,58.818-20.902h21.285V353.674z M300.626,142.729c0-12.027,9.784-21.811,21.811-21.811 c29.148,0,56.647,10.715,77.901,29.91h-99.714v-8.099H300.626z M338.092,246.297l-30.208-30.206v-49.225h63.449 c-13.962,28.977-21.295,60.997-21.295,93.403c0,32.401,7.339,64.429,21.301,93.404h-63.456v-65.829l30.208-30.207 c1.504-1.503,2.349-3.543,2.349-5.67S339.596,247.8,338.092,246.297z M291.846,353.674h-36.347V166.866h36.347v33.187l-2.241-2.241 c-3.131-3.133-8.208-3.132-11.341,0c-29.86,29.861-29.86,78.448,0,108.309c1.504,1.504,3.544,2.349,5.671,2.349 s4.167-0.845,5.67-2.349l2.241-2.241V353.674z M284.309,288.738c-16.544-21.618-16.544-51.924,0-73.541l36.773,36.77 L284.309,288.738z M322.437,391.083c-11.879,0-21.551-9.549-21.79-21.371h89.016C370.138,383.601,346.897,391.083,322.437,391.083z M402.561,353.674h-13.234c-15.21-28.595-23.251-60.788-23.251-93.404c0-32.622,8.038-64.806,23.25-93.403h13.235 c0.23,0,0.457,0.015,0.686,0.017c-16.373,28.313-24.975,60.336-24.975,93.386c0,33.051,8.603,65.074,24.976,93.388 C403.018,353.659,402.791,353.674,402.561,353.674z M468.606,326.317c-13.226,13.227-29.72,21.997-47.661,25.56 c-17.429-27.368-26.636-58.93-26.636-91.606s9.208-64.238,26.635-91.605c17.941,3.563,34.436,12.333,47.662,25.56 c17.641,17.643,27.357,41.097,27.356,66.046C495.963,285.218,486.248,308.674,468.606,326.317z M427.988,222.818 c-6.209,0-11.241,5.034-11.241,11.241c0,6.209,5.033,11.241,11.241,11.241c6.209,0,11.241-5.033,11.241-11.241 C439.23,227.852,434.197,222.818,427.988,222.818z" }
        }
        }
    }

    // https://www.svgrepo.com/svg/168804/seahorse | CC0, as listed by SVG Repo.
    // Changes: coordinated fill colours; cream vector backing; layout transforms.
    component SeahorseArt: Item {
        id: art
        implicitWidth: 318.10416
        implicitHeight: 544.25175
        Shape {
            width: 318.10416
            height: 544.25175
            antialiasing: true
            transform: [
                Translate { x: -96.94971; y: 16.12387 },
                Scale { xScale: art.width / art.implicitWidth; yScale: art.height / art.implicitHeight }
            ]
        ShapePath {
            strokeWidth: 23.03982
            strokeColor: "#fff6e7"
            fillColor: "#fff6e7"
            fillRule: ShapePath.WindingFill
            joinStyle: ShapePath.RoundJoin
            capStyle: ShapePath.RoundCap
            PathSvg { path: "M378.098 170.024 L377.37512 168.9997 L376.54921 168.08839 L375.63263 167.29391 L374.6377 166.62011 L373.5768 166.07086 L372.46225 165.65 L371.30641 165.36139 L370.12163 165.20889 L368.92025 165.19634 L367.71462 165.32761 L366.51709 165.60655 L365.34 166.037 L345.627 174.644 L345.87778 173.60136 L346.127 172.56155 L346.37465 171.52455 L346.62075 170.49033 L346.86529 169.45886 L347.10828 168.43012 L347.34974 167.40407 L347.58965 166.38069 L347.82804 165.35995 L348.0649 164.34183 L348.30025 163.32629 L348.53408 162.3133 L348.7664 161.30284 L348.99722 160.29489 L349.22655 159.28941 L349.45438 158.28637 L349.68073 157.28575 L349.90559 156.28752 L350.12899 155.29165 L350.35091 154.29811 L350.57137 153.30687 L350.79038 152.31792 L351.00793 151.33121 L351.22404 150.34673 L351.4387 149.36444 L351.65193 148.38431 L351.86373 147.40632 L352.07411 146.43044 L352.28307 145.45665 L352.49062 144.4849 L352.69675 143.51519 L352.90149 142.54747 L353.10483 141.58172 L353.30678 140.61791 L353.50735 139.65601 L353.70653 138.69601 L353.90435 137.73786 L354.10079 136.78154 L354.29587 135.82702 L354.4896 134.87428 L354.68197 133.92328 L354.873 132.974 L356.028 127.223 L356.076 126.96525 L356.118 126.706 L356.32361 125.24504 L356.50922 123.78333 L356.67489 122.32106 L356.82069 120.85842 L356.94665 119.39562 L357.05283 117.93283 L357.13929 116.47026 L357.20608 115.0081 L357.25326 113.54653 L357.28087 112.08575 L357.28898 110.62596 L357.27763 109.16734 L357.24688 107.71008 L357.19678 106.25439 L357.12739 104.80045 L357.03876 103.34846 L356.93094 101.8986 L356.80399 100.45108 L356.65797 99.00608 L356.49291 97.56379 L356.30889 96.12441 L356.10595 94.68813 L355.88414 93.25514 L355.64353 91.82564 L355.38415 90.39981 L355.10608 88.97786 L354.80935 87.55996 L354.49403 86.14632 L354.16017 84.73713 L353.80782 83.33258 L353.43704 81.93286 L353.04787 80.53817 L352.64038 79.14869 L352.21462 77.76462 L351.77063 76.38616 L351.30848 75.01349 L350.82822 73.6468 L350.3299 72.2863 L349.81358 70.93217 L349.2793 69.5846 L348.72713 68.24379 L348.15711 66.90993 L347.5693 65.58321 L346.96376 64.26382 L346.34054 62.95196 L345.69968 61.64782 L345.04125 60.3516 L344.3653 59.06347 L343.67188 57.78364 L342.96105 56.51231 L342.23286 55.24965 L341.48736 53.99587 L340.72461 52.75115 L339.94466 51.5157 L339.14756 50.28969 L338.33337 49.07333 L337.50215 47.86681 L336.65394 46.67031 L335.7888 45.48404 L334.90678 44.30817 L334.00794 43.14292 L333.09233 41.98846 L332.16 40.845 L331.21226 39.71429 L330.25057 38.59793 L329.27513 37.49601 L328.2861 36.40862 L327.28366 35.33586 L326.26801 34.27779 L325.23931 33.23453 L324.19774 32.20615 L323.14348 31.19275 L322.07672 30.19441 L320.99762 29.21122 L319.90638 28.24328 L318.80316 27.29066 L317.68815 26.35347 L316.56153 25.43178 L315.42347 24.5257 L314.27416 23.63529 L313.11377 22.76067 L311.94248 21.90191 L310.76047 21.0591 L309.56793 20.23233 L308.36502 19.4217 L307.15193 18.62729 L305.92884 17.84918 L304.69592 17.08748 L303.45336 16.34226 L302.20134 15.61362 L300.94002 14.90164 L299.6696 14.20642 L298.39025 13.52804 L297.10215 12.8666 L295.80548 12.22217 L294.50042 11.59486 L293.18714 10.98474 L291.86583 10.39191 L290.53666 9.81646 L289.19982 9.25848 L287.85549 8.71805 L286.50383 8.19527 L285.14503 7.69021 L283.77928 7.20299 L282.40674 6.73367 L281.0276 6.28235 L279.64204 5.84912 L278.25023 5.43407 L276.85236 5.03728 L275.4486 4.65885 L274.03914 4.29887 L272.62415 3.95742 L271.2038 3.63459 L269.77829 3.33048 L268.34779 3.04516 L266.91247 2.77874 L265.47252 2.53129 L264.02811 2.30291 L262.57943 2.09369 L261.12666 1.90372 L259.66997 1.73307 L258.20953 1.58186 L256.74554 1.45015 L255.27817 1.33805 L253.8076 1.24563 L252.334 1.173 L251.89347 1.15511 L251.35166 1.13461 L250.71441 1.11168 L249.98761 1.08646 L249.17712 1.05911 L248.2888 1.0298 L247.32852 0.99869 L246.30215 0.96593 L245.21556 0.93169 L244.07461 0.89612 L242.88517 0.85938 L241.65311 0.82163 L240.3843 0.78304 L239.08459 0.74375 L237.75986 0.70394 L236.41598 0.66376 L235.05881 0.62336 L233.69422 0.58292 L232.32807 0.54258 L230.96624 0.50251 L229.61459 0.46286 L228.27898 0.42381 L226.96529 0.3855 L225.67938 0.34809 L224.42712 0.31175 L223.21437 0.27663 L222.04701 0.24289 L220.93089 0.2107 L219.87189 0.18021 L218.87587 0.15158 L217.9487 0.12498 L217.09625 0.10055 L216.32439 0.07846 L215.63897 0.05887 L215.04587 0.04194 L214.55096 0.02783 L214.1601 0.0167 L213.87916 0.0087 L213.714 0.004 L212.40712 0.05552 L211.13325 0.26919 L209.90587 0.63801 L208.7385 1.155 L207.64462 1.81318 L206.63775 2.60556 L205.73137 3.52516 L204.939 4.565 L204.35128 5.56919 L203.88665 6.62237 L203.54589 7.71344 L203.3298 8.83134 L203.23916 9.96496 L203.27478 11.10322 L203.43743 12.23504 L203.72791 13.34933 L204.147 14.435 L204.62897 15.57608 L205.07582 16.78228 L205.47916 18.01821 L205.83056 19.24845 L206.12161 20.43759 L206.34389 21.55025 L206.489 22.551 L205.49157 22.71886 L204.47364 22.86671 L203.43681 22.99521 L202.38269 23.105 L201.31288 23.19672 L200.22899 23.27101 L199.13261 23.32854 L198.02536 23.36993 L196.90883 23.39583 L195.78463 23.4069 L194.65437 23.40376 L193.51964 23.38708 L192.38206 23.35748 L191.24322 23.31563 L190.10474 23.26216 L188.9682 23.19772 L187.83523 23.12295 L186.70742 23.0385 L185.58637 22.94501 L184.4737 22.84313 L183.371 22.7335 L182.27988 22.61677 L181.20194 22.49358 L180.13878 22.36459 L179.09202 22.23042 L178.06325 22.09173 L177.05408 21.94917 L176.06611 21.80337 L175.10095 21.65499 L174.1602 21.50466 L173.24546 21.35303 L172.35834 21.20076 L171.50044 21.04847 L170.67336 20.89683 L169.87872 20.74646 L169.11811 20.59803 L168.39314 20.45216 L167.70541 20.30951 L167.05653 20.17073 L166.4481 20.03645 L165.88172 19.90733 L165.359 19.784 L164.16844 19.56933 L162.97737 19.49744 L161.79723 19.56426 L160.63946 19.76576 L159.5155 20.09787 L158.43678 20.55656 L157.41473 21.13776 L156.46079 21.83744 L155.5864 22.65153 L154.803 23.576 L154.13484 24.58598 L153.59787 25.65248 L153.19283 26.76344 L152.92046 27.9068 L152.7815 29.0705 L152.7767 30.24248 L152.90681 31.41068 L153.17257 32.56304 L153.57472 33.6875 L154.114 34.772 L154.62768 35.67341 L155.14987 36.60124 L155.67961 37.55389 L156.21594 38.52975 L156.7579 39.52721 L157.30455 40.54467 L157.85493 41.58052 L158.40808 42.63316 L158.96304 43.70096 L159.51887 44.78234 L160.07461 45.87567 L160.6293 46.97936 L161.18198 48.0918 L161.73171 49.21137 L162.27752 50.33648 L162.81846 51.46551 L163.35358 52.59686 L163.88192 53.72892 L164.40252 54.86008 L164.91444 55.98874 L165.41671 57.11329 L165.90837 58.23212 L166.38849 59.34363 L166.85609 60.44621 L167.31023 61.53824 L167.74995 62.61813 L168.17429 63.68427 L168.5823 64.73505 L168.97302 65.76885 L169.34551 66.78409 L169.69879 67.77914 L170.03193 68.7524 L170.34395 69.70227 L170.63392 70.62713 L170.90086 71.52538 L171.14384 72.39541 L171.36189 73.23562 L171.55405 74.0444 L171.71938 74.82014 L171.85691 75.56123 L171.96569 76.26607 L172.04477 76.93305 L172.09319 77.56056 L172.11 78.147 L172.114 81.585 L172.04755 82.9766 L171.84818 84.33905 L171.52106 85.66433 L171.07141 86.94441 L170.50441 88.17126 L169.82525 89.33687 L169.03914 90.43321 L168.15126 91.45226 L167.16681 92.38598 L166.09099 93.22637 L164.92899 93.96538 L163.686 94.595 L123.003 112.759 L121.88125 113.31044 L120.81865 113.93398 L119.81685 114.62531 L118.87749 115.38011 L118.00224 116.19406 L117.19275 117.06286 L116.45065 117.98219 L115.77762 118.94773 L115.17529 119.95517 L114.64533 121.0002 L114.18937 122.0785 L113.80908 123.18576 L113.50611 124.31767 L113.2821 125.4699 L113.13871 126.63815 L113.07758 127.81811 L113.10038 129.00545 L113.20876 130.19587 L113.40435 131.38505 L113.68882 132.56867 L114.06382 133.74243 L114.531 134.902 L122.788 153.394 L123.54103 154.88177 L124.42589 156.27306 L125.43546 157.56114 L126.56262 158.73925 L127.80028 159.80064 L129.1413 160.73856 L130.57858 161.54627 L132.105 162.217 L133.15798 162.58112 L134.22348 162.87351 L135.29862 163.09425 L136.38052 163.24341 L137.46627 163.32105 L138.553 163.32725 L139.63781 163.26207 L140.71781 163.12559 L141.79012 162.91788 L142.85185 162.63899 L143.90011 162.28901 L144.932 161.868 L188.64 142.353 L189.6755 141.93947 L190.73236 141.61261 L191.80577 141.37183 L192.89091 141.21653 L193.98298 141.1461 L195.07715 141.15996 L196.16862 141.2575 L197.25258 141.43812 L198.32421 141.70122 L199.3787 142.04621 L200.41124 142.47248 L201.41701 142.97943 L202.3912 143.56647 L203.329 144.233 L204.68197 145.25016 L206.05425 146.2375 L207.44566 147.19484 L208.856 148.122 L207.55552 149.38234 L206.27326 150.65716 L205.00932 151.94628 L203.76378 153.24955 L202.53672 154.56677 L201.32823 155.8978 L200.13838 157.24245 L198.96727 158.60056 L197.81498 159.97197 L196.68159 161.35648 L195.56718 162.75395 L194.47184 164.1642 L193.39565 165.58706 L192.3387 167.02236 L191.30107 168.46993 L190.28285 169.92961 L189.28411 171.40121 L188.30494 172.88458 L187.34543 174.37954 L186.40565 175.88592 L185.4857 177.40356 L184.58566 178.93228 L183.70561 180.47191 L182.84563 182.02229 L182.00581 183.58324 L181.18623 185.1546 L180.38698 186.7362 L179.60814 188.32786 L178.84979 189.92942 L178.11202 191.5407 L177.39491 193.16155 L176.69854 194.79178 L176.023 196.43123 L175.36838 198.07973 L174.73475 199.7371 L174.1222 201.40319 L173.53082 203.07782 L172.96068 204.76081 L172.41188 206.45201 L171.88449 208.15124 L171.3786 209.85833 L170.8943 211.57311 L170.43166 213.29542 L169.99077 215.02507 L169.57171 216.76191 L169.17458 218.50577 L168.79945 220.25646 L168.4464 222.01384 L168.11552 223.77771 L167.8069 225.54792 L167.52061 227.3243 L167.25674 229.10667 L167.01538 230.89487 L166.79661 232.68873 L166.60051 234.48807 L166.42717 236.29273 L166.27667 238.10254 L166.14909 239.91733 L166.04452 241.73692 L165.96304 243.56116 L165.90474 245.38986 L165.8697 247.22287 L165.858 249.06 L165.88428 251.60047 L165.96296 254.13293 L166.09384 256.65709 L166.2767 259.17263 L166.51133 261.67927 L166.7975 264.17671 L167.13502 266.66465 L167.52366 269.1428 L167.96321 271.61085 L168.45346 274.06852 L168.99419 276.5155 L169.58519 278.9515 L170.22624 281.37622 L170.91713 283.78936 L171.65764 286.19063 L172.44757 288.57973 L173.2867 290.95636 L174.1748 293.32022 L175.11168 295.67103 L176.09712 298.00847 L177.13089 300.33226 L178.21279 302.6421 L179.3426 304.93768 L180.52012 307.21872 L181.74511 309.48492 L183.01738 311.73598 L184.33671 313.97159 L185.70287 316.19148 L187.11567 318.39533 L188.57488 320.58285 L190.08029 322.75375 L191.63168 324.90773 L193.22885 327.04449 L194.87158 329.16372 L196.55965 331.26515 L198.29285 333.34847 L200.07096 335.41337 L201.89378 337.45958 L203.76108 339.48678 L205.67266 341.49468 L207.6283 343.48299 L209.62778 345.45141 L211.67089 347.39963 L213.75742 349.32737 L215.88715 351.23433 L218.05988 353.12021 L220.27537 354.9847 L222.53343 356.82753 L224.83384 358.64838 L227.17637 360.44696 L229.56083 362.22298 L231.98699 363.97614 L234.45464 365.70614 L236.96356 367.41268 L239.51355 369.09546 L242.10439 370.7542 L244.73586 372.38859 L247.40775 373.99833 L250.11984 375.58314 L252.87193 377.1427 L255.66379 378.67673 L258.49522 380.18493 L261.366 381.667 L263.72978 382.95316 L265.97281 384.22669 L268.09821 385.48738 L270.10909 386.73501 L272.0086 387.96937 L273.79984 389.19025 L275.48594 390.39743 L277.07002 391.59069 L278.55522 392.76982 L279.94464 393.93461 L281.24142 395.08484 L282.44867 396.2203 L283.56952 397.34077 L284.6071 398.44603 L285.56452 399.53588 L286.44491 400.6101 L287.25139 401.66848 L287.98709 402.71079 L288.65513 403.73683 L289.25862 404.74638 L289.80071 405.73922 L290.2845 406.71514 L290.71311 407.67393 L291.08969 408.61538 L291.41734 409.53926 L291.69919 410.44536 L291.93836 411.33347 L292.13798 412.20337 L292.30117 413.05486 L292.43105 413.8877 L292.53074 414.7017 L292.60338 415.49663 L292.65207 416.27228 L292.67995 417.02844 L292.69014 417.76489 L292.68576 418.48142 L292.66993 419.17781 L292.64578 419.85384 L292.61643 420.50931 L292.585 421.144 L292.535 422.178 L292.34108 424.91504 L292.02525 427.42746 L291.5974 429.72506 L291.06745 431.81763 L290.44531 433.71496 L289.74088 435.42686 L288.96407 436.9631 L288.1248 438.33349 L287.23298 439.54782 L286.2985 440.61587 L285.33129 441.54745 L284.34124 442.35235 L283.33828 443.04036 L282.3323 443.62127 L281.33323 444.10488 L280.35095 444.50097 L279.3954 444.81935 L278.47647 445.06981 L277.60407 445.26214 L276.78811 445.40613 L276.03851 445.51157 L275.36517 445.58826 L274.778 445.646 L273.62301 445.73851 L272.45298 445.79778 L271.27059 445.82335 L270.07849 445.81474 L268.87936 445.77148 L267.67587 445.69309 L266.47069 445.5791 L265.26648 445.42903 L264.06592 445.24241 L262.87166 445.01878 L261.68639 444.75765 L260.51277 444.45855 L259.35347 444.12101 L258.21116 443.74456 L257.0885 443.32872 L255.98817 442.87301 L254.91283 442.37697 L253.86515 441.84012 L252.84781 441.26199 L251.86347 440.6421 L250.91479 439.97998 L250.00446 439.27516 L249.13513 438.52716 L248.30947 437.73551 L247.53017 436.89974 L246.79987 436.01937 L246.12126 435.09393 L245.49699 434.12295 L244.92975 433.10595 L244.4222 432.04246 L243.977 430.932 L243.62242 429.88915 L243.31579 428.84074 L243.0572 427.78726 L242.8467 426.72921 L242.68435 425.66707 L242.57021 424.60134 L242.50436 423.53251 L242.48685 422.46107 L242.51774 421.38751 L242.59711 420.31232 L242.725 419.236 L242.86282 418.0328 L242.93702 416.8355 L242.9485 415.64641 L242.89821 414.46778 L242.78706 413.30192 L242.61599 412.1511 L242.38592 411.0176 L242.09778 409.90371 L241.7525 408.81171 L241.351 407.74388 L240.89421 406.70249 L240.38306 405.68985 L239.81847 404.70822 L239.20137 403.75989 L238.53269 402.84714 L237.81335 401.97226 L237.04429 401.13752 L236.22642 400.34521 L235.36069 399.59761 L234.448 398.897 L233.55268 398.28451 L232.6327 397.72272 L231.6901 397.2119 L230.72693 396.75233 L229.74521 396.34429 L228.74698 395.98807 L227.73429 395.68394 L226.70916 395.43219 L225.67365 395.23309 L224.62977 395.08693 L223.57958 394.99399 L222.5251 394.95455 L221.46838 394.96888 L220.41145 395.03728 L219.35635 395.16002 L218.30512 395.33738 L217.25979 395.56964 L216.22241 395.85709 L215.195 396.2 L213.83104 396.7508 L212.51947 397.39092 L211.26378 398.11654 L210.06743 398.92384 L208.93391 399.80898 L207.86669 400.76814 L206.86925 401.7975 L205.94506 402.89322 L205.09761 404.05149 L204.33036 405.26847 L203.6468 406.54034 L203.05041 407.86327 L202.54465 409.23343 L202.133 410.647 L201.87064 411.70669 L201.62107 412.76318 L201.3843 413.81646 L201.16031 414.86648 L200.94912 415.91321 L200.75072 416.95663 L200.56512 417.99669 L200.3923 419.03336 L200.23228 420.06662 L200.08504 421.09642 L199.9506 422.12274 L199.82895 423.14554 L199.7201 424.16479 L199.62403 425.18045 L199.54075 426.1925 L199.47027 427.20089 L199.41257 428.20561 L199.36767 429.20661 L199.33556 430.20385 L199.31624 431.19732 L199.30971 432.18697 L199.31597 433.17277 L199.33502 434.1547 L199.36686 435.1327 L199.41149 436.10676 L199.46891 437.07684 L199.53912 438.04291 L199.62213 439.00493 L199.71792 439.96288 L199.8265 440.91671 L199.94787 441.86639 L200.08203 442.8119 L200.22898 443.75319 L200.38872 444.69024 L200.56125 445.62302 L200.74657 446.55148 L200.94468 447.4756 L201.15557 448.39535 L201.37926 449.31069 L201.61574 450.22158 L201.865 451.128 L202.23157 452.38747 L202.61648 453.63836 L203.01962 454.88054 L203.44087 456.11384 L203.88011 457.33813 L204.33723 458.55325 L204.81212 459.75905 L205.30464 460.95539 L205.81468 462.14212 L206.34214 463.31908 L206.88688 464.48613 L207.44879 465.64313 L208.02776 466.78992 L208.62366 467.92635 L209.23638 469.05228 L209.86581 470.16756 L210.51181 471.27204 L211.17429 472.36556 L211.85311 473.44799 L212.54817 474.51917 L213.25934 475.57896 L213.98651 476.6272 L214.72956 477.66375 L215.48836 478.68846 L216.26282 479.70118 L217.0528 480.70176 L217.85819 481.69006 L218.67887 482.66592 L219.51473 483.6292 L220.36564 484.57974 L221.23149 485.51741 L222.11217 486.44204 L223.00755 487.3535 L223.91752 488.25163 L224.84196 489.13629 L225.78075 490.00732 L226.73377 490.86458 L227.70091 491.70792 L228.68206 492.53719 L229.67708 493.35225 L230.68587 494.15293 L231.70831 494.93911 L232.74427 495.71062 L233.79365 496.46732 L234.85633 497.20905 L235.93218 497.93568 L237.02109 498.64706 L238.12295 499.34302 L239.23763 500.02343 L240.36502 500.68814 L241.505 501.337 L242.43174 501.84769 L243.36301 502.34601 L244.29872 502.83193 L245.23876 503.30545 L246.18304 503.76655 L247.13146 504.21523 L248.08392 504.65147 L249.04031 505.07526 L250.00055 505.4866 L250.96453 505.88545 L251.93215 506.27183 L252.90331 506.64571 L253.87792 507.00708 L254.85587 507.35593 L255.83707 507.69225 L256.82141 508.01603 L257.8088 508.32725 L258.79915 508.62591 L259.79234 508.91199 L260.78828 509.18548 L261.78687 509.44637 L262.78802 509.69465 L263.79162 509.9303 L264.79757 510.15332 L265.80578 510.36369 L266.81615 510.5614 L267.82857 510.74643 L268.84295 510.91879 L269.85919 511.07845 L270.87719 511.22541 L271.89685 511.35965 L272.91807 511.48116 L273.94075 511.58993 L274.9648 511.68594 L275.99011 511.76919 L277.01659 511.83967 L278.04414 511.89736 L279.07265 511.94225 L280.10203 511.97432 L281.13218 511.99358 L282.163 512 L283.20468 511.99345 L284.24682 511.97378 L285.28934 511.94098 L286.33213 511.89505 L287.37508 511.83596 L288.41811 511.76371 L289.4611 511.67829 L290.50396 511.57968 L291.54659 511.46788 L292.58889 511.34286 L293.63075 511.20462 L294.67208 511.05315 L295.71278 510.88844 L296.75274 510.71046 L297.79187 510.51922 L298.83007 510.3147 L299.86723 510.09688 L300.90325 509.86576 L301.93804 509.62133 L302.9715 509.36356 L304.00352 509.09246 L305.034 508.808 L306.32476 508.43177 L307.60401 508.03647 L308.87165 507.62218 L310.1276 507.18897 L311.37176 506.73693 L312.60403 506.26611 L313.82433 505.77661 L315.03257 505.26849 L316.22865 504.74183 L317.41249 504.19671 L318.58398 503.6332 L319.74305 503.05137 L320.88959 502.45131 L322.02352 501.83308 L323.14474 501.19676 L324.25316 500.54243 L325.3487 499.87017 L326.43125 499.18004 L327.50074 498.47212 L328.55705 497.74649 L329.60012 497.00323 L330.62983 496.2424 L331.64611 495.46409 L332.64885 494.66837 L333.63798 493.85531 L334.61339 493.02499 L335.57499 492.17749 L336.5227 491.31287 L337.45642 490.43123 L338.37606 489.53262 L339.28152 488.61713 L340.17272 487.68483 L341.04957 486.7358 L341.91197 485.77011 L342.75983 484.78784 L343.59306 483.78906 L344.41157 482.77385 L345.21527 481.74228 L346.00405 480.69443 L346.77785 479.63037 L347.53655 478.55019 L348.28008 477.45394 L349.00833 476.34172 L349.72122 475.21359 L350.41865 474.06963 L351.10054 472.90992 L351.76679 471.73452 L352.4173 470.54353 L353.052 469.337 L353.48062 468.49513 L353.90083 467.64662 L354.31264 466.79157 L354.71601 465.93008 L355.11094 465.06225 L355.49741 464.18817 L355.8754 463.30795 L356.2449 462.42167 L356.60589 461.52944 L356.95836 460.63136 L357.30228 459.72751 L357.63766 458.81801 L357.96446 457.90294 L358.28267 456.98241 L358.59229 456.05651 L358.89328 455.12534 L359.18565 454.189 L359.46936 453.24758 L359.74441 452.30119 L360.01077 451.34991 L360.26844 450.39385 L360.5174 449.43311 L360.75763 448.46778 L360.98912 447.49795 L361.21185 446.52374 L361.4258 445.54523 L361.63097 444.56252 L361.82733 443.57571 L362.01486 442.5849 L362.19356 441.59018 L362.3634 440.59166 L362.52438 439.58943 L362.67647 438.58358 L362.81966 437.57422 L362.95393 436.56144 L363.07928 435.54534 L363.19567 434.52602 L363.3031 433.50357 L363.40156 432.47809 L363.49102 431.44969 L363.57147 430.41845 L363.64289 429.38448 L363.70527 428.34787 L363.75859 427.30872 L363.80285 426.26713 L363.83801 425.22319 L363.86407 424.17701 L363.881 423.12868 L363.88881 422.07829 L363.88746 421.02595 L363.87694 419.97175 L363.85724 418.91579 L363.82834 417.85817 L363.79023 416.79899 L363.74289 415.73834 L363.6863 414.67631 L363.62046 413.61302 L363.54533 412.54855 L363.46091 411.48301 L363.36719 410.41648 L363.26414 409.34907 L363.15175 408.28088 L363.03 407.212 L362.89136 406.04829 L362.75115 404.88886 L362.60938 403.73375 L362.46605 402.58296 L362.32115 401.43651 L362.1747 400.2944 L362.0267 399.15666 L361.87715 398.0233 L361.72604 396.89434 L361.57339 395.76978 L361.4192 394.64964 L361.26347 393.53393 L361.10619 392.42268 L360.94739 391.31589 L360.78704 390.21358 L360.62517 389.11576 L360.46177 388.02245 L360.29684 386.93366 L360.13039 385.84941 L359.96242 384.7697 L359.79293 383.69456 L359.62192 382.62399 L359.4494 381.55802 L359.27537 380.49665 L359.09983 379.4399 L358.92279 378.38778 L358.74424 377.34032 L358.56419 376.29751 L358.38265 375.25939 L358.19961 374.22595 L358.01508 373.19722 L357.82905 372.17321 L357.64154 371.15393 L357.45254 370.1394 L357.26206 369.12963 L357.0701 368.12464 L356.87667 367.12444 L356.68176 366.12904 L356.48537 365.13846 L356.28752 364.15272 L356.08819 363.17182 L355.88741 362.19578 L355.68516 361.22461 L355.48145 360.25834 L355.27628 359.29697 L355.06966 358.34052 L354.86159 357.389 L354.65207 356.44242 L354.4411 355.50081 L354.22868 354.56417 L354.01483 353.63252 L353.79953 352.70587 L353.5828 351.78424 L353.36463 350.86764 L353.14503 349.95609 L352.924 349.0496 L352.70155 348.14818 L352.47767 347.25184 L352.25237 346.36061 L352.02565 345.4745 L351.79751 344.59352 L351.56796 343.71768 L351.337 342.847 L351.17096 341.93666 L350.99534 341.01858 L350.81044 340.0929 L350.61657 339.15975 L350.41404 338.21925 L350.20317 337.27155 L349.98427 336.31677 L349.75763 335.35503 L349.52358 334.38649 L349.28241 333.41126 L349.03445 332.42948 L348.78 331.44127 L348.51937 330.44678 L348.25288 329.44612 L347.98082 328.43945 L347.70351 327.42687 L347.42126 326.40853 L347.13438 325.38456 L346.84318 324.35509 L346.54796 323.32025 L346.24905 322.28017 L345.94674 321.23499 L345.64135 320.18483 L345.33319 319.12982 L345.02256 318.07011 L344.70978 317.00581 L344.39516 315.93706 L344.079 314.864 L343.54225 313.0385 L343.004 311.204 L365.337 320.955 L366.67726 321.43285 L368.04174 321.71581 L369.412 321.809 L370.69552 321.72781 L371.95291 321.48742 L373.1689 321.0926 L374.32825 320.54812 L375.41569 319.85876 L376.41597 319.02927 L377.31382 318.06442 L378.094 316.969 L378.73809 315.91601 L379.37246 314.85802 L379.99707 313.79511 L380.61192 312.72733 L381.21698 311.65476 L381.81224 310.57747 L382.39767 309.49551 L382.97326 308.40895 L383.53899 307.31786 L384.09484 306.22231 L384.64079 305.12235 L385.17683 304.01807 L385.70293 302.90951 L386.21907 301.79675 L386.72524 300.67986 L387.22142 299.5589 L387.70759 298.43393 L388.18373 297.30502 L388.64982 296.17224 L389.10584 295.03566 L389.55178 293.89533 L389.98761 292.75133 L390.41332 291.60372 L390.82889 290.45257 L391.2343 289.29794 L391.62953 288.1399 L392.01456 286.97851 L392.38937 285.81384 L392.75395 284.64596 L393.10828 283.47493 L393.45233 282.30082 L393.78609 281.12369 L394.10954 279.94361 L394.42267 278.76065 L394.72544 277.57486 L395.01785 276.38633 L395.29987 275.19511 L395.57149 274.00126 L395.83269 272.80487 L396.08344 271.60598 L396.32374 270.40467 L396.55356 269.201 L396.77288 267.99504 L396.98168 266.78685 L397.17995 265.57651 L397.36766 264.36407 L397.54481 263.1496 L397.71136 261.93317 L397.8673 260.71484 L398.01261 259.49468 L398.14728 258.27276 L398.27128 257.04914 L398.3846 255.82388 L398.48721 254.59706 L398.5791 253.36873 L398.66026 252.13898 L398.73065 250.90785 L398.79026 249.67541 L398.83908 248.44174 L398.87708 247.2069 L398.90424 245.97095 L398.92056 244.73396 L398.926 243.496 L398.92075 242.25804 L398.90462 241.02105 L398.87763 239.7851 L398.8398 238.55026 L398.79116 237.31659 L398.73171 236.08415 L398.66148 234.85303 L398.58049 233.62327 L398.48875 232.39494 L398.38628 231.16812 L398.27311 229.94287 L398.14925 228.71925 L398.01472 227.49733 L397.86953 226.27717 L397.71372 225.05885 L397.54729 223.84242 L397.37027 222.62795 L397.18266 221.41552 L396.98451 220.20517 L396.77581 218.99699 L396.55659 217.79104 L396.32687 216.58737 L396.08667 215.38607 L395.83601 214.18719 L395.5749 212.9908 L395.30336 211.79696 L395.02142 210.60575 L394.72908 209.41722 L394.42638 208.23145 L394.11333 207.0485 L393.78994 205.86843 L393.45624 204.69131 L393.11224 203.51722 L392.75797 202.3462 L392.39343 201.17833 L392.01866 200.01368 L391.63367 198.85231 L391.23848 197.69428 L390.83311 196.53967 L390.41757 195.38853 L389.99188 194.24094 L389.55607 193.09696 L389.11016 191.95666 L388.65415 190.8201 L388.18807 189.68734 L387.71194 188.55846 L387.22578 187.43352 L386.7296 186.31258 L386.22343 185.19572 L385.70728 184.08299 L385.18117 182.97447 L384.64513 181.87021 L384.09916 180.77029 L383.54329 179.67477 L382.97754 178.58372 L382.40193 177.4972 L381.81647 176.41527 L381.22118 175.33802 L380.61609 174.26549 L380.0012 173.19776 L379.37655 172.13489 L378.74214 171.07695 L378.098 170.024" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#f5ba50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M346.029,125.216c8.617-58.362-35.187-111.347-94.129-113.855l0,0 c-5.029-0.214-38.476-1.164-38.476-1.164s8.785,19.086-2.294,21.792c-19.255,4.703-48.171-2.294-48.171-2.294 s19.331,33.676,19.348,48.438l0.004,3.437c0.011,9.649-5.658,18.402-14.469,22.335l-40.68,18.163 c-3.312,1.479-4.797,5.362-3.319,8.672l8.257,18.494c1.479,3.312,5.362,4.797,8.672,3.319l43.708-19.515 c8.285-3.699,17.871-2.422,25.064,3.107c5.285,4.062,11.17,7.383,17.5,9.805c-30.987,23.719-50.989,61.07-50.989,103.107 c0,57.804,43.004,99.692,90.017,123.56c39.425,20.979,37.095,40.241,36.651,50.021c-0.941,20.715-11.337,31.666-26.978,33.157 c-16.969,1.618-35.517-5.359-41.351-21.376c-2.02-5.547-2.53-11.221-1.77-16.612c0.573-4.059-0.829-8.247-4.152-10.648 c-6.096-4.405-14.624-1.234-16.453,5.988c-2.875,11.351-3.632,23.566-0.341,35.202c11.029,38.998,51.585,61.672,90.583,50.643 c38.998-11.029,55.403-50.335,50.643-90.584c-2.989-25.274-6.921-46.184-11.533-63.358c-4.103-23.74-19.884-57.956-19.884-95.994 c0-17.312,3.268-33.831,7.217-48.931c5.991-22.911,11.51-45.942,16.17-69.16L346.029,125.216z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#e87571"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M369.422,175.384l-90.22,39.392c2.089,9.238,3.191,18.849,3.191,28.721 c0,9.87-1.104,19.483-3.191,28.721l90.22,39.392c12.233-19.802,19.309-43.127,19.309-68.113S381.655,195.185,369.422,175.384z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M264.785,315.858c-2.35-1.498-4.647-3.067-6.827-4.662c-4.546-3.324-10.928-2.336-14.253,2.211 c-3.326,4.547-2.336,10.928,2.211,14.253c2.529,1.849,5.188,3.664,7.901,5.395c1.699,1.084,3.597,1.601,5.474,1.601 c3.368,0,6.664-1.666,8.609-4.717C270.929,325.192,269.533,318.886,264.785,315.858z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M221.883,248.799c0-10.186,1.957-20.077,5.818-29.398c2.155-5.204-0.317-11.17-5.521-13.325 c-5.201-2.154-11.169,0.316-13.325,5.52c-4.89,11.809-7.371,24.326-7.371,37.204c0,18.01,5.453,35.001,16.208,50.502 c1.981,2.856,5.159,4.387,8.389,4.387c2.006,0,4.032-0.591,5.804-1.82c4.628-3.211,5.777-9.565,2.566-14.194 C226.113,275.652,221.883,262.573,221.883,248.799z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M378.098,170.024c-2.669-4.318-8.107-6.017-12.758-3.987l-19.713,8.607c3.522-14.617,6.581-28.392,9.246-41.67l1.155-5.751 c0.034-0.171,0.064-0.344,0.09-0.517c4.528-30.671-4.204-61.965-23.958-85.861c-19.755-23.895-48.85-38.355-79.826-39.672 c-5.043-0.215-37.251-1.13-38.62-1.169c-3.517-0.085-6.826,1.634-8.775,4.561c-1.947,2.928-2.243,6.667-0.792,9.87 c1.159,2.559,2.1,5.939,2.342,8.116c-13.813,2.493-34.125-1.084-41.13-2.767c-3.955-0.958-8.109,0.531-10.556,3.792 c-2.445,3.259-2.716,7.661-0.689,11.196c7.467,13.019,17.986,35.083,17.996,43.375l0.004,3.438 c0.007,5.614-3.301,10.721-8.428,13.01l-40.683,18.164c-8.439,3.769-12.24,13.702-8.472,22.143l8.257,18.492 c1.826,4.09,5.134,7.223,9.317,8.823c4.183,1.6,8.736,1.477,12.827-0.349l43.708-19.515c4.775-2.133,10.405-1.415,14.689,1.88 c1.791,1.376,3.634,2.673,5.527,3.889c-27.501,26.314-42.998,62.316-42.998,100.938c0,53.432,34.81,101.76,95.508,132.607 c32.336,17.232,31.638,31.154,31.219,39.477l-0.05,1.034c-0.994,21.87-13.611,23.073-17.757,23.468 c-11.848,1.126-26.532-2.995-30.801-14.714c-1.388-3.813-1.81-7.748-1.252-11.696c1.133-8.036-2.038-15.83-8.277-20.339 c-5.588-4.039-12.782-5.045-19.253-2.697c-6.482,2.356-11.366,7.755-13.062,14.447c-3.673,14.504-3.762,28.124-0.268,40.481 c6.075,21.483,20.154,39.314,39.64,50.209C254.139,508.401,268.071,512,282.163,512c7.637,0,15.32-1.057,22.871-3.192 c21.176-5.989,37.781-19.638,48.018-39.471c9.089-17.609,12.633-39.672,9.978-62.125c-2.895-24.483-6.828-46.135-11.693-64.365 c-1.504-8.46-4.301-17.948-7.258-27.983c-0.357-1.21-0.716-2.438-1.075-3.66l22.333,9.751c1.322,0.577,2.708,0.854,4.075,0.854 c3.444,0,6.772-1.749,8.682-4.84c13.628-22.06,20.832-47.466,20.832-73.473C398.93,217.489,391.727,192.083,378.098,170.024z M324.517,320.632c2.964,10.055,5.524,18.74,6.806,26.156c0.053,0.305,0.118,0.608,0.199,0.908 c4.664,17.374,8.451,38.204,11.254,61.912c3.553,30.054-5.651,68.927-43.291,79.572c-16.24,4.593-33.296,2.586-48.028-5.649 c-14.73-8.237-25.373-21.715-29.965-37.956c-2.509-8.868-2.369-18.935,0.412-29.922c0.023-0.094,0.054-0.211,0.253-0.283 c0.135-0.048,0.209-0.028,0.277,0.014c0.067,0.141,0.158,0.512,0.091,0.997c-1.017,7.192-0.227,14.637,2.285,21.53 c6.836,18.769,28.183,30.297,51.901,28.038c21.541-2.053,35.074-18.07,36.199-42.846l0.046-0.937 c0.574-11.429,1.767-35.211-42.093-58.55c-0.058-0.031-0.115-0.061-0.173-0.09c-25.388-12.889-84.435-49.845-84.435-114.466 c0-37.521,17.127-72.15,46.989-95.009c2.935-2.246,4.424-5.904,3.894-9.561s-2.996-6.741-6.448-8.062 c-5.347-2.046-10.37-4.861-14.93-8.366c-10.232-7.865-23.811-9.525-35.438-4.335l-40.391,18.035l-5.294-11.858L172,113.22 c12.475-5.571,20.526-17.998,20.509-31.659l-0.004-3.437c-0.011-9.484-5.618-23.593-11.074-35.083 c10.048,1.026,22.062,1.314,32.118-1.142c5.137-1.254,9.194-4.486,11.422-9.099c1.819-3.767,2.179-8.001,1.83-12.011 c9.843,0.287,21.863,0.646,24.665,0.765c25.212,1.073,48.893,12.842,64.973,32.292c16.024,19.383,23.139,44.748,19.537,69.632 l-1.101,5.486c-3.506,17.477-7.71,35.843-12.796,55.966l-46.957,20.503c-4.483,1.957-6.946,6.824-5.867,11.596 c1.952,8.631,2.941,17.538,2.941,26.472c0,8.933-0.99,17.84-2.941,26.472c-1.079,4.772,1.383,9.638,5.867,11.596l43.746,19.1 C320.692,307.642,322.631,314.23,324.517,320.632z M365.092,298.591l-74.327-32.453c1.214-7.459,1.827-15.043,1.827-22.641 s-0.613-15.181-1.827-22.641l74.327-32.453c8.816,16.956,13.44,35.831,13.44,55.094C378.532,262.76,373.908,281.635,365.092,298.591 z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M224.32,58.492c-6.572,0-11.919,5.347-11.919,11.919c0,6.572,5.346,11.919,11.919,11.919 c6.573,0,11.919-5.347,11.919-11.919C236.239,63.84,230.892,58.492,224.32,58.492z" }
        }
        }
    }

    // https://www.svgrepo.com/svg/299003/jellyfish | CC0, as listed by SVG Repo.
    // Changes: coordinated fill colours; cream vector backing; layout transforms.
    component JellyfishArt: Item {
        id: art
        implicitWidth: 392.88319
        implicitHeight: 544.25919
        Shape {
            width: 392.88319
            height: 544.25919
            antialiasing: true
            transform: [
                Translate { x: -59.55891; y: 16.12809 },
                Scale { xScale: art.width / art.implicitWidth; yScale: art.height / art.implicitHeight }
            ]
        ShapePath {
            strokeWidth: 23.04013
            strokeColor: "#fff6e7"
            fillColor: "#fff6e7"
            fillRule: ShapePath.WindingFill
            joinStyle: ShapePath.RoundJoin
            capStyle: ShapePath.RoundCap
            PathSvg { path: "M388.182 323.941 L386.4175 324.14422 L384.79766 324.72312 L383.36871 325.63153 L382.17685 326.82329 L381.2683 328.25222 L380.68928 329.87218 L380.486 331.637 L380.68928 333.40182 L381.2683 335.02178 L382.17685 336.45071 L383.36871 337.64247 L384.79766 338.55088 L386.4175 339.12978 L388.182 339.333 L389.81369 339.37315 L391.42494 339.49233 L393.01388 339.68866 L394.5786 339.96024 L396.11723 340.30519 L397.62785 340.72162 L399.1086 341.20762 L400.55757 341.76133 L401.97287 342.38084 L403.35262 343.06426 L404.69493 343.8097 L405.99789 344.61528 L407.25963 345.47911 L408.47825 346.39929 L409.65186 347.37393 L410.77857 348.40114 L411.85649 349.47904 L412.88373 350.60573 L413.8584 351.77933 L414.77861 352.99794 L415.64246 354.25967 L416.44807 355.56263 L417.19355 356.90494 L417.877 358.28469 L418.49654 359.70001 L419.05027 361.14901 L419.5363 362.62978 L419.95275 364.14045 L420.29772 365.67911 L420.56932 367.24389 L420.76566 368.83289 L420.88485 370.44423 L420.925 372.076 L420.88485 373.70768 L420.76566 375.31893 L420.56932 376.90786 L420.29772 378.47256 L419.95275 380.01116 L419.5363 381.52177 L419.05027 383.00248 L418.49654 384.45142 L417.877 385.86669 L417.19355 387.2464 L416.44807 388.58867 L415.64246 389.89159 L414.77861 391.15329 L413.8584 392.37186 L412.88373 393.54543 L411.85649 394.6721 L410.77857 395.74997 L409.65186 396.77717 L408.47825 397.75179 L407.25963 398.67195 L405.99789 399.53576 L404.69493 400.34133 L403.35262 401.08677 L401.97287 401.77018 L400.55757 402.38969 L399.1086 402.94338 L397.62785 403.42939 L396.11723 403.84581 L394.5786 404.19076 L393.01388 404.46234 L391.42494 404.65867 L389.81369 404.77785 L388.182 404.818 L386.55032 404.77785 L384.93907 404.65867 L383.35014 404.46234 L381.78544 404.19076 L380.24684 403.84581 L378.73623 403.42939 L377.25552 402.94338 L375.80658 402.38969 L374.39131 401.77018 L373.0116 401.08677 L371.66933 400.34133 L370.36641 399.53576 L369.10471 398.67195 L367.88614 397.75179 L366.71257 396.77717 L365.5859 395.74997 L364.50803 394.6721 L363.48083 393.54543 L362.50621 392.37186 L361.58605 391.15329 L360.72224 389.89159 L359.91667 388.58867 L359.17123 387.2464 L358.48782 385.86669 L357.86831 384.45142 L357.31462 383.00248 L356.82861 381.52177 L356.41219 380.01116 L356.06724 378.47256 L355.79566 376.90786 L355.59933 375.31893 L355.48015 373.70768 L355.44 372.076 L355.44 262.62 L356.4498 263.04398 L357.47444 263.41936 L358.51211 263.74613 L359.56099 264.02426 L360.61926 264.25374 L361.68512 264.43454 L362.75675 264.56666 L363.83232 264.65006 L364.91003 264.68473 L365.98805 264.67066 L367.06458 264.60782 L368.13779 264.49619 L369.20587 264.33575 L370.26701 264.12649 L371.31939 263.86838 L372.36119 263.56141 L373.3906 263.20556 L374.4058 262.8008 L375.40497 262.34713 L376.38631 261.84451 L377.34799 261.29294 L378.2882 260.69238 L379.20512 260.04283 L380.09694 259.34426 L380.96184 258.59666 L381.798 257.8 L399.932 239.665 L400.72126 238.84716 L401.47727 238.00602 L402.19969 237.14238 L402.88818 236.25706 L403.54242 235.35088 L404.16205 234.42465 L404.74674 233.47918 L405.29616 232.51529 L405.80996 231.5338 L406.28781 230.53551 L406.72938 229.52125 L407.13431 228.49183 L407.50229 227.44806 L407.83296 226.39076 L408.12599 225.32074 L408.38105 224.23882 L408.5978 223.14582 L408.77589 222.04254 L408.91499 220.9298 L409.01477 219.80843 L409.07489 218.67922 L409.095 217.543 L409.095 154.463 L409.04355 150.43309 L408.89006 146.42803 L408.63577 142.4491 L408.28196 138.49758 L407.8299 134.57475 L407.28084 130.6819 L406.63604 126.8203 L405.89679 122.99125 L405.06433 119.19601 L404.13993 115.43587 L403.12486 111.71211 L402.02038 108.02602 L400.82775 104.37887 L399.54824 100.77195 L398.18311 97.20655 L396.73363 93.68393 L395.20107 90.20538 L393.58667 86.77219 L391.89172 83.38563 L390.11747 80.047 L388.26519 76.75756 L386.33613 73.5186 L384.33158 70.3314 L382.25278 67.19725 L380.10101 64.11742 L377.87752 61.0932 L375.58359 58.12587 L373.22048 55.21671 L370.78944 52.367 L368.29175 49.57803 L365.72867 46.85107 L363.10146 44.18741 L360.41139 41.58833 L357.65972 39.05511 L354.84771 36.58903 L351.97663 34.19137 L349.04775 31.86342 L346.06232 29.60646 L343.02162 27.42177 L339.9269 25.31062 L336.77944 23.27431 L333.58048 21.31411 L330.33131 19.43131 L327.03317 17.62718 L323.68735 15.90301 L320.29509 14.26009 L316.85767 12.69968 L313.37635 11.22308 L309.85239 9.83156 L306.28706 8.52641 L302.68162 7.30891 L299.03733 6.18034 L295.35547 5.14198 L291.63729 4.19512 L287.88405 3.34103 L284.09703 2.58099 L280.27748 1.9163 L276.42668 1.34822 L272.54588 0.87805 L268.63635 0.50706 L264.69935 0.23653 L260.73614 0.06775 L256.748 0.002 L256.47737 0.00025 L256.206 0 L254.26782 0.01195 L252.33348 0.04775 L250.40316 0.10734 L248.47702 0.19063 L246.55522 0.29758 L244.63795 0.4281 L242.72536 0.58212 L240.81762 0.75959 L238.91491 0.96042 L237.01738 1.18456 L235.12522 1.43192 L233.23858 1.70244 L231.35764 1.99606 L229.48256 2.3127 L227.61351 2.6523 L225.75066 3.01478 L223.89418 3.40007 L222.04423 3.80812 L220.20099 4.23884 L218.36462 4.69217 L216.5353 5.16804 L214.71318 5.66638 L212.89844 6.18712 L211.09124 6.73019 L209.29176 7.29553 L207.50015 7.88306 L205.7166 8.49272 L203.94127 9.12443 L202.17432 9.77813 L200.41593 10.45375 L198.66626 11.15122 L196.92548 11.87047 L195.19376 12.61142 L193.47127 13.37402 L191.75817 14.1582 L190.05464 14.96387 L188.36084 15.79098 L186.67694 16.63946 L185.00311 17.50923 L183.33951 18.40023 L181.68632 19.31238 L180.0437 20.24563 L178.41183 21.1999 L176.79086 22.17511 L175.18097 23.17121 L173.58233 24.18812 L171.9951 25.22578 L170.41945 26.2841 L168.85555 27.36304 L167.30358 28.46251 L165.76369 29.58245 L164.23605 30.72278 L162.72084 31.88345 L161.21822 33.06437 L159.72835 34.26549 L158.25142 35.48673 L156.78758 36.72802 L155.33701 37.98929 L153.89987 39.27048 L152.47633 40.57151 L151.06656 41.89233 L149.67073 43.23284 L148.289 44.593 L146.91805 45.97629 L145.56686 47.37387 L144.2355 48.78556 L142.92405 50.2112 L141.63257 51.6506 L140.36114 53.10362 L139.10982 54.57006 L137.87869 56.04977 L136.66781 57.54257 L135.47726 59.0483 L134.30711 60.56678 L133.15743 62.09785 L132.02829 63.64133 L130.91976 65.19705 L129.83191 66.76485 L128.76482 68.34455 L127.71854 69.93598 L126.69316 71.53898 L125.68874 73.15338 L124.70535 74.77899 L123.74307 76.41567 L122.80197 78.06322 L121.88211 79.72149 L120.98357 81.39031 L120.10642 83.0695 L119.25072 84.75889 L118.41656 86.45832 L117.60399 88.16762 L116.81309 89.88661 L116.04394 91.61512 L115.2966 93.35299 L114.57113 95.10004 L113.86763 96.85611 L113.18614 98.62102 L112.52675 100.3946 L111.88952 102.1767 L111.27453 103.96712 L110.68185 105.76572 L110.11154 107.5723 L109.56369 109.38671 L109.03834 111.20878 L108.53559 113.03833 L108.0555 114.8752 L107.59814 116.71921 L107.16358 118.5702 L106.75189 120.42799 L106.36314 122.29242 L105.99741 124.16332 L105.65476 126.04051 L105.33526 127.92382 L105.03899 129.81309 L104.76601 131.70815 L104.5164 133.60882 L104.29023 135.51494 L104.08757 137.42633 L103.90848 139.34283 L103.75304 141.26426 L103.62132 143.19046 L103.5134 145.12126 L103.42933 147.05648 L103.36919 148.99596 L103.33306 150.93952 L103.321 152.887 L103.321 217.543 L103.34111 218.67922 L103.40123 219.80843 L103.50101 220.92981 L103.64012 222.04255 L103.81822 223.14583 L104.03497 224.23884 L104.29004 225.32078 L104.58309 226.39081 L104.91378 227.44813 L105.28178 228.49192 L105.68675 229.52138 L106.12835 230.53567 L106.60625 231.534 L107.1201 232.51555 L107.66958 233.4795 L108.25434 234.42503 L108.87404 235.35134 L109.52836 236.25761 L110.21695 237.14303 L110.93948 238.00677 L111.69561 238.84803 L112.485 239.666 L130.62 257.8 L131.44266 258.58422 L132.29318 259.32103 L133.16984 260.01045 L134.07089 260.65249 L134.99462 261.24716 L135.93928 261.79446 L136.90315 262.29442 L137.8845 262.74703 L138.8816 263.15232 L139.89272 263.51028 L140.91612 263.82094 L141.95009 264.0843 L142.99288 264.30038 L144.04276 264.46917 L145.09801 264.5907 L146.1569 264.66498 L147.21769 264.69201 L148.27865 264.6718 L149.33806 264.60437 L150.39418 264.48973 L151.44529 264.32789 L152.48965 264.11885 L153.52553 263.86263 L154.5512 263.55925 L155.56493 263.2087 L156.565 262.811 L156.565 372.076 L156.52485 373.70768 L156.40566 375.31893 L156.20932 376.90786 L155.93772 378.47256 L155.59275 380.01116 L155.1763 381.52177 L154.69027 383.00248 L154.13654 384.45142 L153.517 385.86669 L152.83355 387.2464 L152.08807 388.58867 L151.28246 389.89159 L150.41861 391.15329 L149.4984 392.37186 L148.52373 393.54543 L147.49649 394.6721 L146.41857 395.74997 L145.29186 396.77717 L144.11825 397.75179 L142.89963 398.67195 L141.63789 399.53576 L140.33493 400.34133 L138.99262 401.08677 L137.61287 401.77018 L136.19757 402.38969 L134.7486 402.94338 L133.26785 403.42939 L131.75723 403.84581 L130.2186 404.19076 L128.65388 404.46234 L127.06494 404.65867 L125.45369 404.77785 L123.822 404.818 L122.19031 404.77785 L120.57906 404.65867 L118.99012 404.46234 L117.4254 404.19076 L115.88677 403.84581 L114.37615 403.42939 L112.8954 402.94338 L111.44643 402.38969 L110.03113 401.77018 L108.65138 401.08677 L107.30907 400.34133 L106.00611 399.53576 L104.74437 398.67195 L103.52575 397.75179 L102.35214 396.77717 L101.22543 395.74997 L100.14751 394.6721 L99.12027 393.54543 L98.1456 392.37186 L97.22539 391.15329 L96.36154 389.89159 L95.55593 388.58867 L94.81045 387.2464 L94.127 385.86669 L93.50746 384.45142 L92.95373 383.00248 L92.4677 381.52177 L92.05125 380.01116 L91.70628 378.47256 L91.43468 376.90786 L91.23834 375.31893 L91.11915 373.70768 L91.079 372.076 L91.11915 370.44423 L91.23834 368.83289 L91.43468 367.24389 L91.70628 365.67911 L92.05125 364.14045 L92.4677 362.62978 L92.95373 361.14901 L93.50746 359.70001 L94.127 358.28469 L94.81045 356.90494 L95.55593 355.56263 L96.36154 354.25967 L97.22539 352.99794 L98.1456 351.77933 L99.12027 350.60573 L100.14751 349.47904 L101.22543 348.40114 L102.35214 347.37393 L103.52575 346.39929 L104.74437 345.47911 L106.00611 344.61528 L107.30907 343.8097 L108.65138 343.06426 L110.03113 342.38084 L111.44643 341.76133 L112.8954 341.20762 L114.37615 340.72162 L115.88677 340.30519 L117.4254 339.96024 L118.99012 339.68866 L120.57906 339.49233 L122.19031 339.37315 L123.822 339.333 L125.5865 339.12978 L127.20634 338.55088 L128.63529 337.64247 L129.82715 336.45071 L130.7357 335.02178 L131.31472 333.40182 L131.518 331.637 L131.31472 329.87218 L130.7357 328.25222 L129.82715 326.82329 L128.63529 325.63153 L127.20634 324.72312 L125.5865 324.14422 L123.822 323.941 L122.2033 323.96784 L120.59783 324.04779 L119.00641 324.18001 L117.42991 324.36364 L115.86917 324.59784 L114.32505 324.88176 L112.79838 325.21455 L111.29003 325.59535 L109.80083 326.02333 L108.33163 326.49763 L106.8833 327.0174 L105.45667 327.58179 L104.05259 328.18996 L102.67191 328.84106 L101.31549 329.53423 L99.98416 330.26863 L98.67878 331.04341 L97.40021 331.85772 L96.14927 332.71071 L94.92683 333.60153 L93.73374 334.52933 L92.57084 335.49327 L91.43898 336.49249 L90.33901 337.52615 L89.27178 338.59339 L88.23814 339.69338 L87.23893 340.82525 L86.27501 341.98816 L85.34723 343.18126 L84.45643 344.40371 L83.60346 345.65465 L82.78917 346.93323 L82.01441 348.23861 L81.28004 349.56993 L80.58688 350.92635 L79.93581 352.30702 L79.32766 353.71109 L78.76328 355.1377 L78.24353 356.58602 L77.76925 358.05519 L77.34129 359.54437 L76.9605 361.0527 L76.62772 362.57933 L76.34382 364.12342 L76.10963 365.68412 L75.926 367.26057 L75.79379 368.85194 L75.71384 370.45736 L75.687 372.076 L75.71384 373.69469 L75.79379 375.30017 L75.926 376.89158 L76.10963 378.46807 L76.34382 380.0288 L76.62772 381.57291 L76.9605 383.09956 L77.34129 384.6079 L77.76925 386.09708 L78.24353 387.56626 L78.76328 389.01457 L79.32766 390.44118 L79.93581 391.84524 L80.58688 393.22589 L81.28004 394.58229 L82.01441 395.91359 L82.78917 397.21894 L83.60346 398.49749 L84.45643 399.74839 L85.34723 400.9708 L86.27501 402.16387 L87.23893 403.32674 L88.23814 404.45857 L89.27178 405.5585 L90.33901 406.6257 L91.43898 407.65932 L92.57084 408.65849 L93.73374 409.62238 L94.92683 410.55013 L96.14927 411.44091 L97.40021 412.29385 L98.67878 413.10811 L99.98416 413.88284 L101.31549 414.61719 L102.67191 415.31031 L104.05259 415.96137 L105.45667 416.56949 L106.8833 417.13385 L108.33163 417.65358 L109.80083 418.12784 L111.29003 418.55578 L112.79838 418.93656 L114.32505 419.26932 L115.86917 419.55321 L117.42991 419.78739 L119.00641 419.97101 L120.59783 420.10322 L122.2033 420.18316 L123.822 420.21 L125.4407 420.18316 L127.04617 420.10321 L128.63759 419.971 L130.21409 419.78737 L131.77483 419.55318 L133.31895 419.26928 L134.84562 418.93651 L136.35397 418.55572 L137.84317 418.12776 L139.31237 417.65348 L140.7607 417.13373 L142.18733 416.56936 L143.59141 415.96121 L144.97209 415.31014 L146.32851 414.61699 L147.65984 413.88262 L148.96522 413.10787 L150.24379 412.29359 L151.49473 411.44063 L152.71717 410.54984 L153.91026 409.62206 L155.07316 408.65816 L156.20502 407.65896 L157.30499 406.62534 L158.37222 405.55812 L159.40586 404.45817 L160.40507 403.32633 L161.36899 402.16345 L162.29677 400.97037 L163.18757 399.74796 L164.04054 398.49705 L164.85483 397.21849 L165.62959 395.91314 L166.36396 394.58185 L167.05712 393.22545 L167.70819 391.84481 L168.31634 390.44076 L168.88072 389.01417 L169.40047 387.56587 L169.87475 386.09672 L170.30271 384.60756 L170.6835 383.09925 L171.01628 381.57263 L171.30018 380.02855 L171.53437 378.46786 L171.718 376.89142 L171.85021 375.30006 L171.93016 373.69464 L171.957 372.076 L171.957 249.855 L177.802 244.01 L178.79198 243.16332 L179.88627 242.49184 L181.06677 242.003 L182.31538 241.70424 L183.614 241.603 L184.91234 241.70434 L186.16109 242.00335 L187.34187 242.49249 L188.4363 243.16422 L189.426 244.011 L203.216 257.801 L204.10598 258.64607 L205.02846 259.43534 L205.98123 260.1689 L206.96211 260.84684 L207.96889 261.46926 L208.99938 262.03625 L210.05137 262.5479 L211.12268 263.0043 L212.2111 263.40555 L213.31444 263.75174 L214.4305 264.04296 L215.55709 264.2793 L216.692 264.46086 L217.83303 264.58773 L218.978 264.66 L219.36979 265.77572 L219.74801 266.89424 L220.11267 268.01547 L220.46377 269.13931 L220.8013 270.26565 L221.12526 271.3944 L221.43566 272.52546 L221.7325 273.65873 L222.01577 274.79412 L222.28547 275.93151 L222.54162 277.07082 L222.78419 278.21195 L223.0132 279.35479 L223.22864 280.49925 L223.43052 281.64523 L223.61884 282.79263 L223.79359 283.94136 L223.95477 285.0913 L224.10239 286.24237 L224.23644 287.39446 L224.35693 288.54748 L224.46385 289.70133 L224.5572 290.8559 L224.63699 292.01111 L224.70322 293.16685 L224.75587 294.32301 L224.79497 295.47952 L224.82049 296.63625 L224.83245 297.79312 L224.83085 298.95003 L224.81567 300.10688 L224.78694 301.26357 L224.74463 302.41999 L224.68876 303.57606 L224.61932 304.73167 L224.53632 305.88673 L224.43975 307.04113 L224.32962 308.19478 L224.20591 309.34757 L224.06864 310.49941 L223.91781 311.65021 L223.75341 312.79985 L223.57544 313.94825 L223.3839 315.0953 L223.1788 316.2409 L222.96013 317.38496 L222.7279 318.52738 L222.4821 319.66806 L222.22273 320.80689 L221.94979 321.94379 L221.66329 323.07865 L221.36322 324.21137 L221.04958 325.34186 L220.72237 326.47001 L220.3816 327.59572 L220.02726 328.71891 L219.65936 329.83946 L219.27788 330.95729 L218.88284 332.07228 L218.47423 333.18435 L218.05206 334.29339 L217.61631 335.39931 L217.167 336.502 L216.6142 337.86016 L216.07924 339.22255 L215.5621 340.58904 L215.0628 341.95947 L214.58133 343.33372 L214.11769 344.71165 L213.67189 346.09311 L213.24392 347.47797 L212.83378 348.86609 L212.44147 350.25733 L212.06699 351.65155 L211.71035 353.04861 L211.37154 354.44838 L211.05056 355.85072 L210.74741 357.25548 L210.46209 358.66253 L210.19461 360.07173 L209.94496 361.48294 L209.71314 362.89603 L209.49915 364.31085 L209.303 365.72726 L209.12468 367.14513 L208.96419 368.56431 L208.82153 369.98468 L208.69671 371.40609 L208.58971 372.82839 L208.50055 374.25146 L208.42922 375.67516 L208.37573 377.09934 L208.34006 378.52386 L208.32223 379.9486 L208.32223 381.3734 L208.34006 382.79814 L208.37573 384.22266 L208.42922 385.64684 L208.50055 387.07054 L208.58971 388.49361 L208.69671 389.91591 L208.82153 391.33732 L208.96419 392.75769 L209.12468 394.17687 L209.303 395.59474 L209.49915 397.01115 L209.71314 398.42597 L209.94496 399.83906 L210.19461 401.25027 L210.46209 402.65947 L210.74741 404.06652 L211.05056 405.47128 L211.37154 406.87362 L211.71035 408.27339 L212.06699 409.67045 L212.44147 411.06467 L212.83378 412.45591 L213.24392 413.84403 L213.67189 415.22889 L214.11769 416.61035 L214.58133 417.98828 L215.0628 419.36253 L215.5621 420.73296 L216.07924 422.09945 L216.6142 423.46184 L217.167 424.82 L217.64604 425.99701 L218.10962 427.17769 L218.55775 428.36192 L218.99043 429.54956 L219.40765 430.74051 L219.80942 431.93464 L220.19574 433.13184 L220.56661 434.33198 L220.92202 435.53494 L221.26198 436.7406 L221.58649 437.94885 L221.89554 439.15956 L222.18915 440.37261 L222.4673 441.58789 L222.72999 442.80527 L222.97724 444.02463 L223.20903 445.24585 L223.42537 446.46882 L223.62625 447.6934 L223.81169 448.91949 L223.98167 450.14696 L224.13619 451.3757 L224.27527 452.60557 L224.39889 453.83647 L224.50706 455.06826 L224.59978 456.30084 L224.67704 457.53408 L224.73885 458.76786 L224.78521 460.00207 L224.81612 461.23657 L224.83157 462.47125 L224.83157 463.706 L224.81612 464.94068 L224.78521 466.17519 L224.73885 467.4094 L224.67704 468.64318 L224.59978 469.87643 L224.50706 471.10902 L224.39889 472.34083 L224.27527 473.57173 L224.13619 474.80162 L223.98167 476.03037 L223.81169 477.25786 L223.62625 478.48396 L223.42537 479.70857 L223.20903 480.93156 L222.97724 482.1528 L222.72999 483.37219 L222.4673 484.58959 L222.18915 485.80489 L221.89554 487.01798 L221.58649 488.22872 L221.26198 489.437 L220.92202 490.64269 L220.56661 491.84569 L220.19574 493.04587 L219.80942 494.2431 L219.40765 495.43727 L218.99043 496.62826 L218.55775 497.81595 L218.10962 499.00021 L217.64604 500.18094 L217.167 501.358 L216.7523 502.68356 L216.58438 504.02331 L216.65148 505.34885 L216.94187 506.63177 L217.4438 507.84367 L218.14552 508.95615 L219.03529 509.9408 L220.10136 510.76922 L221.332 511.413 L222.79625 511.857 L224.274 512.001 L225.76429 511.85469 L227.18767 511.42719 L228.50287 510.73562 L229.66867 509.79715 L230.64379 508.62889 L231.387 507.248 L231.9398 505.88984 L232.47476 504.52745 L232.9919 503.16096 L233.4912 501.79053 L233.97267 500.41628 L234.43631 499.03835 L234.88211 497.65689 L235.31008 496.27203 L235.72022 494.88391 L236.11253 493.49267 L236.48701 492.09845 L236.84365 490.70139 L237.18246 489.30162 L237.50344 487.89928 L237.80659 486.49452 L238.09191 485.08747 L238.35939 483.67827 L238.60904 482.26706 L238.84086 480.85397 L239.05485 479.43915 L239.251 478.02274 L239.42932 476.60487 L239.58981 475.18569 L239.73247 473.76532 L239.85729 472.34391 L239.96429 470.92161 L240.05345 469.49854 L240.12478 468.07484 L240.17827 466.65066 L240.21394 465.22614 L240.23177 463.8014 L240.23177 462.3766 L240.21394 460.95186 L240.17827 459.52734 L240.12478 458.10316 L240.05345 456.67946 L239.96429 455.25639 L239.85729 453.83409 L239.73247 452.41268 L239.58981 450.99231 L239.42932 449.57313 L239.251 448.15526 L239.05485 446.73885 L238.84086 445.32403 L238.60904 443.91094 L238.35939 442.49973 L238.09191 441.09053 L237.80659 439.68348 L237.50344 438.27872 L237.18246 436.87638 L236.84365 435.47661 L236.48701 434.07955 L236.11253 432.68533 L235.72022 431.29409 L235.31008 429.90597 L234.88211 428.52111 L234.43631 427.13965 L233.97267 425.76172 L233.4912 424.38747 L232.9919 423.01704 L232.47476 421.65055 L231.9398 420.28816 L231.387 418.93 L230.90796 417.75299 L230.44438 416.57231 L229.99625 415.38808 L229.56357 414.20044 L229.14635 413.00949 L228.74458 411.81536 L228.35826 410.61816 L227.98739 409.41802 L227.63198 408.21506 L227.29202 407.0094 L226.96751 405.80115 L226.65846 404.59044 L226.36485 403.37739 L226.0867 402.16211 L225.82401 400.94473 L225.57676 399.72537 L225.34497 398.50415 L225.12863 397.28118 L224.92775 396.0566 L224.74231 394.83051 L224.57233 393.60304 L224.41781 392.3743 L224.27873 391.14443 L224.15511 389.91353 L224.04694 388.68174 L223.95422 387.44916 L223.87696 386.21592 L223.81515 384.98214 L223.76879 383.74793 L223.73788 382.51343 L223.72243 381.27875 L223.72243 380.044 L223.73788 378.80932 L223.76879 377.57481 L223.81515 376.3406 L223.87696 375.10682 L223.95422 373.87357 L224.04694 372.64098 L224.15511 371.40917 L224.27873 370.17827 L224.41781 368.94838 L224.57233 367.71963 L224.74231 366.49214 L224.92775 365.26604 L225.12863 364.04143 L225.34497 362.81844 L225.57676 361.5972 L225.82401 360.37781 L226.0867 359.16041 L226.36485 357.94511 L226.65846 356.73202 L226.96751 355.52128 L227.29202 354.313 L227.63198 353.10731 L227.98739 351.90431 L228.35826 350.70413 L228.74458 349.5069 L229.14635 348.31273 L229.56357 347.12174 L229.99625 345.93405 L230.44438 344.74979 L230.90796 343.56906 L231.387 342.392 L231.90083 341.13099 L232.39928 339.86633 L232.88235 338.59813 L233.35003 337.32649 L233.80233 336.05153 L234.23926 334.77336 L234.66079 333.49209 L235.06695 332.20783 L235.45773 330.92069 L235.83313 329.63079 L236.19314 328.33823 L236.53778 327.04313 L236.86703 325.74559 L237.18091 324.44573 L237.47941 323.14366 L237.76253 321.83948 L238.03027 320.53332 L238.28263 319.22528 L238.51961 317.91547 L238.74122 316.60401 L238.94744 315.291 L239.1383 313.97656 L239.31377 312.66079 L239.47387 311.34381 L239.61859 310.02572 L239.74793 308.70665 L239.8619 307.3867 L239.9605 306.06598 L240.04372 304.7446 L240.11156 303.42267 L240.16403 302.10031 L240.20113 300.77762 L240.22285 299.45472 L240.22919 298.13172 L240.22017 296.80873 L240.19577 295.48585 L240.156 294.16321 L240.10085 292.84091 L240.03034 291.51906 L239.94445 290.19777 L239.84319 288.87716 L239.72656 287.55733 L239.59455 286.2384 L239.44718 284.92048 L239.28443 283.60368 L239.10632 282.2881 L238.91284 280.97387 L238.70398 279.66108 L238.47976 278.34986 L238.24016 277.04032 L237.9852 275.73255 L237.71487 274.42669 L237.42917 273.12283 L237.12811 271.82108 L236.81167 270.52157 L236.47987 269.2244 L236.1327 267.92967 L235.77017 266.63751 L235.39227 265.34802 L234.999 264.06131 L234.59036 262.7775 L234.16637 261.49669 L233.727 260.219 L235.2045 259.076 L236.607 257.801 L250.397 244.011 L251.38698 243.16432 L252.48127 242.49284 L253.66177 242.004 L254.91038 241.70524 L256.209 241.604 L257.50772 241.70534 L258.75652 242.00435 L259.93716 242.49349 L261.0314 243.16522 L262.021 244.012 L275.811 257.802 L276.73941 258.6811 L277.70314 259.49934 L278.69965 260.25697 L279.72641 260.95419 L280.78088 261.59125 L281.86051 262.16837 L282.96278 262.68577 L284.08514 263.1437 L285.22506 263.54236 L286.38 263.882 L286.78569 265.00807 L287.17752 266.13709 L287.55549 267.26893 L287.9196 268.40352 L288.26985 269.54073 L288.60623 270.68047 L288.92876 271.82264 L289.23742 272.96713 L289.53223 274.11385 L289.81317 275.26268 L290.08025 276.41354 L290.33346 277.56631 L290.57281 278.72089 L290.7983 279.87719 L291.00993 281.03509 L291.20769 282.1945 L291.39158 283.35532 L291.56162 284.51744 L291.71778 285.68076 L291.86008 286.84518 L291.98852 288.01059 L292.10309 289.1769 L292.20379 290.344 L292.29063 291.51179 L292.3636 292.68017 L292.4227 293.84903 L292.46794 295.01827 L292.4993 296.1878 L292.5168 297.3575 L292.52043 298.52728 L292.51019 299.69704 L292.48609 300.86667 L292.44811 302.03606 L292.39626 303.20513 L292.33055 304.37376 L292.25096 305.54185 L292.1575 306.7093 L292.05018 307.87601 L291.92898 309.04188 L291.79391 310.20681 L291.64496 311.37068 L291.48215 312.53341 L291.30546 313.69488 L291.1149 314.855 L290.91047 316.01366 L290.69216 317.17077 L290.45998 318.32621 L290.21392 319.47989 L289.95399 320.6317 L289.68019 321.78155 L289.39251 322.92932 L289.09096 324.07493 L288.77553 325.21826 L288.44622 326.35921 L288.10304 327.49769 L287.74598 328.63358 L287.37505 329.76679 L286.99023 330.89722 L286.59154 332.02476 L286.17897 333.14931 L285.75253 334.27077 L285.3122 335.38903 L284.858 336.504 L284.3052 337.86216 L283.77024 339.22455 L283.2531 340.59104 L282.7538 341.96147 L282.27233 343.33572 L281.80869 344.71365 L281.36289 346.09511 L280.93492 347.47997 L280.52478 348.86809 L280.13247 350.25933 L279.75799 351.65355 L279.40135 353.05061 L279.06254 354.45038 L278.74156 355.85272 L278.43841 357.25748 L278.15309 358.66453 L277.88561 360.07373 L277.63596 361.48494 L277.40414 362.89803 L277.19015 364.31285 L276.994 365.72926 L276.81568 367.14713 L276.65519 368.56631 L276.51253 369.98668 L276.38771 371.40809 L276.28071 372.83039 L276.19155 374.25346 L276.12022 375.67716 L276.06673 377.10134 L276.03106 378.52586 L276.01323 379.9506 L276.01323 381.3754 L276.03106 382.80014 L276.06673 384.22466 L276.12022 385.64884 L276.19155 387.07254 L276.28071 388.49561 L276.38771 389.91791 L276.51253 391.33932 L276.65519 392.75969 L276.81568 394.17887 L276.994 395.59674 L277.19015 397.01315 L277.40414 398.42797 L277.63596 399.84106 L277.88561 401.25227 L278.15309 402.66147 L278.43841 404.06852 L278.74156 405.47328 L279.06254 406.87562 L279.40135 408.27539 L279.75799 409.67245 L280.13247 411.06667 L280.52478 412.45791 L280.93492 413.84603 L281.36289 415.23089 L281.80869 416.61235 L282.27233 417.99028 L282.7538 419.36453 L283.2531 420.73496 L283.77024 422.10145 L284.3052 423.46384 L284.858 424.822 L285.33704 425.99901 L285.80062 427.17969 L286.24875 428.36392 L286.68143 429.55156 L287.09865 430.74251 L287.50042 431.93664 L287.88674 433.13384 L288.25761 434.33398 L288.61302 435.53694 L288.95298 436.7426 L289.27749 437.95085 L289.58654 439.16156 L289.88015 440.37461 L290.1583 441.58989 L290.42099 442.80727 L290.66824 444.02663 L290.90003 445.24785 L291.11637 446.47082 L291.31725 447.6954 L291.50269 448.92149 L291.67267 450.14896 L291.82719 451.3777 L291.96627 452.60757 L292.08989 453.83847 L292.19806 455.07026 L292.29078 456.30284 L292.36804 457.53608 L292.42985 458.76986 L292.47621 460.00407 L292.50712 461.23857 L292.52257 462.47325 L292.52257 463.708 L292.50712 464.94268 L292.47621 466.17719 L292.42985 467.4114 L292.36804 468.64518 L292.29078 469.87843 L292.19806 471.11102 L292.08989 472.34283 L291.96627 473.57373 L291.82719 474.80362 L291.67267 476.03237 L291.50269 477.25986 L291.31725 478.48596 L291.11637 479.71057 L290.90003 480.93356 L290.66824 482.1548 L290.42099 483.37419 L290.1583 484.59159 L289.88015 485.80689 L289.58654 487.01998 L289.27749 488.23072 L288.95298 489.439 L288.61302 490.64469 L288.25761 491.84769 L287.88674 493.04787 L287.50042 494.2451 L287.09865 495.43927 L286.68143 496.63026 L286.24875 497.81795 L285.80062 499.00221 L285.33704 500.18294 L284.858 501.36 L284.4433 502.68556 L284.27538 504.02531 L284.34248 505.35085 L284.63287 506.63377 L285.1348 507.84567 L285.83652 508.95815 L286.72629 509.9428 L287.79236 510.77122 L289.023 511.415 L290.48725 511.859 L291.965 512.003 L293.45529 511.85669 L294.87867 511.42919 L296.19388 510.73762 L297.35967 509.79915 L298.33479 508.63089 L299.078 507.25 L299.6308 505.89184 L300.16576 504.52945 L300.6829 503.16296 L301.1822 501.79253 L301.66367 500.41828 L302.12731 499.04035 L302.57311 497.65889 L303.00108 496.27403 L303.41122 494.88591 L303.80353 493.49467 L304.17801 492.10045 L304.53465 490.70339 L304.87346 489.30362 L305.19444 487.90128 L305.49759 486.49652 L305.78291 485.08947 L306.05039 483.68027 L306.30004 482.26906 L306.53186 480.85597 L306.74585 479.44115 L306.942 478.02474 L307.12032 476.60687 L307.28081 475.18769 L307.42347 473.76732 L307.54829 472.34591 L307.65529 470.92361 L307.74445 469.50054 L307.81578 468.07684 L307.86927 466.65266 L307.90494 465.22814 L307.92277 463.8034 L307.92277 462.3786 L307.90494 460.95386 L307.86927 459.52934 L307.81578 458.10516 L307.74445 456.68146 L307.65529 455.25839 L307.54829 453.83609 L307.42347 452.41468 L307.28081 450.99431 L307.12032 449.57513 L306.942 448.15726 L306.74585 446.74085 L306.53186 445.32603 L306.30004 443.91294 L306.05039 442.50173 L305.78291 441.09253 L305.49759 439.68548 L305.19444 438.28072 L304.87346 436.87838 L304.53465 435.47861 L304.17801 434.08155 L303.80353 432.68733 L303.41122 431.29609 L303.00108 429.90797 L302.57311 428.52311 L302.12731 427.14165 L301.66367 425.76372 L301.1822 424.38947 L300.6829 423.01904 L300.16576 421.65255 L299.6308 420.29016 L299.078 418.932 L298.59896 417.75499 L298.13538 416.57431 L297.68725 415.39008 L297.25457 414.20244 L296.83735 413.01149 L296.43558 411.81736 L296.04926 410.62016 L295.67839 409.42002 L295.32298 408.21706 L294.98302 407.0114 L294.65851 405.80315 L294.34946 404.59244 L294.05585 403.37939 L293.7777 402.16411 L293.51501 400.94673 L293.26776 399.72737 L293.03597 398.50615 L292.81963 397.28318 L292.61875 396.0586 L292.43331 394.83251 L292.26333 393.60504 L292.10881 392.3763 L291.96973 391.14643 L291.84611 389.91553 L291.73794 388.68374 L291.64522 387.45116 L291.56796 386.21792 L291.50615 384.98414 L291.45979 383.74993 L291.42888 382.51543 L291.41343 381.28075 L291.41343 380.046 L291.42888 378.81132 L291.45979 377.57681 L291.50615 376.3426 L291.56796 375.10882 L291.64522 373.87557 L291.73794 372.64298 L291.84611 371.41117 L291.96973 370.18027 L292.10881 368.95038 L292.26333 367.72163 L292.43331 366.49414 L292.61875 365.26804 L292.81963 364.04343 L293.03597 362.82044 L293.26776 361.5992 L293.51501 360.37981 L293.7777 359.16241 L294.05585 357.94711 L294.34946 356.73402 L294.65851 355.52328 L294.98302 354.315 L295.32298 353.10931 L295.67839 351.90631 L296.04926 350.70613 L296.43558 349.5089 L296.83735 348.31473 L297.25457 347.12374 L297.68725 345.93605 L298.13538 344.75179 L298.59896 343.57106 L299.078 342.394 L299.5769 341.17024 L300.06131 339.94304 L300.53124 338.71249 L300.98668 337.4787 L301.42763 336.24176 L301.8541 335.00179 L302.26609 333.75888 L302.66358 332.51312 L303.04659 331.26464 L303.41512 330.01351 L303.76916 328.75986 L304.10872 327.50377 L304.4338 326.24535 L304.74438 324.98471 L305.04049 323.72193 L305.32211 322.45713 L305.58925 321.19041 L305.8419 319.92186 L306.08007 318.65159 L306.30376 317.3797 L306.51296 316.1063 L306.70768 314.83147 L306.88792 313.55533 L307.05368 312.27798 L307.20495 310.99951 L307.34175 309.72004 L307.46406 308.43965 L307.57189 307.15846 L307.66524 305.87655 L307.7441 304.59405 L307.80849 303.31104 L307.85839 302.02762 L307.89382 300.74391 L307.91476 299.46 L307.92122 298.17599 L307.91321 296.89198 L307.89071 295.60808 L307.85373 294.32439 L307.80228 293.041 L307.73634 291.75802 L307.65593 290.47556 L307.56104 289.1937 L307.45167 287.91256 L307.32782 286.63224 L307.18949 285.35283 L307.03668 284.07445 L306.8694 282.79718 L306.68763 281.52113 L306.49139 280.24641 L306.28068 278.97311 L306.05548 277.70133 L305.81581 276.43119 L305.56166 275.16277 L305.29304 273.89618 L305.00994 272.63153 L304.71236 271.3689 L304.40031 270.10841 L304.07378 268.85016 L303.73277 267.59425 L303.37729 266.34077 L303.00734 265.08984 L302.62291 263.84155 L302.224 262.596 L303.47422 261.98943 L304.69507 261.30778 L305.88238 260.54962 L307.03193 259.71356 L308.13953 258.79815 L309.201 257.802 L322.991 244.012 L323.98098 243.16532 L325.07527 242.49384 L326.25577 242.005 L327.50438 241.70624 L328.803 241.605 L330.10134 241.70634 L331.35009 242.00535 L332.53087 242.49449 L333.6253 243.16622 L334.615 244.013 L340.045 249.443 L340.045 372.077 L340.07184 373.69569 L340.15179 375.30117 L340.284 376.89258 L340.46763 378.46907 L340.70182 380.0298 L340.98572 381.57391 L341.31849 383.10056 L341.69928 384.6089 L342.12724 386.09808 L342.60152 387.56726 L343.12127 389.01557 L343.68564 390.44218 L344.29379 391.84624 L344.94486 393.22689 L345.63801 394.58329 L346.37238 395.91459 L347.14713 397.21994 L347.96141 398.49849 L348.81437 399.74939 L349.70516 400.9718 L350.63294 402.16487 L351.59684 403.32774 L352.59604 404.45957 L353.62966 405.5595 L354.69688 406.6267 L355.79683 407.66032 L356.92867 408.65949 L358.09155 409.62338 L359.28463 410.55113 L360.50704 411.44191 L361.75795 412.29485 L363.03651 413.10911 L364.34186 413.88384 L365.67315 414.61819 L367.02955 415.31131 L368.41019 415.96237 L369.81424 416.57049 L371.24083 417.13485 L372.68913 417.65458 L374.15828 418.12884 L375.64744 418.55678 L377.15575 418.93756 L378.68237 419.27032 L380.22645 419.55421 L381.78714 419.78839 L383.36358 419.97201 L384.95494 420.10422 L386.56036 420.18416 L388.179 420.211 L389.7977 420.18416 L391.40317 420.10421 L392.99459 419.972 L394.57109 419.78837 L396.13183 419.55418 L397.67595 419.27028 L399.20262 418.93751 L400.71097 418.55672 L402.20017 418.12876 L403.66937 417.65448 L405.1177 417.13473 L406.54433 416.57036 L407.94841 415.96221 L409.32909 415.31114 L410.68551 414.61799 L412.01684 413.88362 L413.32222 413.10887 L414.60079 412.29459 L415.85173 411.44163 L417.07417 410.55084 L418.26726 409.62306 L419.43016 408.65916 L420.56202 407.65996 L421.66199 406.62634 L422.72922 405.55912 L423.76286 404.45917 L424.76207 403.32733 L425.72599 402.16445 L426.65377 400.97137 L427.54457 399.74896 L428.39754 398.49805 L429.21183 397.21949 L429.98659 395.91414 L430.72096 394.58285 L431.41412 393.22645 L432.06519 391.84581 L432.67334 390.44176 L433.23772 389.01517 L433.75747 387.56687 L434.23175 386.09772 L434.65971 384.60856 L435.0405 383.10025 L435.37328 381.57363 L435.65718 380.02955 L435.89137 378.46886 L436.075 376.89242 L436.20721 375.30106 L436.28716 373.69564 L436.314 372.077 L436.28728 370.45836 L436.20745 368.85293 L436.07536 367.26156 L435.89184 365.6851 L435.65776 364.12439 L435.37397 362.58029 L435.0413 361.05364 L434.66061 359.5453 L434.23275 358.05611 L433.75857 356.58691 L433.23891 355.13858 L432.67463 353.71194 L432.06657 352.30784 L431.41559 350.92715 L430.72252 349.57071 L429.98823 348.23936 L429.21355 346.93395 L428.39934 345.65534 L427.54645 344.40437 L426.65572 343.1819 L425.72801 341.98877 L424.76416 340.82582 L423.76502 339.69392 L422.73144 338.59391 L421.66427 337.52663 L420.56436 336.49294 L419.43256 335.49369 L418.26971 334.52972 L417.07667 333.60189 L415.85428 332.71104 L414.60339 331.85802 L413.32485 331.04369 L412.01952 330.26888 L410.68823 329.53445 L409.33184 328.84126 L407.9512 328.19014 L406.54715 327.58194 L405.12055 327.01753 L403.67224 326.49774 L402.20307 326.02342 L400.71389 325.59543 L399.20556 325.2146 L397.67891 324.8818 L396.1348 324.59787 L394.57407 324.36366 L392.99758 324.18002 L391.40617 324.0478 L389.80069 323.96784 L388.182 323.941" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#b9ace5"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M402.858,219.583l2.223-59.635C408.069,79.76,346.147,11.163,265.97,7.896 c-80.356-3.273-148.017,59.362-151.01,139.663l-2.407,64.61l0,0c-0.233,6.251,2.027,12.341,6.283,16.926l17.447,18.797 c5.979,6.442,16.05,6.818,22.493,0.838l14.293-13.266c6.442-5.979,16.513-5.605,22.493,0.838l13.266,14.293 c5.979,6.442,16.05,6.818,22.493,0.838l14.293-13.266c6.442-5.979,16.513-5.605,22.493,0.838l13.266,14.293 c5.979,6.442,16.05,6.818,22.493,0.838l14.293-13.266c6.442-5.979,16.513-5.605,22.493,0.838l13.266,14.293 c5.979,6.442,16.05,6.818,22.493,0.838l18.797-17.447c4.586-4.256,7.293-10.159,7.526-16.411L402.858,219.583z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#8675b6"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M289.212,116.064c-0.993,26.637-32.259,47.096-32.259,47.096s-29.656-22.729-28.664-49.366 S260.548,66.7,260.548,66.7S290.205,89.428,289.212,116.064z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#8675b6"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M345.652,72.682c9.799,10.557,5.67,30.321,5.67,30.321s-20.016,2.648-29.815-7.91 s-5.67-30.321-5.67-30.321S335.854,62.125,345.652,72.682z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#8675b6"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M186.032,66.734c-10.557,9.799-7.91,29.815-7.91,29.815s19.764,4.129,30.321-5.67 c10.557-9.799,7.91-29.815,7.91-29.815S196.59,56.935,186.032,66.734z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M384.614,219.119c3.006-3.006,3.006-7.879,0-10.883c-3.007-3.006-7.879-3.007-10.885-0.001 c-3.204,3.205-8.419,3.206-11.625,0l-13.789-13.789c-4.46-4.461-10.39-6.916-16.697-6.916c-6.307,0-12.237,2.457-16.697,6.915 l-13.79,13.79c-3.205,3.205-8.42,3.205-11.624,0l-13.789-13.789c-4.46-4.461-10.39-6.916-16.697-6.916 c-6.307,0-12.237,2.457-16.697,6.915l-13.79,13.79c-3.205,3.205-8.42,3.205-11.624,0l-13.79-13.789 c-4.46-4.461-10.389-6.916-16.697-6.916c-6.307,0-12.237,2.457-16.697,6.915l-13.79,13.79c-3.205,3.205-8.42,3.205-11.624,0 c-3.007-3.005-7.879-3.006-10.885,0.001c-3.006,3.006-3.005,7.879,0,10.883c9.206,9.205,24.185,9.206,33.392,0l13.79-13.79 c1.553-1.553,3.616-2.407,5.812-2.407c2.196,0,4.26,0.855,5.812,2.408l13.79,13.79c4.603,4.602,10.649,6.905,16.696,6.905 c6.046-0.001,12.094-2.303,16.697-6.905l13.79-13.79c1.553-1.553,3.616-2.407,5.812-2.407c2.196,0,4.26,0.855,5.812,2.408 l13.79,13.79c9.206,9.205,24.185,9.206,33.392,0l13.79-13.79c1.553-1.553,3.616-2.407,5.812-2.407s4.26,0.855,5.812,2.408 l13.79,13.79C360.428,228.326,375.408,228.325,384.614,219.119z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M138.188,164.242c4.25,0,7.696-3.445,7.696-7.696c0-13.447,2.342-26.597,6.959-39.088c1.475-3.987-0.563-8.412-4.55-9.887 c-3.99-1.476-8.414,0.563-9.888,4.55c-5.252,14.204-7.915,29.15-7.915,44.425C130.491,160.796,133.937,164.242,138.188,164.242z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M221.56,49.637c0.783,0,1.581-0.12,2.366-0.375c11.161-3.604,22.821-5.43,34.664-5.43c0.145,0.001,0.285,0.009,0.434,0.001 c4.238,0,7.681-3.428,7.696-7.67c0.015-4.25-3.419-7.709-7.67-7.723c-0.154,0-0.307-0.001-0.461-0.001 c-13.449,0-26.702,2.077-39.393,6.176c-4.045,1.305-6.265,5.644-4.959,9.688C215.292,47.563,218.311,49.637,221.56,49.637z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M388.182,323.941c-4.25,0-7.696,3.445-7.696,7.696s3.446,7.696,7.696,7.696c18.054,0,32.743,14.688,32.743,32.743 c0,18.054-14.689,32.742-32.743,32.742c-18.054,0-32.742-14.688-32.742-32.742V262.62c8.682,3.885,19.241,2.297,26.358-4.82 l18.134-18.135c5.909-5.91,9.163-13.766,9.163-22.122v-63.08c0-84.88-68.343-154.171-152.347-154.461C256.567,0,256.388,0,256.206,0 c-40.741,0-79.05,15.824-107.917,44.593c-28.997,28.898-44.968,67.357-44.968,108.294v64.656c0,8.356,3.254,16.212,9.164,22.123 L130.62,257.8c7.004,7.002,17.342,8.662,25.945,5.011v109.265c0,18.054-14.689,32.742-32.743,32.742s-32.743-14.688-32.743-32.742 c0-18.055,14.689-32.743,32.743-32.743c4.25,0,7.696-3.445,7.696-7.696s-3.446-7.696-7.696-7.696 c-26.542,0-48.135,21.594-48.135,48.135c0,26.542,21.593,48.134,48.135,48.134s48.135-21.593,48.135-48.134V249.855l5.845-5.845 c1.553-1.553,3.616-2.407,5.812-2.407c2.195,0,4.26,0.855,5.812,2.408l13.79,13.79c4.365,4.365,10.031,6.634,15.762,6.859 c8.37,23.4,7.767,48.72-1.811,71.842c-11.796,28.476-11.796,59.842,0,88.318c10.222,24.678,10.222,51.859,0,76.538 c-1.626,3.927,0.238,8.429,4.165,10.055c0.963,0.4,1.961,0.588,2.942,0.588c3.02,0,5.886-1.79,7.113-4.753 c11.796-28.476,11.796-59.842,0-88.318c-10.222-24.678-10.222-51.859,0-76.538c10.952-26.442,11.728-55.375,2.34-82.173 c1.004-0.727,1.976-1.515,2.88-2.418l13.79-13.79c1.553-1.553,3.616-2.407,5.812-2.407c2.196,0,4.26,0.855,5.812,2.408l13.79,13.79 c3.033,3.032,6.697,5.046,10.569,6.08c8.665,23.616,8.162,49.243-1.522,72.622c-11.796,28.476-11.796,59.842,0,88.318 c10.222,24.678,10.222,51.859,0,76.538c-1.626,3.927,0.238,8.429,4.165,10.055c0.963,0.4,1.961,0.588,2.942,0.588 c3.02,0,5.886-1.79,7.113-4.753c11.796-28.476,11.796-59.842,0-88.318c-10.222-24.678-10.222-51.859,0-76.538 c10.629-25.662,11.675-53.671,3.146-79.798c2.527-1.139,4.903-2.72,6.977-4.794l13.79-13.79c1.553-1.553,3.616-2.407,5.812-2.407 c2.195,0,4.26,0.855,5.812,2.408l5.43,5.43v122.634c0,26.542,21.593,48.134,48.134,48.134c26.542,0,48.135-21.593,48.135-48.134 C436.316,345.536,414.724,323.941,388.182,323.941z M328.805,226.21c-6.308,0-12.237,2.457-16.697,6.915l-13.79,13.79 c-3.205,3.205-8.42,3.205-11.624,0l-13.789-13.789c-4.46-4.461-10.39-6.916-16.697-6.916c-6.307,0-12.237,2.457-16.697,6.915 l-13.79,13.79c-3.205,3.205-8.42,3.205-11.624,0l-13.789-13.789c-4.46-4.461-10.39-6.916-16.697-6.916s-12.237,2.457-16.697,6.915 l-13.79,13.79c-3.205,3.205-8.42,3.205-11.624,0l-18.134-18.133c-3.002-3.003-4.656-6.993-4.656-11.239v-64.656 c0-36.816,14.362-71.404,40.44-97.391c25.965-25.874,60.413-40.104,97.055-40.104c0.162,0,0.327,0,0.49,0.001 c75.546,0.262,137.007,62.647,137.007,139.069v63.08c0,4.245-1.653,8.236-4.655,11.238l-18.134,18.134 c-3.205,3.205-8.42,3.205-11.624,0l-13.789-13.789C341.042,228.667,335.112,226.21,328.805,226.21z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M249.044,60.384c-1.377,0.976-33.728,24.258-33.728,54.542s32.351,53.566,33.728,54.542c1.333,0.945,2.892,1.418,4.45,1.418 s3.117-0.473,4.45-1.418c1.377-0.976,33.728-24.258,33.728-54.542s-32.351-53.566-33.728-54.542 C255.279,58.493,251.711,58.493,249.044,60.384z M276.282,114.925c0,16.661-15.062,31.761-22.786,38.409 c-7.728-6.651-22.787-21.75-22.787-38.409c0-16.661,15.062-31.761,22.786-38.409C261.223,83.168,276.282,98.267,276.282,114.925z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M337.824,107.834c4.663,0,8.134-0.535,9.026-0.687c3.222-0.549,5.745-3.072,6.294-6.295 c0.416-2.439,3.694-24.19-8.939-36.824c0-0.001,0-0.001,0-0.001c-12.634-12.632-34.385-9.355-36.823-8.939 c-3.222,0.549-5.746,3.072-6.294,6.294c-0.416,2.439-3.694,24.19,8.939,36.825C318.042,106.223,329.729,107.834,337.824,107.834z M333.322,74.912c4.194,4.195,5.152,11.803,5.098,17.509c-5.722,0.016-13.317-0.905-17.509-5.097 c-4.194-4.196-5.152-11.802-5.098-17.509C321.519,69.773,329.128,70.72,333.322,74.912z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M170.947,107.147c0.892,0.151,4.362,0.687,9.026,0.687c8.095,0,19.781-1.61,27.797-9.625 c12.634-12.635,9.355-34.386,8.939-36.825c-0.549-3.222-3.073-5.745-6.295-6.294c-2.437-0.413-24.189-3.693-36.823,8.939 c0,0,0,0,0,0.001c-12.633,12.634-9.355,34.385-8.939,36.824C165.201,104.075,167.725,106.598,170.947,107.147z M184.475,74.913 c4.194-4.194,11.778-5.122,17.506-5.099c0.044,5.669-0.91,13.324-5.095,17.509c-4.194,4.195-11.81,5.132-17.505,5.099 C179.336,86.753,180.29,79.098,184.475,74.913z" }
        }
        }
    }

    // https://www.svgrepo.com/svg/37779/turtle | CC0, as listed by SVG Repo.
    // Changes: coordinated fill colours; cream vector backing; layout transforms.
    component TurtleArt: Item {
        id: art
        implicitWidth: 544.25706
        implicitHeight: 540.15006
        Shape {
            width: 544.25706
            height: 540.15006
            antialiasing: true
            transform: [
                Translate { x: 16.12803; y: 14.07503 },
                Scale { xScale: art.width / art.implicitWidth; yScale: art.height / art.implicitHeight }
            ]
        ShapePath {
            strokeWidth: 23.04004
            strokeColor: "#fff6e7"
            fillColor: "#fff6e7"
            fillRule: ShapePath.WindingFill
            joinStyle: ShapePath.RoundJoin
            capStyle: ShapePath.RoundCap
            PathSvg { path: "M424.18 200.763 L422.61981 200.77719 L421.05719 200.81915 L419.495 200.888 L418.52409 198.84954 L417.52854 196.82513 L416.50854 194.81499 L415.46429 192.8193 L414.39598 190.83826 L413.30381 188.87206 L412.18797 186.9209 L411.04866 184.98498 L409.88607 183.0645 L408.70041 181.15964 L407.49185 179.2706 L406.26061 177.39759 L405.00686 175.54079 L403.73082 173.70041 L402.43267 171.87663 L401.11261 170.06966 L399.77084 168.27968 L398.40754 166.5069 L397.02292 164.75152 L395.61717 163.01372 L394.19048 161.2937 L392.74305 159.59167 L391.27508 157.90781 L389.78676 156.24232 L388.27828 154.5954 L386.74984 152.96724 L385.20164 151.35803 L383.63387 149.76799 L382.04672 148.19729 L380.4404 146.64614 L378.81509 145.11474 L377.17099 143.60327 L375.5083 142.11194 L373.8272 140.64093 L372.12791 139.19046 L370.4106 137.7607 L368.67549 136.35186 L366.92275 134.96414 L365.15259 133.59772 L363.3652 132.25281 L361.56078 130.92961 L359.73952 129.6283 L357.90162 128.34908 L356.04727 127.09215 L354.17666 125.85771 L352.29 124.64595 L350.38748 123.45706 L348.46929 122.29125 L346.53562 121.14871 L344.58668 120.02963 L342.62266 118.93421 L340.64375 117.86264 L338.65015 116.81513 L336.64205 115.79187 L334.61965 114.79305 L332.58314 113.81888 L330.53272 112.86953 L328.46859 111.94522 L326.39093 111.04614 L324.29995 110.17248 L322.19584 109.32444 L320.07879 108.50221 L317.949 107.706 L317.949 64 L317.92808 62.37837 L317.86566 60.76689 L317.76227 59.16605 L317.6184 57.57639 L317.43458 55.9984 L317.21132 54.43261 L316.94913 52.87953 L316.64853 51.33968 L316.31003 49.81356 L315.93415 48.30169 L315.52139 46.80459 L315.07229 45.32277 L314.58734 43.85674 L314.06706 42.40702 L313.51197 40.97412 L312.92257 39.55856 L312.2994 38.16085 L311.64295 36.7815 L310.95374 35.42103 L310.23229 34.07995 L309.47911 32.75878 L308.69472 31.45803 L307.87962 30.17821 L307.03434 28.91984 L306.15938 27.68343 L305.25526 26.4695 L304.3225 25.27856 L303.36161 24.11113 L302.3731 22.96771 L301.35749 21.84883 L300.31529 20.75499 L299.24701 19.68671 L298.15317 18.64451 L297.03429 17.6289 L295.89087 16.64039 L294.72344 15.6795 L293.5325 14.74674 L292.31857 13.84262 L291.08216 12.96766 L289.82379 12.12238 L288.54397 11.30728 L287.24322 10.52289 L285.92205 9.76971 L284.58097 9.04826 L283.2205 8.35905 L281.84115 7.7026 L280.44344 7.07943 L279.02788 6.49003 L277.59498 5.93494 L276.14526 5.41466 L274.67923 4.92971 L273.19741 4.48061 L271.70031 4.06785 L270.18844 3.69197 L268.66232 3.35347 L267.12247 3.05287 L265.56939 2.79068 L264.0036 2.56742 L262.42561 2.3836 L260.83595 2.23973 L259.23511 2.13634 L257.62363 2.07392 L256.002 2.053 L254.38037 2.07392 L252.76889 2.13634 L251.16805 2.23973 L249.57838 2.3836 L248.00039 2.56742 L246.43459 2.79068 L244.8815 3.05287 L243.34163 3.35347 L241.8155 3.69197 L240.30362 4.06785 L238.80651 4.48061 L237.32467 4.92971 L235.85863 5.41466 L234.40889 5.93494 L232.97598 6.49003 L231.5604 7.07943 L230.16267 7.7026 L228.7833 8.35905 L227.42281 9.04826 L226.08171 9.76971 L224.76052 10.52289 L223.45975 11.30728 L222.17991 12.12238 L220.92151 12.96766 L219.68509 13.84262 L218.47113 14.74674 L217.28017 15.6795 L216.11271 16.64039 L214.96927 17.6289 L213.85036 18.64451 L212.7565 19.68671 L211.6882 20.75499 L210.64598 21.84883 L209.63034 22.96771 L208.64181 24.11113 L207.68089 25.27856 L206.74811 26.4695 L205.84397 27.68343 L204.96899 28.91984 L204.12368 30.17821 L203.30856 31.45803 L202.52415 32.75878 L201.77095 34.07995 L201.04948 35.42103 L200.36025 36.7815 L199.70378 38.16085 L199.08059 39.55856 L198.49118 40.97412 L197.93607 42.40702 L197.41577 43.85674 L196.93081 45.32277 L196.48169 46.80459 L196.06892 48.30169 L195.69303 49.81356 L195.35452 51.33968 L195.05391 52.87953 L194.79171 54.43261 L194.56844 55.9984 L194.38461 57.57639 L194.24074 59.16605 L194.13734 60.76689 L194.07492 62.37837 L194.054 64 L194.054 107.707 L191.92412 108.50326 L189.80698 109.32554 L187.70278 110.17363 L185.61171 111.04734 L183.53397 111.94648 L181.46976 112.87084 L179.41926 113.82024 L177.38268 114.79448 L175.36021 115.79336 L173.35204 116.81668 L171.35837 117.86425 L169.3794 118.93587 L167.41532 120.03135 L165.46632 121.1505 L163.5326 122.29311 L161.61435 123.45898 L159.71178 124.64794 L157.82507 125.85976 L155.95442 127.09427 L154.10002 128.35127 L152.26207 129.63056 L150.44077 130.93193 L148.63631 132.25521 L146.84889 133.60019 L145.07869 134.96668 L143.32592 136.35447 L141.59077 137.76338 L139.87343 139.19321 L138.17411 140.64375 L136.49299 142.11483 L134.83027 143.60623 L133.18615 145.11777 L131.56082 146.64925 L129.95447 148.20047 L128.36731 149.77124 L126.79952 151.36136 L125.2513 152.97063 L123.72284 154.59886 L122.21435 156.24585 L120.72602 157.91141 L119.25803 159.59534 L117.81059 161.29744 L116.3839 163.01753 L114.97813 164.75539 L113.5935 166.51085 L112.2302 168.28369 L110.88842 170.07373 L109.56835 171.88077 L108.2702 173.70461 L106.99415 175.54506 L105.74041 177.40192 L104.50916 179.275 L103.3006 181.16409 L102.11493 183.06901 L100.95235 184.98956 L99.81303 186.92553 L98.6972 188.87675 L97.60502 190.843 L96.53671 192.8241 L95.49246 194.81984 L94.47246 196.83004 L93.47691 198.85449 L92.506 200.893 L90.94474 200.82267 L89.38259 200.779 L87.822 200.764 L85.52295 200.79361 L83.23827 200.88205 L80.96871 201.02859 L78.71498 201.2325 L76.47782 201.49306 L74.25795 201.80953 L72.0561 202.18119 L69.873 202.6073 L67.70939 203.08715 L65.56598 203.61999 L63.44351 204.2051 L61.34271 204.84175 L59.2643 205.52922 L57.20901 206.26677 L55.17758 207.05368 L53.17072 207.88921 L51.18918 208.77265 L49.23367 209.70325 L47.30493 210.68029 L45.40369 211.70304 L43.53067 212.77078 L41.6866 213.88277 L39.87221 215.03828 L38.08823 216.23659 L36.33539 217.47697 L34.61442 218.75869 L32.92604 220.08102 L31.27099 221.44323 L29.64999 222.84459 L28.06377 224.28437 L26.51306 225.76185 L24.99859 227.2763 L23.52109 228.82698 L22.08128 230.41317 L20.6799 232.03414 L19.31767 233.68917 L17.99533 235.37751 L16.71359 237.09845 L15.4732 238.85125 L14.27487 240.63519 L13.11934 242.44953 L12.00733 244.29356 L10.93958 246.16653 L9.91681 248.06772 L8.93976 249.99641 L8.00914 251.95185 L7.12569 253.93333 L6.29014 255.94012 L5.50321 257.97149 L4.76564 260.0267 L4.07815 262.10503 L3.44147 264.20575 L2.85634 266.32813 L2.32347 268.47145 L1.8436 270.63496 L1.41746 272.81796 L1.04577 275.0197 L0.72926 277.23946 L0.46867 279.4765 L0.26472 281.73011 L0.11814 283.99955 L0.02966 286.28409 L0 288.583 L0.16431 290.41635 L0.63805 292.14186 L1.39241 293.73074 L2.3986 295.15419 L3.62781 296.3834 L5.05126 297.38959 L6.64014 298.14395 L8.36565 298.61769 L10.199 298.782 L76.847 298.782 L77.07922 300.63963 L77.33028 302.49142 L77.6001 304.33726 L77.88856 306.17706 L78.19557 308.01071 L78.52102 309.83811 L78.86483 311.65918 L79.22689 313.4738 L79.60709 315.28187 L80.00535 317.08331 L80.42156 318.87801 L80.85562 320.66587 L81.30743 322.44678 L81.7769 324.22066 L82.26392 325.98741 L82.76839 327.74691 L83.29022 329.49908 L83.8293 331.24381 L84.38553 332.98101 L84.95883 334.71058 L85.54907 336.43241 L86.15618 338.14641 L86.78004 339.85247 L87.42056 341.55051 L88.07764 343.24041 L88.75117 344.92209 L89.44107 346.59543 L90.14722 348.26035 L90.86954 349.91674 L91.60792 351.5645 L92.36225 353.20354 L93.13245 354.83375 L93.91841 356.45503 L94.72003 358.06729 L95.53722 359.67043 L96.36987 361.26434 L97.21788 362.84894 L98.08116 364.42411 L98.9596 365.98976 L99.85311 367.54579 L100.76159 369.0921 L101.68493 370.62859 L102.62303 372.15517 L103.57581 373.67173 L104.54315 375.17817 L105.52496 376.67439 L106.52114 378.1603 L107.53159 379.6358 L108.55621 381.10078 L109.5949 382.55515 L110.64756 383.99881 L111.7141 385.43165 L112.7944 386.85359 L113.88838 388.26451 L114.99593 389.66433 L116.11695 391.05294 L117.25134 392.43023 L118.39901 393.79613 L119.55986 395.15051 L120.73378 396.49329 L121.92068 397.82436 L123.12045 399.14363 L124.333 400.451 L123.81813 401.34152 L123.31407 402.23757 L122.82086 403.13906 L122.33851 404.04588 L121.86708 404.95791 L121.40657 405.87506 L120.95703 406.79721 L120.51849 407.72426 L120.09096 408.65609 L119.67449 409.59261 L119.26911 410.5337 L118.87483 411.47926 L118.4917 412.42919 L118.11975 413.38336 L117.75899 414.34169 L117.40947 415.30405 L117.07121 416.27034 L116.74424 417.24046 L116.4286 418.2143 L116.1243 419.19175 L115.83139 420.1727 L115.5499 421.15704 L115.27984 422.14468 L115.02126 423.1355 L114.77417 424.12939 L114.53862 425.12625 L114.31464 426.12597 L114.10224 427.12844 L113.90147 428.13356 L113.71234 429.14122 L113.5349 430.15131 L113.36917 431.16372 L113.21518 432.17835 L113.07296 433.19509 L112.94254 434.21383 L112.82396 435.23447 L112.71723 436.2569 L112.6224 437.28101 L112.53948 438.30669 L112.46852 439.33384 L112.40954 440.36234 L112.36257 441.3921 L112.32763 442.42301 L112.30477 443.45495 L112.29401 444.48783 L112.29538 445.52152 L112.30891 446.55594 L112.33463 447.59096 L112.37257 448.62648 L112.42275 449.6624 L112.48522 450.69861 L112.56 451.735 L112.65419 452.84939 L112.76251 453.96134 L112.8849 455.07072 L113.0213 456.17742 L113.17166 457.2813 L113.33592 458.38225 L113.51403 459.48013 L113.70592 460.57484 L113.91154 461.66624 L114.13083 462.75421 L114.36374 463.83863 L114.61021 464.91937 L114.87018 465.99631 L115.14359 467.06933 L115.4304 468.1383 L115.73053 469.2031 L116.04394 470.26362 L116.37056 471.31971 L116.71035 472.37127 L117.06324 473.41816 L117.42918 474.46026 L117.8081 475.49746 L118.19996 476.52962 L118.60469 477.55663 L119.02225 478.57836 L119.45256 479.59468 L119.89558 480.60548 L120.35125 481.61063 L120.81951 482.61 L121.3003 483.60348 L121.79357 484.59093 L122.29927 485.57225 L122.81732 486.5473 L123.34768 487.51595 L123.89029 488.4781 L124.4451 489.4336 L125.01204 490.38235 L125.59106 491.32421 L126.1821 492.25907 L126.7851 493.18679 L127.40002 494.10726 L128.02678 495.02036 L128.66534 495.92595 L129.31564 496.82392 L129.97762 497.71415 L130.65122 498.5965 L131.33638 499.47086 L132.03306 500.3371 L132.74119 501.1951 L133.46072 502.04474 L134.19158 502.88588 L134.93373 503.71842 L135.6871 504.54223 L136.45164 505.35717 L137.22729 506.16314 L138.014 506.96 L139.05864 507.87293 L140.18911 508.61974 L141.38825 509.2005 L142.63889 509.61526 L143.92386 509.86407 L145.226 509.947 L146.52821 509.86407 L147.81333 509.61526 L149.06412 509.2005 L150.26333 508.61974 L151.39371 507.87293 L152.438 506.96 L208.191 451.207 L209.12468 451.46111 L210.06034 451.71035 L210.99796 451.95472 L211.93752 452.19419 L212.87901 452.42875 L213.82241 452.65839 L214.76772 452.88309 L215.71491 453.10283 L216.66398 453.3176 L217.61491 453.52738 L218.56768 453.73216 L219.52228 453.93191 L220.4787 454.12663 L221.43692 454.31629 L222.39693 454.50089 L223.35872 454.68041 L224.32226 454.85482 L225.28755 455.02412 L226.25457 455.18828 L227.22331 455.3473 L228.19375 455.50115 L229.16588 455.64983 L230.13968 455.79331 L231.11515 455.93158 L232.09226 456.06462 L233.071 456.19241 L234.05137 456.31495 L235.03333 456.43221 L236.01689 456.54418 L237.00202 456.65085 L237.98871 456.75219 L238.97695 456.84819 L239.96672 456.93884 L240.95801 457.02412 L241.95081 457.10401 L242.9451 457.1785 L243.94086 457.24757 L244.93808 457.31121 L245.93676 457.36939 L246.93686 457.42211 L247.93839 457.46935 L248.94132 457.51109 L249.94564 457.54732 L250.95134 457.57802 L251.95841 457.60317 L252.96682 457.62276 L253.97656 457.63677 L254.98763 457.64519 L256 457.648 L257.02804 457.64512 L258.05473 457.63648 L259.08007 457.6221 L260.10404 457.60199 L261.12662 457.57617 L262.1478 457.54466 L263.16757 457.50747 L264.1859 457.46461 L265.20279 457.41611 L266.21822 457.36198 L267.23216 457.30222 L268.24462 457.23687 L269.25557 457.16593 L270.26499 457.08941 L271.27287 457.00734 L272.27921 456.91974 L273.28397 456.8266 L274.28715 456.72796 L275.28872 456.62382 L276.28869 456.51421 L277.28702 456.39913 L278.28371 456.27861 L279.27874 456.15265 L280.27209 456.02127 L281.26375 455.8845 L282.2537 455.74234 L283.24194 455.59481 L284.22843 455.44192 L285.21318 455.2837 L286.19615 455.12015 L287.17735 454.9513 L288.15674 454.77715 L289.13432 454.59772 L290.11008 454.41303 L291.08399 454.2231 L292.05604 454.02793 L293.02621 453.82755 L293.9945 453.62197 L294.96088 453.4112 L295.92534 453.19526 L296.88787 452.97417 L297.84845 452.74795 L298.80706 452.5166 L299.76369 452.28014 L300.71832 452.03859 L301.67094 451.79196 L302.62153 451.54027 L303.57008 451.28354 L304.51658 451.02178 L305.461 450.755 L361.666 506.96 L362.71064 507.87293 L363.84111 508.61974 L365.04025 509.2005 L366.29089 509.61526 L367.57586 509.86407 L368.878 509.947 L370.18021 509.86407 L371.46533 509.61526 L372.71612 509.2005 L373.91533 508.61974 L375.04571 507.87293 L376.09 506.96 L376.87676 506.16314 L377.65246 505.35717 L378.41704 504.54221 L379.17046 503.71839 L379.91264 502.88584 L380.64354 502.04467 L381.3631 501.19501 L382.07125 500.33698 L382.76796 499.47071 L383.45315 498.59632 L384.12677 497.71393 L384.78876 496.82367 L385.43907 495.92566 L386.07764 495.02002 L386.70441 494.10687 L387.31934 493.18635 L387.92235 492.25857 L388.51339 491.32366 L389.09241 490.38174 L389.65935 489.43293 L390.21415 488.47736 L390.75675 487.51515 L391.28711 486.54642 L391.80515 485.5713 L392.31084 484.58992 L392.8041 483.60238 L393.28488 482.60883 L393.75312 481.60938 L394.20878 480.60415 L394.65178 479.59327 L395.08208 478.57686 L395.49962 477.55504 L395.90434 476.52795 L396.29618 475.4957 L396.67509 474.45841 L397.04101 473.41621 L397.39388 472.36922 L397.73365 471.31757 L398.06025 470.26138 L398.37364 469.20077 L398.67376 468.13587 L398.96055 467.0668 L399.23395 465.99368 L399.4939 464.91663 L399.74035 463.83579 L399.97325 462.75127 L400.19253 461.66319 L400.39813 460.57169 L400.59001 459.47688 L400.76811 458.37889 L400.93236 457.27784 L401.08271 456.17385 L401.21911 455.06705 L401.3415 453.95755 L401.44981 452.8455 L401.544 451.731 L401.61814 450.70328 L401.68016 449.67576 L401.73006 448.64853 L401.7679 447.62171 L401.79368 446.59538 L401.80746 445.56967 L401.80925 444.54467 L401.7991 443.52048 L401.77701 442.49721 L401.74304 441.47497 L401.69721 440.45386 L401.63954 439.43397 L401.57007 438.41543 L401.48883 437.39832 L401.39585 436.38276 L401.29117 435.36884 L401.1748 434.35668 L401.04678 433.34637 L400.90714 432.33802 L400.75591 431.33174 L400.59313 430.32762 L400.41881 429.32577 L400.233 428.3263 L400.03572 427.32931 L399.827 426.3349 L399.60688 425.34318 L399.37537 424.35425 L399.13253 423.36821 L398.87836 422.38518 L398.61291 421.40525 L398.3362 420.42852 L398.04827 419.4551 L397.74914 418.4851 L397.43885 417.51862 L397.11742 416.55576 L396.78489 415.59663 L396.44128 414.64133 L396.08663 413.68996 L395.72097 412.74263 L395.34432 411.79944 L394.95672 410.8605 L394.5582 409.92591 L394.14879 408.99578 L393.72851 408.0702 L393.2974 407.14929 L392.85549 406.23314 L392.40281 405.32186 L391.93939 404.41555 L391.46526 403.51433 L390.98045 402.61828 L390.48498 401.72752 L389.9789 400.84215 L389.46223 399.96228 L388.935 399.088 L390.11447 397.79016 L391.28147 396.48091 L392.43592 395.16034 L393.57772 393.82853 L394.70677 392.4856 L395.82299 391.13162 L396.92627 389.7667 L398.01652 388.39093 L399.09365 387.00441 L400.15756 385.60722 L401.20816 384.19947 L402.24535 382.78125 L403.26904 381.35265 L404.27914 379.91377 L405.27555 378.4647 L406.25817 377.00553 L407.22692 375.53637 L408.18169 374.05731 L409.12239 372.56843 L410.04894 371.06984 L410.96122 369.56163 L411.85916 368.04389 L412.74265 366.51673 L413.6116 364.98022 L414.46592 363.43447 L415.30551 361.87958 L416.13027 360.31563 L416.94012 358.74273 L417.73496 357.16096 L418.51469 355.57042 L419.27922 353.97121 L420.02845 352.36341 L420.76229 350.74713 L421.48065 349.12246 L422.18344 347.4895 L422.87055 345.84833 L423.54189 344.19905 L424.19737 342.54176 L424.83689 340.87655 L425.46036 339.20352 L426.06769 337.52276 L426.65878 335.83437 L427.23353 334.13844 L427.79186 332.43506 L428.33366 330.72433 L428.85884 329.00634 L429.36732 327.28119 L429.85898 325.54898 L430.33375 323.80979 L430.79152 322.06372 L431.2322 320.31087 L431.6557 318.55134 L432.06192 316.7852 L432.45076 315.01257 L432.82214 313.23353 L433.17595 311.44819 L433.51211 309.65662 L433.83052 307.85894 L434.13109 306.05523 L434.41371 304.24558 L434.6783 302.4301 L434.92476 300.60887 L435.153 298.782 L501.802 298.782 L503.63535 298.61769 L505.36086 298.14395 L506.94974 297.38959 L508.37319 296.3834 L509.6024 295.15419 L510.60859 293.73074 L511.36295 292.14186 L511.83669 290.41635 L512.001 288.583 L511.9713 286.28409 L511.88277 283.99955 L511.73614 281.73011 L511.53215 279.4765 L511.27152 277.23946 L510.95497 275.0197 L510.58325 272.81796 L510.15707 270.63496 L509.67717 268.47144 L509.14427 266.32813 L508.5591 264.20574 L507.92239 262.10502 L507.23488 260.02669 L506.49728 257.97147 L505.71033 255.94011 L504.87476 253.93332 L503.99129 251.95183 L503.06066 249.99638 L502.08358 248.06769 L501.0608 246.1665 L499.99304 244.29352 L498.88102 242.44949 L497.72548 240.63514 L496.52715 238.85119 L495.28675 237.09839 L494.00502 235.37744 L492.68267 233.68909 L491.32045 232.03406 L489.91907 230.41308 L488.47927 228.82687 L487.00178 227.27618 L485.48732 225.76172 L483.93663 224.28423 L482.35042 222.84443 L480.72944 221.44305 L479.07441 220.08083 L477.38606 218.75849 L475.66511 217.47675 L473.9123 216.23636 L472.12835 215.03803 L470.314 213.88249 L468.46996 212.77048 L466.59698 211.70272 L464.69578 210.67995 L462.76708 209.70288 L460.81162 208.77226 L458.83012 207.8888 L456.82332 207.05324 L454.79194 206.2663 L452.73671 205.52872 L450.65836 204.84122 L448.55762 204.20454 L446.43521 203.61939 L444.29187 203.08652 L442.12833 202.60664 L439.94531 202.18049 L437.74354 201.80879 L435.52375 201.49228 L433.28666 201.23168 L431.03302 201.02773 L428.76354 200.88114 L426.47896 200.79266 L424.18 200.763" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#b3d993"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M10.199,288.583c0-42.869,34.752-77.621,77.621-77.621s77.621,34.752,77.621,77.621H10.199z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#b3d993"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M346.558,288.583c0-42.869,34.752-77.621,77.621-77.621s77.622,34.753,77.622,77.621H346.558z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#b3d993"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M259.105,389.975c30.313-30.313,79.46-30.313,109.773,0c30.313,30.313,30.313,79.46,0,109.773 L259.105,389.975z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#b3d993"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M254.999,389.975c-30.313-30.313-79.46-30.313-109.773,0c-30.313,30.313-30.313,79.46,0,109.773 L254.999,389.975z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#b3d993"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M307.748,174.739H204.252V64c0-28.579,23.169-51.748,51.748-51.748l0,0 c28.579,0,51.748,23.169,51.748,51.748V174.739z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#62b98e"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M 85.755 277.204 A 170.245 170.245 0 1 0 426.245 277.204 A 170.245 170.245 0 1 0 85.755 277.204 Z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#358c73"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M 174.245,229.998 256,182.797 337.755,229.998 337.755,324.4 256,371.602 174.245,324.4 Z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M424.18,200.763c-1.558,0-3.124,0.043-4.685,0.125c-20.129-42.954-56.688-76.736-101.546-93.182V64 c0-34.157-27.79-61.947-61.947-61.947S194.054,29.843,194.054,64v43.707c-44.86,16.447-81.419,50.231-101.548,93.186 c-1.56-0.083-3.125-0.129-4.684-0.129C39.396,200.763,0,240.16,0,288.583c0,5.633,4.566,10.199,10.199,10.199h66.648 c4.678,39.071,21.889,74.34,47.486,101.669c-9.018,15.387-13.176,33.319-11.773,51.284c1.626,20.824,10.666,40.436,25.454,55.225 c1.992,1.992,4.602,2.987,7.212,2.987s5.221-0.995,7.212-2.987l55.753-55.753c15.234,4.19,31.263,6.441,47.809,6.441 c17.145,0,33.738-2.405,49.461-6.893l56.205,56.205c1.992,1.992,4.602,2.987,7.212,2.987s5.221-0.995,7.212-2.987 c14.789-14.789,23.828-34.403,25.454-55.229c1.444-18.5-3.024-36.957-12.609-52.643c24.899-27.134,41.617-61.883,46.218-100.306 h66.649c5.633,0,10.199-4.566,10.199-10.199C512,240.16,472.604,200.763,424.18,200.763z M214.452,64 c0-22.909,18.638-41.548,41.548-41.548c22.91,0,41.548,18.638,41.548,41.548v37.587c-13.345-3.157-27.253-4.835-41.548-4.835 c-14.295,0-28.204,1.679-41.548,4.835V64z M21.168,278.384c4.765-31.266,31.086-55.537,63.273-57.134 c-5.762,17.623-8.891,36.426-8.891,55.949c0,0.397,0.012,0.789,0.015,1.185L21.168,278.384L21.168,278.384z M121.618,190.36 l22.637,22.637c1.992,1.992,4.602,2.987,7.212,2.987c2.61,0,5.221-0.995,7.212-2.987c3.983-3.983,3.983-10.441,0-14.425 l-24.756-24.756c29.381-34.641,73.201-56.669,122.075-56.669s92.694,22.028,122.075,56.669l-42.909,42.909l-68.966-39.817v-11.484 c0-5.633-4.566-10.199-10.199-10.199s-10.199,4.566-10.199,10.199v11.484l-76.655,44.257c-3.156,1.822-5.1,5.188-5.1,8.833v88.508 l-43.635,43.635c-15.487-24.634-24.462-53.757-24.462-84.942C95.95,245.211,105.388,215.39,121.618,190.36z M267.234,436.849 v-59.957l69.244-39.979l42.545,42.545C351.888,412.049,312.077,433.724,267.234,436.849z M132.503,378.897l42.362-42.362 l71.97,41.552v58.893C200.889,434.374,160.062,412.305,132.503,378.897z M256,194.574l71.556,41.313v82.625L256,359.825 l-71.556-41.313v-82.625L256,194.574z M145.763,484.786c-15.009-20.324-17.359-47.248-6.136-69.797 c14.036,11.873,29.899,21.646,47.107,28.826L145.763,484.786z M368.341,484.788l-41.594-41.594 c17.233-7.373,33.095-17.35,47.087-29.439C385.773,436.55,383.627,464.09,368.341,484.788z M391.19,362.777l-43.236-43.236v-86.753 l42.428-42.428c16.23,25.029,25.668,54.851,25.668,86.839C416.05,308.652,406.925,338.011,391.19,362.777z M436.434,278.384 c0.003-0.396,0.015-0.789,0.015-1.185c0-19.522-3.129-38.326-8.891-55.949c32.187,1.597,58.508,25.869,63.273,57.134H436.434z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M256,147.68c5.633,0,10.199-4.566,10.199-10.199v-2.07c0-5.633-4.566-10.199-10.199-10.199s-10.199,4.566-10.199,10.199 v2.07C245.801,143.114,250.367,147.68,256,147.68z" }
        }
        }
    }

    // https://www.svgrepo.com/svg/289006/starfish | CC0, as listed by SVG Repo.
    // Changes: coordinated fill colours; cream vector backing; layout transforms.
    component StarfishArt: Item {
        id: art
        implicitWidth: 544.25298
        implicitHeight: 522.99782
        Shape {
            width: 544.25298
            height: 522.99782
            antialiasing: true
            transform: [
                Translate { x: 16.12722; y: 5.49991 },
                Scale { xScale: art.width / art.implicitWidth; yScale: art.height / art.implicitHeight }
            ]
        ShapePath {
            strokeWidth: 23.03987
            strokeColor: "#fff6e7"
            fillColor: "#fff6e7"
            fillRule: ShapePath.WindingFill
            joinStyle: ShapePath.RoundJoin
            capStyle: ShapePath.RoundCap
            PathSvg { path: "M120.11981 187.73604 L130.00561 188.80166 L130.29223 187.23369 L130.794 185.75822 L131.49157 184.39343 L132.36622 183.1542 L133.39922 182.05537 L134.57185 181.11181 L135.86538 180.33837 L137.26108 179.74991 L138.74024 179.36129 L140.28412 179.18737 L141.874 179.243 L145.499 179.633 L147.06997 179.91963 L148.54501 180.41981 L149.90932 181.11519 L151.1481 181.9874 L152.24654 183.01809 L153.18983 184.18889 L153.96317 185.48145 L154.55177 186.8774 L154.9408 188.35838 L155.11548 189.90604 L155.061 191.502 L155.06092 191.50243 L160.71716 192.11213 L161.00401 190.5418 L161.50519 189.06662 L162.20195 187.70224 L163.07569 186.46346 L164.10784 185.36506 L165.27979 184.42183 L166.57296 183.64857 L167.96876 183.06007 L169.44859 182.67111 L170.99387 182.49649 L172.586 182.551 L174.0525 182.64653 L175.49831 182.62048 L176.91788 182.47688 L178.30568 182.21976 L179.65614 181.85315 L180.96374 181.38107 L182.22292 180.80757 L183.42815 180.13666 L184.57388 179.37237 L185.65455 178.51875 L186.66464 177.57981 L187.59859 176.55959 L188.45087 175.46212 L189.21592 174.29142 L189.8882 173.05153 L190.46217 171.74648 L190.93229 170.38029 L191.293 168.957 L218.047 41.446 L218.37595 40.00344 L218.75134 38.58671 L219.17232 37.19649 L219.63804 35.83349 L220.14764 34.49838 L220.70026 33.19187 L221.29506 31.91464 L221.93119 30.6674 L222.60778 29.45083 L223.32399 28.26563 L224.07896 27.11248 L224.87184 25.99209 L225.70179 24.90515 L226.56793 23.85234 L227.46943 22.83436 L228.40543 21.85191 L229.37507 20.90567 L230.3775 19.99635 L231.41188 19.12462 L232.47734 18.2912 L233.57303 17.49676 L234.6981 16.742 L235.85171 16.02762 L237.03298 15.3543 L238.24108 14.72275 L239.47515 14.13365 L240.73433 13.58769 L242.01777 13.08557 L243.32463 12.62799 L244.65404 12.21563 L246.00515 11.84919 L247.37712 11.52936 L248.76908 11.25683 L250.18019 11.0323 L251.60959 10.85646 L253.05642 10.73 L254.51985 10.65362 L255.999 10.628 L257.47815 10.65362 L258.94158 10.73001 L260.38841 10.85647 L261.81781 11.03233 L263.22892 11.25687 L264.62088 11.52942 L265.99285 11.84927 L267.34396 12.21573 L268.67337 12.62812 L269.98023 13.08573 L271.26367 13.58787 L272.52285 14.13385 L273.75692 14.72298 L274.96502 15.35456 L276.14629 16.0279 L277.2999 16.74231 L278.42497 17.49709 L279.52066 18.29155 L280.58612 19.125 L281.6205 19.99674 L282.62293 20.90608 L283.59257 21.85233 L284.52857 22.8348 L285.43007 23.85278 L286.29621 24.90559 L287.12616 25.99254 L287.91904 27.11292 L288.67401 28.26606 L289.39022 29.45125 L290.06681 30.66779 L290.70294 31.91501 L291.29774 33.1922 L291.85036 34.49868 L292.35996 35.83374 L292.82568 37.19669 L293.24666 38.58685 L293.62205 40.00352 L293.951 41.446 L320.705 168.954 L321.06541 170.37762 L321.53527 171.74411 L322.10904 173.04945 L322.78116 174.28962 L323.5461 175.46058 L324.3983 176.5583 L325.33221 177.57875 L326.34229 178.51791 L327.423 179.37175 L328.56878 180.13624 L329.77409 180.80734 L331.03337 181.38104 L332.34109 181.85329 L333.69169 182.22009 L335.07963 182.47738 L336.49936 182.62115 L337.94533 182.64737 L339.412 182.552 L468.947 168.589 L470.3121 168.46398 L471.66858 168.38377 L473.01568 168.3479 L474.35269 168.3559 L475.67885 168.40729 L476.99343 168.50159 L478.2957 168.63833 L479.58492 168.81705 L480.86035 169.03725 L482.12126 169.29848 L483.36689 169.60025 L484.59653 169.9421 L485.80943 170.32354 L487.00486 170.7441 L488.18207 171.20331 L489.34033 171.7007 L490.47891 172.23578 L491.59706 172.80809 L492.69405 173.41716 L493.76915 174.0625 L494.8216 174.74364 L495.85069 175.46012 L496.85566 176.21145 L497.83579 176.99716 L498.79033 177.81677 L499.71855 178.66982 L500.61972 179.55583 L501.49308 180.47432 L502.33792 181.42482 L503.15348 182.40686 L503.93904 183.41996 L504.69385 184.46364 L505.41718 185.53744 L506.10829 186.64088 L506.76644 187.77348 L507.3909 188.93477 L507.98093 190.12428 L508.53579 191.34154 L509.05475 192.58605 L509.53706 193.85737 L509.982 195.155 L510.34353 196.32381 L510.66873 197.49324 L510.95784 198.66271 L511.21106 199.83164 L511.42864 200.99946 L511.61079 202.16558 L511.75772 203.32943 L511.86968 204.49043 L511.94687 205.648 L511.98952 206.80156 L511.99785 207.95053 L511.97209 209.09433 L511.91246 210.23239 L511.81918 211.36412 L511.69248 212.48895 L511.53257 213.6063 L511.33968 214.71559 L511.11404 215.81623 L510.85586 216.90766 L510.56537 217.9893 L510.24279 219.06055 L509.88834 220.12086 L509.50225 221.16963 L509.08474 222.20628 L508.63603 223.23025 L508.15635 224.24095 L507.64591 225.23779 L507.10495 226.22022 L506.53368 227.18763 L505.93232 228.13946 L505.30111 229.07513 L504.64025 229.99406 L503.94998 230.89566 L503.23052 231.77937 L502.48208 232.6446 L501.7049 233.49077 L500.8992 234.3173 L500.06519 235.12362 L499.2031 235.90915 L498.31316 236.6733 L497.39558 237.4155 L496.4506 238.13518 L495.47842 238.83174 L494.47928 239.50462 L493.4534 240.15323 L492.401 240.777 L379.399 305.621 L378.37658 306.25434 L377.41284 306.94653 L376.50894 307.69396 L375.66604 308.49305 L374.8853 309.34021 L374.1679 310.23184 L373.51499 311.16436 L372.92775 312.13418 L372.40733 313.1377 L371.9549 314.17134 L371.57162 315.2315 L371.25867 316.3146 L371.0172 317.41703 L370.84839 318.53523 L370.75338 319.66558 L370.73336 320.80451 L370.78948 321.94841 L370.92291 323.09371 L371.13481 324.23681 L371.42635 325.37412 L371.79869 326.50204 L372.253 327.617 L425.561 446.493 L426.0259 447.56963 L426.4577 448.65041 L426.85653 449.73481 L427.22254 450.82232 L427.55587 451.91239 L427.85665 453.00451 L428.12503 454.09815 L428.36115 455.19277 L428.56515 456.28786 L428.73716 457.38289 L428.87734 458.47732 L428.98581 459.57064 L429.06273 460.66231 L429.10822 461.75181 L429.12244 462.83861 L429.10552 463.92219 L429.0576 465.00201 L428.97882 466.07754 L428.86932 467.14828 L428.72925 468.21367 L428.55874 469.27321 L428.35794 470.32636 L428.12698 471.37259 L427.866 472.41138 L427.57515 473.44219 L427.25456 474.46451 L426.90438 475.47781 L426.52475 476.48155 L426.1158 477.47522 L425.67768 478.45828 L425.21053 479.43021 L424.71448 480.39048 L424.18968 481.33856 L423.63628 482.27393 L423.0544 483.19606 L422.44419 484.10442 L421.80579 484.99849 L421.13934 485.87773 L420.44498 486.74163 L419.72285 487.58964 L418.9731 488.42126 L418.19585 489.23594 L417.39126 490.03317 L416.55946 490.81241 L415.70059 491.57315 L414.8148 492.31484 L413.90222 493.03697 L412.963 493.739 L412.04361 494.38854 L411.1142 495.009 L410.17526 495.60042 L409.22725 496.16282 L408.27068 496.69622 L407.30601 497.20066 L406.33372 497.67616 L405.35431 498.12274 L404.36825 498.54043 L403.37602 498.92926 L402.3781 499.28926 L401.37497 499.62044 L400.36712 499.92284 L399.35503 500.19648 L398.33918 500.44138 L397.32004 500.65758 L396.29811 500.8451 L395.27386 501.00396 L394.24777 501.1342 L393.22033 501.23583 L392.19201 501.30889 L391.1633 501.3534 L390.13468 501.36938 L389.10663 501.35686 L388.07962 501.31588 L387.05416 501.24644 L386.0307 501.14859 L385.00974 501.02234 L383.99176 500.86773 L382.97723 500.68477 L381.96664 500.4735 L380.96048 500.23393 L379.95921 499.96611 L378.96333 499.67004 L377.97331 499.34577 L376.98964 498.99331 L376.01279 498.61269 L375.04325 498.20394 L374.0815 497.76708 L373.12802 497.30214 L372.1833 496.80914 L371.2478 496.28812 L370.32202 495.73909 L369.40644 495.16208 L368.50153 494.55713 L367.60778 493.92425 L366.72568 493.26347 L365.85569 492.57482 L364.9983 491.85832 L364.154 491.114 L267.557 403.672 L266.679 402.92779 L265.76635 402.25125 L264.82233 401.64237 L263.85026 401.10115 L262.85344 400.62759 L261.83516 400.2217 L260.79874 399.88346 L259.74746 399.61288 L258.68464 399.40995 L257.61358 399.27468 L256.53757 399.20707 L255.45993 399.2071 L254.38395 399.27478 L253.31293 399.41011 L252.25018 399.61309 L251.19899 399.88371 L250.16268 400.22197 L249.14454 400.62788 L248.14787 401.10143 L247.17599 401.64262 L246.23218 402.25144 L245.31975 402.9279 L244.442 403.672 L147.843 491.115 L146.96811 491.88562 L146.07918 492.62638 L145.17675 493.33724 L144.26136 494.01819 L143.33353 494.66919 L142.39381 495.29021 L141.44273 495.88122 L140.48083 496.4422 L139.50864 496.97311 L138.52671 497.47392 L137.53555 497.94461 L136.53572 498.38515 L135.52775 498.7955 L134.51217 499.17564 L133.48952 499.52553 L132.46034 499.84516 L131.42515 500.13448 L130.38451 500.39348 L129.33894 500.62211 L128.28897 500.82035 L127.23515 500.98818 L126.17802 501.12556 L125.1181 501.23246 L124.05593 501.30885 L122.99205 501.35471 L121.927 501.37 L120.84868 501.35434 L119.77027 501.30733 L118.69232 501.22895 L117.61538 501.11918 L116.54002 500.97796 L115.46677 500.80529 L114.3962 500.60113 L113.32886 500.36545 L112.26531 500.09822 L111.20608 499.79941 L110.15175 499.469 L109.10286 499.10695 L108.05996 498.71323 L107.02362 498.28782 L105.99437 497.83069 L104.97278 497.3418 L103.9594 496.82113 L102.95478 496.26864 L101.95948 495.68432 L100.97405 495.06812 L99.99904 494.42003 L99.035 493.74 L98.09578 493.03797 L97.1832 492.31585 L96.29741 491.57417 L95.43854 490.81345 L94.60674 490.03423 L93.80215 489.23703 L93.0249 488.42238 L92.27515 487.5908 L91.55302 486.74282 L90.85866 485.87896 L90.19221 484.99977 L89.55381 484.10575 L88.9436 483.19744 L88.36172 482.27537 L87.80832 481.34006 L87.28352 480.39204 L86.78747 479.43183 L86.32032 478.45997 L85.8822 477.47698 L85.47325 476.48338 L85.09362 475.47971 L84.74344 474.46648 L84.42285 473.44424 L84.132 472.4135 L83.87102 471.37479 L83.64006 470.32864 L83.43926 469.27557 L83.26875 468.21612 L83.12868 467.15081 L83.01918 466.08016 L82.9404 465.0047 L82.89248 463.92496 L82.87556 462.84147 L82.88978 461.75476 L82.93527 460.66534 L83.01219 459.57375 L83.12066 458.48051 L83.26084 457.38616 L83.43285 456.29121 L83.63685 455.1962 L83.87297 454.10165 L84.14135 453.00809 L84.44213 451.91605 L84.77546 450.82605 L85.14147 449.73861 L85.5403 448.65428 L85.9721 447.57356 L86.437 446.497 L139.747 327.613 L140.20092 326.49909 L140.57291 325.37211 L140.86413 324.23566 L141.07575 323.09333 L141.20894 321.94872 L141.26486 320.80543 L141.24466 319.66705 L141.14953 318.53717 L140.98062 317.41938 L140.7391 316.3173 L140.42613 315.2345 L140.04287 314.17459 L139.5905 313.14115 L139.07017 312.13779 L138.48306 311.1681 L137.83032 310.23568 L137.11312 309.34411 L136.33263 308.497 L135.49 307.69794 L134.58641 306.95052 L133.62302 306.25834 L132.601 305.625 L19.597 240.78 L18.54466 240.15598 L17.51884 239.50713 L16.51976 238.83402 L15.54764 238.13724 L14.60271 237.41737 L13.68518 236.67497 L12.79528 235.91064 L11.93324 235.12495 L11.09928 234.31847 L10.29361 233.49179 L9.51646 232.64549 L8.76806 231.78013 L8.04863 230.89631 L7.35839 229.9946 L6.69755 229.07557 L6.06636 228.13981 L5.46502 227.18789 L4.89377 226.2204 L4.35281 225.2379 L3.84239 224.24099 L3.36271 223.23023 L2.91401 222.20621 L2.4965 221.1695 L2.11041 220.12068 L1.75596 219.06034 L1.43337 217.98904 L1.14287 216.90737 L0.88468 215.81591 L0.65902 214.71523 L0.46611 213.60591 L0.30618 212.48853 L0.17945 211.36367 L0.08615 210.23191 L0.02649 209.09383 L0.0007 207.95 L0.00899 206.801 L0.05161 205.64741 L0.12876 204.48981 L0.24066 203.32877 L0.38755 202.16489 L0.56965 200.99872 L0.78717 199.83086 L1.04035 198.66188 L1.32939 197.49236 L1.65454 196.32287 L2.016 195.154 L2.46084 193.85636 L2.94303 192.58502 L3.46183 191.34046 L4.0165 190.12316 L4.60631 188.93358 L5.23053 187.77221 L5.88843 186.63952 L6.57926 185.53598 L7.30231 184.46208 L8.05682 183.41828 L8.84207 182.40507 L9.65733 181.42291 L10.50186 180.47229 L11.37492 179.55368 L12.27579 178.66755 L13.20373 177.81438 L14.158 176.99465 L15.13788 176.20882 L16.14262 175.45739 L17.17149 174.74082 L18.22377 174.05958 L19.29871 173.41416 L20.39558 172.80502 L21.51365 172.23265 L22.65218 171.69752 L23.81045 171.2001 L24.98771 170.74088 L26.18323 170.32032 L27.39628 169.9389 L28.62613 169.5971 L29.87204 169.29539 L31.13327 169.03425 L32.4091 168.81415 L33.69878 168.63557 L35.0016 168.49899 L36.3168 168.40488 L37.64366 168.35371 L38.98144 168.34596 L40.32942 168.38211 L41.68685 168.46263 L43.053 168.588 L110.559 175.865 L112.12995 176.15187 L113.60493 176.65226 L114.96914 177.3478 L116.2078 178.22014 L117.3061 179.25093 L118.24926 180.4218 L119.02247 181.7144 L119.61095 183.11038 L119.99989 184.59138 L120.17451 186.13903 L120.12 187.735 L120.11981 187.73604" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#f6a17f"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M470.103,179.304c30.139-3.255,43.233,37.038,16.935,52.129l-113.002,64.844 c-12.487,7.16-17.499,22.609-11.619,35.747l53.312,118.882c12.4,27.664-21.871,52.563-44.34,32.221l-96.599-87.443 c-10.664-9.655-26.916-9.655-37.58,0l-96.599,87.443c-22.469,20.342-56.74-4.557-44.34-32.221l53.312-118.882 c5.88-13.138,0.868-28.587-11.619-35.747L24.96,231.433c-26.298-15.09-13.203-55.384,16.935-52.129l129.536,13.963 c14.31,1.54,27.458-8.017,30.409-22.099L228.594,43.66c6.227-29.672,48.582-29.672,54.809,0l26.754,127.507 c2.951,14.082,16.1,23.64,30.409,22.099L470.103,179.304z M292.701,277.248c0-20.266-16.426-36.702-36.702-36.702 s-36.702,16.436-36.702,36.702c0,20.276,16.426,36.713,36.702,36.713S292.701,297.525,292.701,277.248z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#e97778"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M255.999,240.546c20.276,0,36.702,16.436,36.702,36.702c0,20.276-16.426,36.713-36.702,36.713 s-36.702-16.436-36.702-36.713C219.297,256.983,235.722,240.546,255.999,240.546z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M143.192,201.062c0.391,0.043,0.781,0.064,1.167,0.064c5.434,0,10.107-4.099,10.702-9.624 c0.638-5.918-3.644-11.232-9.562-11.869l-3.625-0.39c-5.891-0.643-11.232,3.643-11.869,9.562 c-0.638,5.918,3.644,11.232,9.562,11.869L143.192,201.062z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M509.982,195.155c-5.822-17.912-22.323-28.583-41.035-26.566l-129.535,13.963c-8.851,0.945-16.884-4.893-18.707-13.598 L293.951,41.446c-3.869-18.432-19.12-30.818-37.952-30.818s-34.083,12.385-37.952,30.818l-26.754,127.511 c-1.825,8.703-9.857,14.54-18.707,13.594c-5.901-0.638-11.232,3.643-11.869,9.562c-0.638,5.918,3.644,11.232,9.562,11.869 c19.885,2.148,38.006-11.013,42.11-30.601l26.754-127.506c2.119-10.094,10.096-13.69,16.857-13.69s14.738,3.596,16.857,13.69 l26.754,127.504c4.106,19.59,22.222,32.747,42.111,30.603l129.538-13.963c10.266-1.11,16.136,5.37,18.224,11.799 c2.09,6.432,1.137,15.134-7.81,20.268l-112.999,64.843c-17.353,9.95-24.272,31.23-16.093,49.507l53.311,118.881 c4.218,9.412-0.125,17.013-5.597,20.988c-5.468,3.971-14.033,5.754-21.675-1.165l-96.597-87.442 c-14.835-13.432-37.211-13.432-52.048,0l-96.599,87.443c-7.641,6.917-16.206,5.136-21.674,1.164 c-5.472-3.975-9.815-11.576-5.597-20.987l53.314-118.889c8.177-18.27,1.257-39.549-16.093-49.498L30.325,222.086 c-8.947-5.134-9.901-13.836-7.81-20.268c2.09-6.429,7.966-12.904,18.227-11.799l67.508,7.277c5.914,0.636,11.232-3.643,11.87-9.561 c0.638-5.918-3.643-11.232-9.561-11.87l-67.506-7.277c-18.727-2.022-35.216,8.654-41.037,26.566 c-5.822,17.915,1.243,36.251,17.581,45.626l113.004,64.845c7.707,4.42,10.778,13.876,7.146,21.988L86.437,446.497 c-7.704,17.189-2.642,36.174,12.598,47.243c7.028,5.104,14.986,7.63,22.892,7.63c9.234,0,18.396-3.447,25.916-10.255l96.599-87.443 c6.588-5.964,16.525-5.965,23.115,0l96.597,87.442c13.96,12.637,33.572,13.693,48.809,2.625 c15.24-11.069,20.302-30.056,12.598-47.246l-53.308-118.876c-3.635-8.12-0.564-17.576,7.146-21.996l113.002-64.844 C508.74,231.406,515.805,213.069,509.982,195.155z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M208.519,277.248c0,26.186,21.299,47.49,47.479,47.49s47.479-21.305,47.479-47.49c0-26.18-21.299-47.479-47.479-47.479 S208.519,251.068,208.519,277.248z M255.999,251.323c14.295,0,25.925,11.63,25.925,25.925c0,14.301-11.63,25.936-25.925,25.936 s-25.925-11.634-25.925-25.936C230.074,262.953,241.704,251.323,255.999,251.323z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M245.222,204.67c0,5.952,4.826,10.777,10.777,10.777c5.951,0,10.777-4.825,10.777-10.777v-5.403 c0-5.952-4.826-10.777-10.777-10.777c-5.951,0-10.777,4.825-10.777,10.777V204.67z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M245.222,165.244c0,5.952,4.826,10.777,10.777,10.777c5.951,0,10.777-4.825,10.777-10.777v-5.403 c0-5.952-4.826-10.777-10.777-10.777c-5.951,0-10.777,4.825-10.777,10.777V165.244z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M245.222,125.809c0,5.952,4.826,10.777,10.777,10.777c5.951,0,10.777-4.825,10.777-10.777v-5.403 c0-5.952-4.826-10.777-10.777-10.777c-5.951,0-10.777,4.825-10.777,10.777V125.809z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M255.999,97.16c5.951,0,10.777-4.825,10.777-10.777V80.98c0-5.952-4.826-10.777-10.777-10.777 c-5.951,0-10.777,4.825-10.777,10.777v5.403C245.222,92.335,250.048,97.16,255.999,97.16z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M190.308,244.574l-5.142-1.67c-5.659-1.84-11.742,1.258-13.58,6.92c-1.839,5.66,1.259,11.741,6.92,13.58l5.142,1.671 c1.106,0.359,2.228,0.53,3.332,0.53c4.543,0,8.768-2.896,10.248-7.45C199.067,252.493,195.969,246.412,190.308,244.574z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M141.001,251.219l5.142,1.67c1.106,0.359,2.228,0.53,3.332,0.53c4.543,0,8.768-2.896,10.248-7.45 c1.839-5.66-1.259-11.741-6.92-13.58l-5.142-1.67c-5.658-1.838-11.742,1.258-13.58,6.92 C132.242,243.3,135.339,249.38,141.001,251.219z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M115.305,220.209l-5.131-1.672c-5.665-1.844-11.743,1.251-13.585,6.911c-1.842,5.66,1.251,11.742,6.91,13.585l5.131,1.67 c1.109,0.361,2.233,0.532,3.34,0.532c4.54,0,8.764-2.893,10.246-7.444C124.059,228.134,120.965,222.052,115.305,220.209z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M72.642,206.346c-5.663-1.83-11.738,1.283-13.566,6.946c-1.828,5.665,1.281,11.739,6.946,13.566l5.142,1.66 c1.1,0.356,2.216,0.524,3.312,0.524c4.551,0,8.78-2.907,10.255-7.47c1.828-5.665-1.281-11.739-6.946-13.566L72.642,206.346z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M204.625,329.625l-3.178,4.372c-3.5,4.814-2.436,11.554,2.38,15.055c1.913,1.391,4.131,2.061,6.328,2.061 c3.331,0,6.617-1.54,8.725-4.44l3.178-4.372c3.5-4.814,2.436-11.554-2.38-15.055S208.122,324.811,204.625,329.625z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M196.479,359.142c-4.819-3.491-11.558-2.416-15.051,2.405l-3.166,4.372c-3.492,4.821-2.414,11.559,2.405,15.051 c1.91,1.384,4.121,2.05,6.313,2.05c3.338,0,6.628-1.545,8.736-4.455l3.166-4.372C202.376,369.372,201.299,362.633,196.479,359.142z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M158.268,393.427l-3.179,4.372c-3.5,4.814-2.437,11.554,2.377,15.055c1.914,1.392,4.132,2.062,6.331,2.062 c3.33,0,6.616-1.539,8.725-4.439l3.179-4.372c3.5-4.814,2.437-11.554-2.377-15.055C168.509,387.55,161.771,388.612,158.268,393.427z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M150.159,422.963c-4.808-3.505-11.55-2.451-15.058,2.36l-3.179,4.362c-3.506,4.809-2.449,11.551,2.36,15.057 c1.915,1.397,4.137,2.069,6.34,2.069c3.326,0,6.608-1.535,8.718-4.429l3.179-4.362C156.025,433.211,154.969,426.47,150.159,422.963z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M307.373,329.625c-3.498-4.815-10.242-5.879-15.054-2.38c-4.815,3.5-5.88,10.24-2.38,15.055l3.178,4.372 c2.108,2.901,5.394,4.44,8.725,4.44c2.198,0,4.417-0.67,6.328-2.061c4.815-3.5,5.88-10.24,2.38-15.055L307.373,329.625z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M313.113,374.191l3.166,4.372c2.108,2.91,5.399,4.455,8.736,4.455c2.192,0,4.404-0.666,6.313-2.05 c4.821-3.492,5.898-10.23,2.405-15.051l-3.166-4.372c-3.493-4.822-10.231-5.895-15.051-2.405 C310.699,362.633,309.621,369.372,313.113,374.191z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M353.731,393.427c-3.5-4.814-10.243-5.878-15.056-2.377c-4.814,3.5-5.878,10.241-2.377,15.055l3.179,4.372 c2.109,2.9,5.394,4.439,8.725,4.439c2.199,0,4.418-0.67,6.331-2.062c4.814-3.5,5.878-10.241,2.377-15.055L353.731,393.427z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M362.658,442.382c2.11,2.895,5.391,4.429,8.718,4.429c2.202,0,4.424-0.672,6.34-2.069c4.81-3.506,5.866-10.248,2.36-15.057 l-3.179-4.362c-3.507-4.81-10.248-5.867-15.058-2.36c-4.81,3.506-5.866,10.248-2.36,15.057L362.658,442.382z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M326.833,242.903l-5.142,1.67c-5.661,1.84-8.759,7.919-6.92,13.58c1.48,4.555,5.704,7.45,10.248,7.45 c1.103,0,2.226-0.171,3.332-0.53l5.142-1.671c5.661-1.84,8.759-7.919,6.92-13.58C338.574,244.163,332.495,241.061,326.833,242.903z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M362.523,253.421c1.103,0,2.226-0.171,3.332-0.53l5.142-1.67c5.661-1.84,8.759-7.919,6.92-13.58 c-1.84-5.66-7.918-8.76-13.581-6.92l-5.142,1.67c-5.661,1.84-8.759,7.919-6.92,13.58 C353.755,250.525,357.979,253.421,362.523,253.421z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M400.028,241.237c1.106,0,2.23-0.172,3.34-0.532l5.131-1.67c5.659-1.843,8.753-7.926,6.91-13.585 c-1.843-5.66-7.922-8.751-13.585-6.911l-5.131,1.672c-5.659,1.843-8.753,7.925-6.91,13.584 C391.264,238.345,395.488,241.237,400.028,241.237z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M437.521,229.043c1.097,0,2.213-0.169,3.312-0.524l5.142-1.66c5.665-1.828,8.775-7.903,6.946-13.566 c-1.828-5.663-7.902-8.776-13.566-6.946l-5.142,1.66c-5.665,1.828-8.775,7.903-6.946,13.566 C428.74,226.137,432.97,229.043,437.521,229.043z" }
        }
        }
    }

    // https://www.svgrepo.com/svg/500112/shark | CC0, as listed by SVG Repo.
    // Changes: coordinated fill colours; cream vector backing; layout transforms.
    component SharkArt: Item {
        id: art
        implicitWidth: 953.9362
        implicitHeight: 933.2362
        Shape {
            width: 953.9362
            height: 933.2362
            antialiasing: true
            transform: [
                Translate { x: -35.0319; y: -44.9319 },
                Scale { xScale: art.width / art.implicitWidth; yScale: art.height / art.implicitHeight }
            ]
        ShapePath {
            strokeWidth: 40.383
            strokeColor: "#fff6e7"
            fillColor: "#fff6e7"
            fillRule: ShapePath.WindingFill
            joinStyle: ShapePath.RoundJoin
            capStyle: ShapePath.RoundCap
            PathSvg { path: "M941.4 188.6 L943.07107 188.67131 L944.70156 188.88127 L946.28577 189.22392 L947.81802 189.69334 L949.29262 190.28355 L950.70389 190.98863 L952.04614 191.80261 L953.31369 192.71955 L954.50085 193.7335 L955.60192 194.83852 L956.61124 196.02865 L957.52311 197.29794 L958.33184 198.64046 L959.03175 200.05024 L959.61716 201.52134 L960.08237 203.04782 L960.42171 204.62372 L960.62948 206.2431 L960.7 207.9 L960.68844 210.54185 L960.6538 213.1816 L960.59611 215.81911 L960.51543 218.45425 L960.41178 221.08687 L960.28523 223.71684 L960.1358 226.34403 L959.96355 228.9683 L959.76851 231.5895 L959.55074 234.20751 L959.31026 236.82219 L959.04713 239.4334 L958.76139 242.041 L958.45309 244.64486 L958.12225 247.24483 L957.76894 249.84079 L957.39319 252.4326 L956.99504 255.02012 L956.57455 257.60321 L956.13174 260.18173 L955.66667 262.75556 L955.17937 265.32454 L954.6699 267.88856 L954.13829 270.44746 L953.58459 273.00111 L953.00884 275.54938 L952.41108 278.09213 L951.79136 280.62922 L951.14972 283.16051 L950.4862 285.68588 L949.80085 288.20517 L949.09371 290.71826 L948.36482 293.22501 L947.61423 295.72528 L946.84198 298.21893 L946.0481 300.70583 L945.23266 303.18584 L944.39568 305.65883 L943.53722 308.12465 L942.65731 310.58318 L941.756 313.03426 L940.83333 315.47778 L939.88935 317.91358 L938.92409 320.34154 L937.93761 322.76152 L936.92994 325.17337 L935.90113 327.57697 L934.85121 329.97217 L933.78025 332.35885 L932.68827 334.73685 L931.57532 337.10606 L930.44144 339.46632 L929.28668 341.8175 L928.11108 344.15948 L926.91468 346.49209 L925.69753 348.81523 L924.45967 351.12873 L923.20114 353.43248 L921.92199 355.72633 L920.62225 358.01014 L919.30198 360.28378 L917.96122 362.54711 L916.6 364.8 L914.30372 368.48996 L911.95813 372.14057 L909.56381 375.75147 L907.12131 379.32231 L904.63122 382.85274 L902.09412 386.3424 L899.51056 389.79095 L896.88114 393.19802 L894.20641 396.56327 L891.48697 399.88634 L888.72336 403.16688 L885.91619 406.40454 L883.066 409.59896 L880.17339 412.74979 L877.23892 415.85669 L874.26316 418.91929 L871.24669 421.93725 L868.19009 424.9102 L865.09392 427.83781 L861.95876 430.71971 L858.78519 433.55556 L855.57377 436.34499 L852.32508 439.08766 L849.03969 441.78322 L845.71819 444.43131 L842.36113 447.03158 L838.9691 449.58367 L835.54266 452.08724 L832.0824 454.54193 L828.58888 456.94739 L825.06268 459.30327 L821.50437 461.6092 L817.91452 463.86485 L814.29372 466.06986 L810.64252 468.22387 L806.96152 470.32653 L803.25127 472.37749 L799.51235 474.3764 L795.74534 476.3229 L791.95081 478.21665 L788.12933 480.05728 L784.28148 481.84444 L780.40783 483.57779 L776.50895 485.25697 L772.58542 486.88163 L768.63781 488.45142 L764.6667 489.96597 L760.67265 491.42494 L756.65624 492.82798 L752.61805 494.17474 L748.55864 495.46485 L744.4786 496.69798 L740.37849 497.87375 L736.25889 498.99184 L732.12037 500.05187 L727.96351 501.0535 L723.78888 501.99637 L719.59705 502.88014 L715.38859 503.70444 L711.16409 504.46893 L706.9241 505.17326 L702.66922 505.81707 L698.4 506.4 L698.2469 507.5371 L698.0872 508.6688 L697.9203 509.7957 L697.7456 510.9184 L697.5625 512.0375 L697.3704 513.1536 L697.1687 514.2673 L696.9568 515.3792 L696.7341 516.4899 L696.5 517.6 L695.82501 520.55363 L695.08631 523.48073 L694.28474 526.38064 L693.42115 529.25267 L692.49638 532.09616 L691.51127 534.91042 L690.46667 537.69479 L689.36341 540.44858 L688.20233 543.17114 L686.98429 545.86177 L685.71012 548.51981 L684.38066 551.14458 L682.99676 553.73542 L681.55926 556.29163 L680.069 558.81256 L678.52682 561.29752 L676.93357 563.74584 L675.29009 566.15685 L673.59721 568.52987 L671.85579 570.86423 L670.06667 573.15926 L668.23068 575.41427 L666.34867 577.6286 L664.42148 579.80158 L662.44995 581.93252 L660.43493 584.02075 L658.37726 586.0656 L656.27778 588.06639 L654.13733 590.02246 L651.95675 591.93312 L649.7369 593.7977 L647.4786 595.61553 L645.1827 597.38593 L642.85005 599.10823 L640.48148 600.78176 L638.07784 602.40583 L635.63997 603.97978 L633.16872 605.50293 L630.66492 606.97461 L628.12941 608.39415 L625.56305 609.76086 L622.96667 611.07407 L620.34111 612.33312 L617.68722 613.53732 L615.00583 614.68601 L612.2978 615.7785 L609.56396 616.81412 L606.80515 617.7922 L604.02222 618.71207 L601.21601 619.57305 L598.38737 620.37446 L595.53712 621.11564 L592.66613 621.7959 L589.77522 622.41458 L586.86524 622.97099 L583.93704 623.46447 L580.99145 623.89434 L578.02932 624.25993 L575.05148 624.56056 L572.05879 624.79555 L569.05209 624.96424 L566.03221 625.06595 L563 625.1 L561.99509 625.09604 L560.9891 625.08419 L559.98207 625.06449 L558.97406 625.03701 L557.96511 625.00178 L556.95527 624.95886 L555.9446 624.9083 L554.93313 624.85014 L553.92093 624.78444 L552.90803 624.71124 L551.89449 624.6306 L550.88036 624.54256 L549.86569 624.44717 L548.85053 624.34448 L547.83492 624.23454 L546.81892 624.11741 L545.80257 623.99312 L544.78593 623.86173 L543.76904 623.72329 L542.75195 623.57785 L541.73472 623.42545 L540.71738 623.26615 L539.7 623.1 L538.21921 622.78542 L536.78017 622.35889 L535.38794 621.82478 L534.04752 621.18746 L532.76396 620.45131 L531.54227 619.6207 L530.3875 618.7 L529.30466 617.69359 L528.2988 616.60583 L527.37493 615.44111 L526.53808 614.20379 L525.79329 612.89825 L525.14559 611.52886 L524.6 610.1 L524.26997 609.02174 L524.00572 607.93595 L523.80655 606.84509 L523.67176 605.75161 L523.60066 604.65795 L523.59254 603.56657 L523.6467 602.47991 L523.76244 601.40042 L523.93907 600.33056 L524.17589 599.27277 L524.47218 598.22949 L524.82726 597.20319 L525.24043 596.19631 L525.71098 595.2113 L526.23821 594.25061 L526.82143 593.31668 L527.45994 592.41197 L528.15303 591.53893 L528.9 590.7 L529.71798 589.82436 L530.52428 588.94035 L531.31884 588.04808 L532.10163 587.14766 L532.8726 586.23919 L533.63169 585.32276 L534.37888 584.39849 L535.1141 583.46648 L535.83732 582.52682 L536.54849 581.57963 L537.24756 580.62501 L537.93449 579.66305 L538.60923 578.69387 L539.27174 577.71756 L539.92197 576.73423 L540.55988 575.74398 L541.18542 574.74692 L541.79854 573.74315 L542.3992 572.73277 L542.98736 571.71588 L543.56296 570.69259 L544.12597 569.66301 L544.67633 568.62722 L545.214 567.58535 L545.73894 566.53748 L546.2511 565.48373 L546.75044 564.4242 L547.2369 563.35898 L547.71045 562.2882 L548.17103 561.21193 L548.6186 560.1303 L549.05313 559.0434 L549.47455 557.95133 L549.88283 556.85421 L550.27791 555.75213 L550.65977 554.64519 L551.02834 553.5335 L551.38358 552.41717 L551.72545 551.29629 L552.0539 550.17096 L552.36889 549.0413 L552.67037 547.90741 L552.95829 546.76938 L553.23262 545.62732 L553.49329 544.48134 L553.74028 543.33154 L553.97353 542.17801 L554.19299 541.02087 L554.39863 539.86022 L554.59039 538.69616 L554.76823 537.52879 L554.93211 536.35821 L555.08197 535.18454 L555.21778 534.00787 L555.33949 532.82831 L555.44705 531.64595 L555.54042 530.46091 L555.61954 529.27329 L555.68439 528.08318 L555.7349 526.89069 L555.77104 525.69593 L555.79275 524.499 L555.8 523.3 L555.79463 522.19235 L555.77833 521.08498 L555.75084 519.97815 L555.71188 518.87214 L555.66117 517.76723 L555.59845 516.66368 L555.52344 515.56177 L555.43587 514.46177 L555.33546 513.36395 L555.22194 512.26859 L555.09504 511.17597 L554.95448 510.08635 L554.8 509 L440.9 509 L440.63848 510.57382 L440.35874 512.14282 L440.06085 513.70686 L439.74486 515.26579 L439.41085 516.81947 L439.05888 518.36778 L438.68903 519.91056 L438.30135 521.44769 L437.89592 522.97901 L437.4728 524.50439 L437.03206 526.0237 L436.57377 527.53679 L436.098 529.04352 L435.6048 530.54376 L435.09426 532.03736 L434.56643 533.52419 L434.02138 535.0041 L433.45918 536.47697 L432.87991 537.94264 L432.28361 539.40098 L431.67037 540.85185 L431.04025 542.29511 L430.39331 543.73063 L429.72963 545.15826 L429.04927 546.57786 L428.35229 547.98929 L427.63878 549.39242 L426.90878 550.78711 L426.16237 552.17321 L425.39962 553.55059 L424.6206 554.91911 L423.82536 556.27863 L423.01398 557.629 L422.18653 558.9701 L421.34307 560.30178 L420.48367 561.62391 L419.6084 562.93633 L418.71732 564.23892 L417.81051 565.53154 L416.88802 566.81404 L415.94993 568.08629 L414.9963 569.34815 L414.0272 570.59947 L413.04269 571.84013 L412.04286 573.06997 L411.02775 574.28887 L409.99744 575.49667 L408.952 576.69325 L407.8915 577.87846 L406.81599 579.05217 L405.72555 580.21423 L404.62024 581.36451 L403.50014 582.50286 L402.36531 583.62915 L401.21581 584.74324 L400.05171 585.84499 L398.87309 586.93426 L397.68001 588.01091 L396.47253 589.0748 L395.25072 590.1258 L394.01465 591.16375 L392.76439 592.18853 L391.5 593.2 L390.52869 593.94721 L389.54801 594.68875 L388.55787 595.42454 L387.55816 596.15446 L386.54878 596.87841 L385.52963 597.5963 L384.5006 598.30801 L383.46159 599.01344 L382.4125 599.7125 L381.35322 600.40508 L380.28366 601.09107 L379.2037 601.77037 L378.11325 602.44288 L377.01221 603.1085 L375.90046 603.76713 L374.77791 604.41866 L373.64446 605.06298 L372.5 605.7 L371.36582 606.29551 L370.21406 606.80781 L369.0459 607.23809 L367.8625 607.5875 L366.66504 607.85723 L365.45469 608.04844 L364.23262 608.1623 L363 608.2 L361.8932 608.1699 L360.7936 608.0792 L359.7024 607.9273 L358.6208 607.7136 L357.55 607.4375 L356.4912 607.0984 L355.4456 606.6957 L354.4144 606.2288 L353.3988 605.6971 L352.4 605.1 L351.37922 604.3802 L350.43306 603.59969 L349.55931 602.76216 L348.75579 601.87126 L348.02029 600.93065 L347.35062 599.94401 L346.74458 598.91498 L346.19996 597.84724 L345.71457 596.74445 L345.28622 595.61028 L344.9127 594.44838 L344.59182 593.26243 L344.32137 592.05608 L344.09917 590.83299 L343.923 589.59685 L343.79068 588.35129 L343.7 587.1 L343.60587 585.68431 L343.50109 584.27431 L343.38617 582.871 L343.26161 581.47543 L343.12792 580.08862 L342.98561 578.71161 L342.83519 577.34541 L342.67716 575.99106 L342.51203 574.64958 L342.34031 573.32201 L342.1625 572.00938 L341.97911 570.7127 L341.79066 569.43301 L341.59763 568.17134 L341.40055 566.92871 L341.19992 565.70616 L340.99625 564.50471 L340.79005 563.32539 L340.58181 562.16924 L340.37205 561.03727 L340.16128 559.93051 L339.95 558.85 L339.73872 557.79676 L339.52795 556.77183 L339.31819 555.77622 L339.10995 554.81097 L338.90375 553.87711 L338.70008 552.97566 L338.49945 552.10765 L338.30237 551.27412 L338.10934 550.47608 L337.92089 549.71458 L337.7375 548.99063 L337.55969 548.30526 L337.38797 547.65951 L337.22284 547.0544 L337.06481 546.49095 L336.91439 545.97021 L336.77208 545.49319 L336.63839 545.06093 L336.51383 544.67445 L336.39891 544.33479 L336.29413 544.04296 L336.2 543.8 L334.98145 544.81621 L333.85781 545.77969 L332.80215 546.7127 L331.7875 547.6375 L330.78691 548.57637 L329.77344 549.55156 L328.72012 550.58535 L327.6 551.7 L327.5875 551.75 L327.5 551.8 L326.05927 553.26557 L324.6419 554.74781 L323.24796 556.24647 L321.87754 557.76131 L320.5307 559.29206 L319.20753 560.83846 L317.90809 562.40027 L316.63248 563.97724 L315.38076 565.5691 L314.15301 567.1756 L312.94931 568.79649 L311.76973 570.43151 L310.61436 572.08041 L309.48326 573.74294 L308.37653 575.41883 L307.29422 577.10784 L306.23642 578.80972 L305.20321 580.5242 L304.19466 582.25103 L303.21085 583.98996 L302.25185 585.74074 L301.31775 587.50311 L300.40862 589.27681 L299.52453 591.06159 L298.66557 592.8572 L297.83181 594.66338 L297.02332 596.47988 L296.24019 598.30645 L295.48249 600.14282 L294.7503 601.98875 L294.04369 603.84398 L293.36274 605.70825 L292.70753 607.58132 L292.07813 609.46292 L291.47462 611.35281 L290.89708 613.25073 L290.34559 615.15642 L289.82022 617.06963 L289.32105 618.99011 L288.84815 620.9176 L288.4016 622.85184 L287.98148 624.79259 L287.58787 626.73959 L287.22084 628.69258 L286.88047 630.65131 L286.56683 632.61553 L286.28001 634.58498 L286.02007 636.5594 L285.78711 638.53855 L285.58118 640.52216 L285.40238 642.50999 L285.25077 644.50178 L285.12643 646.49727 L285.02945 648.49621 L284.95989 650.49835 L284.91783 652.50343 L284.90336 654.5112 L284.91654 656.5214 L284.95746 658.53378 L285.02619 660.54808 L285.1228 662.56406 L285.24738 664.58145 L285.4 666.6 L288.58193 666.18433 L291.76553 665.81345 L294.95033 665.48724 L298.13588 665.20557 L301.32172 664.96835 L304.5074 664.77545 L307.69246 664.62675 L310.87644 664.52214 L314.05889 664.46152 L317.23936 664.44475 L320.41738 664.47173 L323.59251 664.54234 L326.76428 664.65646 L329.93224 664.81399 L333.09593 665.0148 L336.2549 665.25879 L339.40869 665.54582 L342.55685 665.8758 L345.69892 666.2486 L348.83444 666.66412 L351.96296 667.12222 L355.08403 667.62281 L358.19717 668.16576 L361.30195 668.75096 L364.39791 669.37829 L367.48458 670.04764 L370.56152 670.75889 L373.62826 671.51193 L376.68435 672.30665 L379.72934 673.14292 L382.76276 674.02064 L385.78417 674.93968 L388.79311 675.89994 L391.78912 676.90129 L394.77174 677.94362 L397.74052 679.02682 L400.69501 680.15077 L403.63474 681.31536 L406.55927 682.52047 L409.46813 683.76599 L412.36087 685.0518 L415.23704 686.37778 L418.09617 687.74382 L420.93781 689.14981 L423.76152 690.59563 L426.56682 692.08116 L429.35326 693.60629 L432.1204 695.17091 L434.86776 696.7749 L437.59491 698.41814 L440.30137 700.10052 L442.9867 701.82192 L445.65044 703.58223 L448.29213 705.38134 L450.91132 707.21913 L453.50754 709.09547 L456.08036 711.01027 L458.6293 712.9634 L461.15392 714.95474 L463.65375 716.98419 L466.12835 719.05163 L468.57725 721.15694 L471 723.3 L472.07476 724.28012 L473.13938 725.26095 L474.1944 726.2432 L475.24036 727.22759 L476.27778 728.21481 L477.3072 729.2056 L478.32916 730.20065 L479.34418 731.20068 L480.3528 732.2064 L481.35556 733.21852 L482.35298 734.23775 L483.3456 735.2648 L484.33396 736.30039 L485.31858 737.34521 L486.3 738.4 L487.04062 739.25249 L487.72324 740.1386 L488.34773 741.05569 L488.91392 742.00108 L489.42168 742.97212 L489.87086 743.96614 L490.2613 744.98047 L490.59286 746.01246 L490.86539 747.05944 L491.07875 748.11875 L491.23278 749.18772 L491.32734 750.2637 L491.36228 751.34401 L491.33745 752.426 L491.2527 753.50701 L491.10789 754.58437 L490.90287 755.65541 L490.63749 756.71748 L490.3116 757.76791 L489.92505 758.80404 L489.4777 759.82321 L488.9694 760.82275 L488.4 761.8 L487.7329 762.78351 L487.01525 763.71518 L486.24982 764.59399 L485.43937 765.41893 L484.58665 766.18899 L483.69444 766.90316 L482.76549 767.56041 L481.80255 768.15973 L480.80841 768.70011 L479.7858 769.18054 L478.7375 769.6 L477.66627 769.95748 L476.57486 770.25195 L475.46604 770.48242 L474.34257 770.64786 L473.20721 770.74726 L472.06273 770.7796 L470.91187 770.74388 L469.75741 770.63907 L468.6021 770.46416 L467.44871 770.21814 L466.3 769.9 L464.08697 769.22834 L461.86713 768.58477 L459.64075 767.96925 L457.40814 767.38175 L455.16957 766.82225 L452.92533 766.29071 L450.67572 765.78711 L448.42102 765.3114 L446.16152 764.86356 L443.8975 764.44355 L441.62926 764.05136 L439.35708 763.68693 L437.08125 763.35026 L434.80206 763.04129 L432.51979 762.76 L430.23474 762.50637 L427.94719 762.28035 L425.65743 762.08192 L423.36575 761.91105 L421.07244 761.7677 L418.77778 761.65185 L416.48206 761.56346 L414.18557 761.5025 L411.8886 761.46895 L409.59143 761.46276 L407.29436 761.48391 L404.99767 761.53236 L402.70165 761.60809 L400.40658 761.71107 L398.11276 761.84126 L395.82048 761.99863 L393.53001 762.18315 L391.24166 762.3948 L388.9557 762.63353 L386.67243 762.89931 L384.39213 763.19213 L382.11509 763.51194 L379.8416 763.85871 L377.57195 764.23242 L375.30642 764.63302 L373.0453 765.0605 L370.78889 765.51481 L368.53746 765.99594 L366.29131 766.50384 L364.05073 767.03848 L361.816 767.59984 L359.5874 768.18789 L357.36524 768.80258 L355.14979 769.4439 L352.94135 770.1118 L350.7402 770.80626 L348.54663 771.52725 L346.36093 772.27474 L344.18338 773.04869 L342.01428 773.84907 L339.85391 774.67586 L337.70256 775.52901 L335.56052 776.40851 L333.42807 777.31432 L331.30551 778.2464 L329.19312 779.20473 L327.09118 780.18927 L325 781.2 L324.21837 783.38506 L323.46395 785.57814 L322.73673 787.77895 L322.03673 789.9872 L321.36395 792.20259 L320.71837 794.42484 L320.1 796.65364 L319.50884 798.8887 L318.9449 801.12974 L318.40816 803.37645 L317.89864 805.62856 L317.41633 807.88576 L316.96122 810.14776 L316.53333 812.41427 L316.13265 814.68499 L315.75918 816.95964 L315.41293 819.23792 L315.09388 821.51953 L314.80204 823.80419 L314.53741 826.09161 L314.3 828.38148 L314.0898 830.67352 L313.9068 832.96744 L313.75102 835.26293 L313.62245 837.55971 L313.52109 839.85749 L313.44694 842.15598 L313.4 844.45487 L313.38027 846.75388 L313.38776 849.05272 L313.42245 851.35108 L313.48435 853.64869 L313.57347 855.94524 L313.6898 858.24045 L313.83333 860.53402 L314.00408 862.82566 L314.20204 865.11507 L314.42721 867.40196 L314.67959 869.68605 L314.95918 871.96703 L315.26599 874.24462 L315.6 876.51852 L315.96122 878.78844 L316.34966 881.05408 L316.76531 883.31516 L317.20816 885.57138 L317.67823 887.82245 L318.17551 890.06807 L318.7 892.30796 L319.2517 894.54181 L319.83061 896.76934 L320.43673 898.99026 L321.07007 901.20427 L321.73061 903.41108 L322.41837 905.61039 L323.13333 907.80192 L323.87551 909.98537 L324.6449 912.16045 L325.4415 914.32686 L326.26531 916.48431 L327.11633 918.63251 L327.99456 920.77118 L328.9 922.9 L329.34084 923.99908 L329.70939 925.11247 L330.00649 926.23713 L330.23298 927.37002 L330.38972 928.5081 L330.47754 929.64831 L330.49729 930.78762 L330.44981 931.92299 L330.33596 933.05137 L330.15657 934.16972 L329.9125 935.275 L329.60458 936.36416 L329.23367 937.43417 L328.8006 938.48197 L328.30623 939.50453 L327.75139 940.4988 L327.13694 941.46174 L326.46371 942.39031 L325.73256 943.28146 L324.94433 944.13216 L324.09986 944.93935 L323.2 945.7 L322.2263 946.42893 L321.21698 947.08843 L320.17611 947.67851 L319.10774 948.19917 L318.01593 948.65041 L316.90473 949.03223 L315.77821 949.34463 L314.64042 949.5876 L313.49542 949.76116 L312.34726 949.86529 L311.2 949.9 L310.01907 949.85309 L308.83469 949.71603 L307.64879 949.49436 L306.46327 949.19359 L305.28004 948.81923 L304.10102 948.37682 L302.92812 947.87188 L301.76327 947.30991 L300.60835 946.69646 L299.46531 946.03703 L298.33603 945.33714 L297.22245 944.60233 L296.12647 943.83811 L295.05 943.05 L293.99496 942.24352 L292.96327 941.4242 L291.95682 940.59755 L290.97755 939.7691 L290.02736 938.94436 L289.10816 938.12886 L288.22187 937.32813 L287.37041 936.54767 L286.55568 935.79301 L285.77959 935.06968 L285.04407 934.38319 L284.35102 933.73907 L283.70236 933.14283 L283.1 932.6 L280.62331 930.34082 L278.18385 928.04933 L275.78181 925.72601 L273.41737 923.37136 L271.09072 920.98586 L268.80206 918.57 L266.55158 916.12428 L264.33946 913.64918 L262.16589 911.14519 L260.03106 908.6128 L257.93517 906.0525 L255.8784 903.46479 L253.86095 900.85014 L251.88299 898.20905 L249.94473 895.54201 L248.04634 892.84951 L246.18803 890.13204 L244.36997 887.39009 L242.59237 884.62414 L240.8554 881.83469 L239.15926 879.02222 L237.50414 876.18723 L235.89023 873.33021 L234.31771 870.45164 L232.78678 867.55201 L231.29763 864.63182 L229.85044 861.69155 L228.4454 858.73169 L227.08272 855.75273 L225.76256 852.75517 L224.48513 849.73948 L223.25062 846.70617 L222.05921 843.65572 L220.91109 840.58861 L219.80645 837.50535 L218.74548 834.40641 L217.72838 831.2923 L216.75532 828.16349 L215.82651 825.02047 L214.94213 821.86375 L214.10236 818.6938 L213.30741 815.51111 L212.55745 812.31618 L211.85268 809.1095 L211.19329 805.89155 L210.57947 802.66282 L210.01141 799.4238 L209.48929 796.17499 L209.01331 792.91687 L208.58365 789.64993 L208.20051 786.37467 L207.86407 783.09156 L207.57453 779.80111 L207.33207 776.50379 L207.13689 773.2001 L206.98916 769.89053 L206.88909 766.57557 L206.83687 763.25571 L206.83267 759.93144 L206.8767 756.60324 L206.96914 753.27161 L207.11017 749.93703 L207.3 746.6 L203.08308 743.97255 L198.91835 741.28124 L194.80632 738.52692 L190.74748 735.71042 L186.74232 732.83259 L182.79135 729.89427 L178.89506 726.8963 L175.05395 723.83952 L171.26851 720.72478 L167.53925 717.55292 L163.86665 714.32478 L160.25121 711.04121 L156.69344 707.70303 L153.19383 704.31111 L149.75287 700.86628 L146.37106 697.36938 L143.0489 693.82125 L139.78688 690.22274 L136.58551 686.57469 L133.44527 682.87794 L130.36667 679.13333 L127.3502 675.34171 L124.39635 671.50392 L121.50564 667.6208 L118.67854 663.69319 L115.91556 659.72193 L113.2172 655.70787 L110.58395 651.65185 L108.01631 647.55471 L105.51477 643.4173 L103.07984 639.24045 L100.712 635.02501 L98.41176 630.77182 L96.17961 626.48172 L94.01605 622.15556 L91.92157 617.79417 L89.89668 613.3984 L87.94187 608.9691 L86.05763 604.50709 L84.24446 600.01324 L82.50287 595.48837 L80.83333 590.93333 L79.23636 586.34897 L77.71245 581.73612 L76.2621 577.09563 L74.8858 572.42833 L73.58404 567.73508 L72.35734 563.01672 L71.20617 558.27407 L70.13105 553.508 L69.13246 548.71934 L68.2109 543.90893 L67.36688 539.07762 L66.60087 534.22624 L65.9134 529.35564 L65.30494 524.46667 L64.776 519.56016 L64.32707 514.63695 L63.95865 509.69789 L63.67123 504.74383 L63.46532 499.7756 L63.34141 494.79404 L63.3 489.8 L63.40162 481.92377 L63.70483 474.09675 L64.20713 466.32144 L64.90601 458.60034 L65.79898 450.93594 L66.88354 443.33074 L68.1572 435.78724 L69.61746 428.30794 L71.26181 420.89534 L73.08776 413.55192 L75.09281 406.2802 L77.27447 399.08267 L79.63024 391.96182 L82.15761 384.92016 L84.8541 377.96019 L87.7172 371.08439 L90.74441 364.29528 L93.93324 357.59534 L97.28118 350.98707 L100.78575 344.47298 L104.44444 338.05556 L108.25476 331.7373 L112.21421 325.52072 L116.32028 319.40829 L120.57048 313.40253 L124.96232 307.50593 L129.49329 301.72099 L134.16091 296.05021 L138.96266 290.49607 L143.89605 285.06109 L148.95858 279.74777 L154.14777 274.55858 L159.46109 269.49605 L164.89607 264.56266 L170.45021 259.76091 L176.12099 255.09329 L181.90593 250.56232 L187.80253 246.17048 L193.80829 241.92028 L199.92072 237.81421 L206.1373 233.85476 L212.45556 230.04444 L218.87298 226.38575 L225.38707 222.88118 L231.99534 219.53324 L238.69528 216.34441 L245.48439 213.3172 L252.36019 210.4541 L259.32016 207.75761 L266.36182 205.23024 L273.48267 202.87447 L280.6802 200.69281 L287.95192 198.68776 L295.29534 196.86181 L302.70794 195.21746 L310.18724 193.7572 L317.73074 192.48354 L325.33594 191.39898 L333.00034 190.50601 L340.72144 189.80713 L348.49675 189.30483 L356.32377 189.00162 L364.2 188.9 L429.9 188.9 L429.2579 187.48262 L428.60782 186.06862 L427.94978 184.65804 L427.2838 183.25093 L426.60992 181.84733 L425.92816 180.44731 L425.23855 179.05089 L424.5411 177.65814 L423.83586 176.2691 L423.12284 174.88381 L422.40208 173.50233 L421.67359 172.12471 L420.9374 170.75098 L420.19355 169.38121 L419.44206 168.01543 L418.68295 166.6537 L417.91625 165.29606 L417.14198 163.94257 L416.36018 162.59326 L415.57087 161.24819 L414.77407 159.90741 L413.96982 158.57096 L413.15814 157.23889 L412.33905 155.91125 L411.51258 154.58809 L410.67876 153.26946 L409.83761 151.95539 L408.98916 150.64595 L408.13344 149.34118 L407.27048 148.04113 L406.40029 146.74584 L405.52291 145.45537 L404.63837 144.16975 L403.74668 142.88905 L402.84787 141.61331 L401.94198 140.34257 L401.02903 139.07688 L400.10904 137.81629 L399.18204 136.56086 L398.24806 135.31062 L397.30713 134.06563 L396.35926 132.82593 L395.40449 131.59157 L394.44284 130.3626 L393.47434 129.13907 L392.49902 127.92102 L391.5169 126.70851 L390.52801 125.50158 L389.53237 124.30027 L388.53002 123.10465 L387.52097 121.91475 L386.50526 120.73062 L385.4829 119.55232 L384.45394 118.37988 L383.41838 117.21337 L382.37627 116.05281 L381.32762 114.89827 L380.27247 113.74979 L379.21083 112.60742 L378.14274 111.47121 L377.06822 110.34121 L375.9873 109.21745 L374.9 108.1 L374.09834 107.2367 L373.35996 106.33765 L372.68477 105.40576 L372.07269 104.44397 L371.52361 103.4552 L371.03745 102.44239 L370.61411 101.40844 L370.25351 100.3563 L369.95556 99.28889 L369.72015 98.20913 L369.5472 97.11995 L369.43663 96.02428 L369.38832 94.92504 L369.40221 93.82516 L369.47819 92.72757 L369.61617 91.63519 L369.81606 90.55095 L370.07778 89.47778 L370.40122 88.41859 L370.7863 87.37633 L371.23292 86.35391 L371.741 85.35426 L372.31044 84.38031 L372.94115 83.43498 L373.63304 82.5212 L374.38602 81.6419 L375.2 80.8 L376.1805 79.909 L377.2 79.096 L378.2555 78.361 L379.344 77.704 L380.4625 77.125 L381.608 76.624 L382.7775 76.201 L383.968 75.856 L385.1765 75.589 L386.4 75.4 L387.36419 75.28324 L388.33043 75.16979 L389.29868 75.05965 L390.2689 74.95279 L391.24108 74.84922 L392.21516 74.74891 L393.19113 74.65187 L394.16895 74.55807 L395.14858 74.46751 L396.12999 74.38017 L397.11315 74.29605 L398.09803 74.21513 L399.0846 74.13741 L400.07281 74.06287 L401.06264 73.99149 L402.05406 73.92328 L403.04703 73.85822 L404.04152 73.7963 L405.0375 73.7375 L406.03493 73.68182 L407.03379 73.62924 L408.03403 73.57976 L409.03563 73.53337 L410.03855 73.49004 L411.04276 73.44978 L412.04823 73.41257 L413.05492 73.3784 L414.06281 73.34725 L415.07185 73.31913 L416.08202 73.29401 L417.09329 73.27189 L418.10561 73.25275 L419.11897 73.23659 L420.13331 73.22339 L421.14862 73.21314 L422.16486 73.20583 L423.182 73.20146 L424.2 73.2 L428.75638 73.23171 L433.30137 73.32666 L437.83448 73.48461 L442.35519 73.70533 L446.86302 73.98855 L451.35746 74.33405 L455.838 74.74156 L460.30414 75.21086 L464.75539 75.74169 L469.19125 76.33381 L473.6112 76.98698 L478.01475 77.70094 L482.4014 78.47546 L486.77064 79.31029 L491.12198 80.20518 L495.45492 81.1599 L499.76894 82.17419 L504.06356 83.24781 L508.33826 84.38052 L512.59255 85.57207 L516.82593 86.82222 L521.03789 88.13072 L525.22793 89.49733 L529.39555 90.9218 L533.54025 92.40389 L537.66153 93.94335 L541.75889 95.53994 L545.83182 97.19342 L549.87983 98.90353 L553.90241 100.67004 L557.89906 102.49269 L561.86927 104.37125 L565.81256 106.30547 L569.72841 108.29511 L573.61632 110.33992 L577.4758 112.43965 L581.30634 114.59406 L585.10744 116.80291 L588.8786 119.06595 L592.61931 121.38294 L596.32908 123.75363 L600.00741 126.17778 L603.65378 128.65514 L607.26771 131.18546 L610.84869 133.76851 L614.39621 136.40404 L617.90978 139.0918 L621.3889 141.83155 L624.83306 144.62305 L628.24176 147.46604 L631.6145 150.36029 L634.95078 153.30554 L638.2501 156.30156 L641.51195 159.3481 L644.73584 162.44492 L647.92126 165.59177 L651.06771 168.7884 L654.1747 172.03458 L657.24171 175.33005 L660.26824 178.67457 L663.25381 182.0679 L666.19789 185.50979 L669.1 189 L941.4 189 L941.4 188.6" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M941.4 188.6c10.7 0 19.3 8.7 19.3 19.3 0 55.5-15.3 109.7-44.1 156.9-47.7 77.9-128.4 130-218.2 141.6-0.5 3.8-1.1 7.5-1.9 11.2C683 579.9 626.8 625.1 563 625.1c-7.7 0-15.5-0.7-23.3-2-7-1.2-12.8-6.2-15.1-13-2.3-6.8-0.6-14.2 4.3-19.4 17.3-18.3 26.9-42.2 26.9-67.4 0-4.8-0.3-9.6-1-14.3H440.9c-5.3 33.1-22.7 63.1-49.4 84.2-5.8 4.5-12.1 8.7-19 12.5-3 1.7-6.2 2.5-9.5 2.5-3.7 0-7.3-1-10.6-3.1-6-3.9-8.3-10.9-8.7-18-1.3-20.8-6.2-40.1-7.5-43.3-3.4 2.8-5.5 4.8-8.6 7.9 0 0 0 0.1-0.1 0.1-30.5 30.6-45.6 72.4-42.1 114.8 66.8-9.2 135 11.3 185.6 56.7 5.4 4.9 10.4 9.8 15.3 15.1 5.9 6.4 6.7 16 2.1 23.4-4.7 7.4-13.7 10.7-22.1 8.1-46.4-14.4-97.5-10.2-141.3 11.3-16.7 45.8-15.4 97.1 3.9 141.7 3.5 8 1.1 17.4-5.7 22.8-3.5 2.8-7.8 4.2-12 4.2-11 0-22.7-12.5-28.1-17.3-52.4-47.1-80.3-115.9-75.8-186-89.1-54.5-144-151.8-144-256.8 0-165.9 135-300.9 300.9-300.9h65.7c-13.4-29.8-32.1-57.4-55-80.8-7.5-7.6-7.3-19.9 0.3-27.3 3.2-3.1 7.1-4.9 11.2-5.4 12.2-1.5 24.9-2.2 37.8-2.2 95.8 0 184.4 42 244.9 115.8h272.3z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#8dcbdc"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M660.4 228.2l260.9-0.9c-3 40.8-15.5 80.2-36.4 115.2h-110c-10.3 0-19.3 7.8-20 18.1-0.7 11.3 8.2 20.6 19.3 20.6h82.3c-44.8 50.8-108.1 83-176.4 88.3-10.6 0-19.2 8.6-19.3 19.3 0 7-0.8 13.9-2.3 20.6-8.5 39-40.3 68.7-78.8 75.5 9.6-18.9 14.6-39.9 14.6-61.6 0-13.4-1.9-26.6-5.7-39.2-2.5-8.4-10.2-13.8-18.5-13.8l-147.7 0.2c-10.1 0.4-18.3 8.6-18.5 18.9-0.5 23.1-13 50.1-27.9 66.9-5.5-26.9-15-51.6-16.1-53.2-6.1-8.8-18.1-11-26.9-4.9-11.9 7.4-22.9 16.2-32.8 26.1-44.3 44.3-63 107.5-49.9 168.9 2 9.1 10 15.3 18.9 15.3 1.4 0 5.6-0.8 6.4-1.1 43.2-9.5 87.9-3.8 126.6 15.4-35.3 1.2-70.3 10.4-101.7 27.3-5.8 3.1-8.3 8.5-8.9 9.9-13.4 33.1-18.9 68.9-16.3 104-23.3-36.7-33.8-80.8-28.8-124.9 0.1-0.8 0.1-1.6 0.1-2.4 0.3-7.1-3.3-14.1-9.9-17.8-83.2-46.3-134.9-134.2-134.9-229.4 0-144.6 117.6-262.3 262.3-262.3 0 0 95.4 1.4 100.1-1 9.6-4.8 15.6-14.3 12.2-24.4-10.8-32.3-27-62.9-47.6-90.2 85.4 1.4 164 41 216.2 109 3.9 5 9.6 7.6 15.4 7.6z" }
        }
        ShapePath {
            strokeWidth: 0
            fillColor: "#193e50"
            fillRule: ShapePath.WindingFill
            PathSvg { path: "M818.7 263.8c10 0 18.2 8.1 18.2 18.2s-8.1 18.2-18.2 18.2c-10 0-18.2-8.1-18.2-18.2s8.2-18.2 18.2-18.2zM674.9 277.3c9.1 5.6 12 17.5 6.4 26.6-9.3 15.1-9.3 34.6 0 49.7 5.6 9.1 2.7 21-6.4 26.6-3.2 1.9-6.7 2.9-10.1 2.9-6.5 0-12.9-3.3-16.5-9.2-17-27.8-17-62.3 0-90.1 5.6-9.2 17.5-12.1 26.6-6.5zM601.3 277.3c9.1 5.6 12 17.5 6.4 26.6-9.3 15.1-9.3 34.6 0 49.7 5.6 9.1 2.7 21-6.4 26.6-3.2 1.9-6.6 2.9-10.1 2.9-6.5 0-12.9-3.3-16.5-9.2-17-27.8-17-62.3 0-90.1 5.6-9.2 17.5-12.1 26.6-6.5zM329 295.6c2.9 10.3-3 21-13.3 23.9-60.7 17.3-107.4 66.2-123.2 127.2-4.5 17.3-21.9 14.5-23.4 14.1-10.4-2.6-16.7-13.1-14.1-23.5 18.6-74.5 76.2-133.9 150.1-155 10.2-2.9 20.9 3 23.9 13.3z" }
        }
        }
    }
}
