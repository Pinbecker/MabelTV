import QtQuick

Image {
    required property string name
    source: "qrc:/icons/my-tv/" + name + ".svg"
    fillMode: Image.PreserveAspectFit
    sourceSize.width: Math.ceil(width)
    sourceSize.height: Math.ceil(height)
}
