import QtQuick

// Optional artwork never delays the native channel schedule.
QtObject {
    id: directory
    objectName: "channelArtworkDirectory"
    property var channels: []
    property var pending: null
    property double updated: 0
    property string baseUrl: "http://127.0.0.1:8080"
    function refresh() {
        if (pending || Date.now() - updated < 30000) return
        const request = new XMLHttpRequest()
        pending = request
        request.open("GET", baseUrl + "/api/native/my-tv/mabel-channels")
        request.setRequestHeader("X-MabelTV-Native", "1")
        request.onreadystatechange = function() {
            if (request.readyState !== XMLHttpRequest.DONE || pending !== request) return
            pending = null
            if (request.status !== 200) return
            try { channels = JSON.parse(request.responseText).channels || []; updated = Date.now() } catch (_) {}
        }
        request.send(); deadline.restart()
    }
    function source(number) {
        const channel = channels.find(value => Number(value.channel_number) === Number(number))
        return channel?.poster_url ? baseUrl + channel.poster_url : ""
    }
    function focalX(name) {
        const positions = { "postman pat": 0.79, "puffin rock": 0.85, "zog": 0.85,
            "waffle dog": 0.53, "waffle the wonder dog": 0.53 }
        return positions[String(name).trim().toLowerCase()] ?? 0.5
    }
    property Timer deadline: Timer {
        interval: 5000
        onTriggered: if (directory.pending) {
            const request = directory.pending; directory.pending = null; request.abort()
        }
    }
    Component.onDestruction: if (pending) pending.abort()
}
