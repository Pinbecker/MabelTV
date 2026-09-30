import QtQuick

Rectangle {
    color: "#082b29"
    Column {
        anchors.centerIn: parent
        spacing: 22
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "All done!"
            color: "#f7fffc"
            font.pixelSize: 72
            font.bold: true
        }
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "Time to turn the telly off."
            color: "#c3e6df"
            font.pixelSize: 32
        }
    }
}
