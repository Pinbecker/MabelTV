pragma ComponentBehavior: Bound
import QtQuick

Item {
    id: row
    required property var host
    required property var rowData
    required property int rowIndex
    readonly property real uiScale: host.uiScale
    readonly property bool wide: Boolean(rowData.wide)
    readonly property real headingHeight: rowData.title ? 44 * uiScale : 0
    height: headingHeight + (wide ? 225 : 510) * uiScale
    MyTvText {
        width: parent.width
        color: "#151e26"
        font.pixelSize: 30 * row.uiScale
        font.weight: Font.DemiBold
        text: row.rowData.title || ""
    }
    ListView {
        id: cards
        y: row.headingHeight
        width: parent.width
        height: parent.height - y
        orientation: ListView.Horizontal
        spacing: 22 * row.uiScale
        clip: true
        cacheBuffer: 100 * row.uiScale
        model: row.rowData.items
        currentIndex: row.host.selectedRow === row.rowIndex ? row.host.selectedCard : 0
        onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)
        delegate: MyTvCard {
            required property int index
            host: row.host
            modelData: cards.model[index]
            width: row.wide ? 380 * row.uiScale : (cards.width - 5 * cards.spacing) / 6
            height: cards.height
            wide: row.wide
            selected: row.host.selectedZone === 1 && row.host.selectedRow === row.rowIndex
                      && row.host.selectedCard === index
        }
    }
}
