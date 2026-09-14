pragma ComponentBehavior: Bound

import QtQuick

Item {
    id: view
    required property var host
    required property var tvController
    property color accent: "#10cfb2"
    property bool loading: false
    property string errorMessage: ""
    property string query: ""
    property bool keyboardVisible: false
    property bool detailVisible: false
    property int selectedZone: 1
    property int selectedRow: 0
    property int selectedCard: 0
    property var homeData: ({ "continue": [], "up_next": [], "recommended": [], "library": [] })
    property var searchResults: []
    property var rows: []
    property var currentDetail: ({})
    property var selectedPlayback: null
    property var activeSearchRequest: null
    property var activeDetailRequest: null
    property int searchGeneration: 0
    property int detailGeneration: 0
    property int homeGeneration: 0
    readonly property real uiScale: host.uiScale
    readonly property string nativeBase: "http://127.0.0.1:8080"

    onSelectedRowChanged: Qt.callLater(ensureSelectedRowVisible)

    anchors.fill: parent
    visible: !host.playing

    Rectangle {
        anchors.fill: parent
        color: "#f2f4f7"
        gradient: Gradient {
            GradientStop { position: 0; color: "#ffffff" }
            GradientStop { position: 0.58; color: "#f5f7f9" }
            GradientStop { position: 1; color: "#edf0f4" }
        }
    }
    Rectangle {
        anchors.right: parent.right
        anchors.top: parent.top
        width: parent.width * 0.46
        height: parent.height * 0.38
        radius: width
        color: "#1810cfb2"
    }

    Column {
        id: page
        anchors.fill: parent
        anchors.leftMargin: 58 * view.uiScale
        anchors.rightMargin: 58 * view.uiScale
        anchors.topMargin: 34 * view.uiScale
        anchors.bottomMargin: 30 * view.uiScale
        spacing: 18 * view.uiScale

        Row {
            width: parent.width
            height: 76 * view.uiScale
            Column {
                width: parent.width * 0.55
                spacing: 2 * view.uiScale
                Text {
                    color: view.accent
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.letterSpacing: 2.3 * view.uiScale
                    font.pixelSize: 13 * view.uiScale
                    text: "YOUR FILMS AND SERIES"
                }
                Text {
                    color: "#11151d"
                    font.family: "DejaVu Sans"
                    font.bold: true
                    font.pixelSize: 38 * view.uiScale
                    text: "What do you want to watch?"
                }
            }
            Rectangle {
                width: parent.width * 0.45
                height: 58 * view.uiScale
                anchors.verticalCenter: parent.verticalCenter
                radius: 13 * view.uiScale
                color: "white"
                border.width: view.selectedZone === 0 ? 4 * view.uiScale : 1
                border.color: view.selectedZone === 0 ? view.accent : "#d5dbe1"
                Row {
                    anchors.fill: parent
                    anchors.leftMargin: 18 * view.uiScale
                    anchors.rightMargin: 18 * view.uiScale
                    spacing: 13 * view.uiScale
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        color: view.accent
                        font.pixelSize: 26 * view.uiScale
                        text: "⌕"
                    }
                    Text {
                        width: parent.width - 45 * view.uiScale
                        anchors.verticalCenter: parent.verticalCenter
                        color: view.query.length ? "#161b22" : "#737c88"
                        elide: Text.ElideRight
                        font.family: "DejaVu Sans"
                        font.pixelSize: 16 * view.uiScale
                        text: view.query.length ? view.query : "Search films and series"
                    }
                }
            }
        }

        Flickable {
            id: shelves
            width: parent.width
            height: parent.height - 112 * view.uiScale
            contentHeight: shelfColumn.implicitHeight
            clip: true

            Column {
                id: shelfColumn
                width: parent.width
                spacing: 22 * view.uiScale
                Repeater {
                    id: shelfRepeater
                    model: view.rows
                    delegate: Column {
                        id: shelfDelegate
                        required property int index
                        required property var modelData
                        readonly property int rowIndex: index
                        readonly property var rowData: modelData
                        width: shelfColumn.width
                        spacing: 10 * view.uiScale
                        Row {
                            width: parent.width
                            Text {
                                width: parent.width * 0.78
                                color: "#151922"
                                font.family: "DejaVu Sans"
                                font.bold: true
                                font.pixelSize: 24 * view.uiScale
                                text: modelData.title
                            }
                            Text {
                                width: parent.width * 0.22
                                horizontalAlignment: Text.AlignRight
                                color: "#747d89"
                                font.family: "DejaVu Sans"
                                font.pixelSize: 13 * view.uiScale
                                text: modelData.items.length + (modelData.wide ? " in progress" : " titles")
                            }
                        }
                        ListView {
                            id: cardList
                            property int shelfIndex: shelfDelegate.rowIndex
                            property bool shelfWide: Boolean(shelfDelegate.rowData.wide)
                            width: parent.width
                            height: shelfWide ? 190 * view.uiScale : 310 * view.uiScale
                            orientation: ListView.Horizontal
                            spacing: 15 * view.uiScale
                            clip: false
                            model: shelfDelegate.rowData.items
                            currentIndex: shelfIndex === view.selectedRow ? view.selectedCard : 0
                            onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)
                            delegate: MyTvCard {
                                required property int index
                                host: view
                                modelData: cardList.model[index]
                                wide: cardList.shelfWide
                                selected: view.selectedZone === 1
                                    && cardList.shelfIndex === view.selectedRow
                                    && index === view.selectedCard
                            }
                        }
                    }
                }
                Text {
                    visible: !view.loading && view.rows.length === 0
                    width: parent.width
                    color: "#68717d"
                    horizontalAlignment: Text.AlignHCenter
                    font.family: "DejaVu Sans"
                    font.pixelSize: 18 * view.uiScale
                    text: view.errorMessage || "There is nothing to show here yet."
                }
            }
        }
    }

    Rectangle {
        visible: view.loading
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: 34 * view.uiScale
        width: loadingText.implicitWidth + 28 * view.uiScale
        height: 42 * view.uiScale
        radius: height / 2
        color: "#e8ffffff"
        border.width: 1
        border.color: "#d5dbe1"
        Text {
            id: loadingText
            anchors.centerIn: parent
            color: view.accent
            font.family: "DejaVu Sans"
            font.bold: true
            font.pixelSize: 13 * view.uiScale
            text: "Loading My TV…"
        }
    }

    MyTvDetailView {
        id: detailView
        host: view
        visible: view.detailVisible
        z: 10
        onClosed: view.detailVisible = false
    }
    Rectangle {
        visible: view.keyboardVisible
        anchors.fill: parent
        z: 19
        color: "#66070a0d"
    }
    MyTvKeyboard {
        id: keyboard
        host: view
        visible: view.keyboardVisible
        z: 20
        onAccepted: value => view.appendSearch(value)
        onClosed: view.keyboardVisible = false
    }

    function request(path, method, payload, success, failure) {
        const xhr = new XMLHttpRequest()
        xhr.open(method || "GET", nativeBase + path)
        xhr.setRequestHeader("X-MabelTV-Native", "1")
        if (payload !== null) xhr.setRequestHeader("Content-Type", "application/json")
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE) return
            if (xhr.status >= 200 && xhr.status < 300) {
                try { success(JSON.parse(xhr.responseText)) }
                catch (error) { if (failure) failure("My TV returned invalid data") }
            } else if (failure) {
                try { failure(JSON.parse(xhr.responseText).error || "My TV is unavailable") }
                catch (error) { failure("My TV is unavailable") }
            }
        }
        xhr.send(payload === null ? null : JSON.stringify(payload))
        return xhr
    }

    function open() {
        detailVisible = false
        keyboardVisible = false
        selectedZone = 1
        selectedRow = 0
        selectedCard = 0
        query = ""
        loadHome()
    }
    function loadHome() {
        const generation = ++homeGeneration
        loading = true
        errorMessage = ""
        request("/api/native/my-tv/home", "GET", null, result => {
            if (generation !== homeGeneration) return
            homeData = result; rebuildRows(); loading = false
            recommendationTimer.restart()
        }, message => { errorMessage = message; loading = false; rebuildRows() })
    }
    function rebuildRows() {
        if (query.length) {
            rows = searchResults.length ? [{ title: "Search results", items: searchResults, wide: false }] : []
        } else {
            const next = []
            if ((homeData.continue || []).length) next.push({ title: "Continue watching", items: homeData.continue, wide: true })
            if ((homeData.up_next || []).length) next.push({ title: "Up next", items: homeData.up_next, wide: false })
            if ((homeData.recommended || []).length) next.push({ title: "What to watch", items: homeData.recommended, wide: false })
            if ((homeData.library || []).length) next.push({ title: "From your library", items: homeData.library, wide: false })
            rows = next
        }
        selectedRow = Math.max(0, Math.min(selectedRow, rows.length - 1))
        selectedCard = Math.max(0, Math.min(selectedCard, currentItems().length - 1))
    }
    function currentItems() { return rows.length > selectedRow ? rows[selectedRow].items : [] }
    function currentItem() { const values = currentItems(); return values.length > selectedCard ? values[selectedCard] : null }
    function ensureSelectedRowVisible() {
        const row = shelfRepeater.itemAt(selectedRow)
        if (!row) return
        const top = row.y
        const bottom = row.y + row.height
        if (top < shelves.contentY) shelves.contentY = top
        else if (bottom > shelves.contentY + shelves.height)
            shelves.contentY = Math.min(shelves.contentHeight - shelves.height,
                                        bottom - shelves.height)
    }
    function artworkUrl(item, backdrop) {
        const path = backdrop && item.backdrop_path ? item.backdrop_path : item.poster_path
        return path ? nativeBase + "/api/native/my-tv/artwork/" + (backdrop ? "w780" : "w342")
            + "/" + encodeURIComponent(String(path).replace(/^\//, "")) : ""
    }
    function providerPriority(name) {
        const value = String(name || "").toLowerCase()
        if (value.includes("mabel")) return 0
        if (value.includes("netflix")) return 1
        if (value.includes("prime") || value.includes("amazon")) return 2
        if (value.includes("iplayer") || value.includes("bbc")) return 3
        if (value.includes("channel 4") || value.includes("all 4")) return 4
        if (value.includes("itv")) return 5
        if (value.includes("sky")) return 6
        if (value.includes("now") || value.includes("max")) return 1000
        return 100
    }
    function providerEntry(value) {
        const name = String(value.name || "Streaming service")
        const lowered = name.toLowerCase()
        let localAsset = ""
        if (lowered.includes("netflix")) localAsset = "netflix-app.jpg"
        else if (lowered.includes("prime") || lowered.includes("amazon")) localAsset = "prime-video-app.jpg"
        else if (lowered.includes("iplayer") || lowered.includes("bbc")) localAsset = "bbc-iplayer-app.jpg"
        else if (lowered.includes("channel 4") || lowered.includes("all 4")) localAsset = "channel-4-app.jpg"
        else if (lowered.includes("itv")) localAsset = "itvx-app.jpg"
        else if (lowered.includes("sky")) localAsset = "sky-go-app.jpg"
        else if (lowered.includes("disney")) localAsset = "disney-plus-app.jpg"
        else if (lowered.includes("paramount")) localAsset = "paramount-plus-app.jpg"
        else if (lowered.includes("apple")) localAsset = "apple-tv-app.jpg"
        else if (lowered.includes("now")) localAsset = "now-app.jpg"
        return { name: name, asset: localAsset ? nativeBase + "/portal/assets/providers/" + localAsset
            : (value.logo_path ? nativeBase + "/api/native/my-tv/artwork/w92/"
                + encodeURIComponent(String(value.logo_path).replace(/^\//, "")) : ""),
            destination: value.android_url || value.web_url || "", raw: value }
    }
    function providerBadges(item) {
        const values = []
        if (item.on_mabeltv) values.push({ name: tvDisplayName, asset: nativeBase + "/apple-touch-icon.png", local: true })
        for (const provider of item.providers || []) {
            if (!["flatrate", "free", "ads"].includes(String(provider.type || "").toLowerCase())) continue
            if (!values.some(value => value.name === provider.name)) values.push(providerEntry(provider))
        }
        for (const source of item.provider_sources || []) {
            if (!["sub", "free", "tve", "ads"].includes(String(source.type || "").toLowerCase())) continue
            if (!values.some(value => String(value.name).toLowerCase() === String(source.name).toLowerCase()))
                values.push(providerEntry(source))
        }
        values.sort((left, right) => providerPriority(left.name) - providerPriority(right.name))
        return values.slice(0, 2)
    }
    function detailProviders(item) {
        const values = []
        if (item.on_mabeltv)
            values.push({ name: tvDisplayName, asset: nativeBase + "/apple-touch-icon.png", local: true })
        for (const provider of item.providers || []) {
            if (["flatrate", "free", "ads"].includes(String(provider.type || "").toLowerCase())
                    && !values.some(value => value.name === provider.name))
                values.push(providerEntry(provider))
        }
        for (const source of item.provider_result?.sources || []) {
            if (!["sub", "free", "tve", "ads"].includes(String(source.type || "").toLowerCase())) continue
            if (!values.some(value => String(value.name).toLowerCase() === String(source.name).toLowerCase())) values.push(providerEntry(source))
        }
        values.sort((left, right) => providerPriority(left.name) - providerPriority(right.name))
        return values
    }
    function progressRatio(item) {
        const progress = item.progress || item.local_progress || {}
        const duration = Number(progress.duration || 0)
        return duration > 0 ? Math.min(1, Number(progress.position || 0) / duration) : 0
    }
    function progressLabel(item) {
        const episode = item.progress?.episode
        return episode ? "Continue · S" + String(episode.season).padStart(2, "0")
            + " E" + String(episode.episode).padStart(2, "0") : "Continue"
    }
    function appendSearch(value) {
        if (value === "\b") query = query.slice(0, -1)
        else query += value
        beginSearch()
    }
    function appendRemoteText(value) {
        selectedZone = 0; keyboardVisible = true
        if (value === "\b") appendSearch(value)
        else { query += value; beginSearch() }
    }
    function localSearchResults(value) {
        const needle = String(value || "").trim().toLowerCase()
        if (!needle.length) return []
        const found = []
        const seen = ({})
        const pools = [homeData.continue || [], homeData.up_next || [],
                       homeData.recommended || [], homeData.library || []]
        for (const pool of pools) for (const item of pool) {
            const key = item.key || item.media_type + ":" + item.tmdb_id
            if (seen[key]) continue
            if ((String(item.title || "") + " " + String(item.year || "")).toLowerCase().includes(needle)) {
                seen[key] = true
                found.push(item)
            }
        }
        return found
    }
    function beginSearch() {
        searchGeneration++
        if (activeSearchRequest) { activeSearchRequest.abort(); activeSearchRequest = null }
        searchResults = localSearchResults(query)
        selectedRow = 0; selectedCard = 0; rebuildRows()
        if (query.trim().length >= 3) searchTimer.restart()
        else searchTimer.stop()
    }
    function openSelected() {
        const item = currentItem()
        if (!item) return
        if (!Number(item.tmdb_id || 0)) {
            currentDetail = item; detailView.open(item); detailVisible = true; return
        }
        const generation = ++detailGeneration
        if (activeDetailRequest) activeDetailRequest.abort()
        currentDetail = item; detailView.open(item); detailVisible = true
        activeDetailRequest = request("/api/native/my-tv/title?media_type=" + item.media_type + "&tmdb_id=" + item.tmdb_id,
                "GET", null, result => {
            if (generation !== detailGeneration || !detailVisible) return
            if (item.local) result.local = item.local
            result.on_mabeltv = item.on_mabeltv || result.on_mabeltv
            currentDetail = result; detailView.open(result)
            if (generation === detailGeneration) activeDetailRequest = null
        }, message => {
            if (generation === detailGeneration && detailVisible) errorMessage = message
            if (generation === detailGeneration) activeDetailRequest = null
        })
    }
    function detailActions(item) {
        const actions = []
        if (item.on_mabeltv && item.local) actions.push({ id: "play", label: item.media_type === "tv" ? "▶ Play next episode" : "▶ Play" })
        return actions
    }
    function runDetailAction(action, item) {
        if (action.id !== "play") return
        let playable = item
        if (item.media_type === "tv") {
            const episodes = item.local?.episodes || []
            playable = episodes.find(value => !value.watched) || episodes[0]
        }
        if (playable?.source) {
            selectedPlayback = { name: item.title, source: playable.source,
                id: playable.library_id || item.local?.library_id || item.key }
            host.startNativePlayback(selectedPlayback, Number(playable.remote_position || 0))
        }
    }
    function launchProvider(provider, item) {
        if (provider.local) { runDetailAction({ id: "play" }, item); return }
        loading = true
        request("/api/native/my-tv/launch", "POST", { provider: provider.name,
            destination: provider.destination, title: item.title,
            media_type: item.media_type, tmdb_id: item.tmdb_id }, result => {
            errorMessage = result.message || "Opening " + provider.name; loading = false
        }, message => { errorMessage = message; loading = false })
    }
    function back() {
        if (keyboardVisible) { keyboardVisible = false; return true }
        if (detailVisible) {
            detailGeneration++; if (activeDetailRequest) activeDetailRequest.abort()
            activeDetailRequest = null; detailVisible = false; return true
        }
        if (query.length) {
            searchGeneration++; if (activeSearchRequest) activeSearchRequest.abort()
            activeSearchRequest = null; query = ""; searchResults = []; rebuildRows(); return true
        }
        if (selectedZone === 1) { selectedZone = 0; return true }
        return false
    }
    function handleKey(key) {
        if (keyboardVisible) return keyboard.handleKey(key)
        if (detailVisible) return detailView.handleKey(key)
        if (key === Qt.Key_Escape || key === Qt.Key_Backspace || key === Qt.Key_B) return false
        if (selectedZone === 0) {
            if (key === Qt.Key_Down && rows.length) selectedZone = 1
            else if (key === Qt.Key_Return || key === Qt.Key_Enter) keyboardVisible = true
            else return false
            return true
        }
        if (key === Qt.Key_Left) selectedCard = Math.max(0, selectedCard - 1)
        else if (key === Qt.Key_Right) selectedCard = Math.min(currentItems().length - 1, selectedCard + 1)
        else if (key === Qt.Key_Up) {
            if (selectedRow > 0) { selectedRow--; selectedCard = Math.min(selectedCard, currentItems().length - 1) }
            else selectedZone = 0
        } else if (key === Qt.Key_Down && selectedRow + 1 < rows.length) {
            selectedRow++; selectedCard = Math.min(selectedCard, currentItems().length - 1)
        } else if (key === Qt.Key_Return || key === Qt.Key_Enter) openSelected()
        else return false
        return true
    }

    Timer {
        id: searchTimer
        interval: 650
        repeat: false
        onTriggered: {
            const submitted = view.query.trim()
            if (submitted.length < 3) return
            const generation = view.searchGeneration
            view.activeSearchRequest = view.request(
                "/api/native/my-tv/search?q=" + encodeURIComponent(submitted), "GET", null,
                result => {
                    if (generation !== view.searchGeneration || submitted !== view.query.trim()) return
                    view.searchResults = result.results || []; view.selectedRow = 0; view.selectedCard = 0
                    view.rebuildRows(); view.activeSearchRequest = null
                }, message => {
                    if (generation === view.searchGeneration) view.errorMessage = message
                    if (generation === view.searchGeneration) view.activeSearchRequest = null
                })
        }
    }
    Timer {
        id: recommendationTimer
        interval: 120
        repeat: false
        onTriggered: {
            const generation = view.homeGeneration
            view.request("/api/native/my-tv/recommendations", "GET", null, result => {
                if (generation !== view.homeGeneration) return
                const updated = Object.assign({}, view.homeData)
                updated.recommended = result.results || []
                view.homeData = updated
                if (!view.query.length) view.rebuildRows()
            })
        }
    }
}
