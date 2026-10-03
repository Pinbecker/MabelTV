import QtQuick

MyTvRoundedClip {
    id: artwork
    required property string artworkSource
    property string title: ""
    property bool crop: true
    property real focalX: 0.5
    property real focalY: 0.5
    property int attempts: 0
    property var queue: null
    property var queueJob: null
    property bool initialized: false
    property color color: "#e4e9ec"
    clip: true
    Rectangle { anchors.fill: parent; color: artwork.color }
    onArtworkSourceChanged: if (initialized) { attempts = 0; retry.stop(); load() }
    Component.onCompleted: { initialized = true; load() }
    Component.onDestruction: if (queue && queueJob) queue.release(queueJob)
    function load() {
        if (queue && queueJob) queue.release(queueJob)
        queueJob = null; picture.source = ""
        if (!artworkSource) return
        if (queue) queueJob = queue.enqueue(function() { picture.source = artwork.artworkSource })
        else picture.source = artworkSource
    }
    MyTvText {
        anchors.centerIn: parent
        width: parent.width * 0.8
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.WordWrap
        color: "#64727c"
        font.pixelSize: Math.max(16, parent.width * 0.09)
        text: artwork.title
        visible: picture.status !== Image.Ready
    }
    Image {
        id: picture
        readonly property real imageAspect: implicitWidth > 0 && implicitHeight > 0
            ? implicitWidth / implicitHeight : artwork.width / Math.max(1, artwork.height)
        width: artwork.crop ? Math.max(artwork.width, artwork.height * imageAspect) : artwork.width
        height: artwork.crop ? Math.max(artwork.height, artwork.width / imageAspect) : artwork.height
        x: (artwork.width - width) * Math.max(0, Math.min(1, artwork.focalX))
        y: (artwork.height - height) * Math.max(0, Math.min(1, artwork.focalY))
        sourceSize.width: Math.ceil(artwork.width * (artwork.crop ? 3 : 1))
        sourceSize.height: Math.ceil(artwork.height)
        asynchronous: true
        cache: true
        fillMode: artwork.crop ? Image.Stretch : Image.PreserveAspectFit
        onStatusChanged: {
            if (status === Image.Ready || status === Image.Error) {
                if (artwork.queue && artwork.queueJob) artwork.queue.release(artwork.queueJob)
                artwork.queueJob = null
            }
            if (status === Image.Error && artwork.attempts < 1) retry.restart()
        }
    }
    Timer {
        id: retry
        interval: 1500
        onTriggered: { artwork.attempts++; artwork.load() }
    }
}
