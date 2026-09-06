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
    OceanClownfishArt {
        objectName: "clownfish"
        width: cabinet._sideSpace * 0.76
        height: width * implicitHeight / implicitWidth
        x: cabinet._sideCenter - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.18 - height / 2
        rotation: -12
        z: 2
    }
    OceanClownfishArt {
        objectName: "smallClownfish"
        width: cabinet._sideSpace * 0.44
        height: width * implicitHeight / implicitWidth
        x: cabinet._sideCenter - width * 0.30
        y: cabinet.screenY + cabinet.screenHeight * 0.30 - height / 2
        rotation: 11
        z: 2
    }
    OceanJellyfishArt {
        objectName: "jellyfish"
        width: cabinet._sideSpace * 0.66
        height: width * implicitHeight / implicitWidth
        x: cabinet._sideCenter - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.52 - height / 2
        rotation: -5
        z: 2
    }
    OceanSeahorseArt {
        objectName: "seahorse"
        width: cabinet._sideSpace * 0.53
        height: width * implicitHeight / implicitWidth
        x: cabinet._sideCenter - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.82 - height / 2
        rotation: 7
        z: 2
    }
    OceanSharkArt {
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
    OceanTurtleArt {
        objectName: "seaTurtle"
        width: cabinet._sideSpace * 0.68
        height: width * implicitHeight / implicitWidth
        x: cabinet.width - cabinet._sideCenter - width / 2
        y: cabinet.screenY + cabinet.screenHeight * 0.55 - height / 2
        rotation: 20
        z: 2
    }
    OceanStarfishArt {
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
}
