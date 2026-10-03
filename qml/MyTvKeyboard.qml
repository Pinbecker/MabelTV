import QtQuick

Rectangle {
    id: keyboard
    required property var host
    property int selectedIndex: 0
    property var keys: ["Q","W","E","R","T","Y","U","I","O","P",
                        "A","S","D","F","G","H","J","K","L","⌫",
                        "Z","X","C","V","B","N","M","SPACE","CLEAR","DONE",
                        "1","2","3","4","5","6","7","8","9","0"]
    signal accepted(string value)
    signal closed()
    width: Math.min(parent.width * 0.76, 1320 * host.uiScale)
    height: 410 * host.uiScale
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.bottom: parent.bottom
    anchors.bottomMargin: 34 * host.uiScale
    radius: 24 * host.uiScale
    color: "#f9fafb"
    border.width: 1
    border.color: "#cfd6dd"

    MyTvText {
        x: 24 * keyboard.host.uiScale; y: 20 * keyboard.host.uiScale
        font.weight: Font.DemiBold; font.pixelSize: 25 * keyboard.host.uiScale; text: "Search My TV"
    }
    MyTvText {
        anchors.right: parent.right; anchors.rightMargin: 24 * keyboard.host.uiScale
        y: 24 * keyboard.host.uiScale; color: "#667780"; font.pixelSize: 17 * keyboard.host.uiScale
        text: "OK to select · Back to close"
    }
    Grid {
        x: 20 * host.uiScale; y: 68 * host.uiScale
        width: keyboard.width - 40 * host.uiScale; height: keyboard.height - 88 * host.uiScale
        columns: 10
        spacing: 8 * host.uiScale
        Repeater {
            model: keyboard.keys
            delegate: MyTvControl {
                required property int index
                required property string modelData
                width: (parent.width - 9 * parent.spacing) / 10
                height: (parent.height - 3 * parent.spacing) / 4
                uiScale: keyboard.host.uiScale; radius: 13 * uiScale
                highlighted: index === keyboard.selectedIndex; checked: highlighted; accent: keyboard.host.accent
                MyTvText {
                    anchors.centerIn: parent
                    color: "#152029"
                    font.weight: Font.DemiBold
                    font.pixelSize: (modelData.length > 1 ? 16 : 21) * keyboard.host.uiScale
                    text: modelData === "SPACE" ? "Space" : modelData === "CLEAR" ? "Clear" : modelData === "DONE" ? "Done" : modelData
                }
            }
        }
    }

    function activate() {
        const value = keys[selectedIndex]
        if (value === "DONE") closed()
        else if (value === "⌫") accepted("\b")
        else accepted(value === "SPACE" ? " " : value)
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
