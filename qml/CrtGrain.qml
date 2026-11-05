import QtQuick
Item {
    readonly property alias texture: grain
    Image { id: picture; width: 256; height: 256; source: "qrc:/textures/crt-grain.png" }
    ShaderEffectSource {
        id: grain
        sourceItem: picture
        visible: false
        hideSource: true
        live: false
        smooth: true
        wrapMode: ShaderEffectSource.Repeat
    }
}
