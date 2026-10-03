pragma ComponentBehavior: Bound
import QtQuick
import MabelTV 1.0

Item {
    id: dashboard
    required property var host
    required property var tvController
    readonly property real s: host.uiScale
    anchors.fill: parent
    visible: tvController.parentAccessState === TvController.ParentOpen
    Rectangle { anchors.fill: parent; color: "#f3f5f7" }
    FontLoader { source: "qrc:/fonts/inter/InterVariable.ttf" }
    Item {
        id: heading
        x: 72 * dashboard.s; y: 48 * dashboard.s
        width: parent.width - 144 * dashboard.s; height: 100 * dashboard.s
        Rectangle {
            width: 72 * dashboard.s; height: width; radius: 24 * dashboard.s; color: "#dff4ee"
            SignalIcon { anchors.centerIn: parent; width: 34 * dashboard.s; height: width; icon: "settings"; color: "#008b79" }
        }
        Column {
            x: 94 * dashboard.s; spacing: 5 * dashboard.s
            MyTvText { font.pixelSize: 17 * dashboard.s; font.weight: Font.DemiBold; color: "#008b79"; font.letterSpacing: 2 * dashboard.s; text: "MAKE YOURSELF AT HOME" }
            MyTvText { font.pixelSize: 44 * dashboard.s; font.weight: Font.Bold; font.letterSpacing: -1 * dashboard.s; text: "Settings" }
        }
        Row {
            anchors.right: parent.right; y: 24 * dashboard.s; spacing: 10 * dashboard.s
            SignalIcon { width: 22 * dashboard.s; height: width; icon: "circle-check"; color: "#008b79" }
            MyTvText { font.pixelSize: 18 * dashboard.s; color: "#647580"; text: "Changes saved automatically" }
        }
    }
    Row {
        id: tabs
        objectName: "settingsCategories"
        x: 72 * dashboard.s; y: 160 * dashboard.s
        width: parent.width - 144 * dashboard.s; height: 72 * dashboard.s
        spacing: 14 * dashboard.s
        Repeater {
            model: dashboard.host.navPages
            MyTvControl {
                id: tab
                required property string modelData
                required property int index
                width: (tabs.width - tabs.spacing * (dashboard.host.navPages.length - 1)) / dashboard.host.navPages.length
                height: tabs.height; uiScale: dashboard.s
                checked: dashboard.host.page === modelData
                highlighted: dashboard.host.sidebarFocused && dashboard.host.sidebarSelection === index
                Row {
                    anchors.centerIn: parent; spacing: 12 * dashboard.s
                    SignalIcon { width: 26 * dashboard.s; height: width; icon: dashboard.host.pageIconName(tab.modelData); color: "#17242d" }
                    MyTvText { font.pixelSize: 23 * dashboard.s; font.weight: Font.DemiBold; text: dashboard.host.pageLabel(tab.modelData) }
                }
            }
        }
    }
    Item {
        id: body
        x: tabs.x; y: tabs.y + tabs.height + 32 * dashboard.s
        width: tabs.width; height: parent.height - y - 90 * dashboard.s
        opacity: dashboard.host.sidebarFocused ? 0.76 : 1
        Behavior on opacity { NumberAnimation { duration: 110 } }
        ParentChannelSettings {
            anchors.fill: parent
            visible: dashboard.host.page === "channels"
            host: dashboard.host; tvController: dashboard.tvController
        }
        ListView {
            id: settings
            objectName: "settingsRows"
            visible: dashboard.host.page !== "channels"
            width: parent.width * 0.65; height: parent.height
            clip: true; interactive: false; boundsBehavior: Flickable.StopAtBounds
            spacing: 12 * dashboard.s
            model: dashboard.host.rowsForPage(dashboard.host.page)
            currentIndex: dashboard.host.selectedRow
            onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)
            delegate: MyTvControl {
                id: setting
                required property int modelData
                required property int index
                readonly property bool toggle: modelData === 7 || modelData === 9 || modelData === 10
                readonly property bool slider: modelData === 4 || modelData === 5 || modelData === 8
                readonly property bool adjustable: modelData <= 10
                width: settings.width; height: 104 * dashboard.s; uiScale: dashboard.s
                highlighted: !dashboard.host.sidebarFocused && index === dashboard.host.selectedRow
                MyTvText {
                    x: 26 * dashboard.s; anchors.verticalCenter: parent.verticalCenter
                    width: parent.width * 0.52; elide: Text.ElideRight
                    font.pixelSize: 24 * dashboard.s; font.weight: Font.DemiBold
                    text: dashboard.host.labelForRow(setting.modelData)
                }
                Row {
                    anchors.right: parent.right; anchors.rightMargin: 24 * dashboard.s
                    anchors.verticalCenter: parent.verticalCenter; spacing: 14 * dashboard.s
                    SignalIcon { visible: setting.adjustable && !setting.toggle; anchors.verticalCenter: parent.verticalCenter; width: 22 * dashboard.s; height: width; icon: "chevron-left"; color: setting.highlighted ? "#008b79" : "#8b9ba3" }
                    Rectangle {
                        visible: setting.toggle
                        width: 68 * dashboard.s; height: 36 * dashboard.s; radius: height / 2
                        color: dashboard.host.valueForRow(setting.modelData) === "On" ? "#04c6a8" : "#d6dfe3"
                        Rectangle {
                            x: dashboard.host.valueForRow(setting.modelData) === "On" ? parent.width - width - 5 * dashboard.s : 5 * dashboard.s
                            y: 5 * dashboard.s; width: 26 * dashboard.s; height: width; radius: width / 2; color: "white"
                            Behavior on x { NumberAnimation { duration: 130 } }
                        }
                    }
                    Rectangle {
                        visible: setting.slider
                        anchors.verticalCenter: parent.verticalCenter
                        width: 130 * dashboard.s; height: 7 * dashboard.s; radius: height / 2; color: "#dbe5e8"
                        Rectangle { width: parent.width * dashboard.host.sliderValueForRow(setting.modelData) / 100; height: parent.height; radius: parent.radius; color: "#04c6a8" }
                    }
                    MyTvText {
                        visible: !setting.toggle
                        anchors.verticalCenter: parent.verticalCenter
                        width: setting.slider ? 60 * dashboard.s : 320 * dashboard.s
                        horizontalAlignment: Text.AlignHCenter; elide: Text.ElideRight
                        font.pixelSize: 22 * dashboard.s; font.weight: Font.DemiBold; color: "#008b79"
                        text: dashboard.host.valueForRow(setting.modelData)
                    }
                    SignalIcon { visible: !setting.toggle; anchors.verticalCenter: parent.verticalCenter; width: 22 * dashboard.s; height: width; icon: "chevron-right"; color: setting.highlighted ? "#008b79" : "#8b9ba3" }
                }
            }
        }
        Rectangle {
            visible: dashboard.host.page !== "channels"
            x: parent.width * 0.65 + 26 * dashboard.s
            width: parent.width - x; height: parent.height; radius: 24 * dashboard.s
            color: "#e8efef"
            Column {
                x: 34 * dashboard.s; y: 34 * dashboard.s; width: parent.width - 68 * dashboard.s
                spacing: 22 * dashboard.s
                SignalIcon { width: 40 * dashboard.s; height: width; icon: dashboard.host.pageIconName(dashboard.host.page); color: "#008b79" }
                MyTvText { width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 32 * dashboard.s; font.weight: Font.Bold; text: dashboard.host.labelForRow(dashboard.host.rowsForPage(dashboard.host.page)[dashboard.host.selectedRow]) }
                MyTvText { width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 23 * dashboard.s; lineHeight: 1.35; color: "#647580"; text: dashboard.host.descriptionForRow(dashboard.host.rowsForPage(dashboard.host.page)[dashboard.host.selectedRow]) }
                MyTvText { width: parent.width; wrapMode: Text.WordWrap; font.pixelSize: 19 * dashboard.s; color: "#008b79"; text: dashboard.host.page === "system" ? dashboard.tvController.libraryStatus : "Applies to this television. Your library and viewing progress stay in place." }
            }
        }
    }
    Row {
        x: 72 * dashboard.s; y: parent.height - 54 * dashboard.s; spacing: 12 * dashboard.s
        SignalIcon { width: 20 * dashboard.s; height: width; icon: "chevron-left"; color: "#647580" }
        MyTvText { font.pixelSize: 18 * dashboard.s; color: "#647580"; text: dashboard.host.sidebarFocused ? "Back to television" : "Back to categories" }
    }
    MyTvText {
        x: parent.width * 0.5; y: parent.height - 54 * dashboard.s; width: parent.width * 0.5 - 72 * dashboard.s
        horizontalAlignment: Text.AlignRight; elide: Text.ElideRight
        font.pixelSize: 18 * dashboard.s; color: "#008b79"; text: dashboard.tvController.parentMessage
    }
}
