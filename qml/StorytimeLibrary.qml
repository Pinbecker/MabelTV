pragma ComponentBehavior: Bound
import QtQuick

Item {
    id: library
    objectName: "storytimeLibrary"
    property var stories: []
    property string catalogueStatus: ""
    property string childName: "Mabel"
    property int selectedIndex: 0
    property string selectedIdentity: ""
    property bool headerSelected: false
    property bool previewsEnabled: true
    property string dockingStory: ""
    property real uiScale: Math.max(.5, Math.min(width / 1920, height / 1080))
    readonly property int columns: 4
    readonly property int page: Math.floor(selectedIndex / 8)
    readonly property int pageCount: Math.max(1, Math.ceil(stories.length / 8))
    readonly property var selectedStory: stories[selectedIndex] || ({})
    readonly property real cellWidth: (width - 160 * uiScale) / columns
    signal chosen(string identity)
    signal exited()
    signal previewSound()
    signal stopPreviewSound()
    function selectStory(identity) {
        const index = stories.findIndex(value => value.id === identity)
        selectedIndex = Math.max(0, index); headerSelected = false
        selectedIdentity = String(stories[selectedIndex]?.id || "")
    }
    function targetRect() {
        const slot = selectedIndex % 8
        const bookHeight = 270 * uiScale, bookWidth = bookHeight * 1.4
        const emphasis = headerSelected ? 1 : 1.035
        return { x: 80 * uiScale + (slot % 4) * cellWidth + (cellWidth - bookWidth * emphasis) / 2,
            y: 188 * uiScale + Math.floor(slot / 4) * 380 * uiScale + (190 - 154 * emphasis) * uiScale,
            width: bookWidth * emphasis, height: bookHeight * emphasis }
    }
    function navigate(direction) {
        stopPreviewSound()
        previewsEnabled = true
        if (!stories.length) { headerSelected = true; return }
        if (headerSelected) { if (direction === "down") headerSelected = false; return }
        if (direction === "up" && selectedIndex % 8 < 4) { headerSelected = true; return }
        const step = direction === "left" ? -1 : direction === "right" ? 1 : direction === "up" ? -4 : 4
        selectedIndex = Math.max(0, Math.min(stories.length - 1, selectedIndex + step))
    }
    function select() {
        stopPreviewSound()
        if (headerSelected) { exited(); return }
        if (selectedStory.ready) chosen(String(selectedStory.id))
    }
    function back() {
        // Back is safe even after a repeated accidental press: it only closes
        // the preview. Returning to television requires the labelled action.
        stopPreviewSound(); previewsEnabled = false; headerSelected = false
    }
    onSelectedIndexChanged: selectedIdentity = String(stories[selectedIndex]?.id || "")
    onStoriesChanged: {
        const index = stories.findIndex(value => value.id === selectedIdentity)
        selectedIndex = index >= 0 ? index : Math.max(0, Math.min(selectedIndex, stories.length - 1))
        selectedIdentity = String(stories[selectedIndex]?.id || "")
    }
    FontLoader { id: lettering; source: "qrc:/fonts/storytime/CinzelDecorative-Bold.ttf" }
    FontLoader { source: "qrc:/fonts/inter/InterVariable.ttf" }
    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            GradientStop { position: 0; color: "#d91b281f" }
            GradientStop { position: .38; color: "#64302d24" }
            GradientStop { position: 1; color: "#b916221b" }
        }
    }
    Text {
        x: 100 * library.uiScale; y: 49 * library.uiScale
        text: library.childName + "’s Storytime"; color: "#f3dba1"
        font.family: lettering.status === FontLoader.Ready ? lettering.name : "DejaVu Serif"
        font.pixelSize: 54 * library.uiScale; style: Text.Raised; styleColor: "#16291e"
    }
    MyTvText {
        x: 104 * library.uiScale; y: 125 * library.uiScale
        text: "Choose a book. There’s a little adventure inside."
        color: "#d7d1b9"; font.pixelSize: 23 * library.uiScale
    }
    MyTvControl {
        x: library.width - width - 100 * library.uiScale; y: 67 * library.uiScale
        width: 208 * library.uiScale; height: 60 * library.uiScale; uiScale: library.uiScale
        highlighted: library.headerSelected
        MyTvText { anchors.centerIn: parent; text: library.childName + " TV"; color: "#244b3d"; font.pixelSize: 22 * library.uiScale; font.weight: Font.DemiBold }
        MouseArea { anchors.fill: parent; onClicked: library.exited() }
    }
    Repeater {
        model: Math.min(8, Math.max(0, library.stories.length - library.page * 8))
        StorytimeBookCard {
            required property int index
            readonly property int storyIndex: library.page * 8 + index
            objectName: "storytimeBookCard" + storyIndex
            story: library.stories[storyIndex] || ({})
            childName: library.childName
            coverIndex: storyIndex
            selected: library.selectedIndex === storyIndex && !library.headerSelected
            revealEnabled: library.previewsEnabled && library.visible && !library.dockingStory.length
            docking: library.dockingStory === story.id
            uiScale: library.uiScale
            x: 80 * library.uiScale + (index % 4) * library.cellWidth
            y: 188 * library.uiScale + Math.floor(index / 4) * 380 * library.uiScale
            width: library.cellWidth; height: 380 * library.uiScale
            onActivated: {
                library.selectedIndex = storyIndex; library.headerSelected = false; library.select()
            }
            onRustled: if (selected && revealEnabled) library.previewSound()
        }
    }
    MyTvText {
        visible: library.stories.length === 0; anchors.centerIn: parent
        text: library.catalogueStatus || "Your next adventure is waiting.\nAdd a story in the portal to put its book here."
        width: parent.width * .7; wrapMode: Text.WordWrap
        color: "#f1e4bd"; font.pixelSize: 29 * library.uiScale
        horizontalAlignment: Text.AlignHCenter; lineHeight: 1.5
    }
    MyTvText {
        x: 104 * library.uiScale; y: library.height - 59 * library.uiScale
        text: library.stories.length === 1 ? "One little adventure" : library.stories.length + " little adventures"
        color: "#c5c2ad"; font.pixelSize: 18 * library.uiScale
    }
    Row {
        anchors.horizontalCenter: parent.horizontalCenter; y: library.height - 48 * library.uiScale
        spacing: 14 * library.uiScale; visible: library.pageCount > 1
        Repeater {
            model: library.pageCount
            Rectangle {
                required property int index
                width: library.page === index ? 32 * library.uiScale : 9 * library.uiScale
                height: 9 * library.uiScale; radius: height / 2
                color: library.page === index ? "#e2c885" : "#787965"
                Behavior on width { NumberAnimation { duration: 200 } }
            }
        }
    }
}
