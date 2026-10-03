pragma ComponentBehavior: Bound
import QtQuick
import MabelTV 1.0

Item {
    id: access
    required property var host
    required property var tvController
    readonly property real s: host.uiScale
    anchors.fill: parent
    visible: tvController.parentAccessState === TvController.ParentConfirmation
    FontLoader { source: "qrc:/fonts/inter/InterVariable.ttf" }
    Rectangle {
        anchors.centerIn: parent
        width: 940 * access.s; height: 680 * access.s; radius: 34 * access.s
        color: "#f7fbfa"; border.color: "#d0e9e3"
        Column {
            x: 64 * access.s; y: 48 * access.s; width: parent.width - 128 * access.s
            spacing: 18 * access.s
            Rectangle {
                width: 72 * access.s; height: width; radius: 24 * access.s; color: "#dff4ee"
                SignalIcon { anchors.centerIn: parent; width: 34 * access.s; height: width; color: "#008b79"; icon: "settings" }
            }
            MyTvText { font.pixelSize: 17 * access.s; font.weight: Font.DemiBold; font.letterSpacing: 2 * access.s; color: "#008b79"; text: "A MOMENT FOR THE GROWN-UPS" }
            MyTvText { font.pixelSize: 42 * access.s; font.weight: Font.Bold; text: "Make it yours" }
            MyTvText { width: parent.width; font.pixelSize: 23 * access.s; color: "#647580"; text: "Press OK three times to open settings." }
            Row {
                spacing: 12 * access.s
                Repeater {
                    model: 3
                    Rectangle {
                        required property int index
                        width: 48 * access.s; height: 9 * access.s; radius: height / 2
                        color: index < access.tvController.parentConfirmationCount ? "#04c6a8" : "#d8e5e1"
                        Behavior on color { ColorAnimation { duration: 100 } }
                    }
                }
            }
            MyTvControl {
                width: parent.width; height: 76 * access.s; uiScale: access.s
                primary: true; highlighted: !access.host.myTvShortcutFocused
                MyTvText { anchors.centerIn: parent; font.pixelSize: 24 * access.s; font.weight: Font.DemiBold; text: access.tvController.parentConfirmationCount === 2 ? "OK · One more press" : "OK · Open settings" }
            }
            MyTvControl {
                width: parent.width; height: 70 * access.s; uiScale: access.s
                highlighted: access.host.myTvShortcutFocused
                MyTvText { anchors.centerIn: parent; font.pixelSize: 23 * access.s; font.weight: Font.DemiBold; text: "Up · Open My TV" }
            }
            MyTvText { width: parent.width; font.pixelSize: 18 * access.s; color: "#647580"; text: access.host.restartSequenceStep ? "Restart selected · Right, then OK" : "Restart this programme: Left, Right, OK" }
            MyTvText { font.pixelSize: 18 * access.s; color: "#647580"; text: "Back to television" }
        }
    }
}
