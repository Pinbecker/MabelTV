import QtQuick
Item {
    id: reflection
    required property real glass
    Rectangle {
        anchors.fill: parent
        color: "transparent"
        opacity: reflection.glass
        gradient: Gradient {
            GradientStop { position: 0.0; color: "#60ffffff" }
            GradientStop { position: 0.16; color: "#24ffffff" }
            GradientStop { position: 0.46; color: "#03000000" }
            GradientStop { position: 0.78; color: "#13000000" }
            GradientStop { position: 1.0; color: "#36000000" }
        }
    }
    Rectangle {
        width: parent.width * 1.18
        height: parent.height * 0.23
        x: -parent.width * 0.12
        y: parent.height * 0.055
        rotation: -10
        transformOrigin: Item.Center
        opacity: 0.72 * Math.pow(reflection.glass, 1.3)
        color: "transparent"
        gradient: Gradient {
            GradientStop { position: 0.0; color: "#00ffffff" }
            GradientStop { position: 0.34; color: "#28ffffff" }
            GradientStop { position: 0.50; color: "#64ffffff" }
            GradientStop { position: 0.67; color: "#1cffffff" }
            GradientStop { position: 1.0; color: "#00ffffff" }
        }
    }
}
