import QtQuick

Row {
    id: hint
    required property string keys
    required property string label
    property real uiScale: 1
    property bool dark: false
    spacing: 9 * uiScale
    Rectangle {
        width: keyLabel.implicitWidth + 16 * hint.uiScale; height: 28 * hint.uiScale
        radius: 6 * hint.uiScale; color: hint.dark ? "#293743" : "#ffffff"; border.width: 1; border.color: hint.dark ? "#60717d" : "#dbe3e8"
        MyTvText { id: keyLabel; anchors.centerIn: parent; color: hint.dark ? "#edf6fb" : "#17242d"; font.weight: Font.DemiBold; font.pixelSize: 15 * hint.uiScale; text: hint.keys }
    }
    MyTvText { anchors.verticalCenter: parent.verticalCenter; color: hint.dark ? "#bdccd5" : "#667780"; font.pixelSize: 17 * hint.uiScale; text: hint.label }
}
