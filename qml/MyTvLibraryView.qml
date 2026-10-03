pragma ComponentBehavior: Bound
import QtQuick

Item {
    id: view
    required property var host
    required property var tvController
    property color accent: "#04c6a8"
    readonly property real uiScale: host.uiScale
    readonly property string nativeBase: "http://127.0.0.1:8080"
    property string tvDisplayName: "Mabel TV"
    property bool loading: false
    property string errorMessage: ""
    property string query: ""
    property bool keyboardVisible: false
    property bool detailVisible: false
    property int selectedZone: 1
    property int selectedRow: 0
    property int selectedCard: 0
    property int selectedShortcut: 0
    property var rowSelections: ({})
    property var sectionSelections: ({})
    property var backdrops: ({})
    property var attemptedBackdrops: ({})
    property var activeBackdropRequest: null
    property bool mabelVisible: false
    property var mabelChannel: null
    property var mabelChannels: []
    property var mabelItems: []
    readonly property var shortcuts: mabelVisible ? ["My TV", tvDisplayName]
        : rows.filter(row => row.title).map(row => row.title).concat([tvDisplayName])
    property var homeData: ({ "continue": [], "up_next": [], "library": [] })
    property var rows: []
    property var searchResults: []
    property var selectedPlayback: null
    property var activeSearchRequest: null
    property var activeDetailRequest: null
    property var activeHomeRequest: null
    property int searchGeneration: 0
    property int detailGeneration: 0
    property int homeGeneration: 0
    property var pendingRequests: []
    property alias artworkQueue: artworkQueue
    property alias browseContentY: browse.contentY
    anchors.fill: parent
    visible: !host.playing

    Rectangle { anchors.fill: parent; color: "#f3f5f7" }
    FontLoader { source: "qrc:/fonts/inter/InterVariable.ttf" }
    MyTvArtworkQueue { id: artworkQueue }
    MyTvMabelBrowse { id: family; host: view; objectName: "familyBrowse" }
    Row {
        id: heading
        x: 60 * view.uiScale; y: 38 * view.uiScale
        width: parent.width - 120 * view.uiScale; height: 86 * view.uiScale
        spacing: 30 * view.uiScale
        Column {
            width: parent.width * 0.52 - parent.spacing
            spacing: 3 * view.uiScale
            MyTvText { color: "#008b79"; font.weight: Font.DemiBold; font.letterSpacing: 2 * view.uiScale; font.pixelSize: 18 * view.uiScale; text: view.mabelVisible ? "YOUR CHANNELS · WITHOUT THE TV FRAME" : "YOUR FILMS AND SERIES" }
            MyTvText { width: parent.width; elide: Text.ElideRight; color: "#142029"; font.weight: Font.Bold; font.letterSpacing: -1 * view.uiScale; font.pixelSize: 52 * view.uiScale; text: view.mabelVisible ? view.mabelChannel?.title || view.tvDisplayName : "My TV" }
        }
        MyTvControl {
            width: parent.width * 0.48; height: 68 * view.uiScale
            anchors.verticalCenter: parent.verticalCenter
            uiScale: view.uiScale; highlighted: view.selectedZone === 0
            MyTvText {
                anchors.left: parent.left; anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter
                anchors.leftMargin: 65 * view.uiScale; anchors.rightMargin: 20 * view.uiScale
                verticalAlignment: Text.AlignVCenter
                color: view.query ? "#142029" : "#697984"
                font.pixelSize: 24 * view.uiScale
                elide: Text.ElideRight
                text: view.query || (view.mabelVisible ? view.mabelChannel ? "Search this channel" : "Search channels" : "Search films and series")
            }
            MyTvIcon {
                x: 23 * view.uiScale; anchors.verticalCenter: parent.verticalCenter
                width: 27 * view.uiScale; height: width; name: "search"
            }
        }
    }
    Row {
        id: shortcutsBar
        x: 60 * view.uiScale; y: 138 * view.uiScale
        spacing: 16 * view.uiScale; visible: !view.query.trim()
        Repeater {
            model: view.shortcuts
            delegate: MyTvControl {
                required property var modelData
                required property int index
                width: shortcutLabel.implicitWidth + 48 * view.uiScale; height: 52 * view.uiScale
                radius: height / 2
                uiScale: view.uiScale; highlighted: view.selectedZone === 2 && view.selectedShortcut === index
                checked: highlighted; accent: view.accent
                MyTvText { id: shortcutLabel; anchors.centerIn: parent; color: "#142a31"; font.weight: Font.DemiBold; font.pixelSize: 22 * view.uiScale; text: modelData }
            }
        }
    }
    ListView {
        id: browse
        x: 60 * view.uiScale; y: view.query.trim() ? 154 * view.uiScale : 216 * view.uiScale
        width: parent.width - 120 * view.uiScale
        height: parent.height - y - 30 * view.uiScale
        clip: true; spacing: 14 * view.uiScale
        cacheBuffer: 180 * view.uiScale
        visible: !view.detailVisible
        model: view.rows
        currentIndex: view.selectedRow
        onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)
        delegate: MyTvBrowseRow {
            required property int index
            required property var modelData
            host: view; rowData: modelData; rowIndex: index
            width: browse.width
        }
    }
    MyTvText {
        anchors.centerIn: browse
        visible: !view.rows.length
        color: "#647680"; font.pixelSize: 27 * view.uiScale
        text: view.loading ? "Loading your library…" : view.query ? "No matching titles" : "Your library is empty"
    }
    MyTvDetailView { id: detailView; host: view; visible: view.detailVisible; z: 10; onClosed: view.back() }
    Rectangle { visible: view.keyboardVisible; anchors.fill: parent; z: 19; color: "#660e1b23" }
    MyTvKeyboard {
        id: keyboard; host: view; visible: view.keyboardVisible; z: 20
        onAccepted: value => view.appendSearch(value)
        onClosed: { view.keyboardVisible = false; view.selectedZone = view.rows.length ? 1 : 0 }
    }
    Rectangle {
        visible: Boolean(view.errorMessage); z: 30
        anchors.horizontalCenter: parent.horizontalCenter; anchors.bottom: parent.bottom
        anchors.bottomMargin: 50 * view.uiScale
        width: Math.min(parent.width - 120 * view.uiScale, message.implicitWidth + 50 * view.uiScale)
        height: message.implicitHeight + 28 * view.uiScale
        radius: 10 * view.uiScale; color: "#142c34"
        MyTvText { id: message; anchors.centerIn: parent; width: parent.width - 40 * view.uiScale; color: "white"; font.pixelSize: 23 * view.uiScale; wrapMode: Text.WordWrap; text: view.errorMessage }
    }
    Timer { id: messageTimer; interval: 7000; onTriggered: view.errorMessage = "" }
    Timer { interval: 700; repeat: true; running: !view.host.playing && !view.detailVisible && !view.query.trim(); onTriggered: view.loadNextBackdrop() }
    Timer {
        interval: 1000; running: view.pendingRequests.length > 0; repeat: true
        onTriggered: {
            const now = Date.now()
            for (const pending of view.pendingRequests.slice()) {
                if (now > pending.deadline) pending.timeout()
                else if (pending.retryAt && now >= pending.retryAt) { pending.retryAt = 0; pending.resend() }
            }
        }
    }
    function notify(message) { errorMessage = message; messageTimer.restart() }
    function request(path, method, payload, success, failure) {
        const xhr = new XMLHttpRequest()
        const pending = { xhr: xhr, deadline: Date.now() + (path.includes("/launch") ? 25000 : 15000) }
        let finished = false
        let attempts = 0
        function remove() { view.pendingRequests = view.pendingRequests.filter(value => value !== pending) }
        pending.timeout = function() {
            if (finished) return
            finished = true; remove(); xhr.abort()
            if (failure) failure("Taking too long. Press OK to try again.")
        }
        pendingRequests = pendingRequests.concat([pending])
        function send() {
            if (finished) return
            xhr.open(method || "GET", nativeBase + path)
            xhr.setRequestHeader("X-MabelTV-Native", "1")
            if (payload !== null) xhr.setRequestHeader("Content-Type", "application/json")
            xhr.send(payload === null ? null : JSON.stringify(payload))
        }
        pending.resend = send
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE || finished) return
            if (xhr.status === 0 && (method || "GET") === "GET" && attempts++ < 1) {
                pending.retryAt = Date.now() + 400; return
            }
            finished = true; remove()
            if (xhr.status >= 200 && xhr.status < 300) {
                let data
                try { data = JSON.parse(xhr.responseText) }
                catch (error) { if (failure) failure("My TV returned invalid data"); return }
                success(data)
            } else if (failure) {
                let message = "My TV is unavailable. Press OK to retry."
                try { message = JSON.parse(xhr.responseText).error || message } catch (error) {}
                failure(message)
            }
        }
        send()
        return { abort: function() { if (!finished) { finished = true; remove(); xhr.abort() } } }
    }
    function open() {
        family.cancelChannel()
        mabelVisible = false; mabelChannel = null
        closeDetail(); keyboardVisible = false; selectedPlayback = null
        selectedZone = 1; selectedRow = 0; selectedCard = 0; query = ""
        rowSelections = {}; sectionSelections = {}; selectedShortcut = 0
        browse.contentY = 0; loadHome()
    }
    function loadHome() {
        if (mabelVisible) { if (mabelChannel) family.openChannel(mabelChannel, true); else family.showDirectory(); return }
        const generation = ++homeGeneration
        if (activeHomeRequest) activeHomeRequest.abort()
        loading = true
        activeHomeRequest = request("/api/native/my-tv/home", "GET", null, result => {
            if (generation !== homeGeneration) return
            homeData = result; tvDisplayName = result.tv_name || "Mabel TV"
            rebuildRows(); loading = false; activeHomeRequest = null
            family.prefetch()
            if (detailVisible && detailView.detail.on_mabeltv) {
                const detailToken = detailGeneration
                request("/api/native/my-tv/local-title?key=" + encodeURIComponent(detailView.detail.key), "GET", null, value => {
                    if (detailToken === detailGeneration && detailVisible) detailView.updatePlayback(value)
                })
            }
        }, message => { if (generation !== homeGeneration) return; loading = false; notify(message) })
    }
    function gridRows(next, title, values) {
        for (let index = 0; index < values.length; index += 6)
            next.push({ title: index === 0 ? title : "", wide: false, items: values.slice(index, index + 6) })
    }
    function loadMabel(channel) {
        if (channel) family.openChannel(channel, false); else family.showDirectory()
    }
    function openFamilyDetail(value) { detailView.open(value) }
    function updateFamilyDetail(value, preserve) {
        if (preserve) detailView.updatePlayback(value); else detailView.updateDetail(value)
    }
    function familyDetailKey() { return detailView.detail.key }
    function familyDetailLoading() { return detailView.loading || detailView.loadFailed }
    function failFamilyDetail(message) { detailView.loading = false; detailView.loadFailed = true; notify(message) }
    function rebuildRows() {
        const oldKey = currentItem()?.key, oldTitle = sectionTitle(selectedRow)
        const next = []
        if (mabelVisible) {
            const needle = query.trim().toLowerCase()
            const values = (mabelChannel ? mabelItems : mabelChannels).filter(value => !needle || value.title.toLowerCase().includes(needle))
            if (mabelChannel) gridRows(next, mabelChannel.content_type === "films" ? "Films in this channel" : "Episodes in this channel", values)
            else {
                gridRows(next, "Episode channels", values.filter(value => value.content_type !== "films"))
                gridRows(next, "Film channels", values.filter(value => value.content_type === "films"))
            }
        } else if (query.trim()) gridRows(next, "Search results · " + searchResults.length, searchResults)
        else {
            if ((homeData.continue || []).length) next.push({ title: "Continue watching", wide: true, items: homeData.continue })
            if ((homeData.up_next || []).length) next.push({ title: "Up next", wide: false, items: homeData.up_next })
            gridRows(next, "Films", (homeData.library || []).filter(value => value.media_type === "movie"))
            gridRows(next, "Series", (homeData.library || []).filter(value => value.media_type === "tv"))
        }
        rows = next
        if (!query.trim() && oldKey && oldTitle) {
            const first = rows.findIndex(row => row.title === oldTitle)
            for (let index = first; index >= 0 && index < rows.length && (index === first || !rows[index].title); index++) {
                const card = rows[index].items.findIndex(item => item.key === oldKey)
                if (card >= 0) { selectedRow = index; selectedCard = card; break }
            }
        }
        selectedRow = Math.max(0, Math.min(selectedRow, rows.length - 1))
        selectedCard = Math.max(0, Math.min(selectedCard, currentItems().length - 1))
    }
    function currentItems() { return rows[selectedRow]?.items || [] }
    function currentItem() { return currentItems()[selectedCard] || null }
    function sectionTitle(index) {
        while (index > 0 && !rows[index]?.title) index--
        return rows[index]?.title || ""
    }
    function rememberSelection() {
        rowSelections = Object.assign({}, rowSelections, { [selectedRow]: selectedCard })
        let headingRow = selectedRow
        while (headingRow > 0 && !rows[headingRow]?.title) headingRow--
        const title = rows[headingRow]?.title
        if (title) sectionSelections = Object.assign({}, sectionSelections, { [title]: { offset: selectedRow - headingRow, card: selectedCard, key: currentItem()?.key } })
    }
    function selectRow(index) {
        rememberSelection(); selectedRow = index
        selectedCard = Math.max(0, Math.min(rowSelections[index] || 0, currentItems().length - 1))
    }
    function jumpToSection() {
        const title = shortcuts[selectedShortcut], index = rows.findIndex(row => row.title === title)
        if (!mabelVisible && title === tvDisplayName) { family.enter(); return }
        if (mabelVisible) {
            query = ""
            if (title === "My TV") family.leave()
            else loadMabel(null)
            return
        }
        if (index < 0) return
        rememberSelection()
        const saved = sectionSelections[title]
        let last = index
        while (last + 1 < rows.length && !rows[last + 1].title) last++
        selectedRow = Math.min(last, index + (saved?.offset || 0))
        selectedCard = Math.max(0, Math.min(saved?.card || 0, currentItems().length - 1))
        if (saved?.key) for (let row = index; row <= last; row++) {
            const card = rows[row].items.findIndex(item => item.key === saved.key)
            if (card >= 0) { selectedRow = row; selectedCard = card; break }
        }
        selectedZone = 1; browse.positionViewAtIndex(selectedRow, ListView.Beginning)
    }
    function focusShortcuts() {
        rememberSelection()
        selectedShortcut = Math.max(0, shortcuts.indexOf(sectionTitle(selectedRow)))
        selectedZone = 2
    }
    function loadNextBackdrop() {
        if (mabelVisible || activeBackdropRequest || loading) return
        const item = (homeData.continue || []).find(value => value.tmdb_id && !value.backdrop_path
            && !Object.prototype.hasOwnProperty.call(backdrops, value.key) && !attemptedBackdrops[value.key])
        if (!item) return
        attemptedBackdrops = Object.assign({}, attemptedBackdrops, { [item.key]: true })
        activeBackdropRequest = request("/api/native/my-tv/backdrop?media_type=" + item.media_type + "&tmdb_id=" + item.tmdb_id, "GET", null,
            value => { backdrops = Object.assign({}, backdrops, { [value.key]: value.backdrop_path }); activeBackdropRequest = null },
            () => { activeBackdropRequest = null })
    }
    function artworkUrl(item, backdrop) {
        const landscape = item.backdrop_path || backdrops[item.key]
        const path = backdrop && landscape ? landscape : item.poster_path
        if ((!backdrop || !landscape) && item.poster_url) return nativeBase + item.poster_url
        return path ? nativeBase + "/api/native/my-tv/artwork/" + (backdrop ? "w780" : width >= 1800 ? "w500" : "w342")
            + "/" + encodeURIComponent(String(path).replace(/^\//, "")) : ""
    }
    function artworkFocus(item) {
        // Manually framed against the actual channel artwork, matching a 2:3 card.
        if (item.family_channel || item.borrowed) {
            const positions = { "postman pat": 0.79, "puffin rock": 0.85,
                "zog": 0.85, "waffle dog": 0.53, "waffle the wonder dog": 0.53 }
            const x = positions[String(item.title || "").trim().toLowerCase()]
            if (x !== undefined) return { x: x, y: 0.5 }
        }
        return { x: 0.5, y: 0.5 }
    }
    function progressRatio(item) { const value = item.progress || {}; return value.duration > 0 ? Math.min(1, value.position / value.duration) : 0 }
    function progressLabel(item) {
        if (item.series_progress?.state === "next") {
            const next = item.series_progress.next_episode
            return "NEXT · S" + next.season + " E" + next.number
        }
        const episode = item.progress?.episode
        return episode ? "CONTINUE · S" + episode.season + " E" + (episode.number || episode.episode) : "CONTINUE"
    }
    function remainingLabel(playable) {
        const position = Number(playable?.remote_position ?? playable?.position ?? 0)
        const duration = Number(playable?.remote_duration ?? playable?.duration ?? 0)
        return duration > position && position >= 30 ? Math.ceil((duration - position) / 60) + " min left" : ""
    }
    function appendSearch(value) {
        if (value === "\b") query = query.slice(0, -1)
        else if (value === "CLEAR") query = ""
        else query += value
        beginSearch()
    }
    function appendRemoteText(value) {
        if (detailVisible) closeDetail()
        selectedZone = 0; appendSearch(value)
    }
    function beginSearch() {
        searchGeneration++
        if (activeSearchRequest) activeSearchRequest.abort()
        activeSearchRequest = null; loading = false
        const needle = query.trim().toLowerCase()
        if (mabelVisible) { selectedRow = 0; selectedCard = 0; rebuildRows(); searchTimer.stop(); return }
        const found = {}; searchResults = []
        for (const item of (homeData.library || []).concat(homeData.up_next || []))
            if (needle && !found[item.key] && String(item.title).toLowerCase().includes(needle)) {
                found[item.key] = true; searchResults.push(item)
            }
        selectedRow = 0; selectedCard = 0; rebuildRows(); browse.contentY = 0
        if (needle.length >= 3) searchTimer.restart(); else searchTimer.stop()
    }
    function openSelected() {
        const item = currentItem()
        if (!item) { loadHome(); return }
        if (item.family_channel) { loadMabel(item); return }
        rememberSelection()
        if (activeBackdropRequest) { activeBackdropRequest.abort(); activeBackdropRequest = null }
        closeDetail()
        const generation = ++detailGeneration
        detailVisible = true; detailView.open(item)
        if (item.borrowed) { detailView.updateDetail(item); return }
        const path = item.tmdb_id ? "/api/native/my-tv/title?media_type=" + item.media_type + "&tmdb_id=" + item.tmdb_id
            : "/api/native/my-tv/local-title?key=" + encodeURIComponent(item.key)
        activeDetailRequest = request(path, "GET", null, result => {
            if (generation !== detailGeneration || !detailVisible) return
            detailView.updateDetail(result); activeDetailRequest = null
        }, message => { if (generation === detailGeneration && detailVisible) { detailView.loading = false; detailView.loadFailed = true; notify(message) } })
    }
    function closeDetail() {
        detailGeneration++; if (activeDetailRequest) activeDetailRequest.abort()
        activeDetailRequest = null; detailView.cancel(); detailVisible = false
    }
    function playItem(item, episode, fromStart) {
        const playable = episode || (item.media_type === "tv" ? item.next_playable : item)
        if (!playable?.source) { notify("Choose a streaming service below"); return }
        selectedPlayback = { name: item.title + (item.media_type === "tv" ? " · S" + playable.season + " E" + playable.number : ""),
            source: playable.source, id: playable.library_id || item.local?.library_id }
        if (item.media_type === "tv") selectedPlayback = Object.assign({}, selectedPlayback, {
            season: playable.season, number: playable.number, episodeTitle: playable.name,
            series: { id: item.local?.id, key: item.key, title: item.title, domain: item.borrowed ? "mabel" : "my-tv",
                episodes: item.local_episodes || [] } })
        if (item.borrowed) selectedPlayback = Object.assign({}, selectedPlayback, { mabel: playable.mabel || item.mabel })
        if (!selectedPlayback.id) { notify("This title has no playback identity"); return }
        const position = fromStart ? 0 : episode || item.media_type === "tv"
            ? Number(playable.remote_position || 0) : Number(item.progress?.position || 0)
        host.startNativePlayback(selectedPlayback, position)
    }
    function detailProviders(item) {
        return (item.services || []).map(value => Object.assign({}, value, {
            asset: value.asset ? nativeBase + "/portal/assets/providers/" + value.asset
                : value.logo_path ? artworkUrl({ poster_path: value.logo_path }, false) : ""
        }))
    }
    function launchProvider(provider, item) {
        if (!provider?.shortcut) { notify("That service is not available on the connected TV"); return }
        notify("Opening " + provider.name + "…")
        request("/api/native/my-tv/launch", "POST", { provider: provider.name,
            destination: provider.destination, title: item.title, media_type: item.media_type, tmdb_id: item.tmdb_id },
            result => notify(result.message || "Opened " + provider.name), message => notify(message))
    }
    function back() {
        if (keyboardVisible) { keyboardVisible = false; return true }
        if (detailVisible) {
            if (mabelVisible && mabelChannel?.content_type !== "films") family.showDirectory()
            else closeDetail()
            return true
        }
        if (mabelVisible) {
            query = ""
            if (mabelChannel) loadMabel(null)
            else family.leave()
            return true
        }
        if (query) { query = ""; beginSearch(); selectedZone = 1; return true }
        if (selectedZone === 1 && selectedRow > 0) { focusShortcuts(); return true }
        return false
    }
    function handleKey(key) {
        if (keyboardVisible) return keyboard.handleKey(key)
        if (detailVisible) return detailView.handleKey(key)
        if (key === Qt.Key_Escape || key === Qt.Key_Backspace || key === Qt.Key_B) return false
        if (mabelVisible && loading) return true
        if (selectedZone === 0) {
            if (key === Qt.Key_Down && rows.length) selectedZone = query.trim() ? 1 : 2
            else if (key === Qt.Key_Return || key === Qt.Key_Enter) keyboardVisible = true
            else return false
            return true
        }
        if (selectedZone === 2) {
            if (key === Qt.Key_Left) selectedShortcut = Math.max(0, selectedShortcut - 1)
            else if (key === Qt.Key_Right) selectedShortcut = Math.min(shortcuts.length - 1, selectedShortcut + 1)
            else if (key === Qt.Key_Up) selectedZone = 0
            else if (key === Qt.Key_Down || key === Qt.Key_Return || key === Qt.Key_Enter) jumpToSection()
            else return false
            return true
        }
        if (key === Qt.Key_Left) selectedCard = Math.max(0, selectedCard - 1)
        else if (key === Qt.Key_Right) selectedCard = Math.min(currentItems().length - 1, selectedCard + 1)
        else if (key === Qt.Key_Up) {
            if (selectedRow > 0) selectRow(selectedRow - 1)
            else if (query.trim()) selectedZone = 0
            else focusShortcuts()
        } else if (key === Qt.Key_Down && selectedRow + 1 < rows.length) {
            selectRow(selectedRow + 1)
        } else if (key === Qt.Key_Return || key === Qt.Key_Enter) openSelected()
        else return false
        return true
    }
    Timer {
        id: searchTimer; interval: 350
        onTriggered: {
            const submitted = view.query.trim(), generation = view.searchGeneration
            view.loading = true
            view.activeSearchRequest = view.request("/api/native/my-tv/search?q=" + encodeURIComponent(submitted), "GET", null, result => {
                if (generation !== view.searchGeneration || submitted !== view.query.trim()) return
                const seen = {}, merged = []
                for (const item of view.searchResults.concat(result.results || [])) if (!seen[item.key]) { seen[item.key] = true; merged.push(item) }
                view.searchResults = merged; view.rebuildRows(); view.loading = false; view.activeSearchRequest = null
            }, message => { if (generation === view.searchGeneration) { view.loading = false; view.notify(message) } })
        }
    }
}
