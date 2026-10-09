import QtQuick

QtObject {
    id: catalogue
    property var stories: []
    property url pageSound: ""
    property bool loading: false
    property string error: ""
    property int generation: 0
    property var pending: null
    property var deadline: Timer {
        interval: 10000
        onTriggered: { catalogue.cancel(); catalogue.error = "Your books could not be refreshed. Try opening Storytime again." }
    }
    function cancel() {
        generation++; deadline.stop()
        if (pending) pending.abort()
        pending = null; loading = false
    }
    function includeCurrent(session) {
        if (!session.story_id || stories.some(story => story.id === session.story_id)) return
        stories = [...stories, { id: session.story_id, title: session.title, ready: true,
            position: session.position || 0, illustration: session.scenes?.[0]?.items?.[0]?.source || "" }]
            .sort((left, right) => {
                const key = value => value.title.trim().replace(/^(the|a)\s+/i, "").toLowerCase()
                return key(left).localeCompare(key(right)) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id)
            })
    }
    function refresh() {
        cancel(); error = ""; loading = true
        const requestGeneration = generation
        const xhr = new XMLHttpRequest(); pending = xhr
        xhr.open("GET", "http://127.0.0.1:8080/api/native/family-media/stories")
        xhr.setRequestHeader("X-MabelTV-Native", "1")
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE || requestGeneration !== catalogue.generation) return
            catalogue.deadline.stop(); catalogue.pending = null; catalogue.loading = false
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const value = JSON.parse(xhr.responseText)
                    catalogue.stories = value.stories || []; catalogue.pageSound = value.page_sound || ""
                } catch (failure) { catalogue.error = "Your books could not be refreshed." }
            } else catalogue.error = "Your books could not be refreshed. Try opening Storytime again."
        }
        deadline.restart(); xhr.send()
    }
}
