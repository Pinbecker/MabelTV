import QtQuick

Rectangle {
    id: keyboard
    required property var host
    property int selectedIndex: 0
    property var keys: ["Q","W","E","R","T","Y","U","I","O","P",
                        "A","S","D","F","G","H","J","K","L","⌫",
                        "Z","X","C","V","B","N","M","-","'","DONE"]
    signal accepted(string value)
    signal closed()
    width: Math.min(parent.width * 0.76, 1320 * host.uiScale)
    height: 270 * host.uiScale
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.bottom: parent.bottom
    anchors.bottomMargin: 34 * host.uiScale
    radius: 20 * host.uiScale
    color: "#f9fafb"
    border.width: 1
    border.color: "#cfd6dd"

    Grid {
        anchors.fill: parent
        anchors.margins: 18 * host.uiScale
        columns: 10
        spacing: 8 * host.uiScale
        Repeater {
            model: keyboard.keys
            delegate: Rectangle {
                required property int index
                required property string modelData
                width: (keyboard.width - 36 * host.uiScale - 9 * parent.spacing) / 10
                height: (keyboard.height - 36 * host.uiScale - 2 * parent.spacing) / 3
                radius: 9 * host.uiScale
                color: index === keyboard.selectedIndex ? host.accent : "#e4e8ed"
                border.width: index === keyboard.selectedIndex ? 3 * host.uiScale : 0
                border.color: "white"
                Text {
                    anchors.centerIn: parent
                    color: "#152029"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 19 * host.uiScale
                    text: modelData
                }
            }
        }
    }

    function activate() {
        const value = keys[selectedIndex]
        if (value === "DONE") closed()
        else if (value === "⌫") accepted("\b")
        else accepted(value)
    }

    function handleKey(key) {
        const columns = 10
        if (key === Qt.Key_Left) selectedIndex = Math.max(0, selectedIndex - 1)
        else if (key === Qt.Key_Right) selectedIndex = Math.min(keys.length - 1, selectedIndex + 1)
        else if (key === Qt.Key_Up) selectedIndex = Math.max(0, selectedIndex - columns)
        else if (key === Qt.Key_Down) selectedIndex = Math.min(keys.length - 1, selectedIndex + columns)
        else if (key === Qt.Key_Return || key === Qt.Key_Enter) activate()
        else if (key === Qt.Key_Escape || key === Qt.Key_Backspace || key === Qt.Key_B) closed()
        else return false
        return true
    }
}
