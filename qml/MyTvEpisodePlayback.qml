pragma ComponentBehavior: Bound
import QtQuick

// Owns series context and serialised handoff; it never opens a second decoder.
Item {
    id: sequence
    required property var host
    required property var library
    property var current: null
    property var pending: null
    property int generation: 0
    property bool completing: false
    property bool promptDismissed: false
    property bool promptSelected: false
    readonly property var nextEpisode: findNext(current)
    readonly property bool promptVisible: host.playing && !host.stopping
        && !promptDismissed && nextEpisode !== null && host.playbackDuration >= 60
        && host.playbackPosition >= Math.max(30, host.playbackDuration - 45)
    readonly property string episodeLabel: current?.series
        ? "Season " + current.season + " \u00b7 Episode " + current.number
            + (current.episodeTitle ? " \u00b7 " + current.episodeTitle : "") : ""
    onPromptVisibleChanged: if (promptVisible) promptSelected = !host.scrubberActive

    function findNext(item) {
        if (!item?.series) return null
        const episodes = (item.series.episodes || []).filter(value => value.source && value.library_id)
            .slice().sort((a, b) => a.season - b.season || a.number - b.number)
        const index = episodes.findIndex(value => value.library_id === item.id)
        if (index < 0 || index + 1 >= episodes.length) return null
        const next = episodes[index + 1]
        return { id: next.library_id, source: next.source, series: item.series,
            mabel: next.mabel,
            season: next.season, number: next.number, episodeTitle: next.name,
            name: item.series.title + " · S" + next.season + " E" + next.number,
            poster_url: next.poster_url || "", remote_position: next.remote_position || 0 }
    }
    function begin(item) {
        cancel()
        current = item?.series ? item : null
        promptDismissed = false
    }
    function cancel() {
        generation++; handoff.stop(); pending = null; completing = false
        current = null; promptSelected = false; promptDismissed = true
    }
    function fail(message) {
        cancel(); host.playing = false; host.stopping = false
        host.errorMessage = message; library.notify(message); library.loadHome()
    }
    function saveCompletion(after) {
        if (!current?.series || completing) return
        completing = true
        const token = generation
        const item = current
        if (item.series.domain === "mabel") {
            completing = false; host.controller.setMyTvPlaybackPosition(item.id, 0); after(); return
        }
        library.request("/api/native/my-tv/episode-complete", "POST",
            { series_id: item.series.id, library_id: item.id }, result => {
                if (token !== generation) return
                completing = false
                host.controller.setMyTvPlaybackPosition(item.id, 0)
                after()
            }, message => { if (token === generation) fail(message) })
    }
    function startPending() {
        if (pending && !host.closing) handoff.restart()
        else {
            host.playing = false; host.stopping = false
            library.loadHome()
        }
    }
    function finished() {
        if (!current?.series || host.closing) return false
        host.stopping = true; pending = nextEpisode
        saveCompletion(() => startPending())
        return true
    }
    function skip() {
        if (!nextEpisode || pending || completing || host.stopping) return false
        pending = nextEpisode
        // A deliberate skip only counts as watched inside the end-of-episode prompt.
        pending = Object.assign({}, pending, { completePrevious: promptVisible })
        promptSelected = false
        host.stopFilm()
        return true
    }
    function stopped() {
        if (!pending || host.closing) return false
        if (pending.completePrevious) saveCompletion(() => startPending())
        else startPending()
        return true
    }
    function handleKey(key, repeat) {
        if (!promptVisible || repeat) return false
        if (host.isBackKey(key) && !host.scrubberActive) {
            promptDismissed = true; promptSelected = false; return true
        }
        if (key === Qt.Key_Up && !host.scrubberActive) {
            promptSelected = true; return true
        }
        if (!promptSelected) return false
        if (key === Qt.Key_Return || key === Qt.Key_Enter) { skip(); return true }
        if (key === Qt.Key_Down) {
            promptSelected = false; host.openScrubber(); return true
        }
        if (key === Qt.Key_Left || key === Qt.Key_Right) {
            promptSelected = false; return false
        }
        return false
    }
    Timer {
        id: handoff
        interval: 350
        onTriggered: {
            if (!sequence.pending || sequence.host.closing) return
            const next = sequence.pending
            sequence.pending = null
            sequence.host.startNativePlayback(next, 0)
        }
    }
}
