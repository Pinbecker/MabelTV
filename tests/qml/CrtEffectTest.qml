import QtQuick
import "../../qml"
Item {
    id: root
    width: 960; height: 540
    property bool reference: true
    property real glass: 0.9
    property real distortion: 0.15
    property real paused: 0
    Item {
        id: original
        anchors.fill: parent
        Rectangle { anchors.fill: parent; color:"#010201" }
        Image { anchors.fill: parent; source: "story-illustration.svg"; fillMode: Image.Stretch }
        CrtReferenceReflection { anchors.fill: parent; glass: root.glass }
        Text { x:14; y:parent.height-30; text:"CH 6 / PLAYING"; color:"#6f8b70"; opacity:.72; font.pixelSize:12 }
    }
    Image { id: picture; anchors.fill: parent; source: "story-illustration.svg"; fillMode: Image.Stretch }
    Item {
        id: overlay
        anchors.fill: parent
        CrtReflection { anchors.fill: parent; glass: root.glass }
        Text { x:14; y:parent.height-30; text:"CH 6 / PLAYING"; color:"#6f8b70"; opacity:.72; font.pixelSize:12 }
    }
    ShaderEffectSource { id: originalTexture; anchors.fill: parent; sourceItem: original; hideSource:true; smooth:true; visible:false }
    ShaderEffectSource { id: pictureTexture; anchors.fill: parent; sourceItem: picture; hideSource:true; smooth:true; visible:false }
    ShaderEffectSource { id: overlayTexture; anchors.fill: parent; sourceItem: overlay; hideSource:true; smooth:true; visible:false }
    CrtGrain { id: grain }
    ShaderEffect {
        mesh: GridMesh { resolution: Qt.size(64, 36) }
        vertexShader: root.reference ? "" : "qrc:/shaders/crt.vert.qsb"
        property variant grainTexture: grain.texture
        property variant foreground: overlayTexture
        anchors.fill: parent
        property variant source: root.reference ? originalTexture : pictureTexture
        property real effectStrength: root.glass
        property real glassCurve: Math.pow(effectStrength, 1.25)
        property real maskExponent: 7 - 3 * Math.pow(effectStrength, 0.8)
        property real distortion: root.distortion
        property real pausedEffect: root.paused
        property real phase: 2.75
        property real flicker: 0.25
        property real cornerRadius: 42
        property real maskSoftness: 1.65
        property vector2d resolution: Qt.vector2d(width, height)
        fragmentShader: root.reference ? "qrc:/shaders/crt-reference.frag.qsb" : root.distortion <= 0.3 && root.paused === 0 ? "qrc:/shaders/crt-fast.frag.qsb" : "qrc:/shaders/crt.frag.qsb"
    }
}
