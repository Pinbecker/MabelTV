pragma ComponentBehavior: Bound
import QtQuick

Item {
    id: stage
    property var scene: ({ "items": [] })
    property var previousScene: ({ "items": [] })
    property bool paused: false
    property real drift: 0
    property real previousDrift: 0
    property real reveal: 1
    property string transitionStyle: "dissolve"
    readonly property real uiScale: Math.max(.5, Math.min(width / 1920, height / 1080))
    readonly property var videoGeometry: {
        const frame = currentScene.videoGeometry
        return { x: frame.x + (transitionStyle === "glide" ? 100 * uiScale * (1 - reveal) : 0),
                 y: frame.y + (transitionStyle === "rise" ? 70 * uiScale * (1 - reveal) : 0),
                 width: frame.width, height: frame.height, rotation: frame.rotation, scale: frame.scale }
    }

    function reset() {
        movement.stop(); transition.stop()
        scene = { items: [] }; previousScene = { items: [] }; drift = 0; reveal = 1
    }

    function present(value) {
        movement.stop(); transition.stop()
        previousScene = scene; previousDrift = drift; scene = value
        transitionStyle = value.transition || "dissolve"
        reveal = 0; drift = 0
        transition.restart(); movement.restart()
    }
    NumberAnimation {
        id: movement; target: stage; property: "drift"; from: 0; to: 1
        duration: Math.max(5000, Number(stage.scene.seconds || 10) * 1000)
        easing.type: Easing.InOutSine; paused: running && stage.paused
    }
    NumberAnimation {
        id: transition
        target: stage; property: "reveal"; from: 0; to: 1; duration: 1200
        easing.type: Easing.InOutCubic; paused: running && stage.paused
        onFinished: stage.previousScene = { items: [] }
    }
    MemoryScene {
        anchors.fill: parent; scene: stage.previousScene; progress: stage.previousDrift
        opacity: 1 - stage.reveal
        transform: Translate {
            x: stage.transitionStyle === "glide" ? -100 * stage.uiScale * stage.reveal : 0
            y: stage.transitionStyle === "rise" ? -55 * stage.uiScale * stage.reveal : 0
        }
    }
    MemoryScene {
        id: currentScene
        anchors.fill: parent; scene: stage.scene; progress: stage.drift; entrance: stage.reveal
        opacity: stage.reveal
        transform: Translate {
            x: stage.transitionStyle === "glide" ? 100 * stage.uiScale * (1 - stage.reveal) : 0
            y: stage.transitionStyle === "rise" ? 70 * stage.uiScale * (1 - stage.reveal) : 0
        }
    }
}
