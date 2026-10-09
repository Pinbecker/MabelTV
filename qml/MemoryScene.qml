pragma ComponentBehavior: Bound
import QtQuick

Item {
    id: spread
    property var scene: ({ items: [] })
    property real progress: 0
    property real entrance: 1
    readonly property real uiScale: Math.max(.5, Math.min(width / 1920, height / 1080))
    readonly property var items: scene.items || []
    readonly property int videoIndex: Number(scene.video_index ?? (scene.kind === "video" ? 0 : -1))
    readonly property var videoGeometry: fittedFrame(videoIndex)
    function slot(index) {
        const frames = width < height ? scene.portrait_frames : scene.frames
        if (frames && frames[index]) return frames[index]
        const count = Math.max(1, items.length)
        return { x: .05 + index * .9 / count, y: .07, width: .9 / count - (count > 1 ? .025 : 0), height: .86, tilt: 0, direction: 1 }
    }
    function fittedFrame(index) {
        const asset = items[index]
        if (!asset) return { x: 0, y: 0, width: 2, height: 2, rotation: 0, scale: 1 }
        const placement = slot(index)
        const ratio = Number(asset.width || 1200) / Math.max(1, Number(asset.height || 800))
        const w = Math.min(placement.width * width, placement.height * height * ratio) * .988
        const arrival = Math.max(0, Math.min(1, (entrance - index * .075) / (1 - index * .075)))
        return { x: (placement.x + placement.width / 2) * width - w / 2 + Number(placement.direction || 1) * (progress - .5) * 8 * uiScale,
                 y: (placement.y + placement.height / 2) * height - w / ratio / 2 + ((1 - arrival) * (16 + index * 5) + (progress - .5) * (index % 2 ? -5 : 5)) * uiScale,
                 width: w, height: w / ratio, rotation: Number(placement.tilt || 0) * (1 - progress * .35),
                 scale: .985 + .012 * progress + .003 * arrival }
    }
    Image {
        anchors.fill: parent; visible: spread.items.length > 0
        source: spread.items[0]?.artwork || (spread.items[0]?.kind === "video" ? "" : spread.items[0]?.source || ""); fillMode: Image.PreserveAspectCrop
        opacity: .14; asynchronous: true; sourceSize.width: 960; sourceSize.height: 540
    }
    Rectangle { anchors.fill: parent; color: "#680b151d"; visible: spread.items.length > 0 }
    Repeater {
        model: Math.min(3, spread.items.length)
        Item {
            id: box
            required property int index
            readonly property var asset: spread.items[index]
            readonly property var placement: spread.slot(index)
            readonly property var fitted: spread.fittedFrame(index)
            readonly property real ratio: Number(asset.width || 1200) / Math.max(1, Number(asset.height || 800))
            readonly property real arrival: Math.max(0, Math.min(1, (spread.entrance - index * .075) / (1 - index * .075)))
            x: placement.x * spread.width; y: placement.y * spread.height
            width: placement.width * spread.width; height: placement.height * spread.height
            opacity: arrival
            Item {
                id: photo
                objectName: "memoryPhotoFrame"
                x: box.fitted.x - box.x; y: box.fitted.y - box.y
                width: box.fitted.width; height: box.fitted.height
                rotation: box.fitted.rotation; scale: box.fitted.scale
                Rectangle {
                    x: -8 * spread.uiScale; y: 9 * spread.uiScale
                    width: parent.width + 16 * spread.uiScale; height: parent.height + 10 * spread.uiScale
                    radius: 12 * spread.uiScale; color: "#44000000"
                }
                Rectangle {
                    anchors.fill: parent; radius: 5 * spread.uiScale
                    color: "#172029"; border.color: "#60ffffff"; border.width: spread.uiScale
                }
                Image {
                    objectName: "memoryWholePhoto"
                    anchors.fill: parent; anchors.margins: 2 * spread.uiScale
                    source: box.index === spread.videoIndex ? box.asset.artwork || "" : box.asset.source || ""; fillMode: Image.PreserveAspectFit
                    asynchronous: true; cache: true
                    sourceSize.width: Math.ceil(photo.width); sourceSize.height: Math.ceil(photo.height)
                }
            }
        }
    }
    Text {
        anchors.bottom: parent.bottom; anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottomMargin: 10 * spread.uiScale
        text: spread.scene.caption || ""; color: "#c6d4dd"; opacity: .75
        font.family: "Inter"; font.pixelSize: 17 * spread.uiScale; font.letterSpacing: 2 * spread.uiScale
    }
}
