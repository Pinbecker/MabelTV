import QtQuick

QtObject {
    id: family
    required property var host
    property var directory: null
    property double directoryUpdated: 0
    property var directoryRequest: null
    property var channelRequest: null
    property int generation: 0
    property var channelCache: ({})
    property var privateState: null
    property var directoryState: null

    function snapshot() {
        return { row: host.selectedRow, card: host.selectedCard, key: host.currentItem()?.key,
            zone: host.selectedZone, shortcut: host.selectedShortcut, query: host.query,
            scroll: host.browseContentY, rows: host.rowSelections, sections: host.sectionSelections }
    }
    function restore(state) {
        host.selectedRow = Math.max(0, Math.min(state?.row || 0, host.rows.length - 1))
        host.selectedCard = Math.max(0, Math.min(state?.card || 0, host.currentItems().length - 1))
        if (state?.key) for (let row = 0; row < host.rows.length; row++) {
            const card = host.rows[row].items.findIndex(item => item.key === state.key)
            if (card >= 0) { host.selectedRow = row; host.selectedCard = card; break }
        }
        host.selectedZone = state?.zone ?? 1; host.selectedShortcut = state?.shortcut ?? 1
        host.rowSelections = state?.rows || {}; host.sectionSelections = state?.sections || {}
        const token = generation
        Qt.callLater(function() { if (token === family.generation) family.host.browseContentY = state?.scroll || 0 })
    }
    function cancelChannel() {
        generation++
        if (channelRequest) channelRequest.abort()
        channelRequest = null; host.loading = false
    }
    function prefetch() {
        if (directoryRequest || directory && Date.now() - directoryUpdated < 30000) return
        directoryRequest = host.request("/api/native/my-tv/mabel-channels", "GET", null, result => {
            directory = result.channels || []; directoryUpdated = Date.now(); directoryRequest = null
            if (host.mabelVisible && !host.mabelChannel) {
                if (host.rows.length) directoryState = snapshot()
                showDirectory()
            }
        }, message => {
            directoryRequest = null
            if (host.mabelVisible && !host.mabelChannel) { host.loading = false; host.notify(message) }
        })
    }
    function enter() {
        privateState = snapshot(); directoryState = null
        host.homeGeneration++
        if (host.activeHomeRequest) host.activeHomeRequest.abort()
        host.activeHomeRequest = null
        if (host.activeBackdropRequest) host.activeBackdropRequest.abort()
        host.activeBackdropRequest = null
        host.mabelVisible = true; host.query = ""
        showDirectory(); prefetch()
    }
    function showDirectory() {
        const wasFilmGrid = host.mabelChannel?.content_type === "films"
        const wasChannel = Boolean(host.mabelChannel)
        cancelChannel(); host.closeDetail(); host.mabelChannel = null; host.mabelItems = []
        host.query = directoryState?.query || ""
        if (directory === null) { host.rows = []; host.loading = true; prefetch(); return }
        host.mabelChannels = directory
        // Episode detail lives directly over the directory: keep its delegates and artwork warm.
        if (!wasChannel || wasFilmGrid) host.rebuildRows()
        restore(directoryState)
        prefetch()
    }
    function leave() {
        cancelChannel(); host.closeDetail(); host.mabelVisible = false; host.mabelChannel = null
        host.query = privateState?.query || ""; host.rebuildRows(); restore(privateState)
    }
    function openChannel(channel, refresh) {
        if (!host.mabelChannel) directoryState = snapshot()
        cancelChannel()
        const token = generation
        const sameDetail = host.detailVisible && !host.familyDetailLoading()
            && host.mabelChannel?.channel_number === channel.channel_number
        host.mabelChannel = channel; host.query = ""
        const series = channel.content_type !== "films"
        if (series && !sameDetail) {
            host.detailVisible = true
            host.openFamilyDetail(Object.assign({}, channel, { media_type: "tv", borrowed: true, on_mabeltv: true }))
        }
        const cached = channelCache[channel.channel_number]
        if (!refresh && cached && Date.now() - cached.updated < 30000) { apply(channel, cached.value, sameDetail); return }
        host.loading = true
        channelRequest = host.request("/api/native/my-tv/mabel-channel?number=" + channel.channel_number, "GET", null, result => {
            if (token !== generation || !host.mabelVisible) return
            channelRequest = null
            const cache = Object.assign({}, channelCache, { [channel.channel_number]: { updated: Date.now(), value: result } })
            const oldest = Object.keys(cache).sort((left, right) => cache[left].updated - cache[right].updated)
            while (oldest.length > 6) delete cache[oldest.shift()]
            channelCache = cache
            apply(channel, result, sameDetail)
        }, message => {
            if (token !== generation) return
            channelRequest = null; host.loading = false
            host.failFamilyDetail(message)
        })
    }
    function apply(channel, result, sameDetail) {
        host.mabelItems = result.items || []; host.loading = false
        if (result.content_type !== "films") {
            const resume = host.mabelItems.find(value => value.remote_position >= 30) || host.mabelItems[0]
            const detail = Object.assign({}, channel, { borrowed: true, on_mabeltv: true, media_type: "tv",
                overview: result.overview || "Choose an episode to watch without the television frame.",
                local: { id: channel.channel_number, kind: "mabel" }, local_episodes: host.mabelItems,
                next_playable: resume, progress: { episode: resume, position: resume?.remote_position || 0 },
                seasons: [...new Set(host.mabelItems.map(value => value.season))].map(number => ({ number: number, name: "Season " + number })) })
            host.updateFamilyDetail(detail, sameDetail)
        } else {
            if (!sameDetail) { host.selectedRow = 0; host.selectedCard = 0; host.selectedZone = 1 }
            host.rebuildRows()
            if (!sameDetail) host.browseContentY = 0
            else {
                const value = host.mabelItems.find(item => item.key === host.familyDetailKey())
                if (value) host.updateFamilyDetail(value, true)
            }
        }
    }
}
