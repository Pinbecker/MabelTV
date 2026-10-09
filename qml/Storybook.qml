pragma ComponentBehavior: Bound
import QtQuick

Item {
    id: book
    objectName: "storytimeBook"
    property string childName: "Mabel"
    property string storyTitle: "A little adventure"
    property string coverTitle: ""
    property int coverIndex: 0
    readonly property var coverFiles: ["cover-v2.png", "cover-sapphire.png", "cover-ruby.png", "cover-amethyst.png",
        "cover-teal.png", "cover-amber.png", "cover-rose.png", "cover-brown.png"]
    readonly property url coverSource: "qrc:/storytime/" + coverFiles[Math.max(0, coverIndex) % coverFiles.length]
    property bool preview: false
    property real coverFontSize: preview ? 66 : 51
    property url illustration: ""
    property bool opened: false
    property real progress: 0
    property int openingDuration: 8600
    readonly property bool opening: entrance.running
    readonly property bool revealed: progress >= 1
    readonly property real unit: height / 800
    readonly property real pageWidth: width / 2
    readonly property real coverAngle: -179 * ease(.16,.72)
    readonly property real leafAngle: -180 * ease(.57,.94)
    readonly property string titleFont: lettering.status === FontLoader.Ready ? lettering.name : "DejaVu Serif"
    signal openingFinished()
    signal closingFinished()
    function ease(start, end) {
        const t = Math.max(0,Math.min(1,(progress - start) / (end - start)))
        return t * t * (3 - 2 * t)
    }
    function pageRotation(angle, pageHeight) {
        const radians = angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians)
        // Keep the perspective in screen space. Real 3D depth is clipped by
        // Qt Quick's 2D GPU renderer and makes the turning surfaces disappear.
        const perspective = s / (2400 * book.unit)
        return Qt.matrix4x4(c,0,0,0, pageHeight/2*perspective,1,0,0,
                           0,0,1,0, perspective,0,0,1)
    }
    function reset() { entrance.stop(); departure.stop(); opened = false; progress = 0 }
    function closeBook() {
        entrance.stop(); departure.stop()
        departure.duration = Math.max(280, 1450 * progress)
        departure.start()
    }
    function finish() {
        if (revealed) return
        entrance.stop(); progress = 1; opened = true; openingFinished()
    }
    onOpenedChanged: { if (opened && !revealed) entrance.restart(); else if (!opened) { entrance.stop(); progress = 0 } }
    FontLoader { id: lettering; source: "qrc:/fonts/storytime/CinzelDecorative-Bold.ttf" }
    NumberAnimation {
        id: entrance; target: book; property: "progress"; from: 0; to: 1
        duration: book.openingDuration; onFinished: book.openingFinished()
    }
    NumberAnimation {
        id: departure; target: book; property: "progress"; to: 0
        easing.type: Easing.InOutCubic
        onFinished: { book.opened = false; book.closingFinished() }
    }
    component Paper: Rectangle {
        radius: 7 * book.unit
        color: "#eddfbf"
        border.color: "#d5c298"; border.width: book.unit
        Image {
            anchors.fill: parent; anchors.margins: parent.border.width
            source: "qrc:/storytime/parchment.png"; fillMode: Image.Stretch
            sourceSize.width: 768; sourceSize.height: 1152
        }
        Rectangle {
            anchors.fill: parent; radius: parent.radius
            gradient: Gradient { orientation: Gradient.Horizontal
                GradientStop { position: 0; color: "#458e7346" }
                GradientStop { position: .12; color: "#00ffffff" }
                GradientStop { position: .86; color: "#00ffffff" }
                GradientStop { position: 1; color: "#307c633a" } }
        }
    }
    // All three views share one canvas, so landing the leaf never moves the print.
    component IllustratedSpread: Item {
        width: book.width; height: book.height
        Paper { x: 10 * book.unit; y: 13 * book.unit; width: book.pageWidth - 10 * book.unit; height: book.height - 31 * book.unit }
        Paper { x: book.pageWidth; y: 13 * book.unit; width: book.pageWidth - 10 * book.unit; height: book.height - 31 * book.unit }
        Item {
            x: 33 * book.unit; y: 30 * book.unit
            width: book.width - 68 * book.unit; height: book.height - 65 * book.unit
            Rectangle { anchors.fill: parent; color: "transparent"; border.color: "#c6ad75"; border.width: book.unit; radius: 5 * book.unit }
            Text {
                anchors.top: parent.top; anchors.topMargin: 22 * book.unit; width: parent.width
                text: book.childName + "’s Storytime"; color: "#8c754e"
                font.family: book.titleFont; font.pixelSize: 17 * book.unit; font.letterSpacing: 1.2 * book.unit
                horizontalAlignment: Text.AlignHCenter; elide: Text.ElideRight
            }
            Image {
                objectName: "storyPrintedArtwork"
                x: 27 * book.unit; y: 65 * book.unit
                width: parent.width - 54 * book.unit; height: parent.height - 155 * book.unit
                source: book.illustration; fillMode: Image.PreserveAspectFit
                asynchronous: true; sourceSize.width: book.preview ? 560 : 1440; sourceSize.height: book.preview ? 400 : 1000
            }
            Text {
                anchors.bottom: parent.bottom; anchors.bottomMargin: 26 * book.unit
                width: parent.width - 52 * book.unit; anchors.horizontalCenter: parent.horizontalCenter
                text: book.storyTitle; color: "#294737"; font.family: book.titleFont; font.pixelSize: 31 * book.unit
                horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap; maximumLineCount: 2; elide: Text.ElideRight
            }
        }
    }
    // A single slow timeline drives the camera, cover and separate flyleaf.
    // Static materials stay decoded throughout the animation.
    Item {
        id: volume
        x: -book.pageWidth / 2 * (1 - book.ease(.14,.76))
        y: (1 - book.ease(.80,1)) * -12 * book.unit
        width: book.width; height: book.height
        scale: .92 + .08 * book.ease(.02,.95)
        transform: Scale {
            origin.y: volume.height / 2
            yScale: Math.cos(7 * (1 - book.ease(.30,.96)) * Math.PI / 180)
        }
        Repeater {
            model: 9
            Rectangle {
                required property int index
                x: (6 - index * 2) * book.unit; y: volume.height + (10 + index * 2) * book.unit
                width: volume.width + index * 4 * book.unit; height: (9 + index * 3) * book.unit
                radius: height / 2; color: "#101f18"; opacity: .035
            }
        }
        Rectangle {
            x: book.pageWidth; width: book.pageWidth; height: volume.height
            radius: 13 * book.unit; color: "#1c412e"; border.color: "#9b7a42"; border.width: 3 * book.unit
        }
        Repeater {
            model: 8
            Paper {
                required property int index
                visible: !book.preview || book.progress > .16
                x: book.pageWidth + (4 + index * .9) * book.unit; y: (9 + index * .8) * book.unit
                width: book.pageWidth - (14 + index) * book.unit; height: volume.height - (18 + index * 1.7) * book.unit
            }
        }
        Item {
            objectName: "storyStaticRightPage"
            x: book.pageWidth; width: book.pageWidth; height: volume.height; clip: true; z: 2
            visible: !book.preview || book.progress > .16
            IllustratedSpread { x: -book.pageWidth }
        }
        Item {
            objectName: "storyStaticLeftPage"
            width: book.pageWidth; height: volume.height; clip: true; visible: book.progress >= .94; z: 2
            IllustratedSpread {}
        }
        Rectangle {
            x: book.pageWidth - 17 * book.unit; y: 14 * book.unit
            width: 34 * book.unit; height: volume.height - 32 * book.unit; opacity: book.ease(.45,.92) * .60; z: 3
            gradient: Gradient {
                orientation: Gradient.Horizontal
                GradientStop { position: 0; color: "#007c613d" }
                GradientStop { position: .45; color: "#697c613d" }
                GradientStop { position: .52; color: "#99825f38" }
                GradientStop { position: 1; color: "#00825f38" }
            }
        }
        Rectangle {
            x: book.pageWidth - 4 * book.unit; y: volume.height - 21 * book.unit
            width: 10 * book.unit; height: 28 * book.unit; color: "#934f3f"; opacity: book.ease(.55,.95); radius: 2 * book.unit; z: 3
        }
        Item {
            id: cover
            objectName: "storyOpeningCover"
            // The opened cover stays above the base and below the landed pages.
            x: book.pageWidth; width: book.pageWidth; height: volume.height; z: book.progress < .74 ? 5 : 1
            transform: Matrix4x4 { matrix: book.pageRotation(book.coverAngle,cover.height) }
            Image {
                anchors.fill: parent; source: book.coverSource
                sourceSize.width: 800; sourceSize.height: 1200; fillMode: Image.Stretch; visible: book.coverAngle > -90
            }
            Rectangle {
                x: 0; width: 18 * book.unit; height: parent.height; radius: 3 * book.unit; visible: book.coverAngle > -90
                gradient: Gradient { orientation: Gradient.Horizontal
                    GradientStop { position: 0; color: "#af855232" }
                    GradientStop { position: .55; color: "#44160d04" }
                    GradientStop { position: 1; color: "#00160d04" } }
            }
            Column {
                width: parent.width * .67; anchors.centerIn: parent; spacing: 27 * book.unit; visible: book.coverAngle > -90
                Text { width: parent.width; text: "ONCE UPON A TIME"; color: "#d3b975"; font.family: "DejaVu Serif"; font.pixelSize: 14 * book.unit; font.letterSpacing: 3 * book.unit; horizontalAlignment: Text.AlignHCenter }
                Text { width: parent.width; text: book.coverTitle || book.childName + "’s\nStorytime"; color: "#f0d99b"; font.family: book.titleFont; font.pixelSize: book.coverFontSize * book.unit; style: Text.Raised; styleColor: "#10271b"; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap; maximumLineCount: 4; elide: Text.ElideRight; lineHeight: 1.18 }
                Rectangle { width: 105 * book.unit; height: book.unit; anchors.horizontalCenter: parent.horizontalCenter; color: "#c8a464" }
                Text { width: parent.width; text: "Every story starts\nwith a little wonder"; color: "#d0bd88"; font.family: "DejaVu Serif"; font.italic: true; font.pixelSize: 18 * book.unit; horizontalAlignment: Text.AlignHCenter; lineHeight: 1.5 }
            }
            Paper {
                anchors.fill: parent; border.width: 7 * book.unit; border.color: "#937441"; visible: book.coverAngle <= -90
                Rectangle { anchors.fill: parent; anchors.margins: 25 * book.unit; radius: 4 * book.unit; color: "transparent"; border.color: "#c3ab77"; border.width: book.unit }
            }
        }
        Item {
            id: leaf
            objectName: "storyTurningLeaf"
            x: book.pageWidth; y: 13 * book.unit; width: book.pageWidth - 10 * book.unit; height: volume.height - 31 * book.unit; z: 4
            visible: book.progress < .94 && (!book.preview || book.progress > .16)
            transform: Matrix4x4 { matrix: book.pageRotation(book.leafAngle,leaf.height) }
            Paper { anchors.fill: parent }
            Rectangle { anchors.fill: parent; anchors.margins: 27 * book.unit; visible: book.leafAngle > -90; radius: 5 * book.unit; color: "transparent"; border.color: "#d6bf8c"; border.width: book.unit }
            Column {
                visible: book.leafAngle > -90; anchors.centerIn: parent; width: parent.width * .74; spacing: 30 * book.unit
                Text { width: parent.width; text: "A little adventure awaits"; font.family: "DejaVu Serif"; font.italic: true; font.pixelSize: 22 * book.unit; color: "#947d53"; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap }
                Text { width: parent.width; text: book.storyTitle; font.family: book.titleFont; font.pixelSize: 38 * book.unit; color: "#34543e"; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap }
                Rectangle { width: 105 * book.unit; height: book.unit; anchors.horizontalCenter: parent.horizontalCenter; color: "#b6a06b" }
                Text { width: parent.width; text: "Let the story begin"; font.family: "DejaVu Serif"; font.italic: true; font.pixelSize: 20 * book.unit; color: "#947d53"; horizontalAlignment: Text.AlignHCenter }
            }
            Item {
                objectName: "storyTurningIllustration"
                anchors.fill: parent; clip: true; visible: book.leafAngle <= -90
                transform: Scale { origin.x: leaf.width / 2; xScale: -1 }
                IllustratedSpread { x: -10 * book.unit; y: -13 * book.unit }
            }
            Rectangle {
                anchors.right: parent.right; height: parent.height; width: (7 + 28 * Math.sin(book.ease(.57,.94) * Math.PI)) * book.unit; opacity: .6
                gradient: Gradient { orientation: Gradient.Horizontal
                    GradientStop { position: 0; color: "#00ac966c" }
                    GradientStop { position: .55; color: "#bffff4d8" }
                    GradientStop { position: 1; color: "#99a1895e" } }
            }
        }
    }
    Repeater {
        model: book.preview ? 0 : 16
        Rectangle {
            required property int index
            readonly property real phase: Math.max(0,Math.min(1,(book.progress - .12 - index * .012) / .75))
            width: (2 + index % 3) * book.unit; height: width; radius: width / 2
            x: book.width * (.15 + (index * 37 % 77) / 100) + Math.sin(phase * 4 + index) * 22 * book.unit
            y: book.height * (.8 - phase * .7) - (index % 5) * 38 * book.unit
            color: "#e8c883"; opacity: Math.sin(phase * Math.PI) * .5
        }
    }
}
