import QtQuick

// Clip the whole surface, including artwork and overlays, in one GPU pass.
// Rectangle.radius alone does not clip child Images to its rounded outline.
Item {
    id: surface
    property real radius: 0
    layer.enabled: radius > 0
    layer.smooth: true
    layer.effect: ShaderEffect {
        property real cornerRadius: surface.radius
        property vector2d surfaceSize: Qt.vector2d(surface.width, surface.height)
        fragmentShader: "qrc:/shaders/my-tv-rounded.frag.qsb"
    }
}
