pragma ComponentBehavior: Bound
import QtQuick

Item {
    id: stage
    objectName: "storytimeStage"
    property string childName: "Mabel"
    property string storyTitle: ""
    property string storyId: ""
    property url illustration: ""
    property var stories: []
    property string catalogueStatus: ""
    property real uiScale: Math.max(.5, Math.min(width / 1920, height / 1080))
    property bool browsing: false
    property bool returning: false
    property bool lifting: false
    property real dockProgress: 0
    readonly property bool revealed: book.revealed
    readonly property bool transitioning: returning || lifting || dock.running
    readonly property real readingHeight: Math.min(height * .64, width * .80 / 1.4)
    readonly property real readingWidth: readingHeight * 1.4
    readonly property var dockRect: library.targetRect()
    signal openingFinished()
    signal returned()
    signal chosen(string identity)
    signal exited()
    signal previewSound()
    signal stopPreviewSound()
    function reset() {
        dock.stop(); lift.stop(); openingDelay.stop(); book.reset()
        browsing = false; returning = false; lifting = false; dockProgress = 0
        library.dockingStory = ""; library.previewsEnabled = false
    }
    function holdLibrary() {
        reset(); browsing = true; library.previewsEnabled = false
    }
    function open() {
        const fromShelf = browsing && stories.some(value => value.id === storyId)
        reset(); library.selectStory(storyId)
        if (fromShelf) {
            dockProgress = 1; lifting = true; library.dockingStory = storyId
            lift.restart()
        } else openingDelay.restart()
    }
    function finish() {
        openingDelay.stop(); lift.stop(); lifting = false; dockProgress = 0
        library.dockingStory = ""; book.finish()
    }
    function showLibrary(animate) {
        openingDelay.stop(); lift.stop(); lifting = false
        stopPreviewSound(); library.selectStory(storyId)
        if (animate) {
            returning = true; library.previewsEnabled = false
            library.dockingStory = storyId; book.closeBook()
        } else {
            reset(); browsing = true; library.previewsEnabled = true
        }
    }
    function navigate(direction) { if (returning) back(); library.navigate(direction) }
    function select() { if (!transitioning) library.select() }
    function back() {
        if (returning) { book.reset(); dock.complete(); browsing = true; returning = false; library.dockingStory = ""; library.previewsEnabled = true; returned() }
        else library.back()
    }
    StorytimeLibrary {
        id: library; anchors.fill: parent; childName: stage.childName; stories: stage.stories
        catalogueStatus: stage.catalogueStatus
        opacity: stage.browsing ? 1 : stage.dockProgress
        visible: stage.browsing || stage.returning || stage.lifting
        onChosen: identity => stage.chosen(identity)
        onExited: stage.exited()
        onPreviewSound: stage.previewSound()
        onStopPreviewSound: stage.stopPreviewSound()
    }
    Storybook {
        id: book
        x: (stage.width - stage.readingWidth) / 2 * (1 - stage.dockProgress) + stage.dockRect.x * stage.dockProgress
        y: ((stage.height - stage.readingHeight) / 2 - 60 * stage.uiScale) * (1 - stage.dockProgress) + stage.dockRect.y * stage.dockProgress
        width: stage.readingWidth * (1 - stage.dockProgress) + stage.dockRect.width * stage.dockProgress
        height: stage.readingHeight * (1 - stage.dockProgress) + stage.dockRect.height * stage.dockProgress
        childName: stage.childName; storyTitle: stage.storyTitle; illustration: stage.illustration
        coverIndex: Math.max(0, stage.stories.findIndex(value => value.id === stage.storyId))
        coverTitle: stage.storyTitle
        coverFontSize: 51 + 15 * stage.dockProgress
        visible: !stage.browsing || stage.returning
        onOpeningChanged: { if (opening) pageTurnSound.restart(); else pageTurnSound.stop() }
        onOpeningFinished: if (!stage.returning && !stage.browsing) stage.openingFinished()
        onClosingFinished: if (stage.returning) {
            dock.from = stage.dockProgress
            dock.duration = Math.max(180, 780 * (1 - stage.dockProgress))
            dock.restart()
        }
    }
    Timer { id: openingDelay; interval: 500; onTriggered: book.opened = true }
    Timer {
        id: pageTurnSound; interval: Math.round(book.openingDuration * .57)
        onTriggered: if (!stage.returning && !stage.browsing) stage.previewSound()
    }
    NumberAnimation {
        id: lift; target: stage; property: "dockProgress"; from: 1; to: 0
        duration: 900; easing.type: Easing.InOutCubic
        onFinished: {
            stage.lifting = false; library.dockingStory = ""
            openingDelay.restart()
        }
    }
    NumberAnimation {
        id: dock; target: stage; property: "dockProgress"; from: 0; to: 1
        duration: 780; easing.type: Easing.InOutCubic
        onFinished: {
            stage.browsing = true; stage.returning = false
            library.dockingStory = ""; library.previewsEnabled = true; stage.returned()
        }
    }
}
